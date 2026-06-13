// SEO Audit — classical SEO + website-optimization scoring for an org's
// website. Crawls the homepage + a few content pages, parses meta tags,
// heading tree, JSON-LD schema, OG/Twitter cards, internal-link structure,
// image alt coverage, robots/sitemap/llms.txt presence. Pulls Core Web
// Vitals from PageSpeed Insights API. Synthesises a scored report via
// Claude sonnet (streaming SSE).
//
// POST { org_id, website_url? }  →  text/event-stream:
//   started → fetching(url) → fetched(url, status) → analysing
//   → synthesising → chunk(text) → done | error

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import type { Json } from '../_shared/database.types.ts'
import { checkProjectAiBudget, type ProjectAiBudgetWarning } from '../_shared/ai-policy.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'
import { resolveProjectTextRuntime, streamText, textRuntimeUsageMetadata, type TextRuntime } from '../_shared/text-runtime.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAGESPEED_API_KEY         = Deno.env.get('PAGESPEED_API_KEY')  // optional — anonymous quota is small but works

const USER_AGENT = 'Mozilla/5.0 (compatible; InnovareAI-SEO-Audit/0.1; +https://innovareai.com)'
const MAX_INNER_PAGES = 4
const MAX_PAGE_SIZE = 500_000  // 500KB cap per page
const APPROX_CHARS_PER_TOKEN = 4
const SEO_SYNTHESIS_MAX_TOKENS = 3000

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

type PageSpeedResult = {
  lighthouseResult?: {
    categories?: {
      performance?: { score?: number | null }
      [key: string]: unknown
    }
  }
  loadingExperience?: {
    metrics?: Record<string, unknown>
  }
  [key: string]: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const { org_id, project_id, website_url: explicitUrl } = await req.json().catch(() => ({}))
  if (!org_id) return jsonError('org_id required', 400)
  if (!project_id) return jsonError('project_id required', 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as unknown as AdminClient
  const access = await requireProjectMember(req, supabase, SUPABASE_SERVICE_ROLE_KEY, project_id, corsHeaders, org_id)
  if (!access.ok) return access.response
  const runtime = await resolveProjectTextRuntime(supabase, org_id, project_id, {
    purpose: 'SEO audit',
  })
  if (!runtime.ok) return jsonError(runtime.message, runtime.status)

  const { data: org } = await supabase
    .from('organizations').select('name, website').eq('id', org_id).maybeSingle()

  const websiteUrl = (explicitUrl as string) ?? (org?.website as string)
  if (!websiteUrl) return jsonError('No website URL configured on this org — set organizations.website or pass website_url.', 400)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))

      try {
        const baseUrl = new URL(websiteUrl)
        send('started', { website_url: websiteUrl, org_name: org?.name ?? null })

        // ── Phase 1: fetch homepage + auxiliary files ───────────────────────
        send('fetching', { url: websiteUrl, label: 'homepage' })
        const homepageHtml = await fetchText(websiteUrl)
        send('fetched', { url: websiteUrl, ok: !!homepageHtml, size: homepageHtml?.length ?? 0 })

        const robotsTxt   = await fetchText(new URL('/robots.txt',   baseUrl).toString())
        const sitemapXml  = await fetchText(new URL('/sitemap.xml',  baseUrl).toString())
        const llmsTxt     = await fetchText(new URL('/llms.txt',     baseUrl).toString())

        // ── Phase 2: discover inner pages from sitemap or HTML links ────────
        const innerUrls = await discoverInnerPages(homepageHtml, sitemapXml, baseUrl)
        send('discovered_pages', { count: innerUrls.length, urls: innerUrls })

        const innerPages: Array<{ url: string; html: string | null }> = []
        for (const u of innerUrls) {
          send('fetching', { url: u })
          const h = await fetchText(u)
          send('fetched', { url: u, ok: !!h, size: h?.length ?? 0 })
          innerPages.push({ url: u, html: h })
        }

        // ── Phase 3: deterministic parsing — pulls hard signal out of HTML ─
        send('analysing', { pages: 1 + innerPages.length })
        const homepageParsed = parsePage(homepageHtml ?? '', websiteUrl)
        const innerParsed = innerPages.map(p => ({ url: p.url, ...parsePage(p.html ?? '', p.url) }))

        // ── Phase 4: PageSpeed Insights for the homepage (Core Web Vitals) ─
        send('pagespeed', { url: websiteUrl })
        const pageSpeed = await fetchPageSpeed(websiteUrl)
        send('pagespeed_done', { ok: !!pageSpeed?.lighthouseResult, score: pageSpeed?.lighthouseResult?.categories?.performance?.score ?? null })

        // ── Phase 5: aggregate signal for the AI synthesiser ────────────────
        const signal = {
          website_url: websiteUrl,
          org_name: org?.name,
          robots_txt_present: !!robotsTxt,
          sitemap_present:    !!sitemapXml,
          llms_txt_present:   !!llmsTxt,
          robots_excerpt: robotsTxt?.slice(0, 400) ?? null,
          sitemap_url_count: sitemapXml ? (sitemapXml.match(/<url>/g) ?? []).length : 0,
          homepage: homepageParsed,
          inner_pages: innerParsed,
          page_speed: pageSpeed?.lighthouseResult?.categories ?? null,
          core_web_vitals: pageSpeed?.loadingExperience?.metrics ?? null,
        }

        // ── Phase 6: insert running audit row, then stream Claude synthesis ─
        const { data: auditRow } = await supabase
          .from('seo_audits')
          .insert({ org_id, website_url: websiteUrl, status: 'running', result: {}, pages_audited: [websiteUrl, ...innerUrls] })
          .select('id').single()
        const auditId = auditRow?.id as string | undefined

        send('synthesising', { audit_id: auditId })
        const startedAt = Date.now()
        const usageMetadata = textRuntimeUsageMetadata(runtime.runtime, { pages_audited: 1 + innerPages.length })
        const synthesis = await synthesise(supabase, org_id, project_id, runtime.runtime, signal, usageMetadata, send)
        const audit = synthesis.audit
        await logGenerationUsage(supabase, {
          orgId: org_id,
          projectId: project_id,
          provider: runtime.runtime.provider,
          model: runtime.runtime.model,
          operation: 'audit.seo',
          inputTokens: synthesis.inputTokens,
          outputTokens: synthesis.outputTokens,
          durationMs: Date.now() - startedAt,
          metadata: {
            ...usageMetadata,
            ...(synthesis.budgetWarning ? { budget_warning: synthesis.budgetWarning } : {}),
          },
        })

        // ── Phase 7: persist final result ───────────────────────────────────
        if (auditId) {
          await supabase.from('seo_audits').update({
            status: 'completed',
            result: audit as Json,
            page_speed: (pageSpeed ?? null) as unknown as Json,
          }).eq('id', auditId)
        }

        send('done', { audit_id: auditId, audit })
        controller.close()
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Fetching
// ──────────────────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > MAX_PAGE_SIZE ? text.slice(0, MAX_PAGE_SIZE) : text
  } catch { return null }
}

async function fetchPageSpeed(url: string): Promise<PageSpeedResult | null> {
  try {
    const base = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
    const u = new URL(base)
    u.searchParams.set('url', url)
    u.searchParams.set('strategy', 'mobile')
    u.searchParams.append('category', 'performance')
    u.searchParams.append('category', 'seo')
    u.searchParams.append('category', 'accessibility')
    u.searchParams.append('category', 'best-practices')
    if (PAGESPEED_API_KEY) u.searchParams.set('key', PAGESPEED_API_KEY)
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch { return null }
}

// ──────────────────────────────────────────────────────────────────────────────
// Page discovery
// ──────────────────────────────────────────────────────────────────────────────

async function discoverInnerPages(homepageHtml: string | null, sitemapXml: string | null, base: URL): Promise<string[]> {
  // Prefer sitemap if it exists — it's the canonical list of content pages.
  if (sitemapXml) {
    const urls: string[] = []
    for (const m of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const u = m[1].trim()
      try {
        const parsed = new URL(u, base)
        if (parsed.origin !== base.origin) continue
        if (parsed.pathname === '/' || parsed.pathname === base.pathname) continue
        urls.push(parsed.toString())
      } catch { /* skip */ }
    }
    // Prefer content-y paths (blog/post/services/about) over generic
    const ranked = urls.sort((a, b) => contentScore(b) - contentScore(a))
    const seen = new Set<string>()
    const out: string[] = []
    for (const u of ranked) {
      if (seen.has(u)) continue
      seen.add(u)
      out.push(u)
      if (out.length >= MAX_INNER_PAGES) break
    }
    if (out.length) return out
  }
  // Fallback: scrape anchors from homepage.
  if (!homepageHtml) return []
  const candidates = new Map<string, number>()
  for (const m of homepageHtml.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    let abs: URL
    try { abs = new URL(m[1], base) } catch { continue }
    if (abs.origin !== base.origin) continue
    if (abs.pathname === '/' || abs.pathname === base.pathname) continue
    const url = abs.toString().split('#')[0]
    candidates.set(url, (candidates.get(url) ?? 0) + 1 + contentScore(url))
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INNER_PAGES)
    .map(([u]) => u)
}

function contentScore(url: string): number {
  let s = 0
  if (/\/(blog|post|posts|article|articles|news|insights|case-stud|service|product|about|team)/i.test(url)) s += 3
  if (/\b20\d{2}\b/.test(url)) s += 2
  if (/[a-z0-9](-[a-z0-9]+){2,}/i.test(url)) s += 1
  if (/\/(privacy|terms|legal|cookies|sitemap|robots|feed|rss|login|signup)/i.test(url)) s -= 5
  return s
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML parsing — deterministic signal extraction
// ──────────────────────────────────────────────────────────────────────────────

interface PageSignal {
  title: string | null
  title_length: number
  meta_description: string | null
  meta_description_length: number
  canonical: string | null
  viewport_meta: boolean
  charset: string | null
  lang: string | null
  h1s: string[]
  h2s: string[]
  h3_count: number
  word_count: number
  image_total: number
  image_alt_present: number
  links_total: number
  links_internal: number
  links_external: number
  json_ld_types: string[]
  og_present: boolean
  twitter_card_present: boolean
  noindex: boolean
}

function parsePage(html: string, _url: string): PageSignal {
  if (!html) {
    return { title: null, title_length: 0, meta_description: null, meta_description_length: 0, canonical: null, viewport_meta: false, charset: null, lang: null, h1s: [], h2s: [], h3_count: 0, word_count: 0, image_total: 0, image_alt_present: 0, links_total: 0, links_internal: 0, links_external: 0, json_ld_types: [], og_present: false, twitter_card_present: false, noindex: false }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  const charset = html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i)?.[1] ?? null
  const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? null
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => stripHtml(m[1])).filter(Boolean).slice(0, 5)
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => stripHtml(m[1])).filter(Boolean).slice(0, 20)
  const h3Count = (html.match(/<h3\b/gi) ?? []).length

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const textOnly = stripHtml(bodyMatch.replace(/<(script|style|nav|footer|header|aside|noscript)\b[\s\S]*?<\/\1>/gi, ' '))
  const wordCount = textOnly.split(/\s+/).filter(Boolean).length

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0])
  const imgWithAlt = imgs.filter(t => /\balt=["'][^"']+["']/i.test(t)).length

  const linkMatches = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map(m => m[1])
  const linksTotal = linkMatches.length
  let internal = 0, external = 0
  try {
    const base = new URL(_url)
    for (const href of linkMatches) {
      try {
        const u = new URL(href, base)
        if (u.origin === base.origin) internal++
        else if (u.protocol.startsWith('http')) external++
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // JSON-LD schema discovery
  const jsonLdTypes = new Set<string>()
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const it of items) {
        const t = it?.['@type']
        if (typeof t === 'string') jsonLdTypes.add(t)
        else if (Array.isArray(t)) t.forEach(x => typeof x === 'string' && jsonLdTypes.add(x))
        // @graph wrapper
        if (Array.isArray(it?.['@graph'])) {
          for (const g of it['@graph']) {
            const gt = g?.['@type']
            if (typeof gt === 'string') jsonLdTypes.add(gt)
            else if (Array.isArray(gt)) gt.forEach(x => typeof x === 'string' && jsonLdTypes.add(x))
          }
        }
      }
    } catch { /* malformed json-ld */ }
  }

  const og = /<meta[^>]+property=["']og:[a-z_]+["']/i.test(html)
  const twitter = /<meta[^>]+name=["']twitter:[a-z]+["']/i.test(html)
  const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)

  return {
    title, title_length: title?.length ?? 0,
    meta_description: desc, meta_description_length: desc?.length ?? 0,
    canonical, viewport_meta: viewport, charset, lang,
    h1s, h2s, h3_count: h3Count,
    word_count: wordCount,
    image_total: imgs.length, image_alt_present: imgWithAlt,
    links_total: linksTotal, links_internal: internal, links_external: external,
    json_ld_types: [...jsonLdTypes],
    og_present: og, twitter_card_present: twitter,
    noindex,
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

// ──────────────────────────────────────────────────────────────────────────────
// AI synthesis — Claude scores sections + drafts concrete fixes
// ──────────────────────────────────────────────────────────────────────────────

async function synthesise(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  runtime: TextRuntime,
  signal: Record<string, unknown>,
  usageMetadata: Record<string, unknown>,
  send: (event: string, data: unknown) => void,
): Promise<{ audit: Record<string, unknown>; inputTokens: number | null; outputTokens: number | null; budgetWarning: ProjectAiBudgetWarning | null }> {
  const sys = `You are KAI's SEO Auditor. You score a website on classical SEO + website optimization signal and propose concrete fixes. Output ONLY valid JSON in exactly this shape — no prose, no markdown fences:

{
  "overall_score": <0-100>,
  "grade": "<A+|A|B+|B|C+|C|D|F>",
  "sections": {
    "technical": {
      "score": <0-100>,
      "findings": ["≤25 words, factual"],
      "fixes": ["≤25 words, concrete action"]
    },
    "metadata":   { "score": <0-100>, "findings": [...], "fixes": [...] },
    "headings":   { "score": <0-100>, "findings": [...], "fixes": [...] },
    "schema":     { "score": <0-100>, "findings": [...], "fixes": [...] },
    "content":    { "score": <0-100>, "findings": [...], "fixes": [...] },
    "links":      { "score": <0-100>, "findings": [...], "fixes": [...] },
    "performance":{ "score": <0-100>, "findings": [...], "fixes": [...] }
  },
  "quick_wins": ["<top 5 highest-leverage fixes, ordered by impact, ≤25 words each>"],
  "ai_readiness": {
    "score": <0-100>,
    "notes": ["3-5 ≤20-word notes on how AI crawlers / LLMs will interpret this site — purely structural observations, NO GEO citation prediction"]
  }
}

Constraints:
- Each findings array: max 4 items, ≤25 words each. Factual statements from the data.
- Each fixes array: max 3 items, ≤25 words each. Concrete actions ("rewrite <title> to 50-60 chars", not "improve title").
- Reference specific values from the data (current title length, actual H1 text, actual schema types found).
- ai_readiness is purely about whether content is CRAWLABLE + STRUCTURED + DISAMBIGUATABLE. Don't predict whether AI will cite the brand — that's out of scope.
- Don't invent — score only based on what's in the data.`

  const userMessage = `Audit this website data:\n\n${JSON.stringify(signal, null, 2).slice(0, 18000)}`
  const budget = await checkAuditBudget(supabase, orgId, projectId, runtime, 'audit.seo', sys, userMessage, SEO_SYNTHESIS_MAX_TOKENS, usageMetadata)
  if (!budget.ok) throw new Error(budget.message)
  if (budget.warning) send('budget_warning', { warning: budget.warning })

  const completion = await streamText(runtime, {
    maxTokens: SEO_SYNTHESIS_MAX_TOKENS,
    temperature: 0.2,
    system: sys,
    user: userMessage,
    json: true,
    onText: text => send('chunk', { text }),
  })

  try {
    const m = completion.text.match(/\{[\s\S]*\}/)
    return {
      audit: m ? JSON.parse(m[0]) : { raw: completion.text },
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      budgetWarning: budget.warning,
    }
  } catch {
    return { audit: { raw: completion.text }, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, budgetWarning: budget.warning }
  }
}

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN))
}

async function checkAuditBudget(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  runtime: TextRuntime,
  operation: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  metadata: Record<string, unknown>,
): Promise<BudgetCheck> {
  const budget = await checkProjectAiBudget(supabase, projectId, {
    orgId,
    projectId,
    provider: runtime.provider,
    model: runtime.model,
    operation,
    inputTokens: approxTokens(`${systemPrompt}\n\n${userPrompt}`),
    outputTokens: maxTokens,
    metadata,
  })
  if (!budget.ok) return { ok: false, message: budget.message }
  return { ok: true, warning: budget.warning }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ event: 'error', message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
