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

  const metadata = sanitizeMetadata(usage.metadata ?? {})
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
    cost_usd: usage.costUsd ?? null,
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
