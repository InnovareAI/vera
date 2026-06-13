// Content audit agent. Reads the active project's Strategy Brain source URLs,
// fetches what it can from each channel, asks Claude to synthesise a proposed
// brand_voice + personas + skills, saves the result to audit_runs. Streams SSE
// progress events as it goes.
//
// Adapters today: blog/medium via RSS, LinkedIn via Unipile research, X via
// Apify, and other public sources via direct HTML fallback. Unsupported or
// blocked channels are surfaced as adapter notes in the audit log.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import type { Json } from '../_shared/database.types.ts'
import { checkProjectAiBudget, type ProjectAiBudgetWarning } from '../_shared/ai-policy.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'
import { resolveProjectTextRuntime, streamText, textRuntimeUsageMetadata, type TextRuntime } from '../_shared/text-runtime.ts'
import { resolveUnipileResearchConnection } from '../_shared/unipile-research.ts'
import { resolveProjectAuditChannels, type AuditChannelProfile, type SourcePullDepth } from '../_shared/project-sources.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')
const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN')

const DEFAULT_ITEMS_PER_CHANNEL = 25
const MAX_CHARS_PER_ITEM = 4000
const APPROX_CHARS_PER_TOKEN = 4
const CONTENT_SYNTHESIS_MAX_TOKENS = 6144

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

type ChannelProfile = AuditChannelProfile

interface FetchedItem {
  channel: string
  source_url: string
  title?: string
  text: string
  published_at?: string
}

interface FetchResult {
  channel: string
  url: string
  ok: boolean
  reason?: string
  items: FetchedItem[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { org_id, project_id, operator_user_id } = await req.json().catch(() => ({}))
  if (!org_id) {
    return new Response(JSON.stringify({ error: 'org_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!project_id) {
    return new Response(JSON.stringify({ error: 'project_id required for content audit' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as unknown as AdminClient
  const auth = await requireProjectMember(req, supabase, SUPABASE_SERVICE_ROLE_KEY, project_id, corsHeaders, org_id)
  if (!auth.ok) return auth.response
  const requesterUserId = auth.service ? cleanString(operator_user_id) : auth.userId
  const runtime = await resolveProjectTextRuntime(supabase, org_id, project_id, {
    purpose: 'Content audit',
  })
  if (!runtime.ok) {
    return new Response(JSON.stringify({ error: runtime.message }), {
      status: runtime.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))

      try {
        // 1. Create audit_runs row
        const { data: run, error: runErr } = await supabase
          .from('audit_runs').insert({ org_id, status: 'running' }).select('id').single()
        if (runErr || !run) throw new Error(`audit_runs insert failed: ${runErr?.message}`)
        const auditId = run.id as string
        send('started', { audit_id: auditId })

        // 2. Fetch project-scoped channels + research account. A workspace
        // research account wins; an InnovareAI operator can fall back to the
        // shared research profile. Client projects never read org-wide channel
        // profiles, which may belong to a different client in the same org.
        const [sourceResolution, unipile] = await Promise.all([
          resolveProjectAuditChannels(supabase, org_id, project_id),
          resolveUnipileResearchConnection(supabase, org_id, { requesterUserId }),
        ])
        const channels = sourceResolution.channels
        const itemsPerChannel = sourcePullItemsPerChannel(sourceResolution.sourcePullDepth)
        if (!channels?.length) {
          throw new Error('No client source URLs configured. Add the website, LinkedIn, Medium, YouTube, or X source in this client Strategy Brain before running the content audit.')
        }
        const unipileAccountId = unipile.ok ? unipile.accountId : null
        send('channels_loaded', {
          channels,
          source: sourceResolution.source,
          source_pull_depth: sourceResolution.sourcePullDepth,
          items_per_channel: itemsPerChannel,
          unipile_connected: !!unipileAccountId,
        })

        // 3. Fetch content from each channel
        const results: FetchResult[] = []
        const channelList = channels as ChannelProfile[]
        for (const c of channelList) {
          send('fetching', { channel: c.channel, url: c.url })
          const r = await fetchChannel(c.channel, c.url, unipileAccountId, channelList, itemsPerChannel)
          results.push(r)
          send('fetched', { channel: c.channel, ok: r.ok, reason: r.reason, item_count: r.items.length })
        }

        const usable = results.filter(r => r.ok && r.items.length > 0)
        if (!usable.length) {
          throw new Error('No channels yielded usable content. Check the source URLs and connector notes for LinkedIn, YouTube, Instagram, Facebook, Quora, Reddit, or X.')
        }

        // 4. Synthesise via Claude
        send('synthesising', { sources: usable.map(r => ({ channel: r.channel, items: r.items.length })) })

        const corpus = buildCorpus(usable)
        const usageMetadata = textRuntimeUsageMetadata(runtime.runtime, {
          channels_audited: usable.length,
          items_audited: usable.reduce((sum, r) => sum + r.items.length, 0),
        })
        const startedAt = Date.now()
        const synthesis = await synthesise(supabase, org_id, project_id, runtime.runtime, corpus, usageMetadata, send)
        const proposal = synthesis.proposal
        await logGenerationUsage(supabase, {
          orgId: org_id,
          projectId: project_id,
          provider: runtime.runtime.provider,
          model: runtime.runtime.model,
          operation: 'audit.content',
          inputTokens: synthesis.inputTokens,
          outputTokens: synthesis.outputTokens,
          durationMs: Date.now() - startedAt,
          metadata: {
            ...usageMetadata,
            ...(synthesis.budgetWarning ? { budget_warning: synthesis.budgetWarning } : {}),
          },
        })

        // 5. Save proposal
        await supabase.from('audit_runs').update({
          status: 'completed',
          channels_audited: usable.map(r => ({ channel: r.channel, url: r.url, item_count: r.items.length })) as Json,
          raw_findings: {
            skipped: results.filter(r => !r.ok).map(r => ({ channel: r.channel, reason: r.reason })),
            proposed_business_context: proposal.business_context ?? {},
          } as Json,
          proposed_brand_voice: proposal.brand_voice as Json,
          proposed_personas: proposal.personas as Json,
          proposed_skills: proposal.skills as Json,
        }).eq('id', auditId)

        send('done', { audit_id: auditId, proposal })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        send('error', { message: msg })
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
// Channel adapters
// ──────────────────────────────────────────────────────────────────────────────

async function fetchChannel(
  channel: string,
  url: string,
  unipileAccountId: string | null,
  channels: ChannelProfile[],
  itemsPerChannel: number,
): Promise<FetchResult> {
  try {
    switch (channel) {
      case 'blog':
      case 'medium':
        return await fetchRSS(channel, url, itemsPerChannel)
      case 'linkedin_personal':
        if (!unipileAccountId) return { channel, url, ok: false, items: [], reason: linkedInResearchReason() }
        return await fetchLinkedInPosts(channel, url, unipileAccountId, itemsPerChannel)
      case 'linkedin_company':
        if (!unipileAccountId) return { channel, url, ok: false, items: [], reason: linkedInResearchReason() }
        return await fetchLinkedInCompany(url, unipileAccountId, itemsPerChannel)
      case 'linkedin_events':
        return await fetchGenericHtmlSource(channel, url, 'LinkedIn events need public page access or a connected research adapter; direct public HTML was attempted.')
      case 'linkedin_newsletter':
        if (!unipileAccountId) return { channel, url, ok: false, items: [], reason: linkedInResearchReason() }
        return await fetchLinkedInNewsletter(url, unipileAccountId, channels, itemsPerChannel)
      case 'instagram':
        return await fetchGenericHtmlSource(channel, url, 'Instagram audit needs public page access or the Instagram research adapter; direct public HTML was attempted.')
      case 'youtube':
        return await fetchGenericHtmlSource(channel, url, 'YouTube audit needs the YouTube API adapter for reliable video history; direct public HTML was attempted.')
      case 'quora':
      case 'reddit':
      case 'facebook':
        return await fetchGenericHtmlSource(channel, url, `${labelForChannel(channel)} is manual or read-first for now; direct public HTML was attempted.`)
      case 'twitter':
        if (!APIFY_API_TOKEN) return { channel, url, ok: false, items: [], reason: 'APIFY_API_TOKEN not configured on the server.' }
        return await fetchTwitterViaApify(url, itemsPerChannel)
      default:
        return { channel, url, ok: false, items: [], reason: `Unknown channel type: ${channel}` }
    }
  } catch (e) {
    return { channel, url, ok: false, items: [], reason: e instanceof Error ? e.message : String(e) }
  }
}

function sourcePullItemsPerChannel(depth: SourcePullDepth): number {
  if (depth === 'light') return 10
  if (depth === 'deep') return 50
  return DEFAULT_ITEMS_PER_CHANNEL
}

function linkedInResearchReason(): string {
  return 'LinkedIn research needs a connected workspace or InnovareAI shared research profile. Configure it in Settings > Integrations > Shared LinkedIn research profile.'
}

function labelForChannel(channel: string): string {
  const labels: Record<string, string> = {
    quora: 'Quora',
    reddit: 'Reddit',
    facebook: 'Facebook',
    instagram: 'Instagram',
    youtube: 'YouTube',
    linkedin_events: 'LinkedIn events',
  }
  return labels[channel] ?? channel
}

function extractTwitterHandle(url: string): string | null {
  if (url.startsWith('@')) return url.slice(1).replace(/[\/\?#].*$/, '')
  const m = url.match(/(?:twitter\.com|x\.com)\/([^\/\?#]+)/i)
  return m?.[1] ?? null
}

// Apify's apidojo/tweet-scraper — sync API, returns the dataset items directly.
// 143M+ runs, well-maintained, pay-per-use. Fields: text, fullText, url,
// createdAt, likeCount, retweetCount, replyCount, viewCount.
async function fetchTwitterViaApify(urlIn: string, itemsPerChannel: number): Promise<FetchResult> {
  const handle = extractTwitterHandle(urlIn)
  if (!handle) return { channel: 'twitter', url: urlIn, ok: false, items: [], reason: `Could not parse handle from ${urlIn}` }

  const apifyUrl = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}&timeout=90`
  const res = await fetch(apifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      twitterHandles: [handle],
      maxItems: itemsPerChannel,
      sort: 'Latest',
      includeReplies: false,
    }),
    signal: AbortSignal.timeout(110_000),
  })
  if (!res.ok) {
    const errText = await res.text()
    return { channel: 'twitter', url: urlIn, ok: false, items: [], reason: `Apify run failed (${res.status}): ${errText.slice(0, 200)}` }
  }
  const tweets = await res.json() as Array<Record<string, unknown>>
  if (!Array.isArray(tweets) || !tweets.length) {
    return { channel: 'twitter', url: urlIn, ok: false, items: [], reason: 'Apify returned no tweets.' }
  }

  return {
    channel: 'twitter', url: urlIn, ok: true,
    items: tweets.slice(0, itemsPerChannel).map(t => ({
      channel: 'twitter',
      source_url: (t.url as string) ?? (t.twitterUrl as string) ?? urlIn,
      title: undefined,
      text: stripHtml(((t.fullText as string) ?? (t.text as string) ?? '')).slice(0, MAX_CHARS_PER_ITEM),
      published_at: (t.createdAt as string) ?? undefined,
    })).filter(it => it.text.length > 20),
  }
}

function extractLinkedInId(url: string, channel: string): string | null {
  const pattern = channel === 'linkedin_company'
    ? /linkedin\.com\/company\/([^\/\?#]+)/i
    : /linkedin\.com\/(?:in|pub)\/([^\/\?#]+)/i
  return url.match(pattern)?.[1] ?? null
}

// Per Unipile docs: GET /api/v1/users/{identifier}/posts works for both users
// and companies, distinguished by `is_company=true`. The identifier for
// companies is the numeric id from /api/v1/linkedin/company/{slug}.
async function fetchLinkedInCompany(url: string, accountId: string, itemsPerChannel: number): Promise<FetchResult> {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return { channel: 'linkedin_company', url, ok: false, items: [], reason: 'UNIPILE_DSN / UNIPILE_API_KEY not configured.' }
  }
  const slug = extractLinkedInId(url, 'linkedin_company')
  if (!slug) return { channel: 'linkedin_company', url, ok: false, items: [], reason: `Could not parse company slug from ${url}` }

  // 1) Resolve company slug → numeric id (and grab profile text as a bonus item)
  const lookup = await fetch(
    `https://${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accountId)}`,
    { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } },
  )
  if (!lookup.ok) {
    const errText = await lookup.text()
    return { channel: 'linkedin_company', url, ok: false, items: [], reason: `Company lookup failed (${lookup.status}): ${errText.slice(0, 200)}` }
  }
  const profile = await lookup.json() as Record<string, unknown>
  const companyId = (profile.id as string) ?? null
  if (!companyId) {
    return { channel: 'linkedin_company', url, ok: false, items: [], reason: 'Company profile returned no id field.' }
  }

  // Build an item from the company profile (useful even if /posts is empty)
  const profileParts = [
    profile.name ? `Company: ${profile.name}` : '',
    profile.description ? `\n\nDescription:\n${profile.description}` : '',
    profile.industry ? `\n\nIndustry: ${profile.industry}` : '',
    Array.isArray(profile.specialties) ? `\n\nSpecialties: ${(profile.specialties as string[]).join(', ')}` : '',
    profile.tagline ? `\n\nTagline: ${profile.tagline}` : '',
  ].filter(Boolean).join('')

  const items: FetchedItem[] = []
  if (profileParts) {
    items.push({
      channel: 'linkedin_company',
      source_url: (profile.share_url as string) ?? url,
      title: (profile.name as string) ?? undefined,
      text: profileParts.slice(0, MAX_CHARS_PER_ITEM),
    })
  }

  // 2) Fetch company posts via the same endpoint as users, with is_company=true
  const postsUrl = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(companyId)}/posts?account_id=${encodeURIComponent(accountId)}&is_company=true&limit=${itemsPerChannel}`
  const res = await fetch(postsUrl, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } })
  if (res.ok) {
    const data = await res.json() as { items?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }
    const posts = (data.items ?? data.data ?? []) as Array<Record<string, unknown>>
    for (const p of posts.slice(0, itemsPerChannel)) {
      const text =
        (p.text as string) ?? (p.commentary as string) ?? (p.content as string) ??
        (p.body as string) ?? ''
      const cleaned = stripHtml(text).slice(0, MAX_CHARS_PER_ITEM)
      if (cleaned.length > 20) {
        items.push({
          channel: 'linkedin_company',
          source_url: (p.url as string) ?? (p.share_url as string) ?? url,
          title: undefined,
          text: cleaned,
          published_at: (p.date as string) ?? (p.created_at as string) ?? (p.posted_at as string) ?? undefined,
        })
      }
    }
  }

  if (!items.length) {
    return { channel: 'linkedin_company', url, ok: false, items: [], reason: 'No usable content (profile empty and no posts).' }
  }
  return { channel: 'linkedin_company', url, ok: true, items }
}

async function fetchLinkedInPosts(channel: string, url: string, accountId: string, itemsPerChannel: number): Promise<FetchResult> {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return { channel, url, ok: false, items: [], reason: 'UNIPILE_DSN / UNIPILE_API_KEY not configured on server.' }
  }
  const handle = extractLinkedInId(url, channel)
  if (!handle) return { channel, url, ok: false, items: [], reason: `Could not parse LinkedIn handle from ${url}` }

  // Unipile's /posts endpoint requires the internal provider_id (ACo… for personal,
  // numeric/ACw… for companies), not the vanity slug. Resolve via the profile lookup first.
  let providerId: string
  if (handle.startsWith('ACo') || handle.startsWith('ACw')) {
    providerId = handle
  } else {
    const lookupUrl = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(handle)}?account_id=${encodeURIComponent(accountId)}`
    const lookup = await fetch(lookupUrl, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } })
    if (!lookup.ok) {
      const errText = await lookup.text()
      return { channel, url, ok: false, items: [], reason: `Unipile profile lookup for "${handle}" failed (${lookup.status}): ${errText.slice(0, 200)}` }
    }
    const profile = await lookup.json() as Record<string, unknown>
    const pid =
      (profile.provider_id as string) ??
      (profile.id as string) ??
      (typeof profile.entity === 'object' && profile.entity !== null
        ? ((profile.entity as Record<string, unknown>).provider_id as string)
        : undefined)
    if (!pid) {
      return { channel, url, ok: false, items: [], reason: `Could not resolve provider_id for "${handle}" (Unipile returned profile without provider_id field)` }
    }
    providerId = pid
  }

  const postsUrl = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(providerId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${itemsPerChannel}`
  const res = await fetch(postsUrl, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } })
  if (!res.ok) {
    const errText = await res.text()
    return { channel, url, ok: false, items: [], reason: `Unipile posts fetch failed (${res.status}): ${errText.slice(0, 200)}` }
  }
  const data = await res.json() as { items?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }
  const posts = (data.items ?? data.data ?? []) as Array<Record<string, unknown>>
  if (!posts.length) return { channel, url, ok: false, items: [], reason: 'No posts returned by Unipile' }

  return {
    channel, url, ok: true,
    items: posts.slice(0, itemsPerChannel).map(p => {
      const text =
        (p.text as string) ?? (p.commentary as string) ?? (p.content as string) ??
        (p.body as string) ?? (typeof p.share_commentary === 'string' ? p.share_commentary as string : '') ?? ''
      return {
        channel,
        source_url: (p.url as string) ?? (p.share_url as string) ?? url,
        title: undefined,
        text: stripHtml(text).slice(0, MAX_CHARS_PER_ITEM),
        published_at: (p.date as string) ?? (p.created_at as string) ?? (p.posted_at as string) ?? undefined,
      }
    }).filter(it => it.text.length > 20),
  }
}

// LinkedIn newsletters surface as `article`-type posts on the author's normal
// `/posts` feed — Unipile has no first-party newsletter endpoint (confirmed via
// llms.txt). Strategy: find the org's sibling LinkedIn channel (personal or
// company), resolve its provider_id, fetch ~50 recent posts, filter for items
// that look like newsletter articles (post_type === 'article', or an
// `article`/`attachment` object, or a /pulse/ URL).
//
// The newsletter URL format is /newsletters/{slug}-{numeric_urn}/. We extract
// the numeric URN and use it to further refine the filter when the response
// includes it — but the filter still works without it.
function extractNewsletterUrn(url: string): string | null {
  // /newsletters/<slug>-<digits>/?... — capture the trailing digits before any trailing slash
  const m = url.match(/\/newsletters\/[^\/]*?(\d{15,})/i)
  return m?.[1] ?? null
}

async function fetchLinkedInNewsletter(
  url: string,
  accountId: string,
  channels: ChannelProfile[],
  itemsPerChannel: number,
): Promise<FetchResult> {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: 'UNIPILE_DSN / UNIPILE_API_KEY not configured on server.' }
  }

  const newsletterUrn = extractNewsletterUrn(url)

  // Find the sibling LinkedIn identity that authors this newsletter. We need a
  // person OR company channel to resolve into a provider_id, since the
  // newsletter URL alone doesn't expose the author.
  const sibling = channels.find(c => c.channel === 'linkedin_personal')
    ?? channels.find(c => c.channel === 'linkedin_company')
  if (!sibling) {
    return {
      channel: 'linkedin_newsletter', url, ok: false, items: [],
      reason: 'LinkedIn newsletters surface on the author\'s posts feed. Configure a linkedin_personal or linkedin_company channel for the newsletter\'s author so we can fetch from it.',
    }
  }
  const isCompany = sibling.channel === 'linkedin_company'

  // Resolve sibling → provider_id (same paths as fetchLinkedInPosts/fetchLinkedInCompany)
  let providerId: string
  if (isCompany) {
    const slug = extractLinkedInId(sibling.url, 'linkedin_company')
    if (!slug) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Could not parse company slug from sibling channel ${sibling.url}` }
    const lookup = await fetch(
      `https://${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accountId)}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } },
    )
    if (!lookup.ok) {
      return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Sibling company lookup failed (${lookup.status})` }
    }
    const profile = await lookup.json() as Record<string, unknown>
    const cid = profile.id as string | undefined
    if (!cid) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: 'Sibling company has no id field.' }
    providerId = cid
  } else {
    const handle = extractLinkedInId(sibling.url, 'linkedin_personal')
    if (!handle) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Could not parse handle from sibling channel ${sibling.url}` }
    if (handle.startsWith('ACo') || handle.startsWith('ACw')) {
      providerId = handle
    } else {
      const lookup = await fetch(
        `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(handle)}?account_id=${encodeURIComponent(accountId)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } },
      )
      if (!lookup.ok) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Sibling profile lookup failed (${lookup.status})` }
      const profile = await lookup.json() as Record<string, unknown>
      const pid =
        (profile.provider_id as string) ??
        (profile.id as string) ??
        (typeof profile.entity === 'object' && profile.entity !== null
          ? ((profile.entity as Record<string, unknown>).provider_id as string)
          : undefined)
      if (!pid) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Sibling profile has no provider_id.` }
      providerId = pid
    }
  }

  // Fetch a slightly wider slice than the requested output because articles can
  // be sparse in a normal LinkedIn feed, then cap the returned items below.
  const newsletterFetchLimit = Math.min(50, Math.max(itemsPerChannel, 20))
  const postsUrl = `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(providerId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${newsletterFetchLimit}${isCompany ? '&is_company=true' : ''}`
  const res = await fetch(postsUrl, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } })
  if (!res.ok) {
    const errText = await res.text()
    return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: `Unipile posts fetch failed (${res.status}): ${errText.slice(0, 200)}` }
  }
  const data = await res.json() as { items?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }
  const posts = (data.items ?? data.data ?? []) as Array<Record<string, unknown>>
  if (!posts.length) return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: 'Sibling author has no recent posts.' }

  // Filter for posts that look like newsletter articles. Unipile mirrors LinkedIn's
  // raw shape; the discriminator varies across response versions, so we look at
  // multiple signals.
  const articles = posts.filter(p => {
    if (p.post_type === 'article' || p.type === 'article') return true
    if (p.article && typeof p.article === 'object') return true
    const att = p.attachment as Record<string, unknown> | undefined
    if (att && (att.type === 'article' || att.kind === 'article' || att.article)) return true
    const atts = p.attachments as Array<Record<string, unknown>> | undefined
    if (Array.isArray(atts) && atts.some(a => a.type === 'article' || a.kind === 'article' || a.article)) return true
    const shareUrl = (p.share_url as string) ?? (p.url as string) ?? ''
    if (/\/pulse\/|\/newsletters?\//i.test(shareUrl)) return true
    // If we know the newsletter URN, match posts that reference it
    if (newsletterUrn) {
      const blob = JSON.stringify(p)
      if (blob.includes(newsletterUrn)) return true
    }
    return false
  })

  if (!articles.length) {
    return {
      channel: 'linkedin_newsletter', url, ok: false, items: [],
      reason: `Sibling author has posts but none in the last 50 are newsletter articles. The newsletter may not have published recently, or the author URL doesn't match the newsletter publisher.`,
    }
  }

  // Build items — combine share commentary + article title + body excerpt.
  const items: FetchedItem[] = articles.slice(0, itemsPerChannel).map(p => {
    const commentary =
      (p.text as string) ?? (p.commentary as string) ?? (p.content as string) ??
      (p.body as string) ?? (typeof p.share_commentary === 'string' ? p.share_commentary as string : '') ?? ''

    const article = (p.article as Record<string, unknown> | undefined)
      ?? (p.attachment as Record<string, unknown> | undefined)
      ?? ((p.attachments as Array<Record<string, unknown>> | undefined)?.[0])
      ?? {}

    const articleTitle = (article.title as string) ?? (article.headline as string) ?? (p.title as string) ?? undefined
    const articleSubtitle = (article.subtitle as string) ?? (article.description as string) ?? ''
    const articleBody = (article.body as string) ?? (article.text as string) ?? ''

    const composed = [
      articleTitle ? `Title: ${articleTitle}` : '',
      articleSubtitle ? `Subtitle: ${articleSubtitle}` : '',
      commentary ? `\nShare commentary:\n${stripHtml(commentary)}` : '',
      articleBody ? `\nArticle body excerpt:\n${stripHtml(articleBody)}` : '',
    ].filter(Boolean).join('\n')

    return {
      channel: 'linkedin_newsletter',
      source_url: (p.share_url as string) ?? (p.url as string) ?? url,
      title: articleTitle,
      text: composed.slice(0, MAX_CHARS_PER_ITEM),
      published_at: (p.date as string) ?? (p.created_at as string) ?? (p.posted_at as string) ?? undefined,
    }
  }).filter(it => it.text.length > 40)

  if (!items.length) {
    return { channel: 'linkedin_newsletter', url, ok: false, items: [], reason: 'Filtered articles had insufficient text content.' }
  }
  return { channel: 'linkedin_newsletter', url, ok: true, items }
}

async function fetchRSS(channel: string, urlIn: string, itemsPerChannel: number): Promise<FetchResult> {
  let url = normaliseFeedUrl(channel, urlIn)
  const headers = { 'User-Agent': 'InnovareAI-Auditor/0.1 (+content-pipeline)' }

  let res = await fetch(url, { headers })
  if (!res.ok) return { channel, url: urlIn, ok: false, items: [], reason: `Fetch failed: HTTP ${res.status}` }
  let body = await res.text()

  // If we got HTML instead of XML, try to auto-discover the feed via <link rel="alternate">
  if (!looksLikeFeed(body)) {
    const discovered = discoverFeedLink(body, url)
    if (discovered) {
      url = discovered
      res = await fetch(url, { headers })
      if (!res.ok) return { channel, url: urlIn, ok: false, items: [], reason: `Discovered feed fetch failed: HTTP ${res.status}` }
      body = await res.text()
    } else if (channel === 'blog') {
      // No RSS feed. Fall back to HTML index scrape for blogs (covers Next.js,
      // Webflow, and custom marketing-site blogs that don't ship a feed).
      return await fetchBlogHtml(urlIn, body, itemsPerChannel)
    } else {
      return { channel, url: urlIn, ok: false, items: [], reason: 'URL returned HTML and no RSS/Atom <link rel="alternate"> found. Try pasting the feed URL directly.' }
    }
  }

  const items = parseRSS(body).slice(0, itemsPerChannel)
  if (!items.length) return { channel, url: urlIn, ok: false, items: [], reason: 'No items in feed' }
  return {
    channel, url: urlIn, ok: true,
    items: items.map(it => ({
      channel,
      source_url: it.link ?? urlIn,
      title: it.title,
      text: stripHtml(it.contentEncoded || it.description || '').slice(0, MAX_CHARS_PER_ITEM),
      published_at: it.pubDate,
    })),
  }
}

// HTML-scrape fallback for blogs without RSS. Reads the index page, finds
// links that look like blog posts (same origin, path heuristics, link text),
// fetches the top N in parallel, and extracts each post's main content.
async function fetchBlogHtml(blogUrl: string, indexHtml: string, itemsPerChannel: number): Promise<FetchResult> {
  const base = new URL(blogUrl)
  const candidates = extractBlogPostLinks(indexHtml, base)
  if (!candidates.length) {
    return { channel: 'blog', url: blogUrl, ok: false, items: [], reason: 'No RSS feed and could not identify blog-post links on the index HTML.' }
  }

  const top = candidates.slice(0, itemsPerChannel)
  const headers = { 'User-Agent': 'InnovareAI-Auditor/0.1 (+content-pipeline)' }
  const posts = await Promise.all(top.map(async (c) => {
    try {
      const r = await fetch(c.href, { headers, signal: AbortSignal.timeout(15_000) })
      if (!r.ok) return null
      const html = await r.text()
      const text = extractArticleText(html)
      if (text.length < 200) return null
      return {
        channel: 'blog',
        source_url: c.href,
        title: extractTitle(html) ?? c.title,
        text: text.slice(0, MAX_CHARS_PER_ITEM),
      } as FetchedItem
    } catch { return null }
  }))

  const items = posts.filter((p): p is FetchedItem => p !== null)
  if (!items.length) {
    return { channel: 'blog', url: blogUrl, ok: false, items: [], reason: `Found ${candidates.length} candidate links but none yielded substantial article content.` }
  }
  return { channel: 'blog', url: blogUrl, ok: true, items }
}

async function fetchGenericHtmlSource(channel: string, urlIn: string, fallbackReason: string): Promise<FetchResult> {
  const normalized = normalizePublicUrl(channel, urlIn)
  if (!normalized) {
    return { channel, url: urlIn, ok: false, items: [], reason: `Could not parse ${labelForChannel(channel)} URL.` }
  }
  try {
    const res = await fetch(normalized, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; VeraAuditor/0.1; +https://innovareai.com)',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return { channel, url: urlIn, ok: false, items: [], reason: `${fallbackReason} HTTP ${res.status}.` }
    }
    const body = await res.text()
    const text = extractArticleText(body).slice(0, MAX_CHARS_PER_ITEM)
    if (text.length < 120) {
      return { channel, url: urlIn, ok: false, items: [], reason: `${fallbackReason} No readable public text found.` }
    }
    return {
      channel,
      url: urlIn,
      ok: true,
      reason: fallbackReason,
      items: [{
        channel,
        source_url: normalized,
        title: extractTitle(body) ?? labelForChannel(channel),
        text,
      }],
    }
  } catch (error) {
    return { channel, url: urlIn, ok: false, items: [], reason: `${fallbackReason} ${error instanceof Error ? error.message : String(error)}` }
  }
}

function normalizePublicUrl(channel: string, raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (channel === 'reddit' && /^r\/[A-Za-z0-9_]+/i.test(trimmed)) {
    return `https://www.reddit.com/${trimmed.replace(/^\/+/, '')}`
  }
  if (channel === 'twitter' && trimmed.startsWith('@')) return `https://x.com/${trimmed.slice(1)}`
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

interface PostCandidate { href: string; title: string }

function extractBlogPostLinks(html: string, base: URL): PostCandidate[] {
  const out = new Map<string, PostCandidate>()
  const aTags = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  for (const m of aTags) {
    const raw = m[1]
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue
    let abs: URL
    try { abs = new URL(raw, base) } catch { continue }
    if (abs.origin !== base.origin) continue
    if (abs.pathname === base.pathname || abs.pathname === '/' || abs.pathname === '') continue

    // Path heuristics — must look like a content slug, not a nav link
    const path = abs.pathname.replace(/\/$/, '')
    const segs = path.split('/').filter(Boolean)
    if (segs.length < 1) continue

    const lastSeg = segs[segs.length - 1]
    const hasYear = /\b(20\d{2})\b/.test(path)
    const hasContentMarker = /(blog|post|article|news|insights|stories|writing)/i.test(path)
    const looksLikeSlug = /[a-z0-9](-[a-z0-9]+){2,}/i.test(lastSeg)   // multi-word slug
    if (!hasYear && !hasContentMarker && !looksLikeSlug) continue

    // Skip common non-post paths
    if (/\b(category|tag|tags|author|authors|page|search|feed|rss|sitemap|privacy|terms|contact|about|pricing|login|signup|register|careers)\b/i.test(path)) continue

    const linkText = stripHtml(m[2] ?? '').slice(0, 200)
    if (linkText.length < 8) continue
    if (/^(home|read more|continue|click|here|more)$/i.test(linkText.trim())) continue

    const key = abs.toString()
    if (!out.has(key)) out.set(key, { href: key, title: linkText })
  }
  return [...out.values()]
}

function extractArticleText(html: string): string {
  // Prefer <article>, then <main>, then a sensible body fallback.
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  let chunk = articleMatch?.[1] ?? mainMatch?.[1]
  if (!chunk) {
    // Strip nav/footer/header/aside/script/style from the entire page
    chunk = html
      .replace(/<(script|style|nav|footer|header|aside|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
  }
  return stripHtml(chunk)
}

function extractTitle(html: string): string | undefined {
  // Prefer og:title or twitter:title, fall back to <title>, fall back to first h1
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
  if (og) return og
  const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
  if (tw) return tw
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  if (t) return stripHtml(t)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.trim()
  return h1 ? stripHtml(h1) : undefined
}

function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 1024)
  return /<\?xml|<rss\b|<feed\b/i.test(head)
}

function discoverFeedLink(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 200_000)  // search just the head/body start
  const linkRe = /<link[^>]+rel=["'](?:alternate|feed)["'][^>]*>/gi
  for (const tagMatch of head.matchAll(linkRe)) {
    const tag = tagMatch[0]
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1]?.toLowerCase()
    if (!type || !(type.includes('rss') || type.includes('atom') || type.includes('xml'))) continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try { return new URL(href, baseUrl).toString() } catch { /* skip */ }
  }
  return null
}

function normaliseFeedUrl(channel: string, urlIn: string): string {
  if (channel === 'medium') {
    // accept @handle, https://medium.com/@handle, full URL — output the feed
    const handleMatch = urlIn.match(/@([A-Za-z0-9._-]+)/)
    if (handleMatch) return `https://medium.com/feed/@${handleMatch[1]}`
    if (urlIn.includes('medium.com') && !urlIn.includes('/feed')) {
      return urlIn.replace(/\/?$/, '').replace('medium.com/', 'medium.com/feed/')
    }
  }
  // Blog: leave as-is. If user gave the HTML page, common-case is /feed or /rss appended,
  // but we can't auto-discover here without parsing HTML. Try the URL directly; if it
  // returns HTML it'll fail parseRSS and surface as "no items".
  return urlIn
}

interface RSSItem { title?: string; link?: string; description?: string; contentEncoded?: string; pubDate?: string }

function parseRSS(xml: string): RSSItem[] {
  const items: RSSItem[] = []
  // Atom feeds use <entry>, RSS 2.0 uses <item>
  const itemBlocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0])
  for (const block of itemBlocks) {
    items.push({
      title:        getTag(block, 'title'),
      link:         getTag(block, 'link') || getLinkHref(block),
      description:  getTag(block, 'description') || getTag(block, 'summary'),
      contentEncoded: getTag(block, 'content:encoded') || getTag(block, 'content'),
      pubDate:      getTag(block, 'pubDate') || getTag(block, 'published') || getTag(block, 'updated'),
    })
  }
  return items
}

function getTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return undefined
  return decodeCDATA(m[1].trim())
}

function getLinkHref(block: string): string | undefined {
  // Atom <link href="…" />
  const m = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)
  return m?.[1]
}

function decodeCDATA(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return m ? m[1] : s
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

// ──────────────────────────────────────────────────────────────────────────────
// Synthesis prompt
// ──────────────────────────────────────────────────────────────────────────────

function buildCorpus(results: FetchResult[]): string {
  const blocks = results.map(r => {
    const header = `### Source: ${r.channel} (${r.url}) · ${r.items.length} items`
    const body = r.items.map((it, i) =>
      `--- Item ${i + 1}${it.title ? ` · ${it.title}` : ''}${it.published_at ? ` · ${it.published_at}` : ''} ---\n${it.text}`
    ).join('\n\n')
    return `${header}\n${body}`
  })
  return blocks.join('\n\n=========================================\n\n')
}

interface Proposal {
  brand_voice: Record<string, unknown>
  business_context: Record<string, unknown>
  personas: unknown[]
  skills: unknown[]
}

async function synthesise(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  runtime: TextRuntime,
  corpus: string,
  usageMetadata: Record<string, unknown>,
  send: (event: string, data: unknown) => void,
): Promise<{ proposal: Proposal; inputTokens: number | null; outputTokens: number | null; budgetWarning: ProjectAiBudgetWarning | null }> {
  const sys = `You are VERA's Strategy Brain auditor. You read a company's existing content and extract a precise model of their voice, audience, channel roles, content strategy assumptions, and repeatable content patterns. Output ONLY valid JSON in exactly this shape, no prose, no markdown fences:

{
  "brand_voice": {
    "tone": ["3-5 specific tone descriptors, e.g. 'direct', 'self-deprecating', 'analytical'"],
    "writing_rules": ["3-7 concrete rules the writer follows, e.g. 'opens with a problem statement, not a hook'"],
    "forbidden_phrases": ["actual phrases this author avoids, leave empty array if none observed"],
    "required_phrases": ["recurring phrases/idioms, leave empty if none"],
    "system_prompt": "A 2-3 sentence Writer-agent system prompt that captures this voice precisely. Reference specifics from the content."
  },
  "business_context": {
    "companyName": "",
    "industry": "",
    "offer": "",
    "audience": "",
    "customerProblems": "",
    "differentiators": "",
    "competitors": "",
    "proofPoints": "",
    "contentGoals": "",
    "speakerStrategy": "",
    "platformToneOfVoice": "",
    "demandObjective": "",
    "conversionPath": "",
    "channelStrategy": "",
    "contentFormats": "",
    "approvalModel": "",
    "approvalStakeholders": "",
    "engagementSignals": "",
    "samHandoffRules": "",
    "learningCadence": "",
    "channelOperatingPolicies": {
      "linkedin": {
        "speakerMode": "",
        "approvalMode": "",
        "publishGuard": "",
        "measurementFocus": "",
        "samTrigger": "",
        "risk": "low | medium | high"
      }
    },
    "constraints": ""
  },
  "personas": [
    {
      "name": "Short label, e.g. 'returning customers' or 'technical operators'",
      "title": "Role, segment, or audience descriptor",
      "pain_points": ["2-4 specific pains observed in the content's framing"],
      "goals": ["2-4 specific goals the content speaks to"],
      "is_primary": true
    }
  ],
  "skills": [
    {
      "type": "writing_rule | content | platform | brand",
      "name": "Short label",
      "description": "What this skill does",
      "prompt_module": "A self-contained instruction block that can be injected into an agent's system prompt",
      "injected_into": "writer | strategist | brand_guard"
    }
  ]
}

Rules:
- Base every claim on the content. Do not invent generic best practices; extract patterns that are actually present.
- If the content is sparse, say less. Fewer rules, fewer skills. Quality over quantity.
- Do not return source URLs in business_context. The app already stores source URLs separately.
- business_context should focus on the assumptions visible in the content: audience, objective, offer, problems, proof, channel fit, approval, engagement signals, traffic path, and follow-up triggers.
- platformToneOfVoice should separate a shared brand core from platform-specific tone when the evidence supports it.
- speakerStrategy should say when Vera should write as the company, founder, named expert, or team. If evidence is unclear, say this needs human review.
- engagementSignals should prioritize comments, shares, saves, qualified clicks, questions, inquiries, purchases, community actions, and traffic, not only likes or views.
- channelOperatingPolicies may include only channels with evidence. Supported keys: linkedin, youtube, medium, quora, reddit, x, instagram, facebook, blog, email.
- For every channelOperatingPolicies entry, use fields speakerMode, approvalMode, publishGuard, measurementFocus, samTrigger, risk. Risk must be low, medium, or high.
- Personas should reflect who the author is writing FOR (their audience), not who the author IS.
- Skills are reusable patterns: a hook style, a structural template, a recurring argument frame. 2-5 skills max.`
  const userMessage = `Analyse this content and produce the JSON proposal:\n\n${corpus}`
  const budget = await checkAuditBudget(supabase, orgId, projectId, runtime, 'audit.content', sys, userMessage, CONTENT_SYNTHESIS_MAX_TOKENS, usageMetadata)
  if (!budget.ok) throw new Error(budget.message)
  if (budget.warning) send('budget_warning', { warning: budget.warning })

  const response = await streamText(runtime, {
    system: sys,
    user: userMessage,
    maxTokens: CONTENT_SYNTHESIS_MAX_TOKENS,
    json: true,
    onText: text => send('synthesis_chunk', { text }),
  })

  const raw = response.text

  // Parse JSON tolerantly
  let proposal: Proposal
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    proposal = JSON.parse(match ? match[0] : raw) as Proposal
  } catch {
    proposal = { brand_voice: { raw }, business_context: {}, personas: [], skills: [] }
  }
  if (!proposal.business_context || typeof proposal.business_context !== 'object' || Array.isArray(proposal.business_context)) {
    proposal.business_context = {}
  }
  if (!proposal.brand_voice || typeof proposal.brand_voice !== 'object' || Array.isArray(proposal.brand_voice)) {
    proposal.brand_voice = {}
  }
  if (!Array.isArray(proposal.personas)) proposal.personas = []
  if (!Array.isArray(proposal.skills)) proposal.skills = []
  return { proposal, inputTokens: response.inputTokens, outputTokens: response.outputTokens, budgetWarning: budget.warning }
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

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
