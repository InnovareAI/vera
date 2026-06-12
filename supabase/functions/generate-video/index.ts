// FAL.AI video generation — SSE+queue+poll. Matches the generate-image
// pattern. Takes a prompt (optionally + image_url for image-to-video) and
// returns the resulting MP4 URL.
//
// POST { prompt, model?, image_url?, duration?, aspect_ratio? }
// → text/event-stream:
//     {event:"started", model_used, request_id}
//     {event:"status",  status, queue_position?, elapsed_s}      (every ~3s)
//     {event:"done",    video:{url, content_type?}, model_used, elapsed_s}
//     {event:"error",   message}

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import type { Database } from "../_shared/database.types.ts"
import type { AdminClient } from "../_shared/auth.ts"
import { requireProjectMember, requireSignedInOrService } from "../_shared/auth.ts"
import { checkProjectAiBudget, loadProjectAiPolicy } from "../_shared/ai-policy.ts"
import { loadClientApiKey } from "../_shared/client-media-keys.ts"
import { logGenerationUsage } from "../_shared/generation-usage.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type VideoTier = 'standard' | 'premium'
type VideoKind = 'text' | 'image'

type VideoModel = {
  slug: string
  tier: VideoTier
  kind: VideoKind
  estimate: string
}

const DEFAULT_TEXT_VIDEO_MODEL = Deno.env.get('DEFAULT_VIDEO_MODEL') ?? 'hailuo'
const DEFAULT_IMAGE_VIDEO_MODEL = Deno.env.get('DEFAULT_IMAGE_VIDEO_MODEL') ?? 'hailuo-i2v'
const PREMIUM_VIDEO_MODELS_ENABLED = Deno.env.get('PREMIUM_VIDEO_MODELS_ENABLED') === 'true'

// Curated video model whitelist. Do not allow arbitrary fal slugs on submit:
// that is how an expensive endpoint can bypass cost controls.
const MODELS: Record<string, VideoModel> = {
  // Standard prototype tier. fal prices Hailuo 2.3 Standard at $0.28 per 6s
  // generation and $0.56 per 10s generation at 768p.
  'hailuo':              { slug: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', tier: 'standard', kind: 'text', estimate: '$0.28 per 6s clip' },
  'hailuo-2.3':          { slug: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', tier: 'standard', kind: 'text', estimate: '$0.28 per 6s clip' },
  'hailuo-standard':     { slug: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', tier: 'standard', kind: 'text', estimate: '$0.28 per 6s clip' },
  'minimax':             { slug: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', tier: 'standard', kind: 'text', estimate: '$0.28 per 6s clip' },
  'hailuo-i2v':          { slug: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video', tier: 'standard', kind: 'image', estimate: '$0.28 per 6s clip' },
  'hailuo-2.3-i2v':      { slug: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video', tier: 'standard', kind: 'image', estimate: '$0.28 per 6s clip' },
  'minimax-i2v':         { slug: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video', tier: 'standard', kind: 'image', estimate: '$0.28 per 6s clip' },

  // Premium tier. These must never be picked by vague "make a video" requests.
  'veo-3':               { slug: 'fal-ai/veo3', tier: 'premium', kind: 'text', estimate: 'premium video endpoint' },
  'veo3':                { slug: 'fal-ai/veo3', tier: 'premium', kind: 'text', estimate: 'premium video endpoint' },
  'sora-2':              { slug: 'fal-ai/sora-2', tier: 'premium', kind: 'text', estimate: 'premium video endpoint' },
  'sora':                { slug: 'fal-ai/sora-2', tier: 'premium', kind: 'text', estimate: 'premium video endpoint' },
  'kling-3':             { slug: 'fal-ai/kling-video/v3/pro/image-to-video', tier: 'premium', kind: 'image', estimate: '$0.112-$0.196 per second' },
  'kling':               { slug: 'fal-ai/kling-video/v3/pro/image-to-video', tier: 'premium', kind: 'image', estimate: '$0.112-$0.196 per second' },
  'kling-2.6':           { slug: 'fal-ai/kling-video/v2.6/pro/image-to-video', tier: 'premium', kind: 'image', estimate: '$0.07-$0.14 per second' },
  'kling-2.5':           { slug: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', tier: 'premium', kind: 'image', estimate: 'premium video endpoint' },
  'seedance-i2v':        { slug: 'bytedance/seedance-2.0/image-to-video', tier: 'premium', kind: 'image', estimate: '$0.3034 per second at 720p on fal' },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)

  const {
    prompt,
    model,
    image_url,
    duration,
    aspect_ratio = '16:9',
    project_id,
    action,                 // 'submit' | 'status' | undefined (legacy stream)
    request_id,             // for action: 'status'
    slug: slugIn,           // legacy status hint; DB slug wins
    premium_approved,
  } = await req.json().catch(() => ({}))

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // ── ASYNC status check ── the frontend polls this with short requests, so
  // nothing holds a 60-120s connection that a gateway would kill mid-render.
  if (action === 'status') {
    if (!request_id) return jsonError('request_id is required', 400)
    const auth = await requireSignedInOrService(req, supabase, SERVICE_KEY, corsHeaders)
    if (!auth.ok) return auth.response
    const { data: job, error: jobError } = await supabase
      .from('video_jobs')
      .select('project_id, slug')
      .eq('request_id', String(request_id))
      .maybeSingle()
    if (jobError) return jsonError(jobError.message, 500)
    const jobProjectId = (job as { project_id?: string | null } | null)?.project_id
    if (!jobProjectId) return jsonError('Video job not found for this client space.', 404)

    const access = await requireProjectMember(req, supabase, SERVICE_KEY, jobProjectId, corsHeaders)
    if (!access.ok) return access.response
    const fal = await resolveFalKey(supabase, jobProjectId)
    if (!fal.ok) return fal.response

    const modelHint = modelSlugHint(model)
    const defaultSlug = modelSlugHint(DEFAULT_TEXT_VIDEO_MODEL) ?? MODELS.hailuo.slug
    const slug = canonicalQueueSlug((job as { slug?: string | null } | null)?.slug || slugIn || modelHint || defaultSlug)
    const sres = await fetch(`https://queue.fal.run/${slug}/requests/${request_id}/status`, { headers: { Authorization: `Key ${fal.key}` } })
    if (!sres.ok) return json({ status: 'ERROR', message: `status ${sres.status}` })
    const sdata = await sres.json() as { status: string; queue_position?: number }
    if (sdata.status !== 'COMPLETED') return json({ status: sdata.status, queue_position: sdata.queue_position ?? null })
    const rres = await fetch(`https://queue.fal.run/${slug}/requests/${request_id}`, { headers: { Authorization: `Key ${fal.key}` } })
    const result = await rres.json() as { video?: { url: string }; videos?: Array<{ url: string }>; url?: string }
    const url = result.video?.url ?? result.videos?.[0]?.url ?? result.url ?? null
    await supabase
      .from('video_jobs')
      .update({ status: 'completed', video_url: url, updated_at: new Date().toISOString() })
      .eq('request_id', String(request_id))
    return json({ status: 'COMPLETED', video_url: url })
  }

  if (!prompt) return jsonError('prompt is required', 400)
  const projectId = typeof project_id === 'string' ? project_id.trim() : ''
  if (!projectId) return jsonError('project_id is required for video generation', 400)

  const access = await requireProjectMember(req, supabase, SERVICE_KEY, projectId, corsHeaders)
  if (!access.ok) return access.response

  const resolved = resolveVideoModel(model, !!image_url)
  if (!resolved.ok) return resolved.response
  const { alias, model: selectedModel, slug } = resolved
  const aiPolicy = await loadProjectAiPolicy(supabase, projectId)
  if (selectedModel.tier === 'standard' && !aiPolicy.standardVideoEnabled) {
    return jsonError('Video generation is disabled for this client space. Enable standard video in the client AI usage policy first.', 403)
  }
  if (selectedModel.tier === 'premium' && !aiPolicy.premiumMediaEnabled) {
    return jsonError(`Premium video model "${alias}" is disabled for this client space. Enable premium media only when this client budget explicitly covers it.`, 402)
  }
  if (selectedModel.kind === 'image' && !image_url) {
    return jsonError(`${alias} is an image-to-video model and requires image_url.`, 400)
  }
  if (selectedModel.kind === 'text' && image_url) {
    return jsonError(`${alias} is a text-to-video model. Use hailuo-i2v for image-to-video.`, 400)
  }
  if (selectedModel.tier === 'premium' && (!PREMIUM_VIDEO_MODELS_ENABLED || premium_approved !== true)) {
    return jsonError(
      `Premium video model "${alias}" is blocked by default (${selectedModel.estimate}). Use hailuo or hailuo-i2v for prototypes, or enable an explicit paid premium video flow first.`,
      402,
    )
  }

  const fal = await resolveFalKey(supabase, projectId)
  if (!fal.ok) return fal.response

  // Build per-model payload. Different FAL video endpoints accept slightly
  // different parameter names; keep this conservative — pass only fields the
  // upstream model is likely to understand.
  const payload: Record<string, unknown> = { prompt }
  if (image_url) {
    if (slug.includes('kling-video')) payload.start_image_url = image_url
    else payload.image_url = image_url
  }
  const safeDuration = normalizeDuration(duration)
  if (safeDuration) payload.duration = safeDuration
  if (aspect_ratio && selectedModel.tier === 'premium') payload.aspect_ratio = aspect_ratio

  const baseUsageMetadata = {
    alias,
    tier: selectedModel.tier,
    kind: selectedModel.kind,
    estimate: selectedModel.estimate,
    duration: safeDuration,
    aspect_ratio,
    has_source_image: !!image_url,
    key_source: fal.source,
  }
  const budget = await checkProjectAiBudget(supabase, projectId, {
    orgId: access.orgId,
    projectId,
    provider: 'fal',
    model: canonicalQueueSlug(slug),
    operation: 'video.submit',
    metadata: baseUsageMetadata,
  })
  if (!budget.ok) return jsonError(budget.message, 402)

  // ── ASYNC submit ── fire the fal job and return the request_id immediately;
  // the frontend then polls action:'status'. No long-held connection.
  if (action === 'submit') {
    const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Key ${fal.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!submitRes.ok) return jsonError(`FAL submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 200)}`, 502)
    const submission = await submitRes.json() as { request_id: string; response_url?: string; status_url?: string }
    const queueSlug = queueSlugFromUrl(submission.response_url ?? submission.status_url) ?? canonicalQueueSlug(slug)
    const recordError = await recordVideoJob(supabase, projectId, submission.request_id, queueSlug, prompt)
    if (recordError) return jsonError(recordError, 500)
    await logGenerationUsage(supabase, {
      orgId: access.orgId,
      projectId,
      provider: 'fal',
      model: queueSlug,
      operation: 'video.submit',
      metadata: {
        ...baseUsageMetadata,
        action: 'submit',
      },
    })
    return json({ request_id: submission.request_id, slug: queueSlug, model: alias, tier: selectedModel.tier, estimated_cost: selectedModel.estimate })
  }

  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))
      const elapsed = () => Math.round((Date.now() - startTime) / 100) / 10

      try {
        const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
          method: 'POST',
          headers: { 'Authorization': `Key ${fal.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!submitRes.ok) {
          const errText = await submitRes.text()
          send('error', { message: `FAL submit failed (${submitRes.status}): ${errText.slice(0, 200)}` })
          controller.close()
          return
        }
        const submission = await submitRes.json() as { request_id: string; status_url?: string; response_url?: string }
        const requestId = submission.request_id
        const queueSlug = queueSlugFromUrl(submission.response_url ?? submission.status_url) ?? canonicalQueueSlug(slug)
        const statusUrl = submission.status_url ?? `https://queue.fal.run/${queueSlug}/requests/${requestId}/status`
        const resultUrl = submission.response_url ?? `https://queue.fal.run/${queueSlug}/requests/${requestId}`
        const recordError = await recordVideoJob(supabase, projectId, requestId, queueSlug, prompt)
        if (recordError) {
          send('error', { message: recordError })
          controller.close()
          return
        }
        await logGenerationUsage(supabase, {
          orgId: access.orgId,
          projectId,
          provider: 'fal',
          model: queueSlug,
          operation: 'video.submit',
          metadata: {
            ...baseUsageMetadata,
            action: 'stream',
          },
        })
        send('started', { model_used: queueSlug, request_id: requestId })

        // Video gen is slower than image — poll every 3s, cap at 600 attempts
        // = 30 min worst case (large Sora 2 jobs can take 5-10 min).
        let completed = false
        for (let i = 0; i < 600; i++) {
          await delay(3000)
          const statusRes = await fetch(statusUrl, { headers: { 'Authorization': `Key ${fal.key}` } })
          if (!statusRes.ok) { send('error', { message: `FAL status fetch failed (${statusRes.status})` }); controller.close(); return }
          const sdata = await statusRes.json() as { status: string; queue_position?: number }
          send('status', { status: sdata.status, queue_position: sdata.queue_position, elapsed_s: elapsed() })
          if (sdata.status === 'COMPLETED') { completed = true; break }
          if (sdata.status === 'FAILED' || sdata.status === 'CANCELLED') {
            send('error', { message: `FAL job ${sdata.status.toLowerCase()}` }); controller.close(); return
          }
        }
        if (!completed) { send('error', { message: 'Timed out after 30 minutes of polling' }); controller.close(); return }

        const resultRes = await fetch(resultUrl, { headers: { 'Authorization': `Key ${fal.key}` } })
        if (!resultRes.ok) { send('error', { message: `FAL result fetch failed (${resultRes.status})` }); controller.close(); return }
        const result = await resultRes.json() as { video?: { url: string; content_type?: string }; videos?: Array<{ url: string }>; url?: string }
        // Normalise — different FAL video models use different result shapes.
        const video = result.video
          ?? (result.videos?.length ? { url: result.videos[0].url } : null)
          ?? (result.url ? { url: result.url } : null)
        if (!video?.url) { send('error', { message: 'FAL returned no video URL' }); controller.close(); return }
        await supabase
          .from('video_jobs')
          .update({ status: 'completed', video_url: video.url, updated_at: new Date().toISOString() })
          .eq('request_id', requestId)
        send('done', { video, model_used: slug, elapsed_s: elapsed() })
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

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function resolveVideoModel(
  requested: unknown,
  hasImage: boolean,
): { ok: true; alias: string; model: VideoModel; slug: string } | { ok: false; response: Response } {
  const fallback = hasImage ? DEFAULT_IMAGE_VIDEO_MODEL : DEFAULT_TEXT_VIDEO_MODEL
  const hasExplicitRequest = typeof requested === 'string' && requested.trim().length > 0
  const requestedAlias = modelAlias(requested)
  if (hasExplicitRequest && !requestedAlias) {
    return {
      ok: false,
      response: jsonError(
        `Unknown video model "${String(requested)}". Allowed prototype models: hailuo, hailuo-i2v. Premium models are blocked unless explicitly enabled.`,
        400,
      ),
    }
  }
  const alias = requestedAlias ?? modelAlias(fallback)
  if (!alias) {
    return {
      ok: false,
      response: jsonError(
        `Unknown video model "${String(requested ?? fallback)}". Allowed prototype models: hailuo, hailuo-i2v. Premium models are blocked unless explicitly enabled.`,
        400,
      ),
    }
  }
  const model = MODELS[alias]
  return { ok: true, alias, model, slug: model.slug }
}

function modelSlugHint(requested: unknown): string | null {
  const alias = modelAlias(requested)
  return alias ? MODELS[alias].slug : null
}

function modelAlias(requested: unknown): string | null {
  if (typeof requested !== 'string') return null
  const raw = requested.trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()
  if (MODELS[normalized]) return normalized
  return Object.entries(MODELS).find(([, model]) => model.slug.toLowerCase() === normalized)?.[0] ?? null
}

function normalizeDuration(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const raw = String(value).trim()
  if (raw === '10') return '10'
  if (raw === '6') return '6'
  return null
}

function queueSlugFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.hostname !== 'queue.fal.run') return null
    const marker = url.pathname.indexOf('/requests/')
    if (marker <= 1) return null
    return canonicalQueueSlug(url.pathname.slice(1, marker))
  } catch {
    return null
  }
}

function canonicalQueueSlug(slug: string): string {
  const normalized = slug.trim().replace(/^\/+|\/+$/g, '')
  if (normalized.startsWith('fal-ai/minimax/')) return 'fal-ai/minimax'
  return normalized
}

async function recordVideoJob(
  supabase: AdminClient,
  projectId: string,
  requestId: string,
  slug: string,
  prompt: unknown,
): Promise<string | null> {
  const { error } = await supabase
    .from('video_jobs')
    .upsert({
      request_id: requestId,
      slug,
      project_id: projectId,
      status: 'rendering',
      prompt: typeof prompt === 'string' ? prompt.slice(0, 8000) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'request_id' })
  return error?.message ?? null
}

async function resolveFalKey(
  supabase: AdminClient,
  projectId: string,
): Promise<{ ok: true; key: string; source: 'client' } | { ok: false; response: Response }> {
  try {
    const clientKey = await loadClientApiKey(supabase, projectId, ['fal', 'fal_ai'])
    if (clientKey) return { ok: true, key: clientKey.key, source: 'client' }

    return {
      ok: false,
      response: jsonError('Video generation requires this client space to use its own FAL key.', 403),
    }
  } catch (error) {
    return {
      ok: false,
      response: jsonError(error instanceof Error ? error.message : 'Could not resolve client FAL key.', 500),
    }
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ event: 'error', message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
