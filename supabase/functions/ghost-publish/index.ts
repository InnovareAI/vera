// Ghost connector — same 6-verb shape as wordpress-publish.
//
// Ghost specifics:
//   - Admin API at https://<site>/ghost/api/admin/
//   - Short-lived JWTs (5 min) signed with HMAC-SHA256 from the API key
//     "<24-char id>:<64-char hex secret>" (Admin → Integrations → API key)
//   - Posts wrapped in {posts: [...]} envelope (Ghost convention)
//   - Tags as array of {name: "..."} objects; created on-the-fly if new
//   - HTML input (not markdown — we render server-side here)
//   - feature_image is a URL (no upload step required — Ghost fetches it)
//
// Failure cases covered: wrong URL, bad API key, REST disabled (Ghost
// can't really disable it but malformed JWT throws), rate limit, slug
// collision (Ghost auto-suffixes), status mapping (draft|published|scheduled).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { requirePublisherActionAccess, type AdminClient } from '../_shared/auth.ts'
import { renderMarkdown, slugify } from '../_shared/markdown.ts'
import { makeGhostJwt } from '../_shared/ghost-jwt.ts'
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
      default:              return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('ghost-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── connect ────────────────────────────────────────────────────────────────
async function connect(supabase: AdminClient, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const name = input.name as string
  const base_url_raw = input.base_url as string
  const api_key = input.api_key as string

  if (!org_id || !name || !base_url_raw || !api_key) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, base_url, api_key all required.') }
  }

  // Normalize URL
  let base_url: string
  try {
    const u = new URL(/^https?:\/\//i.test(base_url_raw) ? base_url_raw : `https://${base_url_raw}`)
    u.search = ''; u.hash = ''
    base_url = u.toString().replace(/\/+$/, '')
  } catch {
    return { ok: false, error: typed('target_misconfigured',
      'That doesn\'t look like a URL.', 'Use the site root, e.g. https://blog.example.com') }
  }

  // Validate JWT generation (catches bad key format early)
  let jwt: string
  try { jwt = await makeGhostJwt(api_key) } catch (e) {
    return { ok: false, error: typed('auth_invalid',
      e instanceof Error ? e.message : String(e),
      'Copy the API key exactly from Ghost Admin → Integrations → "Custom Integration" → Admin API Key.') }
  }

  // Probe /ghost/api/admin/site/ — should return site info if everything's wired
  const res = await fetchSafe(`${base_url}/ghost/api/admin/site/`, {
    headers: { 'Authorization': `Ghost ${jwt}` }, timeoutMs: 8_000,
  })
  if (res.networkError) {
    return { ok: false, error: typed('network_timeout',
      `Couldn\'t reach ${base_url}.`, 'Check the URL and site reachability.') }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'Ghost rejected the API key.',
      'Confirm you copied the Admin API Key (not the Content API key). They\'re different.') }
  }
  if (res.status === 404) {
    return { ok: false, error: typed('target_not_found',
      'No Ghost Admin API found at this URL.',
      'Confirm the site is running Ghost and the URL is the site root (not a subdirectory).') }
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `Auth probe returned HTTP ${res.status}.`, 'Check the Ghost site logs.') }
  }

  const siteData = (res.json as { site?: { title?: string; url?: string } })?.site
  if (!siteData) {
    return { ok: false, error: typed('target_misconfigured',
      'Authenticated but response didn\'t match Ghost\'s shape.', 'Confirm this is a Ghost-powered site.') }
  }

  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, kind: 'ghost', name,
    config: { base_url, site_title: siteData.title ?? null, site_url: siteData.url ?? null },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${siteData.title ?? base_url}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()

  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Save failed: ${insErr?.message}`, 'Try again.') }
  }

  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', {
    p_id: pub.id, p_creds: { api_key },
  })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Credential save failed: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true,
    publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected to ${siteData.title}`, checked_at: new Date().toISOString() },
  }
}

// ─── health_check ───────────────────────────────────────────────────────────
async function health_check(supabase: AdminClient, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const base_url = config.base_url as string
  let jwt: string
  try { jwt = await makeGhostJwt(creds.api_key) } catch {
    await updateHealth(supabase, publisher_id, 'stale', 'Invalid API key format')
    return { ok: false, status: 'stale', detail: 'API key malformed', checked_at: new Date().toISOString() }
  }
  const res = await fetchSafe(`${base_url}/ghost/api/admin/site/`, {
    headers: { 'Authorization': `Ghost ${jwt}` }, timeoutMs: 6_000,
  })
  const checked_at = new Date().toISOString()
  if (res.status === 200) {
    await updateHealth(supabase, publisher_id, 'healthy', null)
    return { ok: true, status: 'healthy', checked_at }
  }
  if (res.status === 401 || res.status === 403) {
    await updateHealth(supabase, publisher_id, 'stale', 'Auth rejected')
    return { ok: false, status: 'stale', detail: 'Key revoked or expired', checked_at }
  }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

// ─── dry_run ────────────────────────────────────────────────────────────────
async function dry_run(supabase: AdminClient, input: Record<string, unknown>): Promise<DryRunResult> {
  const post = input.post as PostInput
  // Ghost auto-suffixes colliding slugs server-side; we just render + propose.
  const rendered_html = renderMarkdown(post.body_md)
  const final_slug = post.slug?.trim() || slugify(post.title)
  return {
    ok: true,
    preview: {
      rendered_html,
      final_slug,
      target_categories: [],  // Ghost has no top-level categories, tags only
      target_tags: post.tags ?? [],
      image_will_upload: false,  // Ghost takes feature_image as a URL — no upload step
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: post.scheduled_at ?? null,
      scheduled_at_target_tz: post.scheduled_at ?? null,
    },
    warnings: post.categories?.length
      ? [`Ghost doesn\'t support categories — these will be ignored: ${post.categories.join(', ')}`]
      : [],
  }
}

// ─── publish ────────────────────────────────────────────────────────────────
async function publish(supabase: AdminClient, input: Record<string, unknown>): Promise<PublishResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const idempotency_key = input.idempotency_key as string
  const post_id = (input.post_id as string | undefined) ?? null
  const t0 = Date.now()

  if (!idempotency_key) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed',
      'idempotency_key required.', 'Pass a unique key per logical publish.') }
  }

  if (!post_id) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'post_id required.', 'Publish actions must target a content post.') }
  }

  const { data: prior } = await supabase.from('publish_attempts')
    .select('id, outcome, remote_id, remote_url')
    .eq('idempotency_key', idempotency_key).eq('phase', 'publish').maybeSingle()
  if (prior && prior.outcome === 'success') {
    return {
      ok: true, remote_id: prior.remote_id as string | undefined, remote_url: prior.remote_url as string | undefined,
      attempt_id: prior.id as string, latency_ms: Date.now() - t0, verified: true,
    }
  }

  const publishLock = await acquirePublishLockForOpenPost(supabase, post_id, publisher_id, null)
  if (!publishLock.ok) {
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishLock.message, publishLock.recoveryAction) }
  }

  const publishClaim = await claimPublish(supabase, publishLock.post, 'ghost', `ghost-publish:${publisher_id}`)
  if (!publishClaim.ok) {
    await releasePublishLock(supabase, post_id, publisher_id)
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishClaim.message,
      'Refresh the post detail page before retrying.') }
  }
  let publishClaimCompleted = false

  try {
    const { config, creds, org_id } = await loadPublisher(supabase, publisher_id)
    const base_url = config.base_url as string
    const jwt = await makeGhostJwt(creds.api_key)

    const rendered_html = renderMarkdown(post.body_md)
    const slug = post.slug?.trim() || slugify(post.title)

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key,
      phase: 'publish', outcome: 'in_progress',
      request_payload: { title: post.title, slug, status: post.status, body_chars: rendered_html.length },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    const ghostStatus = post.status === 'scheduled' ? 'scheduled'
      : post.status === 'published' ? 'published' : 'draft'

    const ghostPost: Record<string, unknown> = {
      title: post.title,
      slug,
      html: rendered_html,
      status: ghostStatus,
    }
    if (post.excerpt) ghostPost.custom_excerpt = post.excerpt
    if (post.featured_image_url) ghostPost.feature_image = post.featured_image_url
    if (post.tags?.length) ghostPost.tags = post.tags.map(name => ({ name }))
    if (ghostStatus === 'scheduled' && post.scheduled_at) ghostPost.published_at = post.scheduled_at

    const res = await fetchSafe(`${base_url}/ghost/api/admin/posts/?source=html`, {
      method: 'POST',
      headers: { 'Authorization': `Ghost ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: [ghostPost] }),
      timeoutMs: 20_000,
    })

    if (res.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'Ghost rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited',
        'Ghost rate-limited the publish.', 'Retry in a minute.') }
    }
    if (res.status === 401 || res.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Auth rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired',
        'Ghost auth rejected.', 'Reconnect from Settings → Integrations.') }
    }
    if (res.status < 200 || res.status >= 300) {
      const errBody = res.json as { errors?: Array<{ message?: string; context?: string }> }
      const msg = errBody?.errors?.[0]?.message ?? `HTTP ${res.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check the post fields.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check the post fields.') }
    }

    const created = (res.json as { posts?: Array<{ id: string; url?: string; slug?: string; status?: string }> })?.posts?.[0]
    if (!created) {
      await markAttempt(supabase, attempt_id, 'failed', 'unknown_error', 'No post returned.', 'Check Ghost logs.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('unknown_error',
        'Ghost responded OK but didn\'t return the post.', 'Check Ghost logs.') }
    }

    const verified = created.status === ghostStatus
    await completePublishClaim(supabase, publishLock.post, created.id, created.url)
    publishClaimCompleted = true

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: created.id, remote_url: created.url ?? null,
      response_body: { id: created.id, slug: created.slug, status: created.status },
    })

    return { ok: true, remote_id: created.id, remote_url: created.url, verified, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    if (!publishClaimCompleted) {
      await releasePublishClaim(supabase, post_id, 'ghost publish did not complete')
    }
    await releasePublishLock(supabase, post_id, publisher_id)
  }
}

// ─── verify ─────────────────────────────────────────────────────────────────
async function verify(supabase: AdminClient, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const jwt = await makeGhostJwt(creds.api_key)
  const res = await fetchSafe(`${config.base_url}/ghost/api/admin/posts/${remote_id}/`, {
    headers: { 'Authorization': `Ghost ${jwt}` }, timeoutMs: 8_000,
  })
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Post deleted on Ghost' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const p = (res.json as { posts?: Array<{ status?: string; url?: string; feature_image?: string | null }> })?.posts?.[0]
  if (!p) return { ok: false, status: 'missing' }
  const statusMap: Record<string, 'draft' | 'published' | 'scheduled'> = {
    draft: 'draft', published: 'published', scheduled: 'scheduled',
  }
  return {
    ok: true,
    status: statusMap[p.status ?? 'draft'] ?? 'draft',
    remote_url: p.url,
    featured_image_set: !!p.feature_image,
  }
}

// ─── unpublish ──────────────────────────────────────────────────────────────
async function unpublish(supabase: AdminClient, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const jwt = await makeGhostJwt(creds.api_key)
  // Ghost requires the current updated_at when PUT-ing to prevent silent overwrites;
  // fetch first, then PUT with the same timestamp.
  const getRes = await fetchSafe(`${config.base_url}/ghost/api/admin/posts/${remote_id}/`, {
    headers: { 'Authorization': `Ghost ${jwt}` }, timeoutMs: 6_000,
  })
  if (getRes.status !== 200) {
    return { ok: false, error: typed('target_not_found', 'Couldn\'t load the post to unpublish.', 'Check the remote_id.') }
  }
  const current = (getRes.json as { posts?: Array<{ updated_at: string }> })?.posts?.[0]
  if (!current) return { ok: false, error: typed('target_not_found', 'Post not found.', '') }

  const putRes = await fetchSafe(`${config.base_url}/ghost/api/admin/posts/${remote_id}/`, {
    method: 'PUT',
    headers: { 'Authorization': `Ghost ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ posts: [{ status: 'draft', updated_at: current.updated_at }] }),
    timeoutMs: 10_000,
  })
  if (putRes.status < 200 || putRes.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Unpublish returned HTTP ${putRes.status}.`, 'Check Ghost permissions.') }
  }
  return { ok: true }
}

// ─── helpers ────────────────────────────────────────────────────────────────
async function loadPublisher(supabase: AdminClient, publisher_id: string):
Promise<{ config: Record<string, unknown>; creds: { api_key: string }; org_id: string }> {
  const { data: pub } = await supabase.from('publishers')
    .select('config, org_id').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error(`credentials for publisher ${publisher_id} missing`)
  return { config: pub.config as Record<string, unknown>, creds: creds as { api_key: string }, org_id: pub.org_id as string }
}

async function updateHealth(supabase: AdminClient, id: string, status: 'healthy' | 'stale' | 'unknown', detail: string | null): Promise<void> {
  await supabase.from('publishers').update({
    health_status: status, health_detail: detail, last_health_check: new Date().toISOString(),
  }).eq('id', id)
}

async function markAttempt(
  supabase: AdminClient, attempt_id: string,
  outcome: 'success' | 'failed', error_code: string | null,
  error_message: string | null, recovery_action: string | null,
  extras?: Record<string, unknown>,
): Promise<void> {
  await supabase.from('publish_attempts').update({
    outcome, error_code, error_message, recovery_action,
    completed_at: new Date().toISOString(), ...(extras ?? {}),
  }).eq('id', attempt_id)
}

interface SafeFetchResult { status: number; json: unknown; headers: Record<string, string>; networkError: boolean }

async function fetchSafe(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<SafeFetchResult> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Accept': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), redirect: 'follow',
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let bodyJson: unknown = null
    try {
      const ct = res.headers.get('content-type') ?? ''
      bodyJson = ct.includes('json') ? await res.json() : await res.text()
    } catch { /* leave null */ }
    return { status: res.status, json: bodyJson, headers, networkError: false }
  } catch (e) {
    console.warn('fetchSafe error', url, e)
    return { status: 0, json: null, headers: {}, networkError: true }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError {
  return { code, message, recovery_action }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
