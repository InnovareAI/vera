// Webflow connector — Webflow API v2.
//
// Two-step publish (Webflow specific):
//   1. POST /collections/{collection_id}/items  (creates draft item)
//   2. POST /sites/{site_id}/publish            (deploys to live)
//
// Operator provides at connect time:
//   - site_id        (visible in Webflow Designer URL or /sites listing)
//   - collection_id  (the "Blog Posts" collection — listing endpoint helps)
//   - token          (Webflow API Token, generated in Site Settings → Apps)
//
// Failure cases covered: bad token (auth_invalid), wrong site/collection
// (target_not_found), required field missing (validation_failed),
// rate limit (429), site publish failure (validation_failed surfaced).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { renderMarkdown, slugify } from '../_shared/markdown.ts'
import type {
  HealthCheckResult, DryRunResult, PublishResult, VerifyResult, UnpublishResult,
  PostInput, PublisherError,
} from '../_shared/publisher.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const WEBFLOW_API = 'https://api.webflow.com/v2'
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
    console.error('webflow-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function connect(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const name = input.name as string
  const site_id = (input.site_id as string)?.trim()
  const collection_id = (input.collection_id as string)?.trim()
  const token = (input.token as string)?.trim()

  if (!org_id || !name || !site_id || !collection_id || !token) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, site_id, collection_id, token all required.') }
  }

  // Probe site
  const siteRes = await wfFetch(`${WEBFLOW_API}/sites/${site_id}`, token)
  if (siteRes.status === 401 || siteRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'Webflow rejected the API token.',
      'Generate a new token in Webflow → Site Settings → Apps & Integrations → Generate API Token.') }
  }
  if (siteRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Site ${site_id} not found.`,
      'Confirm the site_id from Webflow Designer URL or /sites listing.') }
  }
  if (siteRes.status < 200 || siteRes.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `Site probe HTTP ${siteRes.status}.`, 'Try again, or check Webflow status.') }
  }
  const site = siteRes.json as { displayName?: string; workspaceId?: string; lastPublished?: string }

  // Probe collection
  const collRes = await wfFetch(`${WEBFLOW_API}/collections/${collection_id}`, token)
  if (collRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Collection ${collection_id} not found in this site.`,
      'Confirm the collection_id from /sites/{site_id}/collections.') }
  }
  if (collRes.status < 200 || collRes.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `Collection probe HTTP ${collRes.status}.`, 'Try again.') }
  }
  const collection = collRes.json as { displayName?: string; fields?: Array<{ slug: string; displayName: string; type: string; isRequired: boolean }> }

  // Save publisher + creds. Cache field schema so dry_run + publish can
  // adapt to the collection's actual structure.
  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, kind: 'webflow', name,
    config: {
      site_id, collection_id,
      site_name: site.displayName ?? null,
      collection_name: collection.displayName ?? null,
      field_schema: collection.fields ?? [],
    },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${site.displayName ?? site_id} / ${collection.displayName ?? collection_id}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()
  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Save failed: ${insErr?.message}`, 'Try again.') }
  }
  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', {
    p_id: pub.id, p_creds: { token },
  })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Credential save failed: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true, publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected to ${site.displayName} / ${collection.displayName}`, checked_at: new Date().toISOString() },
  }
}

async function health_check(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await wfFetch(`${WEBFLOW_API}/sites/${config.site_id}`, creds.token)
  const checked_at = new Date().toISOString()
  if (res.status === 200) { await updateHealth(supabase, publisher_id, 'healthy', null); return { ok: true, status: 'healthy', checked_at } }
  if (res.status === 401 || res.status === 403) { await updateHealth(supabase, publisher_id, 'stale', 'Token rejected'); return { ok: false, status: 'stale', detail: 'API token rejected', checked_at } }
  if (res.status === 404) { await updateHealth(supabase, publisher_id, 'stale', 'Site missing'); return { ok: false, status: 'stale', detail: 'Site no longer exists', checked_at } }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

async function dry_run(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<DryRunResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const { config } = await loadPublisher(supabase, publisher_id)
  const rendered_html = renderMarkdown(post.body_md)
  const final_slug = post.slug?.trim() || slugify(post.title)
  const fieldSchema = (config.field_schema as Array<{ slug: string; displayName: string; isRequired: boolean }>) ?? []
  const requiredFields = fieldSchema.filter(f => f.isRequired).map(f => f.slug)
  const warnings: string[] = []
  // Webflow collections almost always have a required 'name' (title) and 'slug' field. Our PostInput covers those.
  for (const required of requiredFields) {
    if (!['name', 'slug', 'post-body', 'main-image', '_archived', '_draft'].includes(required)) {
      warnings.push(`Collection has a required field "${required}" — we'll send the title or leave it blank. Check the result on Webflow.`)
    }
  }
  return {
    ok: true,
    preview: {
      rendered_html,
      final_slug,
      target_categories: [],
      target_tags: post.tags ?? [],
      image_will_upload: !!post.featured_image_url,
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: null,
      scheduled_at_target_tz: null,
    },
    warnings,
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
      error: typed('validation_failed', 'Concurrent publish in progress.', 'Wait 5 min for the lock to expire.') }
  }

  try {
    const { config, creds, org_id } = await loadPublisher(supabase, publisher_id)
    const site_id = config.site_id as string
    const collection_id = config.collection_id as string
    const rendered_html = renderMarkdown(post.body_md)
    const slug = post.slug?.trim() || slugify(post.title)
    const isDraft = post.status !== 'published'

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key, phase: 'create_post', outcome: 'in_progress',
      request_payload: { site_id, collection_id, slug, status: post.status, body_chars: rendered_html.length },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    // Phase 1: create collection item
    const fieldData: Record<string, unknown> = {
      name: post.title,
      slug,
      'post-body': rendered_html,
    }
    if (post.excerpt) fieldData['post-summary'] = post.excerpt
    if (post.featured_image_url) fieldData['main-image'] = { url: post.featured_image_url }

    const createRes = await wfFetch(
      `${WEBFLOW_API}/collections/${collection_id}/items`, creds.token,
      { method: 'POST', body: JSON.stringify({ isArchived: false, isDraft, fieldData }) },
    )
    if (createRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'Webflow rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited', 'Webflow rate-limited.', 'Retry in a minute.') }
    }
    if (createRes.status === 401 || createRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Token rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired', 'Webflow token rejected.', 'Reconnect from Settings → Integrations.') }
    }
    if (createRes.status < 200 || createRes.status >= 300) {
      const errBody = createRes.json as { message?: string }
      const msg = errBody?.message ?? `HTTP ${createRes.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check collection field requirements.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check collection field requirements.') }
    }
    const item = createRes.json as { id: string; fieldData?: { name?: string; slug?: string } }

    // Phase 2: site publish (push live) — only if status was 'published'
    let live_url: string | undefined
    if (!isDraft) {
      const pubRes = await wfFetch(`${WEBFLOW_API}/sites/${site_id}/publish`, creds.token, {
        method: 'POST', body: JSON.stringify({ publishToWebflowSubdomain: true, customDomains: [] }),
      })
      if (pubRes.status < 200 || pubRes.status >= 300) {
        // Item created but site publish failed — surface as warning, not full failure
        await markAttempt(supabase, attempt_id, 'success', null, null, null, {
          remote_id: item.id,
          response_body: { item_id: item.id, slug: item.fieldData?.slug, site_publish_status: pubRes.status, warning: 'item created but site publish endpoint failed' },
        })
        return { ok: true, remote_id: item.id, verified: false, attempt_id, latency_ms: Date.now() - t0,
          error: typed('validation_failed',
            'Item created on Webflow but the site-publish step returned an error. The item exists as a draft — publish manually from Webflow Designer.',
            'Open Webflow Designer → publish the site to make the post live.') }
      }
      const pubData = pubRes.json as { sites?: Array<{ siteUrl?: string }> }
      live_url = pubData.sites?.[0]?.siteUrl
    }

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: item.id, remote_url: live_url ?? null,
      response_body: { item_id: item.id, slug: item.fieldData?.slug, is_draft: isDraft },
    })
    return { ok: true, remote_id: item.id, remote_url: live_url, verified: !isDraft, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    await supabase.rpc('release_publish_lock', { p_post_id: post_id, p_publisher_id: publisher_id })
  }
}

async function verify(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await wfFetch(`${WEBFLOW_API}/collections/${config.collection_id}/items/${remote_id}`, creds.token)
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Item deleted on Webflow' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const item = res.json as { isDraft?: boolean; isArchived?: boolean; fieldData?: { 'main-image'?: unknown } }
  return {
    ok: true,
    status: item.isArchived ? 'missing' : (item.isDraft ? 'draft' : 'published'),
    featured_image_set: !!item.fieldData?.['main-image'],
  }
}

async function unpublish(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await wfFetch(`${WEBFLOW_API}/collections/${config.collection_id}/items/${remote_id}`, creds.token, {
    method: 'PATCH', body: JSON.stringify({ isDraft: true }),
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Unpublish returned HTTP ${res.status}.`, 'Check token permissions.') }
  }
  // Re-publish site so the change propagates
  await wfFetch(`${WEBFLOW_API}/sites/${config.site_id}/publish`, creds.token, {
    method: 'POST', body: JSON.stringify({ publishToWebflowSubdomain: true, customDomains: [] }),
  })
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

interface WfRes { status: number; json: unknown; headers: Record<string, string> }
async function wfFetch(url: string, token: string, opts: { method?: string; body?: string } = {}): Promise<WfRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'VERA-webflow-publish/1.0' },
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
    console.warn('wfFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError { return { code, message, recovery_action } }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
