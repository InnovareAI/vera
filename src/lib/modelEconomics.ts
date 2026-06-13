export type TextEstimateProvider = 'openrouter' | 'anthropic' | 'platform' | 'missing'

export type SpendEstimate = {
  label: string
  detail: string
}

export type ImageRouteProvider = 'openrouter' | 'openai' | 'fal'

export type ImageProviderAvailability = {
  hasOpenRouter?: boolean
  hasOpenAI?: boolean
  hasFal?: boolean
}

export type ModelPricingGuide = {
  provider: string
  modelKey: string
  modelMatchPatterns: string[]
  operation: 'chat.message' | 'image.generate' | 'video.submit'
  billingUnit: 'token' | 'image' | 'megapixel' | 'video' | 'quote'
  inputPerMillionUsd: number | null
  outputPerMillionUsd: number | null
  unitPriceUsd: number | null
  estimateLabel: string
  estimateDetail: string
  source: string
  sourceUrl: string | null
  confidence: 'high' | 'medium' | 'low'
  premium: boolean
  reviewedOn: string
}

export type ProviderModelPricingRow = {
  provider?: string | null
  model_key?: string | null
  model_match_patterns?: string[] | null
  operation?: string | null
  billing_unit?: string | null
  input_per_million_usd?: number | string | null
  output_per_million_usd?: number | string | null
  unit_price_usd?: number | string | null
  estimate_label?: string | null
  estimate_detail?: string | null
  source?: string | null
  source_url?: string | null
  confidence?: string | null
  premium?: boolean | null
  reviewed_on?: string | null
}

export type ModelOption = {
  value: string
  label: string
}

export type ModelRecommendationInput = {
  textReady: boolean
  imageReady: boolean
  videoReady: boolean
  hasOpenRouter: boolean
  hasAnthropic: boolean
  hasOpenAI: boolean
  hasFal: boolean
  imagesEnabled: boolean
  standardVideoEnabled: boolean
  premiumMediaEnabled: boolean
  defaultTextModel: string | null
  defaultImageModel: string
  defaultVideoModel: string
  defaultImageVideoModel: string
  monthlyBudgetUsd: number | null
}

export type ModelRecommendation = {
  role: 'Text' | 'Image' | 'Video'
  task: string
  model: string
  provider: string
  status: string
  estimate: SpendEstimate
  reason: string
  escalation: string
  tone: 'success' | 'warn' | 'danger' | 'info'
  requiresApproval: boolean
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
const OPENROUTER_IMAGE_MODELS = new Set(['nano-banana', 'nano-banana-2', 'nano-banana-pro'])
const OPENAI_IMAGE_MODELS = new Set(['gpt-image', 'gpt-image-2'])
const FAL_IMAGE_MODELS = new Set([
  'nano-banana',
  'seedream',
  'seedream-v4',
  'seedream-4.5',
  'seedream-v4.5',
  'seedream-5-lite',
  'seedream-v5-lite',
  'qwen',
  'qwen-image',
  'qwen-image-2',
  'qwen-image-2-pro',
  'z-image-turbo',
  'flux-pro',
  'flux-1.1-pro',
  'ideogram',
  'ideogram-3',
  'recraft',
  'recraft-v3',
  'imagen',
  'imagen-4',
])
const TEXT_ESTIMATE_INPUT_TOKENS = 4_500
const TEXT_ESTIMATE_OUTPUT_TOKENS = 1_200
const DEFAULT_PRICING_CATALOG: ModelPricingGuide[] = [
  textGuide('google', 'gemini-flash-class', ['gemini', 'flash'], 0.10, 0.40, 'Gemini Flash class', 'Low-cost Gemini-class text routing guide. Actual provider markup and selected model can vary.', 'medium'),
  textGuide('anthropic', 'claude-haiku-class', ['haiku'], 1, 5, 'Claude Haiku class', 'Low-cost Claude text route for simple drafting and classification.', 'high'),
  textGuide('anthropic', 'claude-sonnet-class', ['sonnet'], 3, 15, 'Claude Sonnet class', 'Higher-quality Claude text route for strategy, copy judgment, and complex reasoning.', 'high'),
  textGuide('anthropic', 'claude-opus-class', ['opus'], 5, 25, 'Claude Opus class', 'Premium Claude text route. Use only when task complexity justifies the cost.', 'high', true),
  unitGuide('fal', 'nano-banana', ['nano-banana', 'gemini-25-flash-image'], 'image.generate', 'image', 0.039, '~$0.039 / image', 'fal Nano Banana text-to-image guide.', 'high'),
  unitGuide('fal', 'nano-banana-2', ['nano-banana-2'], 'image.generate', 'image', 0.08, '~$0.08 / image', 'fal Nano Banana 2 guide. Higher resolution can cost more.', 'high'),
  unitGuide('fal', 'seedream', ['seedream', 'seedream-v4'], 'image.generate', 'image', 0.03, '~$0.03 / image', 'fal Seedream normalized image guide.', 'medium'),
  unitGuide('fal', 'seedream-v4.5', ['seedream-v4.5', 'seedream-4.5'], 'image.generate', 'image', 0.03, '~$0.03 / image', 'Use Seedream as the cheap prototype benchmark until live pricing is normalized.', 'medium'),
  unitGuide('fal', 'qwen-image', ['qwen-image', 'qwen'], 'image.generate', 'megapixel', 0.02, '~$0.02 / MP', 'fal Qwen guide, billed by output megapixel.', 'medium'),
  quoteGuide('z-image-turbo', 'image.generate', 'cheap prototype tier', 'Use only after provider pricing is confirmed for the selected endpoint.'),
  quoteGuide('ideogram', 'image.generate', 'premium quote required', 'Premium image route. Confirm provider price before generation.', true),
  quoteGuide('recraft', 'image.generate', 'premium quote required', 'Premium image route. Confirm provider price before generation.', true),
  quoteGuide('imagen-4', 'image.generate', 'premium quote required', 'Premium Google image route. Confirm token and resolution cost before generation.', true),
  quoteGuide('gpt-image-2', 'image.generate', 'premium token-metered', 'OpenAI Image Gen 2 is premium and token-metered. Do not use as default.', true),
  unitGuide('fal', 'hailuo', ['hailuo', 'minimax'], 'video.submit', 'video', 0.28, '~$0.28 / 6s', 'fal Hailuo 2.3 Standard text-to-video guide.', 'high'),
  unitGuide('fal', 'hailuo-i2v', ['hailuo-i2v', 'hailuo image-to-video', 'minimax image-to-video'], 'video.submit', 'video', 0.27, '~$0.27 / 6s', 'fal Hailuo 02 Standard image-to-video guide at 768p.', 'high'),
  unitGuide('fal', 'kling', ['kling'], 'video.submit', 'video', 0.25, '~$0.25 to $0.90 / 5 to 10s', 'Kling can climb quickly by tier and duration. Require approval before render.', 'medium', true),
  unitGuide('fal', 'seedance', ['seedance'], 'video.submit', 'video', 0.26, '~$0.26+ / 5s', 'Seedance pricing varies by version, resolution, audio, and endpoint. Require approval before render.', 'medium', true),
  quoteGuide('veo', 'video.submit', 'premium quote required', 'Veo-class video should require explicit approval.', true),
]

export function isPremiumImageModel(model: string | null | undefined) {
  return !!model && PREMIUM_IMAGE_MODELS.has(model)
}

export function imageModelProvider(model: string | null | undefined, availability: ImageProviderAvailability): ImageRouteProvider | null {
  const alias = modelAlias(model)
  if (!alias) return null
  if (OPENAI_IMAGE_MODELS.has(alias) && availability.hasOpenAI) return 'openai'
  if (FAL_IMAGE_MODELS.has(alias) && availability.hasFal) return 'fal'
  if (OPENROUTER_IMAGE_MODELS.has(alias) && availability.hasOpenRouter) return 'openrouter'
  return null
}

export function imageModelProviderLabel(provider: ImageRouteProvider | null | undefined) {
  if (provider === 'openrouter') return 'Space OpenRouter'
  if (provider === 'openai') return 'Space OpenAI'
  if (provider === 'fal') return 'Space FAL'
  return 'No matching key'
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
    'nano-banana-pro': 'Nano Banana Pro',
    'gemini-flash-class': 'Gemini Flash class',
    'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
    'google/gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
    'claude-haiku-class': 'Claude Haiku class',
    'claude-sonnet-class': 'Claude Sonnet class',
    'qwen-image': 'Qwen Image',
    'z-image-turbo': 'Z-Image Turbo',
    'seedream-v4.5': 'Seedream v4.5',
    'hailuo': 'Hailuo',
    'hailuo-i2v': 'Hailuo I2V',
  }
  return labels[value] ?? value
}

export function normalizePricingCatalogRows(rows: ProviderModelPricingRow[] | null | undefined): ModelPricingGuide[] {
  if (!rows?.length) return []
  return rows
    .map(row => {
      const operation = normalizeOperation(row.operation)
      const billingUnit = normalizeBillingUnit(row.billing_unit)
      const provider = stringValue(row.provider)
      const modelKey = stringValue(row.model_key)
      const estimateLabel = stringValue(row.estimate_label)
      const estimateDetail = stringValue(row.estimate_detail)
      const reviewedOn = stringValue(row.reviewed_on)
      if (!provider || !modelKey || !operation || !billingUnit || !estimateLabel || !estimateDetail || !reviewedOn) return null
      return {
        provider,
        modelKey,
        modelMatchPatterns: Array.isArray(row.model_match_patterns) ? row.model_match_patterns.filter(Boolean) : [],
        operation,
        billingUnit,
        inputPerMillionUsd: numericValue(row.input_per_million_usd),
        outputPerMillionUsd: numericValue(row.output_per_million_usd),
        unitPriceUsd: numericValue(row.unit_price_usd),
        estimateLabel,
        estimateDetail,
        source: stringValue(row.source) || 'provider_model_pricing',
        sourceUrl: stringValue(row.source_url) || null,
        confidence: normalizeConfidence(row.confidence),
        premium: row.premium === true,
        reviewedOn,
      } satisfies ModelPricingGuide
    })
    .filter((row): row is ModelPricingGuide => !!row)
}

export function latestPricingReviewDate(catalog?: ModelPricingGuide[]) {
  const dates = pricingCatalog(catalog).map(item => item.reviewedOn).filter(Boolean).sort()
  return dates[dates.length - 1] ?? MODEL_PRICE_GUIDE_LAST_REVIEWED
}

export function textSpendEstimate(model: string | null | undefined, provider: TextEstimateProvider, catalog?: ModelPricingGuide[]): SpendEstimate {
  if (provider === 'missing') {
    return { label: 'No spend', detail: 'No paid text generation until a space key is added.' }
  }
  if (provider === 'platform') {
    return { label: 'Platform metered', detail: 'Allowed only for approved InnovareAI workspaces.' }
  }
  const guide = findPricingGuide(pricingCatalog(catalog), 'chat.message', model)
  if (!guide) {
    return {
      label: provider === 'openrouter' ? 'OpenRouter quote' : 'Anthropic quote',
      detail: 'Set a default model to show a per-draft estimate before generation.',
    }
  }
  if (guide.inputPerMillionUsd === null || guide.outputPerMillionUsd === null) {
    return { label: guide.estimateLabel, detail: guide.estimateDetail }
  }
  const estimate = (TEXT_ESTIMATE_INPUT_TOKENS / 1_000_000) * guide.inputPerMillionUsd
    + (TEXT_ESTIMATE_OUTPUT_TOKENS / 1_000_000) * guide.outputPerMillionUsd
  return {
    label: `${money(estimate)} / draft guide`,
    detail: `${guide.estimateLabel}, based on ${TEXT_ESTIMATE_INPUT_TOKENS.toLocaleString()} input and ${TEXT_ESTIMATE_OUTPUT_TOKENS.toLocaleString()} output tokens. Actual provider markup and context size vary.`,
  }
}

export function imageSpendEstimate(model: string, enabled: boolean, ready: boolean, premium: boolean, catalog?: ModelPricingGuide[]): SpendEstimate {
  if (!enabled) return { label: 'No spend', detail: 'Image generation is disabled for this space.' }
  if (!ready) return { label: 'No spend', detail: 'VERA will keep this as a prompt or production brief.' }
  const guide = findPricingGuide(pricingCatalog(catalog), 'image.generate', model)
  if (guide) return { label: guide.estimateLabel, detail: guide.estimateDetail }
  return {
    label: premium ? 'premium quote required' : 'provider quote required',
    detail: 'This model needs normalized provider pricing before VERA can show a numeric estimate.',
  }
}

export function videoSpendEstimate(model: string, ready: boolean, premium: boolean, catalog?: ModelPricingGuide[]): SpendEstimate {
  if (!ready) return { label: 'No spend', detail: 'Storyboard and prompt only until video is explicitly enabled.' }
  const guide = findPricingGuide(pricingCatalog(catalog), 'video.submit', model)
  if (guide) {
    return {
      label: guide.estimateLabel,
      detail: guide.premium || premium ? ensureApprovalDetail(guide.estimateDetail) : guide.estimateDetail,
    }
  }
  return {
    label: premium ? 'premium quote required' : 'provider quote required',
    detail: 'Video price depends on model, duration, resolution, audio, and endpoint.',
  }
}

export function buildModelRecommendations(input: ModelRecommendationInput, catalog?: ModelPricingGuide[]): ModelRecommendation[] {
  const textProvider = !input.textReady
    ? 'missing'
    : input.hasOpenRouter
      ? 'openrouter'
      : input.hasAnthropic
        ? 'anthropic'
        : 'platform'
  const recommendedTextModel = input.defaultTextModel
    || (input.hasOpenRouter ? 'google/gemini-2.5-flash' : input.hasAnthropic ? 'claude-haiku-class' : 'gemini-flash-class')
  const defaultImagePremium = isPremiumImageModel(input.defaultImageModel)
  const recommendedImageModel = !defaultImagePremium ? input.defaultImageModel : 'nano-banana'
  const imageProvider = imageModelProvider(recommendedImageModel, input)
  const textRecommendation: ModelRecommendation = !input.textReady
    ? {
        role: 'Text',
        task: 'High-volume content drafts',
        model: 'Gemini Flash class',
        provider: 'Space key required',
        status: 'Locked',
        estimate: textSpendEstimate(input.defaultTextModel, 'missing', catalog),
        reason: 'Text generation should not run on platform spend for this space.',
        escalation: 'Add space OpenRouter first. Use Anthropic only when this space prefers that provider.',
        tone: 'danger',
        requiresApproval: false,
      }
    : {
        role: 'Text',
        task: 'High-volume content drafts',
        model: modelLabel(recommendedTextModel),
        provider: textProvider === 'openrouter' ? 'Space OpenRouter' : textProvider === 'anthropic' ? 'Space Anthropic' : 'Platform approved',
        status: textProvider === 'platform' ? 'Operator only' : 'Recommended',
        estimate: textSpendEstimate(recommendedTextModel, textProvider, catalog),
        reason: textProvider === 'openrouter'
          ? 'Gemini Flash class is the default recommendation for inexpensive drafts, rewrites, variants, summaries, and non-critical content planning.'
          : 'Use the available space text provider and keep the model visible before generation.',
        escalation: 'Use Sonnet-class reasoning for positioning, final copy judgment, synthesis across sources, or high-stakes strategy.',
        tone: textProvider === 'platform' ? 'warn' : 'success',
        requiresApproval: textProvider === 'platform',
      }

  const imageRecommendation: ModelRecommendation = !input.imagesEnabled
    ? {
        role: 'Image',
        task: 'Visual prototypes',
        model: modelLabel(recommendedImageModel),
        provider: 'Policy locked',
        status: 'Prompt only',
        estimate: imageSpendEstimate(recommendedImageModel, false, false, false, catalog),
        reason: 'Image generation is disabled for this space.',
        escalation: 'Keep output as prompts, storyboards, or production briefs until the space enables images.',
        tone: 'info',
        requiresApproval: false,
      }
    : !input.imageReady
      ? {
          role: 'Image',
          task: 'Visual prototypes',
          model: modelLabel(recommendedImageModel),
          provider: imageModelProviderLabel(imageProvider),
          status: 'Locked',
          estimate: imageSpendEstimate(recommendedImageModel, true, false, false, catalog),
          reason: `${modelLabel(recommendedImageModel)} needs a matching space image route. OpenAI keys only cover OpenAI image models.`,
          escalation: 'Add space OpenRouter for Nano Banana, or space FAL for Seedream, Qwen, Ideogram, Recraft, Imagen, and other FAL-routed models.',
          tone: 'danger',
          requiresApproval: false,
        }
      : {
          role: 'Image',
          task: 'Visual prototypes',
          model: modelLabel(recommendedImageModel),
          provider: imageProvider ? imageModelProviderLabel(imageProvider) : 'Platform media',
          status: defaultImagePremium ? 'Safer fallback' : 'Recommended',
          estimate: imageSpendEstimate(recommendedImageModel, true, true, false, catalog),
          reason: imageProvider
            ? 'Nano Banana should remain the default for strong text-in-image, editing, and fast content prototypes. Seedream is the bulk alternate when FAL is available.'
            : 'Approved platform media can support operator-only image work, but normal work should still move to space-owned keys.',
          escalation: 'Use OpenAI Image Gen 2, Imagen, Ideogram, or Recraft only for approved premium production needs.',
          tone: defaultImagePremium ? 'warn' : 'success',
          requiresApproval: false,
        }

  const videoRecommendation: ModelRecommendation = !input.videoReady
    ? {
        role: 'Video',
        task: 'Storyboards before renders',
        model: 'Storyboard only',
        provider: input.hasFal ? 'Space FAL policy locked' : 'Space FAL required',
        status: 'No render',
        estimate: videoSpendEstimate(input.defaultVideoModel, false, false, catalog),
        reason: 'Video is the cost sink. Vera should storyboard, frame, prompt, and estimate before any real clip is rendered.',
        escalation: 'Enable standard video only with a space FAL key and a monthly cap.',
        tone: 'warn',
        requiresApproval: false,
      }
    : {
        role: 'Video',
        task: 'Approved prototype clip',
        model: `${modelLabel(input.defaultVideoModel)} / ${modelLabel(input.defaultImageVideoModel)}`,
        provider: input.hasFal ? 'Space FAL' : 'Platform approved',
        status: input.premiumMediaEnabled ? 'Approval gated' : 'Recommended',
        estimate: videoSpendEstimate(input.defaultVideoModel, true, input.premiumMediaEnabled, catalog),
        reason: 'Use Hailuo-class standard video for prototypes after storyboard approval. Do not default to Kling or other premium models.',
        escalation: 'Kling, Veo, Sora, and Seedance need explicit premium approval, budget visibility, and a clear production reason.',
        tone: input.premiumMediaEnabled ? 'warn' : 'success',
        requiresApproval: true,
      }

  return [textRecommendation, imageRecommendation, videoRecommendation]
}

function money(value: number) {
  if (value <= 0) return '$0'
  if (value < 0.01) return '<$0.01'
  if (value < 1) return `$${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`
  return `$${value.toFixed(2)}`
}

function textGuide(provider: string, modelKey: string, patterns: string[], input: number, output: number, label: string, detail: string, confidence: ModelPricingGuide['confidence'], premium = false): ModelPricingGuide {
  return {
    provider,
    modelKey,
    modelMatchPatterns: patterns,
    operation: 'chat.message',
    billingUnit: 'token',
    inputPerMillionUsd: input,
    outputPerMillionUsd: output,
    unitPriceUsd: null,
    estimateLabel: label,
    estimateDetail: detail,
    source: `${provider}_${modelKey}_fallback_${MODEL_PRICE_GUIDE_LAST_REVIEWED}`,
    sourceUrl: null,
    confidence,
    premium,
    reviewedOn: MODEL_PRICE_GUIDE_LAST_REVIEWED,
  }
}

function unitGuide(provider: string, modelKey: string, patterns: string[], operation: ModelPricingGuide['operation'], unit: ModelPricingGuide['billingUnit'], price: number, label: string, detail: string, confidence: ModelPricingGuide['confidence'], premium = false): ModelPricingGuide {
  return {
    provider,
    modelKey,
    modelMatchPatterns: patterns,
    operation,
    billingUnit: unit,
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    unitPriceUsd: price,
    estimateLabel: label,
    estimateDetail: detail,
    source: `${provider}_${modelKey}_fallback_${MODEL_PRICE_GUIDE_LAST_REVIEWED}`,
    sourceUrl: null,
    confidence,
    premium,
    reviewedOn: MODEL_PRICE_GUIDE_LAST_REVIEWED,
  }
}

function quoteGuide(modelKey: string, operation: ModelPricingGuide['operation'], label: string, detail: string, premium = false): ModelPricingGuide {
  return unitGuide('manual', modelKey, [modelKey], operation, 'quote', 0, label, detail, 'low', premium)
}

function pricingCatalog(catalog?: ModelPricingGuide[]) {
  return catalog?.length ? catalog : DEFAULT_PRICING_CATALOG
}

function findPricingGuide(catalog: ModelPricingGuide[], operation: ModelPricingGuide['operation'], model: string | null | undefined) {
  const raw = (model ?? '').toLowerCase()
  if (!raw) return null
  return catalog.find(item => item.operation === operation && (
    item.modelKey.toLowerCase() === raw ||
    item.modelMatchPatterns.some(pattern => raw.includes(pattern.toLowerCase()))
  )) ?? null
}

function normalizeOperation(value: string | null | undefined): ModelPricingGuide['operation'] | null {
  if (value === 'chat.message' || value === 'image.generate' || value === 'video.submit') return value
  return null
}

function normalizeBillingUnit(value: string | null | undefined): ModelPricingGuide['billingUnit'] | null {
  if (value === 'token' || value === 'image' || value === 'megapixel' || value === 'video' || value === 'quote') return value
  return null
}

function normalizeConfidence(value: string | null | undefined): ModelPricingGuide['confidence'] {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

function numericValue(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function modelAlias(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : ''
}

function ensureApprovalDetail(detail: string) {
  return /approval before render/i.test(detail) ? detail : `${detail} Require approval before render.`
}
