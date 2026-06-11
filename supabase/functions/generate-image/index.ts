// FAL.AI image generation — SSE-streaming with queue+poll under the hood so
// slow models (GPT Image 2, Flux Max, Imagen 4) work alongside fast ones
// (Nano Banana, Seedream) through one consistent interface.
//
// POST { prompt, model?, image_size?, num_images? }
// → text/event-stream:
//     {event:"started", model_used, request_id}
//     {event:"status",  status, queue_position?, elapsed_s}   (every ~2s)
//     {event:"done",    images:[{url}], model_used, elapsed_s}
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
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

// Per-client OpenRouter BYOK. Decrypts a client's stored OpenRouter key
// (client_api_keys.secret_ciphertext), same AES-GCM scheme as vera-chat.
const CLIENT_KEY_ENC = Deno.env.get('CLIENT_API_KEY_ENCRYPTION_KEY') ?? Deno.env.get('VAULT_ENC_KEY') ?? ''
async function decryptClientSecret(payload: string): Promise<string | null> {
  try {
    if (!CLIENT_KEY_ENC || !payload) return null
    const parts = payload.split(':')
    if (parts.length !== 4 || parts[0] !== 'aes-gcm') return null
    const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CLIENT_KEY_ENC))
    const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(parts[2]) }, key, b64(parts[3]))
    return new TextDecoder().decode(plain)
  } catch { return null }
}

// FAL-routed models. Default for everything except premium hero images.
const FAL_MODELS: Record<string, string> = {
  // DEFAULT — Gemini 2.5 Flash Image. Wins on rendering text/typography
  // inside images (critical for branded posters, wordmarks). ~8s, ~$0.04/MP.
  'nano-banana':     'fal-ai/gemini-25-flash-image',
  // Seedream V4 — ByteDance, $0.03/image. Higher photo realism + skin
  // texture, honors portrait/landscape aspect presets. No good for embedded text.
  'seedream':        'fal-ai/bytedance/seedream/v4/text-to-image',
  'seedream-v4':     'fal-ai/bytedance/seedream/v4/text-to-image',
  // FLUX 1.1 Pro — photorealistic.
  'flux-pro':        'fal-ai/flux-pro/v1.1',
  'flux-1.1-pro':    'fal-ai/flux-pro/v1.1',
  // Qwen — cheapest at $0.02/MP.
  'qwen':            'fal-ai/qwen-image',
  // FAL-routed GPT Image 2 (escape hatch — typically more expensive than the OR route below)
  'gpt-image-2-fal': 'fal-ai/gpt-image-2',
  // Ideogram 3 — best-in-class English text rendering. Built for
  // posters, ads, and infographics where typography is load-bearing.
  // ~$0.08/image, ~15-25s. The right tool for text-heavy design work.
  'ideogram':        'fal-ai/ideogram/v3',
  'ideogram-3':      'fal-ai/ideogram/v3',
  // Recraft V3 — "design model" with vector awareness, infographic
  // discipline, brand-color fidelity. Strong on multi-panel layouts.
  // ~$0.06/image. Closest non-Google match to NotebookLM aesthetic.
  'recraft':         'fal-ai/recraft/v3/text-to-image',
  'recraft-v3':      'fal-ai/recraft/v3/text-to-image',
  // Imagen 4 — Google's premium image tier. Same family as Gemini, often
  // sharper text than nano-banana-pro for poster-style outputs.
  'imagen-4':        'fal-ai/imagen4/preview',
  'imagen':          'fal-ai/imagen4/preview',
}

// OpenAI-direct models. ~50% cheaper than FAL on GPT Image 2 and gives
// granular quality control (low/medium/high). Needed for fashion / cosmetics
// hero work where photorealism + brand-mark precision matter.
const OPENAI_MODELS: Record<string, string> = {
  'hero':          'gpt-image-2',
  'gpt-image-2':   'gpt-image-2',
  'gpt-image':     'gpt-image-2',  // alias
}

// OpenRouter-routed non-OpenAI models. Useful for newer Google models not
// yet on FAL (Nano Banana 2/Pro). FAL stays preferred for Gemini 2.5
// because it's already plumbed and the OR account currently has provider-
// routing restrictions on some image models.
const OR_MODELS: Record<string, string> = {
  'nano-banana-2':     'google/gemini-3.1-flash-image-preview',
  'nano-banana-pro':   'google/gemini-3-pro-image-preview',
}
// Nano Banana (Gemini 2.5 Flash Image) on OpenRouter — the default image tier
// for a client running on its own OpenRouter key. Kept out of OR_MODELS so the
// plain "nano-banana" alias still routes to FAL for platform (non-BYOK) clients.
const OR_NANO_BANANA = 'google/gemini-2.5-flash-image'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireSignedInOrService(req, supabase, SERVICE_KEY, corsHeaders)
  if (!auth.ok) return auth.response

  const { prompt, model = 'nano-banana', image_size = 'square_hd', num_images = 1, quality = 'high', project_id } = await req.json().catch(() => ({}))
  if (!prompt) return jsonError('prompt is required', 400)

  // Per-client OpenRouter BYOK. When a project has its own active OpenRouter
  // key, ALL of its image generation runs through OpenRouter on that key — never
  // the platform OpenRouter / FAL / OpenAI keys. A client can run entirely on
  // its own key.
  let clientOpenRouterKey: string | null = null
  if (typeof project_id === 'string' && project_id) {
    const { data: orRow } = await supabase.from('client_api_keys')
      .select('secret_ciphertext').eq('project_id', project_id).eq('provider', 'openrouter').eq('status', 'active')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const cipher = (orRow as { secret_ciphertext?: string } | null)?.secret_ciphertext
    if (cipher) clientOpenRouterKey = await decryptClientSecret(cipher)
  }

  // Route by alias: OpenAI-direct > OpenRouter > FAL. Direct fal-ai/<slug>
  // identifiers still flow through FAL as escape hatches. A client OpenRouter
  // key forces the OpenRouter runner regardless of the requested alias.
  let useOpenAI = model in OPENAI_MODELS
  let useOR = !useOpenAI && model in OR_MODELS
  if (clientOpenRouterKey) { useOpenAI = false; useOR = true }
  const slug = useOpenAI
    ? OPENAI_MODELS[model]
    : useOR
      ? (OR_MODELS[model] ?? OR_NANO_BANANA)
      : (FAL_MODELS[model] ?? model)
  // A client's own key when present; otherwise the platform OpenRouter key.
  const openRouterKey = clientOpenRouterKey ?? OPENROUTER_API_KEY

  if (useOpenAI && !OPENAI_API_KEY) return jsonError('OPENAI_API_KEY not configured on the server.', 500)
  if (useOR && !openRouterKey) return jsonError('No OpenRouter key available for this image request.', 500)
  if (!useOpenAI && !useOR && !FAL_API_KEY) return jsonError('FAL_API_KEY not configured on the server.', 500)

  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))
      const elapsed = () => Math.round((Date.now() - startTime) / 100) / 10

      try {
        if (useOpenAI) {
          await runOpenAI(slug, prompt, quality, image_size, num_images, send, elapsed)
        } else if (useOR) {
          await runOpenRouter(slug, prompt, quality, send, elapsed, openRouterKey!)
        } else {
          await runFal(slug, prompt, image_size, num_images, send, elapsed)
        }
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

// ──────────────────────────────────────────────────────────────────────────────
// FAL.AI runner — queue + poll
// ──────────────────────────────────────────────────────────────────────────────

async function runFal(
  slug: string,
  prompt: string,
  image_size: string,
  num_images: number,
  send: (event: string, data: unknown) => void,
  elapsed: () => number,
): Promise<void> {
  const payload: Record<string, unknown> = { prompt, num_images }
  if (image_size) payload.image_size = image_size

  const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text()
    send('error', { message: `FAL submit failed (${submitRes.status}): ${errText.slice(0, 200)}` })
    return
  }
  const submission = await submitRes.json() as { request_id: string; status_url?: string; response_url?: string }
  const requestId = submission.request_id
  const statusUrl = submission.status_url ?? `https://queue.fal.run/${slug}/requests/${requestId}/status`
  const resultUrl = submission.response_url ?? `https://queue.fal.run/${slug}/requests/${requestId}`
  send('started', { provider: 'fal', model_used: slug, request_id: requestId })

  let completed = false
  for (let i = 0; i < 300; i++) {
    await delay(2000)
    const statusRes = await fetch(statusUrl, { headers: { 'Authorization': `Key ${FAL_API_KEY}` } })
    if (!statusRes.ok) { send('error', { message: `FAL status fetch failed (${statusRes.status})` }); return }
    const sdata = await statusRes.json() as { status: string; queue_position?: number }
    send('status', { status: sdata.status, queue_position: sdata.queue_position, elapsed_s: elapsed() })
    if (sdata.status === 'COMPLETED') { completed = true; break }
    if (sdata.status === 'FAILED' || sdata.status === 'CANCELLED') {
      send('error', { message: `FAL job ${sdata.status.toLowerCase()}` }); return
    }
  }
  if (!completed) { send('error', { message: 'Timed out after 10 minutes of polling' }); return }

  const resultRes = await fetch(resultUrl, { headers: { 'Authorization': `Key ${FAL_API_KEY}` } })
  if (!resultRes.ok) { send('error', { message: `FAL result fetch failed (${resultRes.status})` }); return }
  const result = await resultRes.json() as { images?: Array<{ url: string }>; image?: { url: string } }
  const images = result.images ?? (result.image ? [result.image] : [])
  if (!images.length) { send('error', { message: 'FAL returned no images' }); return }
  send('done', { images, provider: 'fal', model_used: slug, elapsed_s: elapsed() })
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI direct runner — /v1/images/generations. Cheapest path for GPT Image 2.
// ──────────────────────────────────────────────────────────────────────────────

async function runOpenAI(
  slug: string,
  prompt: string,
  quality: string,
  image_size: string,
  num_images: number,
  send: (event: string, data: unknown) => void,
  elapsed: () => number,
): Promise<void> {
  send('started', { provider: 'openai', model_used: slug })
  // OpenAI's images endpoint takes ~30–150s for gpt-image-2 at high quality.
  // Heartbeat keeps the SSE alive.
  let alive = true
  ;(async () => {
    while (alive) {
      await delay(5000)
      if (alive) send('status', { status: 'GENERATING', elapsed_s: elapsed() })
    }
  })()

  // Map our generic image_size presets onto OpenAI's expected size strings.
  const sizeMap: Record<string, string> = {
    'square_hd':    '1024x1024',
    'square':       '1024x1024',
    'portrait_4_3': '1024x1536',
    'portrait_16_9':'1024x1792',
    'landscape_4_3':'1536x1024',
    'landscape_16_9':'1792x1024',
  }
  const size = sizeMap[image_size] ?? (image_size.includes('x') ? image_size : '1024x1024')

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: slug,
        prompt,
        n: num_images,
        size,
        quality,  // 'low' | 'medium' | 'high' | 'auto'
      }),
      signal: AbortSignal.timeout(300_000),
    })
    alive = false
    if (!res.ok) {
      const errText = await res.text()
      send('error', { message: `OpenAI call failed (${res.status}): ${errText.slice(0, 300)}` })
      return
    }
    const data = await res.json() as {
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string }
    }
    if (data.error) { send('error', { message: data.error.message ?? 'OpenAI error' }); return }
    const images = (data.data ?? []).map(d => {
      if (d.url) return { url: d.url }
      if (d.b64_json) return { url: `data:image/png;base64,${d.b64_json}` }
      return null
    }).filter((x): x is { url: string } => !!x)
    if (!images.length) { send('error', { message: 'OpenAI returned no images' }); return }
    send('done', { images, provider: 'openai', model_used: slug, elapsed_s: elapsed() })
  } finally {
    alive = false
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouter runner — chat/completions with modalities=["image","text"]
// ──────────────────────────────────────────────────────────────────────────────

async function runOpenRouter(
  slug: string,
  prompt: string,
  quality: string,
  send: (event: string, data: unknown) => void,
  elapsed: () => number,
  apiKey: string,
): Promise<void> {
  send('started', { provider: 'openrouter', model_used: slug })
  // Heartbeat ticker so the SSE stays alive during the long OR call.
  let alive = true
  ;(async () => {
    while (alive) {
      await delay(5000)
      if (alive) send('status', { status: 'GENERATING', elapsed_s: elapsed() })
    }
  })()

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://content-studio-innovareai.netlify.app',
        'X-Title': 'KAI Image Generation',
      },
      body: JSON.stringify({
        model: slug,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: prompt }],
        // OpenAI image-gen-style quality param (passed through where supported)
        quality,
      }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) {
      alive = false
      const errText = await res.text()
      send('error', { message: `OpenRouter call failed (${res.status}): ${errText.slice(0, 200)}` })
      return
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url: string } | string }> } }>
      error?: { message?: string }
    }
    alive = false
    if (data.error) { send('error', { message: data.error.message ?? 'OpenRouter error' }); return }
    const imgArr = data.choices?.[0]?.message?.images ?? []
    const images = imgArr.map(i => {
      const u = i.image_url
      const url = typeof u === 'string' ? u : u?.url
      return url ? { url } : null
    }).filter((x): x is { url: string } => !!x)
    if (!images.length) { send('error', { message: 'OpenRouter returned no images' }); return }
    send('done', { images, provider: 'openrouter', model_used: slug, elapsed_s: elapsed() })
  } finally {
    alive = false
  }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ event: 'error', message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
