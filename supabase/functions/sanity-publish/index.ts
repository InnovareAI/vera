// Sanity connector — uses Sanity Mutations API.
//
// Headless backend. Operator's site reads from the Sanity CDN/API; we
// write via POST /v2024-01-01/data/mutate/{dataset}.
//
// Sanity's draft-vs-published model: a "draft" document has _id prefixed
// with `drafts.` (e.g. drafts.abc123). Publishing = createOrReplace the
// non-prefixed _id from the draft. We use that pattern.
//
// Connect-time inputs:
//   - project_id     (10-char ID at sanity.io/manage)
//   - dataset        (default 'production')
//   - document_type  (e.g. 'post' — the schema type for blog posts)
//   - token          (write-scoped robot token, sanity.io/manage → API)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { requirePublisherActionAccess } from '../_shared/auth.ts'
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
const SANITY_API_VERSION = '2024-01-01'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const action = body.action as string
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
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
    console.error('sanity-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function apiBase(project_id: string, dataset: string): string {
  return `https://${project_id}.api.sanity.io/v${SANITY_API_VERSION}/data`
}

async function connect(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const name = input.name as string
  const project_id = (input.project_id as string)?.trim()
  const dataset = (input.dataset as string)?.trim() || 'production'
  const document_type = (input.document_type as string)?.trim() || 'post'
  const token = (input.token as string)?.trim()

  if (!org_id || !name || !project_id || !token) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, project_id, token required (dataset defaults to "production", document_type to "post").') }
  }

  // Probe by running a tiny query against the dataset.
  const probeRes = await sanFetch(
    `${apiBase(project_id, dataset)}/query/${dataset}?query=${encodeURIComponent('*[_type==$t][0..0]{_id}')}&%24t=%22${encodeURIComponent(document_type)}%22`,
    token,
  )
  if (probeRes.status === 401 || probeRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'Sanity rejected the token.',
      'Generate a write-scoped robot token at sanity.io/manage → your project → API → Tokens.') }
  }
  if (probeRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Project ${project_id} or dataset "${dataset}" not found.`,
      'Verify the 10-char project ID and dataset name at sanity.io/manage.') }
  }
  if (probeRes.status < 200 || probeRes.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Probe HTTP ${probeRes.status}.`, 'Try again.') }
  }

  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, kind: 'sanity', name,
    config: {
      project_id, dataset, document_type,
      // Default field name mapping (operator can override via SQL)
      field_title: 'title', field_slug: 'slug',
      field_body: 'body', field_excerpt: 'excerpt', field_featured_image: 'mainImage',
    },
    credentials_ref: 'pending',
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected to ${project_id}/${dataset}/${document_type}`,
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
    health: { ok: true, status: 'healthy', detail: `Connected to ${project_id}/${dataset}`, checked_at: new Date().toISOString() },
  }
}

async function health_check(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await sanFetch(`${apiBase(config.project_id as string, config.dataset as string)}/query/${config.dataset}?query=${encodeURIComponent('true')}`, creds.token)
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
      ? ['Featured image: passed as URL string. If your schema expects a Sanity image asset reference, configure field_featured_image differently via SQL.']
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
    const project_id = config.project_id as string
    const dataset = config.dataset as string
    const slug = post.slug?.trim() || slugify(post.title)

    // Generate a stable document ID from slug. Sanity IDs are arbitrary
    // strings, so we use the slug + a short hash for uniqueness.
    const docId = `${slug}-${idempotency_key.slice(-8)}`.replace(/[^a-zA-Z0-9-]/g, '-')

    // Build document body using configured field names
    const doc: Record<string, unknown> = {
      _type: config.document_type,
      [config.field_title as string]: post.title,
      [config.field_slug as string]: { _type: 'slug', current: slug },
      [config.field_body as string]: post.body_md,
    }
    if (post.excerpt) doc[config.field_excerpt as string] = post.excerpt
    if (post.featured_image_url) doc[config.field_featured_image as string] = post.featured_image_url

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key, phase: 'create_post', outcome: 'in_progress',
      request_payload: { project_id, dataset, doc_id: docId, slug, status: post.status },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    // For draft status: write to drafts.<id>. For published: write to <id> directly.
    const isPublished = post.status === 'published'
    const targetId = isPublished ? docId : `drafts.${docId}`
    doc._id = targetId

    const mutations = { mutations: [{ createOrReplace: doc }] }
    const mutateRes = await sanFetch(
      `${apiBase(project_id, dataset)}/mutate/${dataset}?returnIds=true`,
      creds.token,
      { method: 'POST', body: JSON.stringify(mutations) },
    )

    if (mutateRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'Sanity rate-limited.', 'Retry in a minute.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited', 'Rate-limited.', 'Retry shortly.') }
    }
    if (mutateRes.status === 401 || mutateRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'Token rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired', 'Token rejected.', 'Reconnect.') }
    }
    if (mutateRes.status < 200 || mutateRes.status >= 300) {
      const errBody = mutateRes.json as { error?: { description?: string } }
      const msg = errBody?.error?.description ?? `HTTP ${mutateRes.status}`
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', msg, 'Check schema field requirements.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', msg, 'Check schema requirements.') }
    }

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: targetId,
      response_body: { document_id: targetId, status: post.status, is_draft: !isPublished },
    })
    return { ok: true, remote_id: targetId, verified: isPublished, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    await supabase.rpc('release_publish_lock', { p_post_id: post_id, p_publisher_id: publisher_id })
  }
}

async function verify(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await sanFetch(
    `${apiBase(config.project_id as string, config.dataset as string)}/doc/${config.dataset}/${remote_id}`,
    creds.token,
  )
  if (res.status === 404) return { ok: false, status: 'missing', detail: 'Document deleted' }
  if (res.status < 200 || res.status >= 300) return { ok: false, status: 'missing', detail: `HTTP ${res.status}` }
  const isDraft = remote_id.startsWith('drafts.')
  return { ok: true, status: isDraft ? 'draft' : 'published' }
}

async function unpublish(supabase: ReturnType<typeof createClient>, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  // Convert from published to draft: delete the published doc, the draft remains.
  // If only a published version exists, we delete it AND create a draft from a copy.
  // For simplicity v1: just delete the published copy. Sanity Studio operator
  // can recover from draft history.
  const publishedId = remote_id.replace(/^drafts\./, '')
  const mutations = { mutations: [{ delete: { id: publishedId } }] }
  const res = await sanFetch(
    `${apiBase(config.project_id as string, config.dataset as string)}/mutate/${config.dataset}`,
    creds.token,
    { method: 'POST', body: JSON.stringify(mutations) },
  )
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

interface SanRes { status: number; json: unknown; headers: Record<string, string> }
async function sanFetch(url: string, token: string, opts: { method?: string; body?: string } = {}): Promise<SanRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'VERA-sanity-publish/1.0' },
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
    console.warn('sanFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError { return { code, message, recovery_action } }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
