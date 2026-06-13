// HubSpot CMS connector — CMS Blog Posts API v3.
//
// Auth: HubSpot Private App Access Token (Bearer). Operator generates in
// HubSpot → Settings → Integrations → Private Apps (needs "cms.blogs.posts"
// scopes: read, write, publish).
//
// Endpoints used:
//   GET  /cms/v3/blogs/blogs               — list blogs (for connect probe + content_group_id)
//   GET  /cms/v3/blogs/posts/{id}          — verify
//   POST /cms/v3/blogs/posts               — create
//   POST /cms/v3/blogs/posts/{id}/draft/push-live — publish a draft
//   PATCH /cms/v3/blogs/posts/{id}         — update (e.g. unpublish to draft)
//
// Each post needs a `contentGroupId` (the blog ID). Operator picks at
// connect time from the list we fetched.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { publisherClientProjectId, requirePublisherActionAccess, type AdminClient } from '../_shared/auth.ts'
import { renderMarkdown, slugify } from '../_shared/markdown.ts'
import { acquirePublishLockForOpenPost, releasePublishLock } from '../_shared/publish-guard.ts'
import {
  claimPublish,
  completePublishClaim,
  releasePublishClaim,
} from '../_shared/publish-claims.ts'
import type {
  HealthCheckResult, DryRunResult, PublishResult, VerifyResult, UnpublishResult,
  PostInput, PublisherError,
} from '../_shared/publisher.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const HUBSPOT_API = 'https://api.hubapi.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const action = body.action as string
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requirePublisherActionAccess(req, supabase, SERVICE_KEY, body, corsHeaders)
  if (!auth.ok) return auth.response
  try {
    switch (action) {
      case 'connect':       return json(await connect(supabase, body))
      case 'health_check':  return json(await health_check(supabase, body))
      case 'dry_run':       return json(await dry_run(supabase, body))
      case 'publish':       return json(await publish(supabase, body))
      case 'verify':        return json(await verify(supabase, body))
      case 'unpublish':     return json(await unpublish(supabase, body))
      case 'list_blogs':    return json(await list_blogs(body))
      default:              return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('hubspot-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function connect(supabase: AdminClient, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const client_project_id = publisherClientProjectId(input)
  const name = input.name as string
  const access_token = (input.access_token as string)?.trim()
  const content_group_id = (input.content_group_id as string)?.trim()

  if (!org_id || !name || !access_token || !content_group_id) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, access_token, content_group_id all required.') }
  }

  // Probe blogs endpoint
  const blogsRes = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/blogs?limit=20`, access_token)
  if (blogsRes.status === 401 || blogsRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'HubSpot rejected the access token.',
      'Generate a new Private App access token in Settings → Integrations → Private Apps with cms.blogs.posts (read/write/publish) scopes.') }
  }
  if (blogsRes.status < 200 || blogsRes.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `HubSpot probe HTTP ${blogsRes.status}.`, 'Check HubSpot status or token scopes.') }
  }
  const blogs = (blogsRes.json as { results?: Array<{ id: string; name?: string; absoluteUrl?: string }> })?.results ?? []
  const matchedBlog = blogs.find(b => b.id === content_group_id)
  if (!matchedBlog) {
    return { ok: false, error: typed('target_not_found',
      `Blog ${content_group_id} not found in this HubSpot portal.`,
      `Pick from: ${blogs.map(b => `${b.id} (${b.name})`).join(', ').slice(0, 200)}`) }
  }

  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, project_id: client_project_id, kind: 'hubspot', name,
    config: {
      content_group_id,
      blog_name: matchedBlog.name ?? null,
      blog_url: matchedBlog.absoluteUrl ?? null,
    },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${matchedBlog.name ?? content_group_id}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()
  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Save failed: ${insErr?.message}`, 'Try again.') }
  }
  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', { p_id: pub.id, p_creds: { access_token } })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Credential save failed: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true, publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected to ${matchedBlog.name}`, checked_at: new Date().toISOString() },
  }
}

// Side-utility for the wizard: list blogs so operator can pick content_group_id.
async function list_blogs(input: Record<string, unknown>): Promise<{ ok: boolean; blogs?: Array<{ id: string; name: string; url: string }>; error?: PublisherError }> {
  const access_token = (input.access_token as string)?.trim()
  if (!access_token) {
    return { ok: false, error: typed('validation_failed', 'access_token required.', '') }
  }
  const res = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/blogs?limit=50`, access_token)
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'HubSpot rejected the token.',
      'Confirm the Private App token has cms.blogs.posts scopes.') }
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `HTTP ${res.status}`, '') }
  }
  const blogs = ((res.json as { results?: Array<{ id: string; name?: string; absoluteUrl?: string }> }).results ?? [])
    .map(b => ({ id: b.id, name: b.name ?? '(unnamed)', url: b.absoluteUrl ?? '' }))
  return { ok: true, blogs }
}

async function health_check(supabase: AdminClient, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { creds } = await loadPublisher(supabase, publisher_id)
  const res = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/blogs?limit=1`, creds.access_token)
  const checked_at = new Date().toISOString()
  if (res.status === 200) { await updateHealth(supabase, publisher_id, 'healthy', null); return { ok: true, status: 'healthy', checked_at } }
  if (res.status === 401 || res.status === 403) { await updateHealth(supabase, publisher_id, 'stale', 'Token rejected'); return { ok: false, status: 'stale', detail: 'Token rejected', checked_at } }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

async function dry_run(supabase: AdminClient, input: Record<string, unknown>): Promise<DryRunResult> {
  const post = input.post as PostInput
  const rendered_html = renderMarkdown(post.body_md)
  const final_slug = post.slug?.trim() || slugify(post.title)
  return {
    ok: true,
    preview: {
      rendered_html,
      final_slug,
      target_categories: [],
      target_tags: post.tags ?? [],
      image_will_upload: !!post.featured_image_url,
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: post.scheduled_at ?? null,
      scheduled_at_target_tz: post.scheduled_at ?? null,
    },
    warnings: [],
  }
}

async function publish(supabase: AdminClient, input: Record<string, unknown>): Promise<PublishResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const idempotency_key = input.idempotency_key as string
  const post_id = (input.post_id as string | undefined) ?? null
  const t0 = Date.now()
  if (!idempotency_key) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'idempotency_key required.', '') }
  }
  if (!post_id) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'post_id required.', 'Publish actions must target a content post.') }
  }

  const { data: prior } = await supabase.from('publish_attempts')
    .select('id, outcome, remote_id, remote_url').eq('idempotency_key', idempotency_key).eq('phase', 'publish').maybeSingle()
  if (prior && prior.outcome === 'success') {
    return { ok: true, remote_id: prior.remote_id as string | undefined, remote_url: prior.remote_url as string | undefined,
      attempt_id: prior.id as string, latency_ms: Date.now() - t0, verified: true }
  }
  const publishLock = await acquirePublishLockForOpenPost(supabase, post_id, publisher_id, null)
  if (!publishLock.ok) {
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0,
      error: typed('validation_failed', publishLock.message, publishLock.recoveryAction) }
  }
  const publishClaim = await claimPublish(supabase, publishLock.post, 'hubspot', `hubspot-publish:${publisher_id}`)
  if (!publishClaim.ok) {
    await releasePublishLock(supabase, post_id, publisher_id)
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishClaim.message,
      'Refresh the post detail page before retrying.') }
  }
  let publishClaimCompleted = false

  try {
    const { config, creds, org_id } = await loadPublisher(supabase, publisher_id)
    const content_group_id = config.content_group_id as string
    const rendered_html = renderMarkdown(post.body_md)
    const slug = post.slug?.trim() || slugify(post.title)
    const stateTarget = post.status === 'published' ? 'PUBLISHED'
                      : post.status === 'scheduled' ? 'SCHEDULED' : 'DRAFT'

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key, phase: 'create_post', outcome: 'in_progress',
      request_payload: { content_group_id, slug, status: post.status, body_chars: rendered_html.length },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    const hsPayload: Record<string, unknown> = {
      contentGroupId: content_group_id,
      name: post.title,           // HubSpot's "post name" → renders in /name slug
      htmlTitle: post.title,
      slug,
      postBody: rendered_html,
      state: stateTarget,
    }
    if (post.excerpt) hsPayload.metaDescription = post.excerpt
    if (post.featured_image_url) {
      hsPayload.featuredImage = post.featured_image_url
      hsPayload.useFeaturedImage = true
    }
    if (post.tags?.length) hsPayload.tagIds = []  // HubSpot tags require pre-existing tag IDs; v2 ships tag reconcile
    if (stateTarget === 'SCHEDULED' && post.scheduled_at) hsPayload.publishDate = post.scheduled_at

    const createRes = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/posts`, creds.access_token, {
      method: 'POST', body: JSON.stringify(hsPayload),
    })

    if (createRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'HubSpot rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited', 'HubSpot rate-limited.', 'Retry shortly.') }
    }
    if (createRes.status === 401 || createRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Token rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired', 'HubSpot token rejected.', 'Reconnect from Settings → Integrations.') }
    }
    if (createRes.status < 200 || createRes.status >= 300) {
      const errBody = createRes.json as { message?: string; errors?: Array<{ message?: string }> }
      const msg = errBody?.errors?.map(e => e.message).filter(Boolean).join('; ') ?? errBody?.message ?? `HTTP ${createRes.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check blog post requirements.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check fields.') }
    }
    const post_data = createRes.json as { id: string; absoluteUrl?: string; state?: string }

    // For scheduled or draft, just return.
    // For PUBLISHED, HubSpot's API accepts state=PUBLISHED on create and publishes immediately.
    const verified = post_data.state === stateTarget

    await completePublishClaim(supabase, publishLock.post, post_data.id, post_data.absoluteUrl)
    publishClaimCompleted = true

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: post_data.id, remote_url: post_data.absoluteUrl ?? null,
      response_body: { post_id: post_data.id, state: post_data.state, url: post_data.absoluteUrl },
    })
    return { ok: true, remote_id: post_data.id, remote_url: post_data.absoluteUrl, verified, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    if (!publishClaimCompleted) {
      await releasePublishClaim(supabase, post_id, 'hubspot publish did not complete')
    }
    await releasePublishLock(supabase, post_id, publisher_id)
  }
}

async function verify(supabase: AdminClient, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { creds } = await loadPublisher(supabase, publisher_id)
  const res = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/posts/${remote_id}`, creds.access_token)
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Post deleted' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const post = res.json as { state?: string; absoluteUrl?: string; featuredImage?: string | null }
  const statusMap: Record<string, 'draft' | 'published' | 'scheduled'> = {
    PUBLISHED: 'published', SCHEDULED: 'scheduled', DRAFT: 'draft', PUBLISHED_OR_SCHEDULED: 'published',
  }
  return {
    ok: true,
    status: statusMap[post.state ?? 'DRAFT'] ?? 'draft',
    remote_url: post.absoluteUrl,
    featured_image_set: !!post.featuredImage,
  }
}

async function unpublish(supabase: AdminClient, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { creds } = await loadPublisher(supabase, publisher_id)
  const res = await hsFetch(`${HUBSPOT_API}/cms/v3/blogs/posts/${remote_id}`, creds.access_token, {
    method: 'PATCH', body: JSON.stringify({ state: 'DRAFT' }),
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Unpublish returned HTTP ${res.status}.`, 'Check token scopes.') }
  }
  return { ok: true }
}

async function loadPublisher(supabase: AdminClient, publisher_id: string):
Promise<{ config: Record<string, unknown>; creds: { access_token: string }; org_id: string }> {
  const { data: pub } = await supabase.from('publishers').select('config, org_id').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error('credentials missing')
  return { config: pub.config as Record<string, unknown>, creds: creds as { access_token: string }, org_id: pub.org_id as string }
}

async function updateHealth(supabase: AdminClient, id: string, status: 'healthy' | 'stale' | 'unknown', detail: string | null): Promise<void> {
  await supabase.from('publishers').update({ health_status: status, health_detail: detail, last_health_check: new Date().toISOString() }).eq('id', id)
}

async function markAttempt(supabase: AdminClient, attempt_id: string,
  outcome: 'success' | 'failed', error_code: string | null, error_message: string | null,
  recovery_action: string | null, extras?: Record<string, unknown>): Promise<void> {
  await supabase.from('publish_attempts').update({
    outcome, error_code, error_message, recovery_action,
    completed_at: new Date().toISOString(), ...(extras ?? {}),
  }).eq('id', attempt_id)
}

interface HsRes { status: number; json: unknown; headers: Record<string, string> }
async function hsFetch(url: string, token: string, opts: { method?: string; body?: string } = {}): Promise<HsRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'VERA-hubspot-publish/1.0' },
      body: opts.body, signal: AbortSignal.timeout(15_000),
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let bodyJson: unknown = null
    try {
      const ct = res.headers.get('content-type') ?? ''
      bodyJson = ct.includes('json') ? await res.json() : await res.text()
    } catch { /* leave null */ }
    return { status: res.status, json: bodyJson, headers }
  } catch (e) {
    console.warn('hsFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError { return { code, message, recovery_action } }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
