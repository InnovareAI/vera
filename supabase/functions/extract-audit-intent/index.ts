// Extract audit_intent from the org's website.
//
// Crawls the homepage (and /about, /product, /pricing if reachable),
// parses both the structured metadata (title, meta description, OpenGraph,
// Twitter cards, JSON-LD, h1/h2 hierarchy) AND the body text, fetches
// /llms.txt and /robots.txt if present, then sends the combined signal to
// Claude with instructions to extract:
//   - icp_summary       — who the offering is for
//   - offer             — what the org sells / delivers
//   - value_prop        — the specific outcome / differentiation
//   - role_positioning  — how the operator should be perceived to sell this
//   - themes            — 3-5 content themes that map to the offer
//   - tone_target       — voice profile that fits the brand + audience
//   - success_criteria  — what "winning" looks like for this profile
//
// Writes the result to organizations.settings.audit_intent. Operator
// reviews/edits via the LinkedInScore page's Audit Context card before
// running brew360 / linkedin-profile-score, which read this intent and
// inject it into their LLM prompts.
//
// POST { org_id, force? }  →  { success, audit_intent, sources: string[] }
// `force=true` re-extracts even if audit_intent already exists.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY         = Deno.env.get('ANTHROPIC_API_KEY')

const CANDIDATE_PATHS = ['/', '/about', '/about-us', '/product', '/pricing', '/customers', '/solutions']
const PAGE_CHAR_CAP = 12_000  // per page, cap before LLM
const BLOG_SAMPLE_COUNT = 5    // how many blog posts to sample
const BLOG_POST_CHAR_CAP = 4_000

// URL paths that suggest a blog post (after the segment, expects a slug)
const BLOG_URL_PATTERN = /\/(blog|posts?|articles?|insights?|resources?|learn|news|stories|writing|essays?)\//i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500)
  }

  const { org_id, force } = await req.json().catch(() => ({}))
  if (!org_id) return json({ success: false, error: 'org_id required' }, 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: org, error } = await supabase
    .from('organizations')
    .select('name, website, settings, industry')
    .eq('id', org_id)
    .maybeSingle()
  if (error) return json({ success: false, error: error.message }, 500)
  if (!org) return json({ success: false, error: 'Org not found' }, 404)

  const websiteUrl = org.website as string | null
  if (!websiteUrl) {
    return json({ success: false, error: 'Org has no website set. Add organizations.website first.' }, 400)
  }

  const settings = (org.settings as Record<string, unknown> | null) ?? {}
  if (settings.audit_intent && !force) {
    return json({
      success: true,
      audit_intent: settings.audit_intent,
      sources: [],
      message: 'audit_intent already set — pass force=true to re-extract from website.',
    })
  }

  // Fetch pages with structured parsing — meta tags are higher-signal than
  // body text, especially for B2B sites where the homepage hero compresses
  // the positioning into a few words.
  const base = new URL(websiteUrl)
  const candidates = CANDIDATE_PATHS.map(p => new URL(p, base).toString())
  const fetched: Array<ParsedPage> = []
  for (const url of candidates) {
    const page = await fetchAndParse(url)
    if (page && (page.body.length > 200 || page.title || page.description)) {
      fetched.push(page)
    }
    if (fetched.length >= 4) break
  }

  if (!fetched.length) {
    return json({ success: false, error: `Could not fetch any usable pages from ${websiteUrl}` }, 502)
  }

  // Side-channel signals: /llms.txt (curated for LLMs) and /robots.txt
  // sometimes carries a brand-statement comment. Both are cheap to fetch.
  const [llmsTxt, robotsTxt] = await Promise.all([
    fetchRaw(new URL('/llms.txt', base).toString()),
    fetchRaw(new URL('/robots.txt', base).toString()),
  ])

  // Discover the blog via sitemap (preferred) or homepage HTML scan (fallback).
  // Marketing pages tell us what the company CLAIMS they're about; blog content
  // tells us what they ACTUALLY write about — themes, voice, depth, cadence.
  const sitemapUrls = await discoverSitemapUrls(base)
  const blogPosts: ParsedPage[] = []
  let blogDiscoveryNote = ''

  if (sitemapUrls.length) {
    const blogCandidates = sitemapUrls
      .filter(u => sameDomain(u.url, base) && BLOG_URL_PATTERN.test(new URL(u.url).pathname))
      .filter(u => !u.url.match(/\/(blog|posts?|articles?|insights?)\/?$/i))  // skip index pages
      .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''))
      .slice(0, BLOG_SAMPLE_COUNT)
    blogDiscoveryNote = `${sitemapUrls.length} URLs from sitemap.xml; ${blogCandidates.length} look like blog posts`
    for (const c of blogCandidates) {
      const p = await fetchAndParse(c.url)
      if (p && (p.body.length > 300 || p.h1.length || p.title)) {
        blogPosts.push({ ...p, body: p.body.slice(0, BLOG_POST_CHAR_CAP) })
      }
    }
  }

  // Sitemap-less fallback: scan homepage HTML for blog-pattern links
  if (!blogPosts.length && fetched[0]) {
    const homepageHtml = await fetchRaw(fetched[0].url) ?? ''
    const candidateUrls = [...homepageHtml.matchAll(/href=["']([^"']+)["']/gi)]
      .map(m => m[1])
      .map(href => { try { return new URL(href, base).toString() } catch { return null } })
      .filter((u): u is string => !!u && sameDomain(u, base) && BLOG_URL_PATTERN.test(new URL(u).pathname))
      .filter(u => !u.match(/\/(blog|posts?|articles?|insights?)\/?(\?|#|$)/i))
    const unique = Array.from(new Set(candidateUrls)).slice(0, BLOG_SAMPLE_COUNT)
    if (unique.length) {
      blogDiscoveryNote = `No sitemap.xml; ${unique.length} blog-pattern links found in homepage HTML`
      for (const url of unique) {
        const p = await fetchAndParse(url)
        if (p && (p.body.length > 300 || p.h1.length || p.title)) {
          blogPosts.push({ ...p, body: p.body.slice(0, BLOG_POST_CHAR_CAP) })
        }
      }
    } else {
      blogDiscoveryNote = 'No blog discovered (no sitemap, no blog-pattern links on homepage)'
    }
  }

  const blogBlock = blogPosts.length
    ? `### Blog samples (${blogPosts.length} posts — actual writing, use to verify the marketing pages' claims about themes + tone)\n\n${blogPosts.map(renderBlogForCorpus).join('\n\n')}`
    : `### Blog\n${blogDiscoveryNote}`

  const corpus = [
    ...fetched.map(p => renderPageForCorpus(p)),
    blogBlock,
    llmsTxt   ? `### /llms.txt (LLM-curated brand summary)\n${llmsTxt.slice(0, 4_000)}` : '',
    robotsTxt ? `### /robots.txt (often contains a brand comment)\n${robotsTxt.slice(0, 1_500)}` : '',
  ].filter(Boolean).join('\n\n---\n\n')

  // Ask Claude to extract structured audit_intent
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: `You are extracting audit context from a B2B company website. Output JSON only — no prose, no markdown fences. Be specific and concrete; vague output produces vague audits.`,
    messages: [{
      role: 'user',
      content: `Company: ${org.name}${org.industry ? ` (${org.industry})` : ''}
Website: ${websiteUrl}

Each page below carries STRUCTURED METADATA (title, meta description, OpenGraph, Twitter card, JSON-LD, h1/h2) in addition to body text. The metadata is usually the highest-signal source for positioning — that's where SEO/marketing teams compress the message into a few words. Treat it as primary; use the body to corroborate and add specificity (especially named numbers).

If a Blog samples section is present, treat it as verification: marketing pages tell you what the company CLAIMS to be about; the blog tells you what they ACTUALLY write about. When the blog contradicts the marketing claim (e.g., site claims "AI sales" but the blog is mostly generic productivity hot-takes), prefer the blog signal for themes/tone and call out the contradiction in the rationale field.

PAGES:

${corpus}

Extract the following fields. Each must be specific to THIS company — never generic ("we serve B2B SaaS" alone is too thin; "Series B-C SaaS, $50M-$200M ARR, VP of Sales owning pipeline build" is right). When a field can't be confidently extracted, return null — don't fabricate.

Plus a "summary" field: a 60-90 word narrative paragraph that synthesizes the 7 structured fields into a single readable story ("X sells Y to Z; positioning is W; winning looks like V"). This is what the operator reads first and what every downstream audit (BREW360, profile score) echoes back as "Audited against:".

Required output JSON (no other keys):
{
  "summary":          "<60-90 word narrative paragraph synthesizing the 7 fields into one story. Operator reads this first; audits echo it back. Plain prose, no bullets, no headers.>",
  "icp_summary":      "<who this offering is for — segment, role, stage, buying trigger>",
  "offer":            "<what the company sells/delivers in one specific sentence>",
  "value_prop":       "<the specific measurable outcome / differentiation vs the obvious alternative>",
  "role_positioning": "<how the operator should be perceived on LinkedIn to credibly sell this — e.g. 'practitioner-founder building authority on HITL outbound for B2B sales' — anchor in the operator's expertise, not vendor pitch language>",
  "themes":           ["<3-5 concrete content themes that map to the offer + ICP>"],
  "tone_target":      "<voice profile — e.g. 'sharp, opinion-led practitioner; no buzzwords; data + named examples'>",
  "success_criteria": "<one sentence — what 'winning' on LinkedIn looks like for this profile in 6 months>"
}`,
    }],
  })

  const text = resp.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('')
  const cleaned = text.replace(/^```(json)?\s*|\s*```$/g, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    return json({ success: false, error: `LLM JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw: cleaned.slice(0, 500) }, 500)
  }

  const audit_intent = {
    ...parsed,
    extracted_at: new Date().toISOString(),
    extracted_from: [...fetched.map(p => p.url), ...blogPosts.map(b => b.url)],
    sitemap_urls_found: sitemapUrls.length,
    blog_posts_sampled: blogPosts.length,
    blog_discovery_note: blogDiscoveryNote,
    extracted_by: 'website',
  }

  // Merge into organizations.settings
  const newSettings = { ...settings, audit_intent }
  const { error: updErr } = await supabase
    .from('organizations')
    .update({ settings: newSettings })
    .eq('id', org_id)
  if (updErr) return json({ success: false, error: updErr.message }, 500)

  return json({ success: true, audit_intent, sources: fetched.map(p => p.url) })
})

interface ParsedPage {
  url: string
  title: string | null
  description: string | null              // meta name=description
  og: Record<string, string>              // og:title, og:description, og:image, og:type, etc.
  twitter: Record<string, string>          // twitter:card, title, description
  keywords: string | null
  canonical: string | null
  h1: string[]
  h2: string[]
  jsonld: Array<Record<string, unknown>>  // parsed Schema.org JSON-LD blocks
  body: string                            // stripped body text
}

async function fetchAndParse(url: string): Promise<ParsedPage | null> {
  const html = await fetchRaw(url)
  if (!html) return null

  // Head extraction
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html.slice(0, 20_000)

  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null
  const description = pickMeta(head, 'name', 'description')
  const keywords = pickMeta(head, 'name', 'keywords')
  const canonical = head.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null

  // OpenGraph + Twitter — pull every property=og:* and name=twitter:*
  const og: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']*)["']/gi)) {
    og[m[1]] = decodeEntities(m[2])
  }
  // Some sites use name="og:*" instead of property="og:*"
  for (const m of head.matchAll(/<meta\b[^>]*name=["']og:([^"']+)["'][^>]*content=["']([^"']*)["']/gi)) {
    if (!og[m[1]]) og[m[1]] = decodeEntities(m[2])
  }

  const twitter: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*name=["']twitter:([^"']+)["'][^>]*content=["']([^"']*)["']/gi)) {
    twitter[m[1]] = decodeEntities(m[2])
  }

  // JSON-LD Schema.org blocks
  const jsonld: Array<Record<string, unknown>> = []
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) jsonld.push(...(parsed as Record<string, unknown>[]))
      else jsonld.push(parsed as Record<string, unknown>)
    } catch { /* ignore malformed JSON-LD */ }
  }

  // H1 / H2 hierarchy — body before stripping
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const h1 = [...bodyMatch.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map(m => stripTags(m[1])).filter(Boolean).slice(0, 5)
  const h2 = [...bodyMatch.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(m => stripTags(m[1])).filter(Boolean).slice(0, 15)

  // Body text — same stripper as before
  const body = stripTags(
    bodyMatch.replace(/<(script|style|nav|footer|header|aside|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' '),
  ).slice(0, PAGE_CHAR_CAP)

  return { url, title, description, og, twitter, keywords, canonical, h1, h2, jsonld, body }
}

function renderPageForCorpus(p: ParsedPage): string {
  const lines: string[] = [`### URL: ${p.url}`]
  if (p.title)        lines.push(`Title: ${p.title}`)
  if (p.description)  lines.push(`Meta description: ${p.description}`)
  if (p.keywords)     lines.push(`Keywords: ${p.keywords}`)
  if (p.canonical)    lines.push(`Canonical: ${p.canonical}`)
  if (Object.keys(p.og).length) {
    lines.push(`OpenGraph:`)
    for (const [k, v] of Object.entries(p.og)) lines.push(`  og:${k} → ${v}`)
  }
  if (Object.keys(p.twitter).length) {
    lines.push(`Twitter card:`)
    for (const [k, v] of Object.entries(p.twitter)) lines.push(`  twitter:${k} → ${v}`)
  }
  if (p.h1.length) lines.push(`H1: ${p.h1.join(' | ')}`)
  if (p.h2.length) lines.push(`H2: ${p.h2.slice(0, 8).join(' | ')}`)
  if (p.jsonld.length) {
    // Keep only the schema-relevant keys to bound size
    const compact = p.jsonld.map(b => {
      const out: Record<string, unknown> = {}
      for (const k of ['@type', 'name', 'description', 'slogan', 'brand', 'sameAs', 'foundingDate', 'numberOfEmployees', 'industry', 'audience', 'mainEntity']) {
        if (b[k] !== undefined) out[k] = b[k]
      }
      return out
    })
    lines.push(`JSON-LD: ${JSON.stringify(compact).slice(0, 1_500)}`)
  }
  if (p.body) lines.push(`\nBody text:\n${p.body}`)
  return lines.join('\n')
}

// ─── Sitemap discovery ──────────────────────────────────────────────────────
// Returns a flat list of {url, lastmod?} from /sitemap.xml. Follows
// sitemap_index entries up to 3 deep. Caps at 1000 URLs total.
async function discoverSitemapUrls(base: URL): Promise<Array<{ url: string; lastmod?: string }>> {
  const seeds = ['/sitemap.xml', '/sitemap_index.xml']
  for (const seed of seeds) {
    const xml = await fetchRaw(new URL(seed, base).toString())
    if (!xml) continue
    if (/<sitemapindex/i.test(xml)) {
      // It's an index — follow the first 3 submaps
      const submaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>(.+?)<\/loc>[\s\S]*?<\/sitemap>/gi)]
        .map(m => m[1].trim())
        .slice(0, 3)
      const all: Array<{ url: string; lastmod?: string }> = []
      for (const sub of submaps) {
        const subXml = await fetchRaw(sub)
        if (!subXml) continue
        all.push(...parseSitemapXml(subXml))
        if (all.length >= 1000) break
      }
      return all.slice(0, 1000)
    }
    return parseSitemapXml(xml).slice(0, 1000)
  }
  return []
}

function parseSitemapXml(xml: string): Array<{ url: string; lastmod?: string }> {
  return [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)]
    .map(m => {
      const block = m[0]
      const loc = block.match(/<loc>(.+?)<\/loc>/)?.[1]?.trim()
      const lastmod = block.match(/<lastmod>(.+?)<\/lastmod>/)?.[1]?.trim()
      return loc ? { url: loc, lastmod } : null
    })
    .filter((x): x is { url: string; lastmod?: string } => x !== null)
}

function sameDomain(url: string, base: URL): boolean {
  try { return new URL(url).hostname === base.hostname } catch { return false }
}

function renderBlogForCorpus(p: ParsedPage): string {
  const lines: string[] = []
  lines.push(`#### ${p.title ?? '(untitled)'}`)
  lines.push(`URL: ${p.url}`)
  if (p.description) lines.push(`Excerpt: ${p.description}`)
  if (p.h1.length) lines.push(`H1: ${p.h1[0]}`)
  if (p.h2.length) lines.push(`Sections: ${p.h2.slice(0, 6).join(' | ')}`)
  if (p.body) lines.push(`\n${p.body}`)
  return lines.join('\n')
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VERA-audit-intent/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function pickMeta(head: string, attr: 'name' | 'property', value: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["']`, 'i')
  const reReversed = new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["']`, 'i')
  const m = head.match(re) ?? head.match(reReversed)
  return m?.[1] ? decodeEntities(m[1]) : null
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
