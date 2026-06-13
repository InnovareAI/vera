// WordPress connector — first concrete implementation of the 6-verb
// Publisher contract from _shared/publisher.ts.
//
// Action-routed (one edge function, six verbs):
//   POST { action: 'connect',      org_id, name, base_url, username, app_password }
//   POST { action: 'health_check', publisher_id }
//   POST { action: 'dry_run',      publisher_id, post: PostInput }
//   POST { action: 'publish',      publisher_id, post: PostInput, idempotency_key }
//   POST { action: 'verify',       publisher_id, remote_id }
//   POST { action: 'unpublish',    publisher_id, remote_id }
//
// Failure cases caught (per docs/PUBLISHING.md §"15 WordPress failure cases"):
//   Phase 1 v1 (this file):
//     1. Wrong base URL                  → connect()
//     2. Application Password rejected   → connect()
//     3. REST API disabled               → connect()
//     4. Authorization stripped          → connect() (probe + warning)
//     5. HTTPS / cert issues             → connect()
//     9. Slug collision                  → dry_run()
//    11. Status stuck on draft           → verify()
//    14. Rate limit (429)                → publish() / connect()
//
// Coming in v2: featured image upload (6/12), taxonomy reconcile (7-8),
// multi-site target picker (14b), scheduled-publish TZ handling (15).

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
    console.error('wordpress-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── connect ────────────────────────────────────────────────────────────────
// End-to-end probe at connect time:
//   1. Normalize base_url (strip trailing slash, force https where unambiguous)
//   2. Probe /wp-json/wp/v2 — must return JSON with a `namespaces` or `routes` key
//   3. Probe /wp-json/wp/v2/users/me with auth — must return 200
//   4. Check that Authorization wasn't stripped (response includes our user)
// On success: writes publisher row + credentials in Vault.
async function connect(supabase: AdminClient, input: Record<string, unknown>): Promise<{
  ok: boolean
  publisher_id?: string
  health?: HealthCheckResult
  error?: PublisherError
}> {
  const org_id = input.org_id as string
  const client_project_id = publisherClientProjectId(input)
  const name = input.name as string
  const base_url_raw = input.base_url as string
  const username = input.username as string
  const app_password = input.app_password as string

  if (!org_id || !name || !base_url_raw || !username || !app_password) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields: org_id, name, base_url, username, app_password',
      'All four fields are required to connect.') }
  }

  // Normalize base URL
  let base_url: string
  try {
    const u = new URL(/^https?:\/\//i.test(base_url_raw) ? base_url_raw : `https://${base_url_raw}`)
    u.search = ''; u.hash = ''
    base_url = u.toString().replace(/\/+$/, '')
  } catch {
    return { ok: false, error: typed('target_misconfigured',
      'That doesn\'t look like a URL.',
      'Paste the site root, e.g. https://blog.example.com') }
  }

  // Step 1: probe /wp-json/wp/v2 — confirm it's WordPress + REST is enabled
  const probe = await fetchSafe(`${base_url}/wp-json/wp/v2`, { timeoutMs: 8_000 })
  if (probe.networkError) {
    return { ok: false, error: typed('network_timeout',
      `Couldn't reach ${base_url}.`,
      'Check the URL and that the site is reachable from the public internet.') }
  }
  if (probe.status === 0 || probe.status >= 500) {
    return { ok: false, error: typed('network_timeout',
      `Site returned HTTP ${probe.status}.`,
      'Try again, or check if the site is down.') }
  }
  if (probe.status === 404) {
    return { ok: false, error: typed('target_not_found',
      'No WordPress REST API found at this URL.',
      'Confirm this is a WordPress site. Some hosts disable the REST API — check Wordfence / iThemes Security settings or whitelist /wp-json/.') }
  }
  let probeJson: Record<string, unknown> | null = null
  try { probeJson = probe.json as Record<string, unknown> } catch { /* not JSON */ }
  if (!probeJson || (!probeJson.namespaces && !probeJson.routes)) {
    return { ok: false, error: typed('target_misconfigured',
      'REST API is reachable but doesn\'t look like WordPress.',
      'Confirm the URL is the site root (not a subdirectory). For example, use https://blog.example.com not https://blog.example.com/wp/.') }
  }

  // Step 2: probe with auth — /wp-json/wp/v2/users/me
  const basic = btoa(`${username}:${app_password}`)
  const meRes = await fetchSafe(`${base_url}/wp-json/wp/v2/users/me?context=edit`, {
    headers: { 'Authorization': `Basic ${basic}` },
    timeoutMs: 8_000,
  })
  if (meRes.status === 401 || meRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'WordPress rejected the username + Application Password.',
      'Generate a new Application Password in WP Admin → Users → Your Profile → Application Passwords. Use the username (not email) and the password EXACTLY as shown (spaces OK).') }
  }
  if (meRes.status === 429) {
    return { ok: false, error: typed('rate_limited',
      'WordPress rate-limited the connection probe.',
      'Wait a minute and try again.') }
  }
  if (meRes.status >= 400 || !meRes.json) {
    return { ok: false, error: typed('target_misconfigured',
      `Auth probe returned HTTP ${meRes.status}.`,
      'Some hosts (WP Engine, certain Cloudways configs) strip the Authorization header. Add to .htaccess: SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1 — or contact your host.') }
  }
  const meUser = meRes.json as { id?: number; name?: string; slug?: string; roles?: string[] }
  if (!meUser.id || !meUser.slug) {
    return { ok: false, error: typed('auth_invalid',
      'Authentication succeeded but the response is malformed.',
      'Try regenerating the Application Password.') }
  }

  // All probes passed — save publisher + credentials
  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, project_id: client_project_id, kind: 'wordpress', name,
    config: { base_url, username, user_id: meUser.id, user_slug: meUser.slug, user_roles: meUser.roles ?? [] },
    credentials_ref: 'pending',   // overwritten by the rpc below
    default_status: 'draft',
    health_status: 'healthy',
    health_detail: `Connected as ${meUser.slug}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()

  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Failed to save publisher row: ${insErr?.message}`, 'Try again, or contact support.') }
  }

  // Stash credentials in Vault via the rpc helper
  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', {
    p_id: pub.id,
    p_creds: { username, app_password },
  })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Failed to store credentials: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true,
    publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected as ${meUser.slug}`, checked_at: new Date().toISOString() },
  }
}

// ─── health_check ───────────────────────────────────────────────────────────
async function health_check(supabase: AdminClient, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const base_url = config.base_url as string
  const basic = btoa(`${creds.username}:${creds.app_password}`)
  const res = await fetchSafe(`${base_url}/wp-json/wp/v2/users/me`, {
    headers: { 'Authorization': `Basic ${basic}` }, timeoutMs: 6_000,
  })
  const checked_at = new Date().toISOString()
  if (res.status === 401 || res.status === 403) {
    await supabase.from('publishers').update({
      health_status: 'stale', health_detail: 'Auth rejected', last_health_check: checked_at,
    }).eq('id', publisher_id)
    return { ok: false, status: 'stale', detail: 'Authentication rejected — Application Password may have been revoked', checked_at }
  }
  if (res.status === 200) {
    await supabase.from('publishers').update({
      health_status: 'healthy', health_detail: null, last_health_check: checked_at,
    }).eq('id', publisher_id)
    return { ok: true, status: 'healthy', checked_at }
  }
  await supabase.from('publishers').update({
    health_status: 'unknown', health_detail: `HTTP ${res.status}`, last_health_check: checked_at,
  }).eq('id', publisher_id)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

// ─── dry_run ────────────────────────────────────────────────────────────────
// Renders MD → HTML, computes final slug (with collision check), returns
// preview. NO writes to the remote site.
async function dry_run(supabase: AdminClient, input: Record<string, unknown>): Promise<DryRunResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const base_url = config.base_url as string
  const basic = btoa(`${creds.username}:${creds.app_password}`)

  const rendered_html = renderMarkdown(post.body_md)
  const candidate_slug = post.slug?.trim() || slugify(post.title)

  // Slug collision probe
  let final_slug = candidate_slug
  const collisionRes = await fetchSafe(
    `${base_url}/wp-json/wp/v2/posts?slug=${encodeURIComponent(candidate_slug)}&status=any&per_page=1`,
    { headers: { 'Authorization': `Basic ${basic}` }, timeoutMs: 6_000 },
  )
  const warnings: string[] = []
  if (Array.isArray(collisionRes.json) && (collisionRes.json as unknown[]).length > 0) {
    // Suffix until clear (cap at -10)
    for (let i = 2; i <= 10; i++) {
      const try_slug = `${candidate_slug}-${i}`
      const r = await fetchSafe(
        `${base_url}/wp-json/wp/v2/posts?slug=${encodeURIComponent(try_slug)}&status=any&per_page=1`,
        { headers: { 'Authorization': `Basic ${basic}` }, timeoutMs: 6_000 },
      )
      if (Array.isArray(r.json) && (r.json as unknown[]).length === 0) {
        final_slug = try_slug
        break
      }
    }
    if (final_slug === candidate_slug) {
      // 10 collisions — surface as a warning, append timestamp suffix
      final_slug = `${candidate_slug}-${Date.now().toString(36)}`
      warnings.push(`Slug "${candidate_slug}" already in use (and -2 through -10 are taken). Using "${final_slug}".`)
    } else if (final_slug !== candidate_slug) {
      warnings.push(`Slug "${candidate_slug}" already in use. Will publish as "${final_slug}".`)
    }
  }

  return {
    ok: true,
    preview: {
      rendered_html,
      final_slug,
      target_categories: post.categories ?? [],
      target_tags: post.tags ?? [],
      image_will_upload: !!post.featured_image_url,
      will_create_taxonomies: { categories: [], tags: [] },  // taxonomy reconcile is v2
      scheduled_at_utc: post.scheduled_at ?? null,
      scheduled_at_target_tz: post.scheduled_at ?? null,
    },
    warnings,
  }
}

// ─── publish ────────────────────────────────────────────────────────────────
// Phase 1 v1 happy path: no featured image, no taxonomy reconcile.
// Creates the post, sets status, returns remote_id + URL.
// Audit trail: writes a publish_attempts row per phase.
async function publish(supabase: AdminClient, input: Record<string, unknown>): Promise<PublishResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const idempotency_key = input.idempotency_key as string
  const post_id = (input.post_id as string | undefined) ?? null
  const t0 = Date.now()

  if (!idempotency_key) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed',
      'idempotency_key required.', 'Pass a unique key per logical publish operation.') }
  }

  // Idempotency: if this key + 'publish' phase already succeeded, return prior result
  if (!post_id) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'post_id required.', 'Publish actions must target a content post.') }
  }

  const { data: prior } = await supabase.from('publish_attempts')
    .select('id, outcome, remote_id, remote_url, error_code, error_message')
    .eq('idempotency_key', idempotency_key)
    .eq('phase', 'publish')
    .maybeSingle()
  if (prior && prior.outcome === 'success') {
    return {
      ok: true, remote_id: prior.remote_id as string | undefined, remote_url: prior.remote_url as string | undefined,
      attempt_id: prior.id as string, latency_ms: Date.now() - t0, verified: true,
    }
  }

  const publishLock = await acquirePublishLockForOpenPost(supabase, post_id, publisher_id, null)
  if (!publishLock.ok) {
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishLock.message,
      publishLock.recoveryAction) }
  }

  const publishClaim = await claimPublish(supabase, publishLock.post, 'wordpress', `wordpress-publish:${publisher_id}`)
  if (!publishClaim.ok) {
    await releasePublishLock(supabase, post_id, publisher_id)
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishClaim.message,
      'Refresh the post detail page before retrying.') }
  }
  let publishClaimCompleted = false

  try {
    const { config, creds } = await loadPublisher(supabase, publisher_id)
    const base_url = config.base_url as string
    const basic = btoa(`${creds.username}:${creds.app_password}`)

    // Pre-render + slug
    const rendered_html = renderMarkdown(post.body_md)
    const slug = post.slug?.trim() || slugify(post.title)
    const status_target = post.status ?? 'draft'
    const org_id = (await supabase.from('publishers').select('org_id').eq('id', publisher_id).single()).data?.org_id as string

    // ─── Phase: image_upload (case 11/12 of the failure plan) ──────────────
    let featured_media_id: number | undefined
    if (post.featured_image_url) {
      const t_img = Date.now()
      const { data: imgAttempt } = await supabase.from('publish_attempts').insert({
        org_id, post_id, publisher_id, idempotency_key,
        phase: 'image_upload', outcome: 'in_progress',
        request_payload: { source_url: post.featured_image_url },
      }).select('id').single()
      const imgAttemptId = imgAttempt?.id as string

      try {
        const imgRes = await fetch(post.featured_image_url, { signal: AbortSignal.timeout(15_000) })
        if (!imgRes.ok) throw new Error(`source returned HTTP ${imgRes.status}`)
        const ct = imgRes.headers.get('content-type') ?? 'image/jpeg'
        const ext = (ct.split('/')[1] ?? 'jpg').split(';')[0]
        const filename = `${slug}.${ext}`
        const imgBytes = new Uint8Array(await imgRes.arrayBuffer())

        const uploadRes = await fetch(`${base_url}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': ct,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
          body: imgBytes,
          signal: AbortSignal.timeout(30_000),
        })
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '')
          await markAttempt(supabase, imgAttemptId, 'failed', 'image_upload_failed',
            `Image upload returned HTTP ${uploadRes.status}: ${errText.slice(0, 120)}`,
            'Try a different image source or omit the featured image.',
            { latency_ms: Date.now() - t_img })
          return { ok: false, attempt_id: imgAttemptId, latency_ms: Date.now() - t0, error: typed('image_upload_failed',
            `Featured image upload to WordPress failed (HTTP ${uploadRes.status}).`,
            'Either the image source URL returned an error, or WordPress rejected the file. Try a different image, or omit the featured image.') }
        }
        const media = await uploadRes.json() as { id: number; source_url?: string }
        featured_media_id = media.id
        await markAttempt(supabase, imgAttemptId, 'success', null, null, null, {
          remote_id: String(media.id), remote_url: media.source_url ?? null,
          latency_ms: Date.now() - t_img,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await markAttempt(supabase, imgAttemptId, 'failed', 'image_upload_failed',
          `Image fetch/upload failed: ${message}`,
          'Check the image URL is reachable and the file is a supported format (PNG/JPEG/WebP).',
          { latency_ms: Date.now() - t_img })
        return { ok: false, attempt_id: imgAttemptId, latency_ms: Date.now() - t0, error: typed('image_upload_failed',
          'Couldn\'t fetch or upload the featured image.',
          'Either the image source is unreachable, the format is unsupported, or WordPress rejected it.') }
      }
    }

    // ─── Phase: taxonomy_reconcile (case 7/8 of the failure plan) ──────────
    let category_ids: number[] = []
    let tag_ids: number[] = []
    if ((post.categories?.length ?? 0) > 0 || (post.tags?.length ?? 0) > 0) {
      const t_tax = Date.now()
      const { data: taxAttempt } = await supabase.from('publish_attempts').insert({
        org_id, post_id, publisher_id, idempotency_key,
        phase: 'taxonomy_reconcile', outcome: 'in_progress',
        request_payload: { categories: post.categories ?? [], tags: post.tags ?? [] },
      }).select('id').single()
      const taxAttemptId = taxAttempt?.id as string

      try {
        if (post.categories?.length) {
          category_ids = await resolveTaxonomy(base_url, basic, 'categories', post.categories)
        }
        if (post.tags?.length) {
          tag_ids = await resolveTaxonomy(base_url, basic, 'tags', post.tags)
        }
        await markAttempt(supabase, taxAttemptId, 'success', null, null, null, {
          response_body: { category_ids, tag_ids },
          latency_ms: Date.now() - t_tax,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await markAttempt(supabase, taxAttemptId, 'failed', 'validation_failed',
          `Taxonomy reconcile failed: ${message}`,
          'WordPress rejected creating a category or tag. Check the names are valid and the user has the manage_categories capability.',
          { latency_ms: Date.now() - t_tax })
        return { ok: false, attempt_id: taxAttemptId, latency_ms: Date.now() - t0, error: typed('validation_failed',
          'Couldn\'t set up categories/tags on the target.',
          'Check that the connected user has permission to create categories on this WordPress site.') }
      }
    }

    // ─── Phase: create_post ────────────────────────────────────────────────
    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key,
      phase: 'publish', outcome: 'in_progress',
      request_payload: { title: post.title, slug, status: status_target, body_chars: rendered_html.length,
                          featured_media: featured_media_id, categories: category_ids, tags: tag_ids },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    // POST /wp/v2/posts
    const wpPayload: Record<string, unknown> = {
      title: post.title,
      content: rendered_html,
      slug,
      status: status_target === 'scheduled' ? 'future' : (status_target === 'published' ? 'publish' : 'draft'),
      excerpt: post.excerpt ?? undefined,
    }
    if (status_target === 'scheduled' && post.scheduled_at) {
      wpPayload.date_gmt = post.scheduled_at
    }
    if (featured_media_id) wpPayload.featured_media = featured_media_id
    if (category_ids.length) wpPayload.categories = category_ids
    if (tag_ids.length)      wpPayload.tags = tag_ids

    const createRes = await fetchSafe(`${base_url}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(wpPayload),
      timeoutMs: 20_000,
    })

    if (createRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited',
        'WordPress rate-limited the publish request.',
        `Wait ${createRes.headers['retry-after'] ?? 'a minute'} and try again.`)
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited',
        'WordPress rate-limited the publish.', 'Try again in a few minutes.') }
    }
    if (createRes.status === 401 || createRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired',
        'Auth rejected mid-publish — Application Password may have been revoked.',
        'Reconnect from Settings → Integrations.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired',
        'Auth rejected mid-publish.', 'Reconnect WordPress in Settings → Integrations.') }
    }
    if (createRes.status === 400) {
      const detail = (createRes.json as { message?: string })?.message ?? 'Bad request'
      await markAttempt(supabase, attempt_id, 'failed', 'validation_failed', detail, 'Check the post fields and try again.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('validation_failed', detail, 'Check the post fields.') }
    }
    if (createRes.status < 200 || createRes.status >= 300) {
      await markAttempt(supabase, attempt_id, 'failed', 'unknown_error',
        `WordPress returned HTTP ${createRes.status}.`,
        'Check the WP error logs.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('unknown_error',
        `HTTP ${createRes.status}`, 'Check the response body in the audit log.') }
    }

    const wpPost = createRes.json as { id: number; link?: string; status?: string; slug?: string }

    // Verify
    const verified = wpPost.status === wpPayload.status || (status_target === 'draft' && wpPost.status === 'draft')
    await completePublishClaim(supabase, publishLock.post, String(wpPost.id), wpPost.link)
    publishClaimCompleted = true

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id: String(wpPost.id),
      remote_url: wpPost.link ?? null,
      response_body: { id: wpPost.id, slug: wpPost.slug, status: wpPost.status },
    })

    return {
      ok: true,
      remote_id: String(wpPost.id),
      remote_url: wpPost.link,
      verified,
      attempt_id,
      latency_ms: Date.now() - t0,
    }
  } finally {
    if (!publishClaimCompleted) {
      await releasePublishClaim(supabase, post_id, 'wordpress publish did not complete')
    }
    await releasePublishLock(supabase, post_id, publisher_id)
  }
}

// ─── verify ─────────────────────────────────────────────────────────────────
async function verify(supabase: AdminClient, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const base_url = config.base_url as string
  const basic = btoa(`${creds.username}:${creds.app_password}`)

  const res = await fetchSafe(
    `${base_url}/wp-json/wp/v2/posts/${remote_id}?context=edit&_embed=wp:featuredmedia`,
    { headers: { 'Authorization': `Basic ${basic}` }, timeoutMs: 8_000 },
  )
  if (res.status === 404) {
    return { ok: false, status: 'missing', detail: 'Post not found on the target — was it deleted?' }
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: 'missing', detail: `Verify probe returned HTTP ${res.status}` }
  }
  const wpPost = res.json as { status?: string; link?: string; featured_media?: number; _embedded?: Record<string, unknown> }
  const statusMap: Record<string, 'draft' | 'published' | 'scheduled' | 'missing'> = {
    publish: 'published', future: 'scheduled', draft: 'draft', pending: 'draft', private: 'published',
  }
  return {
    ok: true,
    status: statusMap[wpPost.status ?? 'draft'] ?? 'draft',
    remote_url: wpPost.link,
    featured_image_set: !!wpPost.featured_media,
  }
}

// ─── unpublish ──────────────────────────────────────────────────────────────
async function unpublish(supabase: AdminClient, input: Record<string, unknown>): Promise<UnpublishResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const base_url = config.base_url as string
  const basic = btoa(`${creds.username}:${creds.app_password}`)

  // Set status to draft (soft unpublish). Hard delete would be POST .../delete — not the default
  // because operators sometimes want to roll back to draft, fix, and re-publish.
  const res = await fetchSafe(`${base_url}/wp-json/wp/v2/posts/${remote_id}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'draft' }),
    timeoutMs: 10_000,
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `Unpublish returned HTTP ${res.status}.`,
      'Check WordPress permissions for the connected user.') }
  }
  return { ok: true }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadPublisher(
  supabase: AdminClient, publisher_id: string,
): Promise<{ config: Record<string, unknown>; creds: { username: string; app_password: string } }> {
  const { data: pub } = await supabase.from('publishers')
    .select('config').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error(`credentials for publisher ${publisher_id} missing`)
  return { config: pub.config as Record<string, unknown>, creds: creds as { username: string; app_password: string } }
}

async function markAttempt(
  supabase: AdminClient,
  attempt_id: string,
  outcome: 'success' | 'failed',
  error_code: string | null,
  error_message: string | null,
  recovery_action: string | null,
  extras?: Record<string, unknown>,
): Promise<void> {
  await supabase.from('publish_attempts').update({
    outcome, error_code, error_message, recovery_action,
    completed_at: new Date().toISOString(),
    ...(extras ?? {}),
  }).eq('id', attempt_id)
}

// Resolve a list of taxonomy names to WP term IDs. For each name:
//   1. Look up by exact match in /wp/v2/<taxonomy>?search=...
//   2. If found, use existing ID
//   3. If not found, POST /wp/v2/<taxonomy> to create
// Throws if any creation fails — the caller turns that into a typed error.
async function resolveTaxonomy(
  base_url: string, basic: string, taxonomy: 'categories' | 'tags', names: string[],
): Promise<number[]> {
  const ids: number[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue

    // Search first
    const searchRes = await fetch(
      `${base_url}/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}&per_page=20`,
      { headers: { 'Authorization': `Basic ${basic}` }, signal: AbortSignal.timeout(8_000) },
    )
    if (searchRes.ok) {
      const arr = await searchRes.json() as Array<{ id: number; name: string }>
      const exact = arr.find(t => t.name.toLowerCase() === name.toLowerCase())
      if (exact) { ids.push(exact.id); continue }
    }

    // Create
    const createRes = await fetch(`${base_url}/wp-json/wp/v2/${taxonomy}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => '')
      throw new Error(`create ${taxonomy} "${name}" failed (HTTP ${createRes.status}): ${errBody.slice(0, 120)}`)
    }
    const created = await createRes.json() as { id: number }
    ids.push(created.id)
  }
  return ids
}

interface SafeFetchResult {
  status: number
  json: unknown
  headers: Record<string, string>
  networkError: boolean
}

async function fetchSafe(url: string, opts: {
  method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number
} = {}): Promise<SafeFetchResult> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Accept': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      redirect: 'follow',
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let body: unknown = null
    try {
      const ct = res.headers.get('content-type') ?? ''
      body = ct.includes('json') ? await res.json() : await res.text()
    } catch { /* leave as null */ }
    return { status: res.status, json: body, headers, networkError: false }
  } catch (e) {
    console.warn('fetchSafe error', url, e)
    return { status: 0, json: null, headers: {}, networkError: true }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string, detail?: Record<string, unknown>): PublisherError {
  return { code, message, recovery_action, detail }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
