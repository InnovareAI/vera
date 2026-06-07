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
import { requireSignedInOrService } from "../_shared/auth.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FAL_API_KEY = Deno.env.get('FAL_API_KEY')

// Curated video model whitelist. Split by text-to-video vs image-to-video —
// the caller picks based on whether they're supplying image_url.
const MODELS: Record<string, string> = {
  // ─── Text-to-video ───────────────────────────────────────────────────────
  // DEFAULT — Google Veo 3. Native audio, strong cinematic quality, ~30-90s
  // generation per 5-8s clip. Best general-purpose text-to-video on FAL.
  'veo-3':         'fal-ai/veo3',
  'veo3':          'fal-ai/veo3',
  // Sora 2 — OpenAI's flagship video model. Premium, photorealistic.
  'sora-2':        'fal-ai/sora-2',
  'sora':          'fal-ai/sora-2',
  'hero':          'fal-ai/sora-2',
  // MiniMax Hailuo — cheaper, ~5-10s clips, fine for social B-roll.
  'minimax':       'fal-ai/minimax-video',
  'hailuo':        'fal-ai/minimax-video',
  // ─── Image-to-video ─────────────────────────────────────────────────────
  // Pass image_url + prompt for camera direction / motion. Used to bring a
  // generated hero image (e.g. fashion campaign still) into motion.
  'kling-3':       'fal-ai/kling-video/v3/pro/image-to-video',
  'kling':         'fal-ai/kling-video/v3/pro/image-to-video',
  'kling-2.6':     'fal-ai/kling-video/v2.6/pro/image-to-video',
  'kling-2.5':     'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  'seedance-i2v':  'bytedance/seedance-2.0/image-to-video',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)
  if (!FAL_API_KEY) return jsonError('FAL_API_KEY not configured on the server.', 500)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireSignedInOrService(req, supabase, SERVICE_KEY, corsHeaders)
  if (!auth.ok) return auth.response

  const {
    prompt,
    model = 'veo-3',
    image_url,
    duration,
    aspect_ratio = '16:9',
    action,                 // 'submit' | 'status' | undefined (legacy stream)
    request_id,             // for action: 'status'
    slug: slugIn,           // for action: 'status'
  } = await req.json().catch(() => ({}))

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // ── ASYNC status check ── the frontend polls this with short requests, so
  // nothing holds a 60-120s connection that a gateway would kill mid-render.
  if (action === 'status') {
    if (!request_id) return jsonError('request_id is required', 400)
    const slug = slugIn || MODELS[model] || model
    const sres = await fetch(`https://queue.fal.run/${slug}/requests/${request_id}/status`, { headers: { Authorization: `Key ${FAL_API_KEY}` } })
    if (!sres.ok) return json({ status: 'ERROR', message: `status ${sres.status}` })
    const sdata = await sres.json() as { status: string; queue_position?: number }
    if (sdata.status !== 'COMPLETED') return json({ status: sdata.status, queue_position: sdata.queue_position ?? null })
    const rres = await fetch(`https://queue.fal.run/${slug}/requests/${request_id}`, { headers: { Authorization: `Key ${FAL_API_KEY}` } })
    const result = await rres.json() as { video?: { url: string }; videos?: Array<{ url: string }>; url?: string }
    const url = result.video?.url ?? result.videos?.[0]?.url ?? result.url ?? null
    return json({ status: 'COMPLETED', video_url: url })
  }

  if (!prompt) return jsonError('prompt is required', 400)

  const slug = MODELS[model] ?? model

  // Build per-model payload. Different FAL video endpoints accept slightly
  // different parameter names; keep this conservative — pass only fields the
  // upstream model is likely to understand.
  const payload: Record<string, unknown> = { prompt }
  if (image_url)    payload.image_url   = image_url
  if (duration)     payload.duration    = duration       // some models use "duration_seconds"
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio

  // ── ASYNC submit ── fire the fal job and return the request_id immediately;
  // the frontend then polls action:'status'. No long-held connection.
  if (action === 'submit') {
    const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!submitRes.ok) return jsonError(`FAL submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 200)}`, 502)
    const submission = await submitRes.json() as { request_id: string }
    return json({ request_id: submission.request_id, slug })
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
          headers: { 'Authorization': `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
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
        const statusUrl = submission.status_url ?? `https://queue.fal.run/${slug}/requests/${requestId}/status`
        const resultUrl = submission.response_url ?? `https://queue.fal.run/${slug}/requests/${requestId}`
        send('started', { model_used: slug, request_id: requestId })

        // Video gen is slower than image — poll every 3s, cap at 600 attempts
        // = 30 min worst case (large Sora 2 jobs can take 5-10 min).
        let completed = false
        for (let i = 0; i < 600; i++) {
          await delay(3000)
          const statusRes = await fetch(statusUrl, { headers: { 'Authorization': `Key ${FAL_API_KEY}` } })
          if (!statusRes.ok) { send('error', { message: `FAL status fetch failed (${statusRes.status})` }); controller.close(); return }
          const sdata = await statusRes.json() as { status: string; queue_position?: number }
          send('status', { status: sdata.status, queue_position: sdata.queue_position, elapsed_s: elapsed() })
          if (sdata.status === 'COMPLETED') { completed = true; break }
          if (sdata.status === 'FAILED' || sdata.status === 'CANCELLED') {
            send('error', { message: `FAL job ${sdata.status.toLowerCase()}` }); controller.close(); return
          }
        }
        if (!completed) { send('error', { message: 'Timed out after 30 minutes of polling' }); controller.close(); return }

        const resultRes = await fetch(resultUrl, { headers: { 'Authorization': `Key ${FAL_API_KEY}` } })
        if (!resultRes.ok) { send('error', { message: `FAL result fetch failed (${resultRes.status})` }); controller.close(); return }
        const result = await resultRes.json() as { video?: { url: string; content_type?: string }; videos?: Array<{ url: string }>; url?: string }
        // Normalise — different FAL video models use different result shapes.
        const video = result.video
          ?? (result.videos?.length ? { url: result.videos[0].url } : null)
          ?? (result.url ? { url: result.url } : null)
        if (!video?.url) { send('error', { message: 'FAL returned no video URL' }); controller.close(); return }
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

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ event: 'error', message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
