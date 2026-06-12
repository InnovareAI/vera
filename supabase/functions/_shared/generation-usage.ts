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

  const normalizedUsage = { ...usage, provider, operation, model }
  const estimate = usage.costUsd === undefined || usage.costUsd === null
    ? await estimateGenerationUsageCostWithCatalog(supabase, normalizedUsage)
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
  confidence: "high" | "medium" | "low"
}

type PricingCatalogRow = {
  provider: string | null
  model_key: string | null
  model_match_patterns: string[] | null
  operation: string | null
  billing_unit: string | null
  input_per_million_usd: number | string | null
  output_per_million_usd: number | string | null
  unit_price_usd: number | string | null
  source: string | null
  confidence: string | null
  premium: boolean | null
  metadata: Record<string, unknown> | null
}

type PricingCatalogCache = {
  loadedAt: number
  rows: PricingCatalogRow[]
}

let pricingCatalogCache: PricingCatalogCache | null = null
const PRICING_CATALOG_CACHE_MS = 5 * 60 * 1000

export function estimateGenerationUsageCost(usage: GenerationUsageEstimateInput): GenerationCostEstimate | null {
  if (
    usage.operation === "chat.message" ||
    usage.operation === "business_context.extract" ||
    usage.operation === "knowledge.classify" ||
    usage.operation === "knowledge.synthesize" ||
    usage.operation === "campaign.plan" ||
    usage.operation.startsWith("chat.tool.") ||
    usage.operation.startsWith("audit.")
  ) return estimateTextCost(usage)
  if (usage.operation === "knowledge.embed") return estimateEmbeddingCost(usage)
  if (usage.operation === "image.generate") return estimateImageCost(usage)
  if (usage.operation === "video.submit") return estimateVideoSubmitCost(usage)
  return null
}

export async function estimateGenerationUsageCostWithCatalog(
  supabase: AdminClient,
  usage: GenerationUsageEstimateInput,
): Promise<GenerationCostEstimate | null> {
  const catalogEstimate = await estimateCatalogCost(supabase, usage)
  return catalogEstimate ?? estimateGenerationUsageCost(usage)
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

async function estimateCatalogCost(
  supabase: AdminClient,
  usage: GenerationUsageEstimateInput,
): Promise<GenerationCostEstimate | null> {
  const operation = catalogOperation(usage.operation)
  if (!operation) return null
  const rows = await loadPricingCatalog(supabase)
  if (!rows.length) return null

  const matchText = [
    usage.model,
    typeof usage.metadata?.alias === "string" ? usage.metadata.alias : "",
  ].join(" ").toLowerCase()

  const row = rows.find(item =>
    item.operation === operation &&
    pricingRowMatches(item, matchText)
  )
  if (!row) return null

  const confidence = normalizeConfidence(row.confidence)
  const source = row.source || `provider_model_pricing_${row.provider ?? "unknown"}_${row.model_key ?? "unknown"}`
  if (operation === "chat.message") {
    const input = usage.inputTokens ?? 0
    const output = usage.outputTokens ?? 0
    const inputRate = numericValue(row.input_per_million_usd)
    const outputRate = numericValue(row.output_per_million_usd)
    if ((input <= 0 && output <= 0) || inputRate === null || outputRate === null) return null
    return roundedEstimate((input / 1_000_000) * inputRate + (output / 1_000_000) * outputRate, source, confidence)
  }

  const unitPrice = numericValue(row.unit_price_usd)
  if (unitPrice === null) return null
  const units = catalogUnits(row, usage)
  if (units === null) return null
  return roundedEstimate(unitPrice * units, source, confidence)
}

async function loadPricingCatalog(supabase: AdminClient): Promise<PricingCatalogRow[]> {
  if (pricingCatalogCache && Date.now() - pricingCatalogCache.loadedAt < PRICING_CATALOG_CACHE_MS) {
    return pricingCatalogCache.rows
  }
  try {
    const client = supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: unknown) => Promise<{ data: PricingCatalogRow[] | null; error: { message?: string } | null }>
        }
      }
    }
    const { data, error } = await client
      .from("provider_model_pricing")
      .select("provider, model_key, model_match_patterns, operation, billing_unit, input_per_million_usd, output_per_million_usd, unit_price_usd, source, confidence, premium, metadata")
      .eq("active", true)
    if (error) {
      pricingCatalogCache = { loadedAt: Date.now(), rows: [] }
      return []
    }
    pricingCatalogCache = { loadedAt: Date.now(), rows: data ?? [] }
    return pricingCatalogCache.rows
  } catch {
    pricingCatalogCache = { loadedAt: Date.now(), rows: [] }
    return []
  }
}

function catalogOperation(operation: string): "chat.message" | "image.generate" | "video.submit" | null {
  if (
    operation === "chat.message" ||
    operation === "business_context.extract" ||
    operation === "knowledge.classify" ||
    operation === "knowledge.synthesize" ||
    operation === "campaign.plan" ||
    operation.startsWith("chat.tool.") ||
    operation.startsWith("audit.")
  ) return "chat.message"
  if (operation === "image.generate") return "image.generate"
  if (operation === "video.submit") return "video.submit"
  return null
}

function pricingRowMatches(row: PricingCatalogRow, matchText: string): boolean {
  const modelKey = (row.model_key ?? "").toLowerCase()
  if (modelKey && matchText.includes(modelKey)) return true
  const patterns = Array.isArray(row.model_match_patterns) ? row.model_match_patterns : []
  return patterns.some(pattern => {
    const value = pattern.toLowerCase()
    return !!value && matchText.includes(value)
  })
}

function catalogUnits(row: PricingCatalogRow, usage: GenerationUsageEstimateInput): number | null {
  const metadata = usage.metadata ?? {}
  if (row.billing_unit === "image") return positiveNumber(metadata.num_images) ?? 1
  if (row.billing_unit === "megapixel") {
    return positiveNumber(metadata.megapixels) ??
      positiveNumber(metadata.output_megapixels) ??
      positiveNumber(metadata.megapixel_count) ??
      positiveNumber(metadata.num_images) ??
      1
  }
  if (row.billing_unit === "video") {
    const duration = durationSeconds(metadata)
    const baseDuration = positiveNumber(row.metadata?.duration_seconds) ?? 6
    if (!duration || duration <= baseDuration) return 1
    return Math.ceil(duration / baseDuration)
  }
  return null
}

function durationSeconds(metadata: Record<string, unknown>): number | null {
  const direct = positiveNumber(metadata.duration_seconds)
  if (direct) return direct
  const duration = metadata.duration
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) return duration
  if (typeof duration === "string") {
    const match = duration.match(/\d+(\.\d+)?/)
    if (match) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  }
  return null
}

function numericValue(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeConfidence(value: string | null | undefined): GenerationCostEstimate["confidence"] {
  if (value === "high" || value === "medium" || value === "low") return value
  return "medium"
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
