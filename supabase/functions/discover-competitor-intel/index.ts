// Competitor intel discovery — runs daily per org via pg_cron, or on-demand
// from /intel "Refresh now". For each active competitor:
//
//   1. Fetch sitemap.xml (with fallback to /sitemap_index.xml + crawl of
//      common paths). Compare URL set to last snapshot → new URLs become
//      `new_page` events with title/H1/meta-description extracted from
//      a follow-up fetch of the page.
//
//   2. Fetch RSS/Atom feed (auto-discover from HTML <link rel="alternate">
//      if no explicit competitor.rss_url). Compare item GUIDs to last
//      snapshot → new items become `blog_post` events.
//
//   3. (Later) Apify-based social monitoring.
//
// Idempotent: re-running the same day surfaces no duplicate events because
// we compare to the latest snapshot, not to all-time history.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

interface Competitor {
  id: string
  name: string
  website_url: string
  rss_url: string | null
}

interface EventDraft {
  org_id: string
  competitor_id: string
  kind: 'new_page' | 'blog_post' | 'website_change' | 'social_post' | 'new_competitor'
  source_url: string
  title?: string
  summary?: string
  meta?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  const body = await req.json().catch(() => ({}))
  const org_id = body.org_id as string | undefined
  if (!org_id) return jsonError("org_id is required", 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("id, name, website_url, rss_url")
    .eq("org_id", org_id)
    .eq("is_active", true)
  if (error) return jsonError(`competitors lookup failed: ${error.message}`, 500)
  if (!competitors?.length) {
    return new Response(JSON.stringify({ success: true, competitor_count: 0, events_created: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let eventsCreated = 0
  const perCompetitor: Array<{ competitor: string; new_pages: number; new_posts: number; error?: string }> = []

  for (const c of competitors as Competitor[]) {
    const result = { competitor: c.name, new_pages: 0, new_posts: 0, error: undefined as string | undefined }
    try {
      // ── Sitemap diff ────────────────────────────────────────────────────
      const freshUrls = await fetchSitemapUrls(c.website_url)
      if (freshUrls.size > 0) {
        const { data: lastSnap } = await supabase
          .from("competitor_snapshots")
          .select("payload")
          .eq("competitor_id", c.id)
          .eq("kind", "sitemap")
          .order("taken_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        const previousUrls = new Set<string>(
          Array.isArray(lastSnap?.payload?.urls) ? lastSnap!.payload!.urls as string[] : []
        )
        // First run with no prior snapshot: store, don't emit events (would
        // otherwise flood the timeline with hundreds of "new" pages).
        const isFirstRun = previousUrls.size === 0

        if (!isFirstRun) {
          const newUrls = [...freshUrls].filter(u => !previousUrls.has(u))
          // Filter out obvious non-content paths (paginated archives, query strings,
          // tag/category pages) so the timeline isn't junked up.
          const meaningful = newUrls.filter(isMeaningfulUrl).slice(0, 20)

          // Fetch meta for each new page to enrich the event
          for (const url of meaningful) {
            const meta = await fetchPageMeta(url)
            const draft: EventDraft = {
              org_id, competitor_id: c.id, kind: 'new_page',
              source_url: url,
              title: meta.title ?? url,
              summary: meta.description ?? meta.h1 ?? undefined,
              meta: { h1: meta.h1, og_image: meta.og_image },
            }
            await supabase.from("competitor_events").insert(draft)
            result.new_pages++
            eventsCreated++
          }
        }

        await supabase.from("competitor_snapshots").insert({
          competitor_id: c.id,
          kind: "sitemap",
          payload: { urls: [...freshUrls], count: freshUrls.size, first_run: isFirstRun },
        })
      }

      // ── RSS diff ────────────────────────────────────────────────────────
      const rssUrl = c.rss_url ?? await discoverRssUrl(c.website_url)
      if (rssUrl) {
        const items = await fetchRssItems(rssUrl)
        if (items.length > 0) {
          const { data: lastSnap } = await supabase
            .from("competitor_snapshots")
            .select("payload")
            .eq("competitor_id", c.id)
            .eq("kind", "rss")
            .order("taken_at", { ascending: false })
            .limit(1)
            .maybeSingle()

          const previousGuids = new Set<string>(
            Array.isArray(lastSnap?.payload?.guids) ? lastSnap!.payload!.guids as string[] : []
          )
          const isFirstRun = previousGuids.size === 0

          if (!isFirstRun) {
            const newItems = items.filter(it => !previousGuids.has(it.guid)).slice(0, 10)
            for (const it of newItems) {
              const draft: EventDraft = {
                org_id, competitor_id: c.id, kind: 'blog_post',
                source_url: it.link,
                title: it.title,
                summary: it.description?.slice(0, 240),
                meta: { pubDate: it.pubDate },
              }
              await supabase.from("competitor_events").insert(draft)
              result.new_posts++
              eventsCreated++
            }
          }

          await supabase.from("competitor_snapshots").insert({
            competitor_id: c.id,
            kind: "rss",
            payload: {
              guids: items.map(i => i.guid),
              feed_url: rssUrl,
              first_run: isFirstRun,
            },
          })
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
    }
    perCompetitor.push(result)
  }

  return new Response(JSON.stringify({
    success: true,
    competitor_count: competitors.length,
    events_created: eventsCreated,
    per_competitor: perCompetitor,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
})

// ─── Sitemap ─────────────────────────────────────────────────────────────

async function fetchSitemapUrls(websiteUrl: string): Promise<Set<string>> {
  const base = new URL(websiteUrl)
  const urls = new Set<string>()
  const candidates = [
    `${base.origin}/sitemap.xml`,
    `${base.origin}/sitemap_index.xml`,
    `${base.origin}/sitemap-index.xml`,
  ]
  for (const candidate of candidates) {
    try {
      const text = await fetchText(candidate)
      if (!text) continue
      // <sitemap> entries point to child sitemaps; <url> entries are the leaves.
      const childSitemaps = [...text.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi)].map(m => m[1].trim())
      if (childSitemaps.length > 0) {
        for (const child of childSitemaps.slice(0, 10)) {
          const childText = await fetchText(child)
          if (childText) extractUrlsInto(childText, urls)
        }
      } else {
        extractUrlsInto(text, urls)
      }
      if (urls.size > 0) break  // first responsive sitemap wins
    } catch { /* try the next */ }
  }
  return urls
}

function extractUrlsInto(xml: string, set: Set<string>) {
  for (const m of xml.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/gi)) {
    set.add(m[1].trim())
  }
}

// Filter URLs that look like content additions vs noise (paginated archives,
// tag pages, etc.). Heuristic — biased toward false positives over noise.
function isMeaningfulUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    if (!path || path === '/') return false
    if (u.search.length > 1) return false
    if (/\/page\/\d+|\/tag\/|\/category\/|\/author\/|\/feed|\/comments|\.xml$|\.json$/i.test(path)) return false
    return true
  } catch { return false }
}

// ─── Page meta extraction ────────────────────────────────────────────────

interface PageMeta { title?: string; description?: string; h1?: string; og_image?: string }

async function fetchPageMeta(url: string): Promise<PageMeta> {
  try {
    const html = await fetchText(url)
    if (!html) return {}
    const headSlice = html.slice(0, 50_000)
    const og = (re: RegExp) => headSlice.match(re)?.[1]?.trim()
    return {
      title:       og(/<title[^>]*>([\s\S]*?)<\/title>/i)?.replace(/\s+/g, ' '),
      description: og(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                    ?? og(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
      h1:          og(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
      og_image:    og(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    }
  } catch { return {} }
}

// ─── RSS ─────────────────────────────────────────────────────────────────

interface RssItem { guid: string; title?: string; link: string; description?: string; pubDate?: string }

async function discoverRssUrl(websiteUrl: string): Promise<string | null> {
  // Hit homepage, look for <link rel="alternate" type="application/rss+xml">
  try {
    const html = await fetchText(websiteUrl)
    if (!html) return null
    const m = html.match(/<link[^>]+rel=["'](?:alternate|feed)["'][^>]+type=["'][^"']*(?:rss|atom)[^"']*["'][^>]+href=["']([^"']+)["']/i)
                ?? html.match(/<link[^>]+type=["'][^"']*(?:rss|atom)[^"']*["'][^>]+href=["']([^"']+)["']/i)
    if (m?.[1]) {
      try { return new URL(m[1], websiteUrl).toString() } catch { return null }
    }
  } catch { /* fall through */ }
  return null
}

async function fetchRssItems(feedUrl: string): Promise<RssItem[]> {
  const xml = await fetchText(feedUrl)
  if (!xml) return []
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0])
  return blocks.slice(0, 30).map(block => {
    const title = getTag(block, 'title')
    const link = getTag(block, 'link') ?? getLinkHref(block) ?? ''
    const description = getTag(block, 'description') ?? getTag(block, 'summary')
    const pubDate = getTag(block, 'pubDate') ?? getTag(block, 'published')
    const guid = getTag(block, 'guid') ?? getTag(block, 'id') ?? link
    return { guid, title, link, description, pubDate }
  }).filter(i => i.guid && i.link)
}

function getTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return undefined
  const raw = m[1].trim()
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return (cdata ? cdata[1] : raw).replace(/<[^>]+>/g, '').trim()
}

function getLinkHref(block: string): string | undefined {
  return block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
}

// ─── HTTP helper ─────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KAI-CompetitorIntel/0.1 (+content-pipeline)' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
