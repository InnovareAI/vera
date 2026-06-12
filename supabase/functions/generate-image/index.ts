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
import type { Database } from "../_shared/database.types.ts"
import type { AdminClient } from "../_shared/auth.ts"
import { requireProjectMember } from "../_shared/auth.ts"
import { checkProjectAiBudget, loadProjectAiPolicy, paidMediaBudgetCapError } from "../_shared/ai-policy.ts"
import { hasAiUserEntitlement, userCanAccessProject } from "../_shared/ai-entitlements.ts"
import { isPlatformMediaProject, loadClientApiKey } from "../_shared/client-media-keys.ts"
import { logGenerationUsage } from "../_shared/generation-usage.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const DEFAULT_IMAGE_MODEL = Deno.env.get('DEFAULT_IMAGE_MODEL') ?? 'nano-banana'

// FAL-routed models. Nano Banana is the default safe Google standard option
// because it can also route through a client's OpenRouter key when no FAL key
// exists. Seedream remains a cheap/fast FAL option for clients with their own
// FAL key.
const FAL_MODELS: Record<string, string> = {
  // Gemini 2.5 Flash Image. Wins on editing consistency and remains a safe
  // Google standard option. Around the same cost band as Seedream.
  'nano-banana':     'fal-ai/gemini-25-flash-image',
  // Seedream — ByteDance. Cheap, fast, strong enough for prototyping and
  // many production marketing visuals.
  'seedream':        'fal-ai/bytedance/seedream/v4/text-to-image',
  'seedream-v4':     'fal-ai/bytedance/seedream/v4/text-to-image',
  'seedream-4.5':    'fal-ai/bytedance/seedream/v4.5/text-to-image',
  'seedream-v4.5':   'fal-ai/bytedance/seedream/v4.5/text-to-image',
  'seedream-5-lite': 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
  'seedream-v5-lite':'fal-ai/bytedance/seedream/v5/lite/text-to-image',
  // FLUX 1.1 Pro — photorealistic.
  'flux-pro':        'fal-ai/flux-pro/v1.1',
  'flux-1.1-pro':    'fal-ai/flux-pro/v1.1',
  // Qwen / Z-Image — cheap Chinese image models for text-heavy layouts and
  // rapid draft exploration.
  'qwen':            'fal-ai/qwen-image',
  'qwen-image':      'fal-ai/qwen-image',
  'qwen-image-2':    'fal-ai/qwen-image-2/text-to-image',
  'qwen-image-2-pro':'fal-ai/qwen-image-2/pro/text-to-image',
  'z-image-turbo':   'fal-ai/z-image/turbo',
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

// OpenAI-direct models. Premium only. Never default and never selected by
// generic aliases like "hero", because that makes normal marketing image
// requests too easy to route onto the expensive OpenAI image tier.
const OPENAI_MODELS: Record<string, string> = {
  'gpt-image-2':   'gpt-image-2',
  'gpt-image':     'gpt-image-2',  // alias
}

// OpenRouter-routed non-OpenAI models. Useful for newer Google models not
// yet on FAL (Nano Banana 2/Pro). Keep Seedream off this list: OpenRouter
// currently rejects the requested image modality for that alias, so Seedream
// must route through FAL only.
const OR_MODELS: Record<string, string> = {
  'nano-banana-2':     'google/gemini-3.1-flash-image-preview',
  'nano-banana-pro':   'google/gemini-3-pro-image-preview',
}
// Nano Banana (Gemini 2.5 Flash Image) on OpenRouter. Kept out of OR_MODELS so
// the plain "nano-banana" alias still routes to FAL when a FAL key is present.
const OR_NANO_BANANA = 'google/gemini-2.5-flash-image'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)

  const {
    prompt,
    model: requestedModel,
    image_size = 'square_hd',
    num_images = 1,
    quality = 'high',
    project_id,
    post_id,
    operator_user_id,
  } = await req.json().catch(() => ({}))
  if (!prompt) return jsonError('prompt is required', 400)
  const projectId = typeof project_id === 'string' ? project_id.trim() : ''
  const postId = typeof post_id === 'string' && post_id.trim() ? post_id.trim() : null
  if (!projectId) return jsonError('project_id is required for image generation', 400)

  const access = await requireProjectMember(req, supabase, SERVICE_KEY, projectId, corsHeaders)
  if (!access.ok) return access.response
  const operatorUserId = access.service ? cleanString(operator_user_id) : access.userId
  const aiPolicy = await loadProjectAiPolicy(supabase, projectId)
  const model = cleanModelAlias(requestedModel) ?? aiPolicy.defaultImageModel ?? DEFAULT_IMAGE_MODEL
  if (!aiPolicy.imagesEnabled) return jsonError('Image generation is disabled for this client space.', 403)
  if (!isSupportedImageModel(model)) {
    return jsonError(
      `Unsupported image model "${model}". Use a curated alias such as nano-banana, seedream, qwen-image, z-image-turbo, ideogram, recraft, imagen-4, or gpt-image-2.`,
      400,
    )
  }
  if (isPremiumImageModel(model) && !aiPolicy.premiumMediaEnabled) {
    return jsonError('Premium image models are disabled for this client space. Use nano-banana, Seedream, Qwen, or another standard model.', 402)
  }
  if (isPremiumImageModel(model)) {
    const budgetCapError = paidMediaBudgetCapError(aiPolicy, 'premium_media')
    if (budgetCapError) return jsonError(budgetCapError, 402)
  }
  const mediaKeys = await resolveMediaKeys(supabase, projectId, access.orgId)
  if (!mediaKeys.ok) return mediaKeys.response

  // Route by alias: explicit OpenAI premium > supported OpenRouter image
  // models > FAL. A client OpenRouter key is used only for aliases we know
  // OpenRouter supports, so FAL-only aliases fail cleanly instead of silently
  // changing model.
  const platformOpenRouterAvailable = mediaKeys.isPlatformMediaProject && !!OPENROUTER_API_KEY
  const wantsNanoBanana = model === 'nano-banana'
  const supportsOpenRouter = model in OR_MODELS || wantsNanoBanana
  const falPreferredForModel = wantsNanoBanana && !!mediaKeys.falKey
  const useOpenAI = model in OPENAI_MODELS
  const useOR = !useOpenAI && (
    (!!mediaKeys.openRouterKey && supportsOpenRouter && !falPreferredForModel) ||
    (!mediaKeys.falKey && platformOpenRouterAvailable && supportsOpenRouter)
  )

  if (!mediaKeys.isPlatformMediaProject) {
    const hasClientKeyForRoute =
      (useOR && !!mediaKeys.openRouterKey) ||
      (useOpenAI && !!mediaKeys.openAIKey) ||
      (!useOpenAI && !useOR && !!mediaKeys.falKey)
    if (!hasClientKeyForRoute) {
      return jsonError('Image generation requires this client space to use its own OpenRouter, OpenAI, or FAL key for the selected model.', 403)
    }
  }

  const slug = useOpenAI
    ? OPENAI_MODELS[model]
    : useOR
      ? (OR_MODELS[model] ?? OR_NANO_BANANA)
      : (FAL_MODELS[model] ?? model)
  const selectedProvider = useOpenAI ? 'openai' : useOR ? 'openrouter' : 'fal'
  const selectedKeySource = selectedProvider === 'openrouter'
    ? (mediaKeys.openRouterKey ? 'client' : 'platform')
    : selectedProvider === 'openai'
      ? (mediaKeys.openAIKey ? 'client' : 'platform')
      : 'client'

  if (selectedKeySource === 'platform') {
    if (!mediaKeys.isPlatformMediaProject) {
      return jsonError('Platform image generation is only available inside approved platform media projects.', 403)
    }
    if (!operatorUserId) {
      return jsonError('Platform image generation requires an entitled operator.', 403)
    }
    try {
      const canAccess = await userCanAccessProject(supabase, operatorUserId, access.orgId, projectId)
      if (!canAccess) return jsonError('Forbidden', 403)
      const entitled = await hasAiUserEntitlement(supabase, {
        userId: operatorUserId,
        orgId: access.orgId,
        projectId,
        capability: 'platform_fal_image',
      })
      if (!entitled) return jsonError('Platform image entitlement is not active for this operator.', 403)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Could not verify platform image entitlement.', 500)
    }
  }

  const openRouterKey = mediaKeys.openRouterKey ?? (selectedKeySource === 'platform' ? OPENROUTER_API_KEY : null)
  const openAIKey = mediaKeys.openAIKey ?? (selectedKeySource === 'platform' ? OPENAI_API_KEY : null)
  const falKey = mediaKeys.falKey

  if (useOpenAI && !openAIKey) return jsonError('No OpenAI key available for this image request.', 500)
  if (useOR && !openRouterKey) return jsonError('No OpenRouter key available for this image request.', 500)
  if (!useOpenAI && !useOR && !falKey) return jsonError('No FAL key available for this image request.', 500)

  const usageMetadata = {
    alias: model,
    image_size,
    num_images,
    quality,
    key_source: selectedKeySource,
    operator_user_id: operatorUserId,
  }
  const budget = await checkProjectAiBudget(supabase, projectId, {
    orgId: access.orgId,
    projectId,
    postId,
    provider: selectedProvider,
    model: slug,
    operation: 'image.generate',
    metadata: usageMetadata,
  })
  if (!budget.ok) return jsonError(budget.message, 402)

  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))
      const elapsed = () => Math.round((Date.now() - startTime) / 100) / 10

      try {
        let success = false
        if (useOpenAI) {
          success = await runOpenAI(slug, prompt, quality, image_size, num_images, send, elapsed, openAIKey!)
        } else if (useOR) {
          success = await runOpenRouter(slug, prompt, quality, send, elapsed, openRouterKey!)
        } else {
          success = await runFal(slug, prompt, image_size, num_images, send, elapsed, falKey!)
        }
        if (success) {
          await logGenerationUsage(supabase, {
            orgId: access.orgId,
            projectId,
            postId,
            provider: selectedProvider,
            model: slug,
            operation: 'image.generate',
            durationMs: Date.now() - startTime,
            metadata: usageMetadata,
          })
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
  apiKey: string,
): Promise<boolean> {
  const payload: Record<string, unknown> = { prompt, num_images }
  if (image_size) payload.image_size = image_size

  const submitRes = await fetch(`https://queue.fal.run/${slug}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text()
    send('error', { message: `FAL submit failed (${submitRes.status}): ${errText.slice(0, 200)}` })
    return false
  }
  const submission = await submitRes.json() as { request_id: string; status_url?: string; response_url?: string }
  const requestId = submission.request_id
  const statusUrl = submission.status_url ?? `https://queue.fal.run/${slug}/requests/${requestId}/status`
  const resultUrl = submission.response_url ?? `https://queue.fal.run/${slug}/requests/${requestId}`
  send('started', { provider: 'fal', model_used: slug, request_id: requestId })

  let completed = false
  for (let i = 0; i < 300; i++) {
    await delay(2000)
    const statusRes = await fetch(statusUrl, { headers: { 'Authorization': `Key ${apiKey}` } })
    if (!statusRes.ok) { send('error', { message: `FAL status fetch failed (${statusRes.status})` }); return false }
    const sdata = await statusRes.json() as { status: string; queue_position?: number }
    send('status', { status: sdata.status, queue_position: sdata.queue_position, elapsed_s: elapsed() })
    if (sdata.status === 'COMPLETED') { completed = true; break }
    if (sdata.status === 'FAILED' || sdata.status === 'CANCELLED') {
      send('error', { message: `FAL job ${sdata.status.toLowerCase()}` }); return false
    }
  }
  if (!completed) { send('error', { message: 'Timed out after 10 minutes of polling' }); return false }

  const resultRes = await fetch(resultUrl, { headers: { 'Authorization': `Key ${apiKey}` } })
  if (!resultRes.ok) { send('error', { message: `FAL result fetch failed (${resultRes.status})` }); return false }
  const result = await resultRes.json() as { images?: Array<{ url: string }>; image?: { url: string } }
  const images = result.images ?? (result.image ? [result.image] : [])
  if (!images.length) { send('error', { message: 'FAL returned no images' }); return false }
  send('done', { images, provider: 'fal', model_used: slug, elapsed_s: elapsed() })
  return true
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
  apiKey: string,
): Promise<boolean> {
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
        'Authorization': `Bearer ${apiKey}`,
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
      return false
    }
    const data = await res.json() as {
      data?: Array<{ url?: string; b64_json?: string }>
      error?: { message?: string }
    }
    if (data.error) { send('error', { message: data.error.message ?? 'OpenAI error' }); return false }
    const images = (data.data ?? []).map(d => {
      if (d.url) return { url: d.url }
      if (d.b64_json) return { url: `data:image/png;base64,${d.b64_json}` }
      return null
    }).filter((x): x is { url: string } => !!x)
    if (!images.length) { send('error', { message: 'OpenAI returned no images' }); return false }
    send('done', { images, provider: 'openai', model_used: slug, elapsed_s: elapsed() })
    return true
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
): Promise<boolean> {
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
      return false
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url: string } | string }> } }>
      error?: { message?: string }
    }
    alive = false
    if (data.error) { send('error', { message: data.error.message ?? 'OpenRouter error' }); return false }
    const imgArr = data.choices?.[0]?.message?.images ?? []
    const images = imgArr.map(i => {
      const u = i.image_url
      const url = typeof u === 'string' ? u : u?.url
      return url ? { url } : null
    }).filter((x): x is { url: string } => !!x)
    if (!images.length) { send('error', { message: 'OpenRouter returned no images' }); return false }
    send('done', { images, provider: 'openrouter', model_used: slug, elapsed_s: elapsed() })
    return true
  } finally {
    alive = false
  }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const PREMIUM_IMAGE_ALIASES = new Set([
  'gpt-image',
  'gpt-image-2',
  'gpt-image-2-fal',
  'imagen',
  'imagen-4',
  'ideogram',
  'ideogram-3',
  'recraft',
  'recraft-v3',
])

function isPremiumImageModel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (PREMIUM_IMAGE_ALIASES.has(normalized)) return true
  return normalized.includes('gpt-image-2') || normalized.includes('/gpt-image-2')
}

function isSupportedImageModel(value: string): boolean {
  return value in FAL_MODELS || value in OPENAI_MODELS || value in OR_MODELS || value === 'nano-banana'
}

function cleanModelAlias(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type MediaKeys = {
  isPlatformMediaProject: boolean
  openRouterKey: string | null
  openAIKey: string | null
  falKey: string | null
}

async function resolveMediaKeys(
  supabase: AdminClient,
  projectId: string,
  orgId: string,
): Promise<{ ok: true } & MediaKeys | { ok: false; response: Response }> {
  try {
    const [platformMediaProject, openRouter, openAI, fal] = await Promise.all([
      isPlatformMediaProject(supabase, projectId, orgId),
      loadClientApiKey(supabase, projectId, ['openrouter']),
      loadClientApiKey(supabase, projectId, ['openai']),
      loadClientApiKey(supabase, projectId, ['fal', 'fal_ai']),
    ])
    return {
      ok: true,
      isPlatformMediaProject: platformMediaProject,
      openRouterKey: openRouter?.key ?? null,
      openAIKey: openAI?.key ?? null,
      falKey: fal?.key ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      response: jsonError(error instanceof Error ? error.message : 'Could not resolve media generation keys.', 500),
    }
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ event: 'error', message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
