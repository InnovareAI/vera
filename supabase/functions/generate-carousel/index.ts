// Background carousel generation — runs server-side so it isn't bound by the
// chat SSE turn (which gets force-killed when it batches image renders).
//
// POST { post_id, frames:[{image_prompt, text?}], aspect?, session_id?, project_id? }
//   → 200 { job_id } IMMEDIATELY, then renders every frame in the background via
//     EdgeRuntime.waitUntil(): each frame is its own short call to generate-image
//     (sequential, to keep the resource spike low), uploaded to storage, then the
//     finished set is written onto the post (media_metadata.frames, media_type
//     'carousel'). Progress + final state are tracked in media_jobs so a crash
//     leaves a retryable row instead of losing the work. The browser just watches
//     the post (or the job) — it does no generation and can close the tab.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.types.ts'
import type { AdminClient } from '../_shared/auth.ts'
import { requirePostMember } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PUBLIC_BASE = Deno.env.get('PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_PUBLIC_URL') || 'https://supabase-content-eu.innovareai.com'
const STORAGE_BUCKET = 'vera-images'

type Frame = { image_prompt?: string; text?: string | null }

async function uploadToStorage(supabase: AdminClient, orgId: string, source: string): Promise<string> {
  let bytes: Uint8Array
  let contentType: string
  if (source.startsWith('data:')) {
    const m = source.match(/^data:([^;]+);base64,(.+)$/s)
    if (!m) throw new Error('invalid data URL')
    contentType = m[1]
    bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0))
  } else {
    const r = await fetch(source)
    if (!r.ok) throw new Error(`fetch ${r.status}`)
    contentType = r.headers.get('content-type') ?? 'image/png'
    bytes = new Uint8Array(await r.arrayBuffer())
  }
  const ext = contentType.split('/')[1]?.split('+')[0] ?? 'png'
  const key = `${orgId || 'carousel'}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(key, bytes, { contentType, upsert: false })
  if (error) throw new Error(`storage: ${error.message}`)
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(key)
  return publicUrl.replace(/^https?:\/\/[^/]+/, PUBLIC_BASE.replace(/\/$/, ''))
}

// Render one frame through the existing generate-image function (SSE), returning
// a stored public URL.
async function renderFrame(supabase: AdminClient, orgId: string, prompt: string, aspect: string, projectId: string | null): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    body: JSON.stringify({ prompt, model: 'nano-banana-pro', image_size: aspect, quality: 'high', project_id: projectId }),
  })
  if (!res.ok || !res.body) throw new Error(`generate-image HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let url: string | undefined
  let err: string | undefined
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find(l => l.startsWith('data: ')); if (!line) continue
      try {
        const ev = JSON.parse(line.slice(6)) as { event?: string; images?: Array<{ url: string }>; message?: string }
        if (ev.event === 'done') url = ev.images?.[0]?.url
        else if (ev.event === 'error') err = ev.message
      } catch { /* skip */ }
    }
  }
  if (err) throw new Error(err)
  if (!url) throw new Error('no image url')
  try { return await uploadToStorage(supabase, orgId, url) } catch { return url }
}

async function processJob(supabase: AdminClient, jobId: string, postId: string | null, frames: Frame[], aspect: string, projectId: string | null) {
  // Find the post's org for storage pathing.
  let orgId = ''
  if (postId) {
    const { data } = await supabase.from('content_posts').select('org_id').eq('id', postId).maybeSingle()
    orgId = (data as { org_id?: string } | null)?.org_id ?? ''
  }
  // Render ALL frames in parallel. This is a background task (the HTTP response
  // already returned), so there's no foreground SSE to hold open — and finishing
  // in ~one frame's time instead of the sum means we're far LESS likely to hit
  // the worker's wall-clock limit, and one slow/stuck frame can't block the rest.
  // Slots keep frame order; we flush the post each time a slot fills so frames
  // still appear progressively on the card.
  const slots: Array<{ url: string; text: string | null } | null> = new Array(frames.length).fill(null)
  const compact = () => slots.filter(Boolean) as Array<{ url: string; text: string | null }>
  const flush = async () => {
    const built = compact()
    await supabase.from('media_jobs').update({ result: { frames: built }, updated_at: new Date().toISOString() }).eq('id', jobId)
    if (postId && built.length) {
      const { data: ex } = await supabase.from('content_posts').select('media_metadata').eq('id', postId).maybeSingle()
      const meta = (ex && typeof (ex as { media_metadata?: unknown }).media_metadata === 'object' && (ex as { media_metadata?: unknown }).media_metadata)
        ? (ex as { media_metadata: Record<string, unknown> }).media_metadata : {}
      meta.frames = built
      await supabase.from('content_posts').update({ media_url: built[0].url, media_type: 'carousel', media_metadata: meta as Json }).eq('id', postId)
    }
  }
  // Each frame gets up to 3 attempts — image endpoints throw the odd transient
  // HTTP 500/429, and a single drop means an incomplete carousel (the "only 4 of
  // 5" case). Backoff between tries; flush after each frame so the card fills in.
  await Promise.all(frames.map(async (f, i) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = await renderFrame(supabase, orgId, f.image_prompt ?? '', aspect, projectId)
        slots[i] = { url, text: f.text ?? null }
        break
      } catch (e) {
        console.error(`frame ${i} attempt ${attempt}/3 failed`, (e as Error).message)
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }
    await flush()
  }))
  const built = compact()
  const ok = built.length > 0
  await supabase.from('media_jobs').update({
    status: ok ? 'completed' : 'failed',
    error: ok ? null : 'all frames failed',
    result: { frames: built },
    updated_at: new Date().toISOString(),
  }).eq('id', jobId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({})) as {
      post_id?: string; frames?: Frame[]; aspect_ratio?: string; aspect?: string; session_id?: string; project_id?: string
    }
    const frames = Array.isArray(body.frames) ? body.frames : []
    if (!frames.length) return new Response(JSON.stringify({ error: 'no frames' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const aspect = body.aspect ?? body.aspect_ratio ?? 'square_hd'
    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)

    // Caller must be the service (vera-chat internal) or a signed-in member who
    // owns the target post — never an anonymous caller. Mirrors the other
    // service-role functions' guards (close the only-unguarded media endpoint).
    const access = await requirePostMember(req, supabase, SERVICE_KEY, body.post_id ?? null, corsHeaders)
    if (!access.ok) return access.response

    // Enqueue the job (durable record), then return immediately and process in
    // the background — the request isn't held open for the render.
    const { data: job, error } = await supabase.from('media_jobs').insert({
      kind: 'carousel',
      post_id: body.post_id ?? null,
      project_id: body.project_id ?? null,
      session_id: body.session_id ?? null,
      spec: { frames, aspect },
      status: 'processing',
      attempts: 1,
    }).select('id').single()
    if (error || !job) throw new Error(error?.message ?? 'job insert failed')
    const jobId = (job as { id: string }).id

    // @ts-expect-error EdgeRuntime is provided by the supabase edge runtime
    EdgeRuntime.waitUntil(processJob(supabase, jobId, body.post_id ?? null, frames, aspect, body.project_id ?? null))

    return new Response(JSON.stringify({ job_id: jobId, status: 'processing', total: frames.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
