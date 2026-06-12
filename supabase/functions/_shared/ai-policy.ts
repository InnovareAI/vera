import type { AdminClient } from "./auth.ts"
import type { Json } from "./database.types.ts"
import { estimateGenerationUsageCost, type GenerationUsageEstimateInput } from "./generation-usage.ts"

export type ProjectAiPolicy = {
  imagesEnabled: boolean
  standardVideoEnabled: boolean
  premiumMediaEnabled: boolean
  monthlyBudgetUsd: number | null
}

export const DEFAULT_AI_POLICY: ProjectAiPolicy = {
  imagesEnabled: true,
  standardVideoEnabled: false,
  premiumMediaEnabled: false,
  monthlyBudgetUsd: null,
}

export async function loadProjectAiPolicy(
  supabase: AdminClient,
  projectId: string,
): Promise<ProjectAiPolicy> {
  const { data, error } = await supabase
    .from("projects")
    .select("ai_policy")
    .eq("id", projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return parseProjectAiPolicy((data as { ai_policy?: Json | null } | null)?.ai_policy)
}

export function parseProjectAiPolicy(value: Json | null | undefined): ProjectAiPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_AI_POLICY
  const policy = value as Record<string, Json | undefined>
  return {
    imagesEnabled: booleanValue(policy.images_enabled, DEFAULT_AI_POLICY.imagesEnabled),
    standardVideoEnabled: booleanValue(policy.standard_video_enabled, DEFAULT_AI_POLICY.standardVideoEnabled),
    premiumMediaEnabled: booleanValue(policy.premium_media_enabled, DEFAULT_AI_POLICY.premiumMediaEnabled),
    monthlyBudgetUsd: positiveNumberValue(policy.monthly_budget_usd),
  }
}

export type ProjectAiBudgetCheck =
  | { ok: true; budgetUsd: number | null; usedUsd: number; requestedUsd: number | null; remainingUsd: number | null }
  | { ok: false; budgetUsd: number; usedUsd: number; requestedUsd: number | null; remainingUsd: number; message: string }

export async function checkProjectAiBudget(
  supabase: AdminClient,
  projectId: string,
  usage?: GenerationUsageEstimateInput,
): Promise<ProjectAiBudgetCheck> {
  const policy = await loadProjectAiPolicy(supabase, projectId)
  const budgetUsd = policy.monthlyBudgetUsd
  const requestedUsd = usage ? estimateGenerationUsageCost(usage)?.costUsd ?? null : null
  if (!budgetUsd || budgetUsd <= 0) return { ok: true, budgetUsd: null, usedUsd: 0, requestedUsd, remainingUsd: null }

  const usedUsd = await currentMonthSpendUsd(supabase, projectId)
  const remainingUsd = Math.max(0, budgetUsd - usedUsd)
  const requestedForCheck = requestedUsd ?? 0
  if (usedUsd >= budgetUsd || usedUsd + requestedForCheck > budgetUsd) {
    const parts = [
      `AI monthly budget reached for this client space.`,
      `Budget: ${formatUsd(budgetUsd)}.`,
      `Used: ${formatUsd(usedUsd)}.`,
    ]
    if (requestedUsd !== null) parts.push(`Requested: ${formatUsd(requestedUsd)}.`)
    return {
      ok: false,
      budgetUsd,
      usedUsd,
      requestedUsd,
      remainingUsd,
      message: parts.join(" "),
    }
  }

  return { ok: true, budgetUsd, usedUsd, requestedUsd, remainingUsd }
}

async function currentMonthSpendUsd(supabase: AdminClient, projectId: string): Promise<number> {
  const since = monthStartIso()
  const { data, error } = await supabase
    .from("generation_log")
    .select("cost_usd")
    .eq("project_id", projectId)
    .gte("created_at", since)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ cost_usd?: number | string | null }>)
    .reduce((sum, row) => {
      const value = typeof row.cost_usd === "number" ? row.cost_usd : Number(row.cost_usd)
      return Number.isFinite(value) && value > 0 ? sum + value : sum
    }, 0)
}

function monthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 10 ? 2 : 4)}`
}

function booleanValue(value: Json | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function positiveNumberValue(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}
