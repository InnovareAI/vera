// Strapi connector — self-hosted Strapi (v4+).
//
// Strapi is the operator's own backend, accessed at /api/{content-type}.
// Auth: API Token from Settings → API Tokens. Bearer.
//
// Quirks:
//   - Strapi requires "draft & publish" to be ENABLED on the content type
//     for draft semantics to work — otherwise everything's instantly live.
//   - Strapi v4 wraps everything in { data: { ... } } envelope.
//   - Content types use kebab-case UID like "articles" or "blog-posts".
//   - Strapi isn't auto-detectable from public site (the API is on a
//     separate domain), so operators reach this connector via the manual
//     platform picker.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { requirePublisherActionAccess, type AdminClient } from '../_shared/auth.ts'
import { slugify } from '../_shared/markdown.ts'
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
    console.error('strapi-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function connect(supabase: AdminClient, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const name = input.name as string
  const base_url_raw = (input.base_url as string)?.trim()
  const content_type_uid = (input.content_type_uid as string)?.trim()
  const token = (input.token as string)?.trim()

  if (!org_id || !name || !base_url_raw || !content_type_uid || !token) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, base_url, content_type_uid, token all required.') }
  }

  let base_url: string
  try {
    const u = new URL(/^https?:\/\//i.test(base_url_raw) ? base_url_raw : `https://${base_url_raw}`)
    u.search = ''; u.hash = ''
    base_url = u.toString().replace(/\/+$/, '')
  } catch {
    return { ok: false, error: typed('target_misconfigured',
      'Invalid Strapi URL.', 'Use the Strapi root, e.g. https://cms.example.com') }
  }

  // Probe: GET /api/{content-type}?pagination[limit]=1
  const res = await stFetch(`${base_url}/api/${content_type_uid}?pagination[limit]=1`, token)
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'Strapi rejected the API token.',
      'Generate a token in Strapi Admin → Settings → API Tokens with read/write permissions on this content type.') }
  }
  if (res.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Strapi content type "${content_type_uid}" not found.`,
      'Check the content type UID (kebab-case like "articles" or "blog-posts") in Strapi → Content-Type Builder.') }
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Probe HTTP ${res.status}.`, 'Check Strapi logs and URL.') }
  }

  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, kind: 'strapi', name,
    config: {
      base_url, content_type_uid,
      // Default field mapping (operator can override via SQL if their content type uses different names)
      field_title: 'title', field_slug: 'slug',
      field_body: 'content', field_excerpt: 'excerpt', field_featured_image: 'featuredImage',
    },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${base_url}/api/${content_type_uid}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()
  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Save failed: ${insErr?.message}`, 'Try again.') }
  }
  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', { p_id: pub.id, p_creds: { token } })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Credential save failed: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true, publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected`, checked_at: new Date().toISOString() },
  }
}

async function health_check(supabase: AdminClient, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await stFetch(`${config.base_url}/api/${config.content_type_uid}?pagination[limit]=1`, creds.token)
  const checked_at = new Date().toISOString()
  if (res.status === 200) { await updateHealth(supabase, publisher_id, 'healthy', null); return { ok: true, status: 'healthy', checked_at } }
  if (res.status === 401 || res.status === 403) { await updateHealth(supabase, publisher_id, 'stale', 'Token rejected'); return { ok: false, status: 'stale', detail: 'Token rejected', checked_at } }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

async function dry_run(supabase: AdminClient, input: Record<string, unknown>): Promise<DryRunResult> {
  const post = input.post as PostInput
  const final_slug = post.slug?.trim() || slugify(post.title)
  return {
    ok: true,
    preview: {
      rendered_html: post.body_md,
      final_slug,
      target_categories: post.categories ?? [],
      target_tags: post.tags ?? [],
      image_will_upload: !!post.featured_image_url,
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: null,
      scheduled_at_target_tz: null,
    },
    warnings: post.featured_image_url
      ? ['Featured image: URL passed as a string field. If your Strapi schema uses a Media field, configure field_featured_image differently via SQL.']
      : [],
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
  const publishClaim = await claimPublish(supabase, publishLock.post, 'strapi', `strapi-publish:${publisher_id}`)
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
    const content_type_uid = config.content_type_uid as string
    const slug = post.slug?.trim() || slugify(post.title)

    const fieldData: Record<string, unknown> = {
      [config.field_title as string]: post.title,
      [config.field_slug as string]: slug,
      [config.field_body as string]: post.body_md,
    }
    if (post.excerpt) fieldData[config.field_excerpt as string] = post.excerpt
    if (post.featured_image_url) fieldData[config.field_featured_image as string] = post.featured_image_url
    // Strapi v4: published when publishedAt is set; draft when null.
    if (post.status === 'published') fieldData.publishedAt = new Date().toISOString()
    else if (post.status === 'scheduled' && post.scheduled_at) fieldData.publishedAt = post.scheduled_at
    else fieldData.publishedAt = null

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key, phase: 'create_post', outcome: 'in_progress',
      request_payload: { content_type_uid, slug, status: post.status },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    const res = await stFetch(`${base_url}/api/${content_type_uid}`, creds.token, {
      method: 'POST', body: JSON.stringify({ data: fieldData }),
    })

    if (res.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'Strapi rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited', 'Strapi rate-limited.', 'Retry shortly.') }
    }
    if (res.status === 401 || res.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Token rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired', 'Token rejected.', 'Reconnect.') }
    }
    if (res.status < 200 || res.status >= 300) {
      const errBody = res.json as { error?: { message?: string; details?: { errors?: Array<{ message?: string }> } } }
      const msg = errBody?.error?.details?.errors?.map(e => e.message).filter(Boolean).join('; ')
                  ?? errBody?.error?.message
                  ?? `HTTP ${res.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check schema field requirements.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check Strapi field requirements.') }
    }

    const entity = (res.json as { data?: { id?: number | string; attributes?: { publishedAt?: string } } })?.data
    const remoteId = entity?.id != null ? String(entity.id) : null
    const verified = !!entity?.attributes?.publishedAt

    await completePublishClaim(supabase, publishLock.post, remoteId ?? undefined)
    publishClaimCompleted = true

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: remoteId,
      response_body: { id: remoteId, published_at: entity?.attributes?.publishedAt ?? null },
    })
    return { ok: true, remote_id: remoteId ?? undefined, verified, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    if (!publishClaimCompleted) {
      await releasePublishClaim(supabase, post_id, 'strapi publish did not complete')
    }
    await releasePublishLock(supabase, post_id, publisher_id)
  }
}

async function verify(supabase: AdminClient, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await stFetch(`${config.base_url}/api/${config.content_type_uid}/${remote_id}`, creds.token)
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Entry deleted' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const entity = (res.json as { data?: { attributes?: { publishedAt?: string } } })?.data
  return {
    ok: true,
    status: entity?.attributes?.publishedAt ? 'published' : 'draft',
  }
}

async function unpublish(supabase: AdminClient, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  // Set publishedAt to null to draft it
  const res = await stFetch(`${config.base_url}/api/${config.content_type_uid}/${remote_id}`, creds.token, {
    method: 'PUT', body: JSON.stringify({ data: { publishedAt: null } }),
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Unpublish returned HTTP ${res.status}.`, 'Check token scope.') }
  }
  return { ok: true }
}

async function loadPublisher(supabase: AdminClient, publisher_id: string):
Promise<{ config: Record<string, unknown>; creds: { token: string }; org_id: string }> {
  const { data: pub } = await supabase.from('publishers').select('config, org_id').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error('credentials missing')
  return { config: pub.config as Record<string, unknown>, creds: creds as { token: string }, org_id: pub.org_id as string }
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

interface StRes { status: number; json: unknown; headers: Record<string, string> }
async function stFetch(url: string, token: string, opts: { method?: string; body?: string } = {}): Promise<StRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'VERA-strapi-publish/1.0' },
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
    console.warn('stFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError { return { code, message, recovery_action } }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
