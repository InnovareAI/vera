export type ModelSelectionSource =
  | "explicit"
  | "policy_default"
  | "recommended_standard"
  | "fallback"

export type ModelSelection = {
  alias: string
  source: ModelSelectionSource
  reason: string
}

export type ImageModelAvailability = {
  hasOpenRouter: boolean
  hasOpenAI: boolean
  hasFal: boolean
  platformOpenRouterAvailable?: boolean
}

const OPENROUTER_IMAGE_ALIASES = new Set([
  "nano-banana",
  "nano-banana-2",
  "nano-banana-pro",
])

const OPENAI_IMAGE_ALIASES = new Set([
  "gpt-image",
  "gpt-image-2",
])

const FAL_IMAGE_ALIASES = new Set([
  "nano-banana",
  "seedream",
  "seedream-v4",
  "seedream-4.5",
  "seedream-v4.5",
  "seedream-5-lite",
  "seedream-v5-lite",
  "flux-pro",
  "flux-1.1-pro",
  "qwen",
  "qwen-image",
  "qwen-image-2",
  "qwen-image-2-pro",
  "z-image-turbo",
  "gpt-image-2-fal",
  "ideogram",
  "ideogram-3",
  "recraft",
  "recraft-v3",
  "imagen",
  "imagen-4",
])

const PREMIUM_IMAGE_ALIASES = new Set([
  "gpt-image",
  "gpt-image-2",
  "gpt-image-2-fal",
  "imagen",
  "imagen-4",
  "ideogram",
  "ideogram-3",
  "recraft",
  "recraft-v3",
])

const STANDARD_IMAGE_CANDIDATES = [
  "nano-banana",
  "seedream",
  "qwen-image",
  "z-image-turbo",
]

const STANDARD_TEXT_VIDEO_ALIASES = new Set([
  "hailuo",
  "hailuo-2.3",
  "hailuo-standard",
  "minimax",
])

const STANDARD_IMAGE_VIDEO_ALIASES = new Set([
  "hailuo-i2v",
  "hailuo-2.3-i2v",
  "minimax-i2v",
])

export function selectImageModel(input: {
  requestedModel: unknown
  defaultImageModel: string | null | undefined
  availability: ImageModelAvailability
}): ModelSelection {
  const explicit = cleanAlias(input.requestedModel)
  if (explicit) {
    return {
      alias: explicit,
      source: "explicit",
      reason: "Operator explicitly requested this image model.",
    }
  }

  const policyDefault = cleanAlias(input.defaultImageModel)
  if (
    policyDefault &&
    !isPremiumImageAlias(policyDefault) &&
    imageAliasCanRoute(policyDefault, input.availability)
  ) {
    return {
      alias: policyDefault,
      source: "policy_default",
      reason: "Using the client policy default because it is standard and matches an available image route.",
    }
  }

  const recommended = STANDARD_IMAGE_CANDIDATES.find(alias =>
    imageAliasCanRoute(alias, input.availability)
  )
  if (recommended) {
    return {
      alias: recommended,
      source: "recommended_standard",
      reason: policyDefault && isPremiumImageAlias(policyDefault)
        ? "Policy default is premium, so Vera selected a standard prototype model before paid generation."
        : "Policy default does not match the active keys, so Vera selected a standard model that can run.",
    }
  }

  return {
    alias: policyDefault || "nano-banana",
    source: "fallback",
    reason: "No routeable standard image model was found. The generation endpoint will return the specific key or policy error.",
  }
}

export function selectVideoModel(input: {
  requestedModel: unknown
  defaultTextVideoModel: string | null | undefined
  defaultImageVideoModel: string | null | undefined
  hasSourceImage: boolean
}): ModelSelection {
  const explicit = cleanAlias(input.requestedModel)
  if (explicit) {
    return {
      alias: explicit,
      source: "explicit",
      reason: "Operator explicitly requested this video model.",
    }
  }

  const policyDefault = cleanAlias(input.hasSourceImage ? input.defaultImageVideoModel : input.defaultTextVideoModel)
  const standardSet = input.hasSourceImage ? STANDARD_IMAGE_VIDEO_ALIASES : STANDARD_TEXT_VIDEO_ALIASES
  if (policyDefault && standardSet.has(policyDefault)) {
    return {
      alias: policyDefault,
      source: "policy_default",
      reason: "Using the client policy default because it is a standard video model for this request type.",
    }
  }

  return {
    alias: input.hasSourceImage ? "hailuo-i2v" : "hailuo",
    source: "recommended_standard",
    reason: policyDefault
      ? "Policy default is premium or incompatible, so Vera selected the standard storyboard-approved video model."
      : "No policy default was set, so Vera selected the standard storyboard-approved video model.",
  }
}

function imageAliasCanRoute(alias: string, availability: ImageModelAvailability): boolean {
  if (OPENAI_IMAGE_ALIASES.has(alias)) return availability.hasOpenAI
  if (FAL_IMAGE_ALIASES.has(alias) && availability.hasFal) return true
  if (OPENROUTER_IMAGE_ALIASES.has(alias)) {
    return availability.hasOpenRouter || availability.platformOpenRouterAvailable === true
  }
  return false
}

function isPremiumImageAlias(alias: string): boolean {
  return PREMIUM_IMAGE_ALIASES.has(alias) || alias.includes("gpt-image-2") || alias.includes("/gpt-image-2")
}

function cleanAlias(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null
}
