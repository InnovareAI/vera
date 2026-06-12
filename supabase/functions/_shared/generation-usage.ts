import type { AdminClient } from "./auth.ts"
import type { Json } from "./database.types.ts"

export type GenerationUsageInput = {
  orgId: string | null
  projectId?: string | null
  postId?: string | null
  provider: string
  model: string
  operation: string
  inputTokens?: number | null
  outputTokens?: number | null
  durationMs?: number | null
  costUsd?: number | null
  metadata?: Record<string, unknown>
}

export async function logGenerationUsage(
  supabase: AdminClient,
  usage: GenerationUsageInput,
): Promise<void> {
  const provider = usage.provider.trim().toLowerCase()
  const operation = usage.operation.trim().toLowerCase()
  const model = usage.model.trim()
  if (!provider || !operation || !model) return

  const estimate = usage.costUsd === undefined || usage.costUsd === null
    ? estimateGenerationUsageCost({ ...usage, provider, operation, model })
    : null
  const metadata = sanitizeMetadata({
    ...(usage.metadata ?? {}),
    ...(estimate
      ? {
          cost_estimate_usd: estimate.costUsd,
          cost_estimate_source: estimate.source,
          cost_estimate_confidence: estimate.confidence,
        }
      : {}),
  })
  const { error } = await supabase.from("generation_log").insert({
    org_id: usage.orgId,
    project_id: usage.projectId ?? null,
    post_id: usage.postId ?? null,
    provider,
    operation,
    model_used: model,
    input_tokens: usage.inputTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    duration_ms: usage.durationMs ?? null,
    cost_usd: usage.costUsd ?? estimate?.costUsd ?? null,
    agent: "vera",
    usage_metadata: metadata,
  })
  if (error) {
    console.warn("generation usage log failed", {
      provider,
      operation,
      model,
      org_id: usage.orgId,
      project_id: usage.projectId ?? null,
      error: error.message,
    })
  }
}

export type GenerationUsageEstimateInput = Omit<GenerationUsageInput, "provider" | "operation" | "model"> & {
  provider: string
  operation: string
  model: string
}

export type GenerationCostEstimate = {
  costUsd: number
  source: string
  confidence: "high" | "medium"
}

export function estimateGenerationUsageCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  if (
    usage.operation === "chat.message" ||
    usage.operation === "business_context.extract" ||
    usage.operation === "knowledge.classify"
  ) return estimateTextCost(usage)
  if (usage.operation === "knowledge.embed") return estimateEmbeddingCost(usage)
  if (usage.operation === "image.generate") return estimateImageCost(usage)
  if (usage.operation === "video.submit") return estimateVideoSubmitCost(usage)
  return null
}

function estimateTextCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  if (inputTokens <= 0 && outputTokens <= 0) return null

  const model = usage.model.toLowerCase()
  const pricing = model.includes("haiku")
    ? { inputPerMillion: 1, outputPerMillion: 5, source: "anthropic_haiku_4_5_pricing_2026_06_12" }
    : model.includes("sonnet")
      ? { inputPerMillion: 3, outputPerMillion: 15, source: "anthropic_sonnet_4_6_pricing_2026_06_12" }
      : null
  if (!pricing) return null

  const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion
    + (outputTokens / 1_000_000) * pricing.outputPerMillion
  return roundedEstimate(costUsd, pricing.source, "high")
}

function estimateEmbeddingCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  const inputTokens = usage.inputTokens ?? 0
  if (inputTokens <= 0) return null

  const model = usage.model.toLowerCase()
  if (!model.includes("text-embedding-3-small")) return null
  return roundedEstimate(
    (inputTokens / 1_000_000) * 0.02,
    "openai_text_embedding_3_small_pricing_2026_06_12",
    "medium",
  )
}

function estimateImageCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  const metadata = usage.metadata ?? {}
  const count = positiveNumber(metadata.num_images) ?? 1
  const model = usage.model.toLowerCase()
  const alias = typeof metadata.alias === "string" ? metadata.alias.toLowerCase() : ""

  if (usage.provider === "fal") {
    if (model.includes("gemini-25-flash-image") || alias === "nano-banana") {
      return roundedEstimate(count * 0.0398, "fal_nanobanana_pricing_2026_06_12", "high")
    }
    if (model.includes("seedream/v4.5") || alias.includes("seedream-4.5") || alias.includes("seedream-v4.5")) {
      return roundedEstimate(count * 0.04, "fal_seedream_4_5_pricing_2026_06_12", "high")
    }
    if (model.includes("seedream/v4") || alias === "seedream" || alias === "seedream-v4") {
      return roundedEstimate(count * 0.03, "fal_seedream_v4_pricing_2026_06_12", "medium")
    }
  }

  return null
}

function estimateVideoSubmitCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  if (usage.provider !== "fal") return null
  const model = usage.model.toLowerCase()
  const metadata = usage.metadata ?? {}
  const alias = typeof metadata.alias === "string" ? metadata.alias.toLowerCase() : ""
  const duration = typeof metadata.duration === "string" ? metadata.duration : null
  if (!model.includes("minimax") && !alias.includes("hailuo") && !alias.includes("minimax")) return null
  return roundedEstimate(duration === "10" ? 0.56 : 0.28, "fal_hailuo_2_3_standard_pricing_2026_06_12", "high")
}

function roundedEstimate(value: number, source: string, confidence: GenerationCostEstimate["confidence"]): GenerationCostEstimate {
  return { costUsd: Math.round(value * 1_000_000) / 1_000_000, source, confidence }
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function sanitizeMetadata(metadata: Record<string, unknown>): { [key: string]: Json | undefined } {
  const out: { [key: string]: Json | undefined } = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (/key|secret|token|authorization|password/i.test(key)) continue
    out[key] = sanitizeValue(value)
  }
  return out
}

function sanitizeValue(value: unknown): Json {
  if (value === null) return null
  if (Array.isArray(value)) return value.slice(0, 25).map(sanitizeValue)
  if (typeof value === "object") {
    const out: { [key: string]: Json | undefined } = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/key|secret|token|authorization|password/i.test(key)) continue
      out[key] = sanitizeValue(item)
    }
    return out
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value
  if (typeof value === "number" || typeof value === "boolean") return value
  return String(value)
}
