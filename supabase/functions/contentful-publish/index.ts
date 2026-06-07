// Contentful connector — Content Management API (CMA).
//
// Headless backend. Operator's site reads from the Delivery API; we
// write to the Management API. Two-step publish:
//   1. PUT /spaces/{space}/environments/{env}/entries/{id}  (create draft)
//   2. PUT /spaces/{space}/environments/{env}/entries/{id}/published  (publish)
//
// Connect-time inputs:
//   - space_id        (Contentful space — visible in Settings → General)
//   - environment_id  (default 'master')
//   - content_type_id (e.g. 'blogPost' — the operator's blog content model)
//   - token           (Personal Access Token from Settings → API keys)
//
// Field mapping: Contentful entries are JSON shaped by the content model.
// We use a sensible default mapping (title, slug, body as Markdown text,
// summary, featuredImage URL) — operator can override field names in
// config if their content model uses different names.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { slugify } from '../_shared/markdown.ts'
import type {
  HealthCheckResult, DryRunResult, PublishResult, VerifyResult, UnpublishResult,
  PostInput, PublisherError,
} from '../_shared/publisher.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const CMA = 'https://api.contentful.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const action = body.action as string
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
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
    console.error('contentful-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function connect(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const name = input.name as string
  const space_id = (input.space_id as string)?.trim()
  const environment_id = (input.environment_id as string)?.trim() || 'master'
  const content_type_id = (input.content_type_id as string)?.trim() || 'blogPost'
  const token = (input.token as string)?.trim()
  const default_locale = (input.default_locale as string)?.trim() || 'en-US'

  if (!org_id || !name || !space_id || !token) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, space_id, token required (environment_id + content_type_id default to master + blogPost).') }
  }

  // Probe space
  const spaceRes = await cfFetch(`${CMA}/spaces/${space_id}`, token)
  if (spaceRes.status === 401 || spaceRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'Contentful rejected the Personal Access Token.',
      'Generate a CMA Personal Access Token at Settings → API keys → Personal Access Tokens.') }
  }
  if (spaceRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Space ${space_id} not found.`,
      'Verify space_id from Contentful → Settings → General settings.') }
  }
  if (spaceRes.status < 200 || spaceRes.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Space probe HTTP ${spaceRes.status}.`, 'Try again.') }
  }
  const space = spaceRes.json as { name?: string }

  // Probe content type
  const ctRes = await cfFetch(`${CMA}/spaces/${space_id}/environments/${environment_id}/content_types/${content_type_id}`, token)
  if (ctRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Content type "${content_type_id}" not found in environment "${environment_id}".`,
      'Check the content model — common names are blogPost, post, article. Find the ID at Content model → your model → Settings.') }
  }
  if (ctRes.status < 200 || ctRes.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Content type probe HTTP ${ctRes.status}.`, 'Try again.') }
  }
  const contentType = ctRes.json as { name?: string; fields?: Array<{ id: string; name: string; required: boolean; type: string }> }

  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, kind: 'contentful', name,
    config: {
      space_id, environment_id, content_type_id, default_locale,
      space_name: space.name ?? null, content_type_name: contentType.name ?? null,
      field_schema: contentType.fields ?? [],
      // Field-name overrides (operator can edit via SQL if their model differs)
      field_title: 'title', field_slug: 'slug',
      field_body: 'body', field_excerpt: 'excerpt', field_featured_image: 'featuredImage',
    },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${space.name ?? space_id} / ${contentType.name ?? content_type_id}`,
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
    health: { ok: true, status: 'healthy', detail: `Connected to ${space.name} / ${contentType.name}`, checked_at: new Date().toISOString() },
  }
}

async function health_check(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await cfFetch(`${CMA}/spaces/${config.space_id}`, creds.token)
  const checked_at = new Date().toISOString()
  if (res.status === 200) { await updateHealth(supabase, publisher_id, 'healthy', null); return { ok: true, status: 'healthy', checked_at } }
  if (res.status === 401 || res.status === 403) { await updateHealth(supabase, publisher_id, 'stale', 'Token rejected'); return { ok: false, status: 'stale', detail: 'Token rejected', checked_at } }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

async function dry_run(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<DryRunResult> {
  const post = input.post as PostInput
  const final_slug = post.slug?.trim() || slugify(post.title)
  return {
    ok: true,
    preview: {
      rendered_html: post.body_md,  // Contentful stores Markdown directly in Text/RichText fields
      final_slug,
      target_categories: post.categories ?? [],
      target_tags: post.tags ?? [],
      image_will_upload: !!post.featured_image_url,
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: null,
      scheduled_at_target_tz: null,
    },
    warnings: post.featured_image_url
      ? ['Featured image: we pass the URL as a string field. If your content model expects an Asset reference instead, configure field_featured_image to a different field name via SQL.']
      : [],
  }
}

async function publish(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<PublishResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const idempotency_key = input.idempotency_key as string
  const post_id = (input.post_id as string | undefined) ?? null
  const t0 = Date.now()
  if (!idempotency_key) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'idempotency_key required.', '') }
  }
  const { data: prior } = await supabase.from('publish_attempts')
    .select('id, outcome, remote_id, remote_url').eq('idempotency_key', idempotency_key).eq('phase', 'publish').maybeSingle()
  if (prior && prior.outcome === 'success') {
    return { ok: true, remote_id: prior.remote_id as string | undefined, remote_url: prior.remote_url as string | undefined,
      attempt_id: prior.id as string, latency_ms: Date.now() - t0, verified: true }
  }
  const { data: lockData } = await supabase.rpc('acquire_publish_lock', { p_post_id: post_id, p_publisher_id: publisher_id, p_locked_by: null })
  if (!lockData) {
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0,
      error: typed('validation_failed', 'Concurrent publish in progress.', 'Wait 5 min.') }
  }

  try {
    const { config, creds, org_id } = await loadPublisher(supabase, publisher_id)
    const { space_id, environment_id, content_type_id, default_locale } = config as Record<string, string>
    const slug = post.slug?.trim() || slugify(post.title)
    const baseEntryPath = `${CMA}/spaces/${space_id}/environments/${environment_id}/entries`

    // Build the entry payload. Contentful localizes every field by locale code.
    const localize = (v: unknown) => ({ [default_locale]: v })
    const fields: Record<string, unknown> = {}
    fields[config.field_title as string]   = localize(post.title)
    fields[config.field_slug as string]    = localize(slug)
    fields[config.field_body as string]    = localize(post.body_md)
    if (post.excerpt) fields[config.field_excerpt as string] = localize(post.excerpt)
    if (post.featured_image_url) fields[config.field_featured_image as string] = localize(post.featured_image_url)

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key, phase: 'create_post', outcome: 'in_progress',
      request_payload: { space_id, environment_id, content_type_id, slug, status: post.status },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    // Phase 1: create the entry (Contentful uses PUT with a new ID, or POST)
    const createRes = await cfFetch(baseEntryPath, creds.token, {
      method: 'POST',
      headers: { 'X-Contentful-Content-Type': content_type_id },
      body: JSON.stringify({ fields }),
    })
    if (createRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'Contentful rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited', 'Rate-limited.', 'Retry shortly.') }
    }
    if (createRes.status === 401 || createRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Token rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired', 'Token rejected.', 'Reconnect.') }
    }
    if (createRes.status < 200 || createRes.status >= 300) {
      const errBody = createRes.json as { message?: string; details?: { errors?: Array<{ message?: string }> } }
      const msg = errBody?.details?.errors?.map(e => e.message).filter(Boolean).join('; ')
                  ?? errBody?.message
                  ?? `HTTP ${createRes.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check content model field requirements.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check field requirements.') }
    }
    const entry = createRes.json as { sys: { id: string; version: number } }
    const entryId = entry.sys.id

    // Phase 2: publish (only when status === 'published')
    let verified = false
    if (post.status === 'published') {
      const pubRes = await cfFetch(`${baseEntryPath}/${entryId}/published`, creds.token, {
        method: 'PUT',
        headers: { 'X-Contentful-Version': String(entry.sys.version) },
      })
      if (pubRes.status >= 200 && pubRes.status < 300) {
        verified = true
      } else {
        // Entry created as draft. Note in audit and return with warning.
        await markAttempt(supabase, attempt_id, 'success', null, null, null, {
          remote_id: entryId,
          response_body: { entry_id: entryId, status: 'draft', publish_failed_status: pubRes.status },
        })
        return { ok: true, remote_id: entryId, verified: false, attempt_id, latency_ms: Date.now() - t0,
          error: typed('validation_failed',
            'Entry created on Contentful but the publish step returned an error. Entry exists as draft.',
            'Open Contentful → review the draft → publish manually.') }
      }
    }

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: entryId,
      response_body: { entry_id: entryId, status: post.status, version: entry.sys.version },
    })
    return { ok: true, remote_id: entryId, verified, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    await supabase.rpc('release_publish_lock', { p_post_id: post_id, p_publisher_id: publisher_id })
  }
}

async function verify(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await cfFetch(`${CMA}/spaces/${config.space_id}/environments/${config.environment_id}/entries/${remote_id}`, creds.token)
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Entry deleted' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const entry = res.json as { sys?: { publishedAt?: string; archivedAt?: string } }
  return {
    ok: true,
    status: entry.sys?.archivedAt ? 'missing' : (entry.sys?.publishedAt ? 'published' : 'draft'),
  }
}

async function unpublish(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await cfFetch(`${CMA}/spaces/${config.space_id}/environments/${config.environment_id}/entries/${remote_id}/published`, creds.token, {
    method: 'DELETE',
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Unpublish returned HTTP ${res.status}.`, 'Check token scope.') }
  }
  return { ok: true }
}

async function loadPublisher(supabase: ReturnType<typeof createClient>, publisher_id: string):
Promise<{ config: Record<string, unknown>; creds: { token: string }; org_id: string }> {
  const { data: pub } = await supabase.from('publishers').select('config, org_id').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error('credentials missing')
  return { config: pub.config as Record<string, unknown>, creds: creds as { token: string }, org_id: pub.org_id as string }
}

async function updateHealth(supabase: ReturnType<typeof createClient>, id: string, status: 'healthy' | 'stale' | 'unknown', detail: string | null): Promise<void> {
  await supabase.from('publishers').update({ health_status: status, health_detail: detail, last_health_check: new Date().toISOString() }).eq('id', id)
}

async function markAttempt(supabase: ReturnType<typeof createClient>, attempt_id: string,
  outcome: 'success' | 'failed', error_code: string | null, error_message: string | null,
  recovery_action: string | null, extras?: Record<string, unknown>): Promise<void> {
  await supabase.from('publish_attempts').update({
    outcome, error_code, error_message, recovery_action,
    completed_at: new Date().toISOString(), ...(extras ?? {}),
  }).eq('id', attempt_id)
}

interface CfRes { status: number; json: unknown; headers: Record<string, string> }
async function cfFetch(url: string, token: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<CfRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/vnd.contentful.management.v1+json', 'User-Agent': 'VERA-contentful-publish/1.0', ...(opts.headers ?? {}) },
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
    console.warn('cfFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError { return { code, message, recovery_action } }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
