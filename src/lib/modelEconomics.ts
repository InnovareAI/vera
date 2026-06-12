export type TextEstimateProvider = 'openrouter' | 'anthropic' | 'platform' | 'missing'

export type SpendEstimate = {
  label: string
  detail: string
}

export type ModelOption = {
  value: string
  label: string
}

export const MODEL_PRICE_GUIDE_LAST_REVIEWED = '2026-06-13'

export const IMAGE_MODEL_OPTIONS: ModelOption[] = [
  { value: 'nano-banana', label: 'Nano Banana, standard' },
  { value: 'seedream', label: 'Seedream v4, standard' },
  { value: 'seedream-v4.5', label: 'Seedream v4.5, standard' },
  { value: 'qwen-image', label: 'Qwen Image, standard' },
  { value: 'z-image-turbo', label: 'Z-Image Turbo, standard' },
  { value: 'ideogram', label: 'Ideogram 3, premium' },
  { value: 'recraft', label: 'Recraft v3, premium' },
  { value: 'imagen-4', label: 'Imagen 4, premium' },
  { value: 'gpt-image-2', label: 'OpenAI Image Gen 2, premium' },
]

export const VIDEO_MODEL_OPTIONS: ModelOption[] = [
  { value: 'hailuo', label: 'Hailuo text-to-video, standard' },
]

export const IMAGE_VIDEO_MODEL_OPTIONS: ModelOption[] = [
  { value: 'hailuo-i2v', label: 'Hailuo image-to-video, standard' },
]

const PREMIUM_IMAGE_MODELS = new Set(['ideogram', 'recraft', 'imagen-4', 'gpt-image-2'])
const TEXT_ESTIMATE_INPUT_TOKENS = 4_500
const TEXT_ESTIMATE_OUTPUT_TOKENS = 1_200
const TEXT_PRICE_GUIDES = [
  { match: ['gemini', 'flash'], label: 'Gemini Flash class', inputPerMillion: 0.10, outputPerMillion: 0.40 },
  { match: ['haiku'], label: 'Claude Haiku class', inputPerMillion: 1, outputPerMillion: 5 },
  { match: ['sonnet'], label: 'Claude Sonnet class', inputPerMillion: 3, outputPerMillion: 15 },
  { match: ['opus'], label: 'Claude Opus class', inputPerMillion: 5, outputPerMillion: 25 },
]
const IMAGE_PRICE_GUIDES: Record<string, { label: string; detail: string }> = {
  'nano-banana': { label: '~$0.039 / image', detail: 'fal Nano Banana text-to-image guide.' },
  'nano-banana-2': { label: '~$0.08 / image', detail: 'fal Nano Banana 2 guide. Higher resolution can cost more.' },
  seedream: { label: '~$0.03 / image', detail: 'fal Seedream normalized image guide.' },
  'seedream-v4.5': { label: '~$0.03 / image', detail: 'Use Seedream as the cheap prototype benchmark until live pricing is normalized.' },
  'qwen-image': { label: '~$0.02 / MP', detail: 'fal Qwen guide, billed by output megapixel.' },
  'z-image-turbo': { label: 'cheap prototype tier', detail: 'Use only after provider pricing is confirmed for the selected endpoint.' },
  ideogram: { label: 'premium quote required', detail: 'Premium image route. Confirm provider price before generation.' },
  recraft: { label: 'premium quote required', detail: 'Premium image route. Confirm provider price before generation.' },
  'imagen-4': { label: 'premium quote required', detail: 'Premium Google image route. Confirm token and resolution cost before generation.' },
  'gpt-image-2': { label: 'premium token-metered', detail: 'OpenAI Image Gen 2 is premium and token-metered. Do not use as default.' },
}
const VIDEO_PRICE_GUIDES: Record<string, { label: string; detail: string; premium?: boolean }> = {
  hailuo: { label: '~$0.28 / 6s', detail: 'fal Hailuo 2.3 Standard text-to-video guide.' },
  'hailuo-i2v': { label: '~$0.27 / 6s', detail: 'fal Hailuo 02 Standard image-to-video guide at 768p.' },
  kling: { label: '~$0.25 to $0.90 / 5 to 10s', detail: 'Kling can climb quickly by tier and duration.', premium: true },
  seedance: { label: '~$0.26+ / 5s', detail: 'Seedance pricing varies by version, resolution, audio, and endpoint.', premium: true },
  veo: { label: 'premium quote required', detail: 'Veo-class video should require explicit approval.', premium: true },
}

export function isPremiumImageModel(model: string | null | undefined) {
  return !!model && PREMIUM_IMAGE_MODELS.has(model)
}

export function modelLabel(value: string | null | undefined) {
  if (!value) return ''
  const option = [
    ...IMAGE_MODEL_OPTIONS,
    ...VIDEO_MODEL_OPTIONS,
    ...IMAGE_VIDEO_MODEL_OPTIONS,
  ].find(item => item.value === value)
  if (option) return option.label.split(',')[0]
  const labels: Record<string, string> = {
    'nano-banana-2': 'Nano Banana 2',
  }
  return labels[value] ?? value
}

export function textSpendEstimate(model: string | null | undefined, provider: TextEstimateProvider): SpendEstimate {
  if (provider === 'missing') {
    return { label: 'No spend', detail: 'No paid text generation until a client key is added.' }
  }
  if (provider === 'platform') {
    return { label: 'Platform metered', detail: 'Allowed only for approved InnovareAI workspaces.' }
  }
  const raw = (model ?? '').toLowerCase()
  const guide = TEXT_PRICE_GUIDES.find(item => item.match.some(part => raw.includes(part)))
  if (!guide) {
    return {
      label: provider === 'openrouter' ? 'OpenRouter quote' : 'Anthropic quote',
      detail: 'Set a default model to show a per-draft estimate before generation.',
    }
  }
  const estimate = (TEXT_ESTIMATE_INPUT_TOKENS / 1_000_000) * guide.inputPerMillion
    + (TEXT_ESTIMATE_OUTPUT_TOKENS / 1_000_000) * guide.outputPerMillion
  return {
    label: `${money(estimate)} / draft guide`,
    detail: `${guide.label}, based on ${TEXT_ESTIMATE_INPUT_TOKENS.toLocaleString()} input and ${TEXT_ESTIMATE_OUTPUT_TOKENS.toLocaleString()} output tokens. Actual provider markup and context size vary.`,
  }
}

export function imageSpendEstimate(model: string, enabled: boolean, ready: boolean, premium: boolean): SpendEstimate {
  if (!enabled) return { label: 'No spend', detail: 'Image generation is disabled for this client space.' }
  if (!ready) return { label: 'No spend', detail: 'VERA will keep this as a prompt or production brief.' }
  const guide = IMAGE_PRICE_GUIDES[model]
  if (guide) return { label: guide.label, detail: guide.detail }
  return {
    label: premium ? 'premium quote required' : 'provider quote required',
    detail: 'This model needs normalized provider pricing before VERA can show a numeric estimate.',
  }
}

export function videoSpendEstimate(model: string, ready: boolean, premium: boolean): SpendEstimate {
  if (!ready) return { label: 'No spend', detail: 'Storyboard and prompt only until video is explicitly enabled.' }
  const guide = VIDEO_PRICE_GUIDES[model]
  if (guide) {
    return {
      label: guide.label,
      detail: guide.premium || premium ? `${guide.detail} Require approval before render.` : guide.detail,
    }
  }
  return {
    label: premium ? 'premium quote required' : 'provider quote required',
    detail: 'Video price depends on model, duration, resolution, audio, and endpoint.',
  }
}

function money(value: number) {
  if (value <= 0) return '$0'
  if (value < 0.01) return '<$0.01'
  if (value < 1) return `$${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`
  return `$${value.toFixed(2)}`
}
