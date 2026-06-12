import type { AdminClient } from "./auth.ts"
import type { Json } from "./database.types.ts"
import { estimateGenerationUsageCostWithCatalog, type GenerationUsageEstimateInput } from "./generation-usage.ts"

export type ProjectAiPolicy = {
  imagesEnabled: boolean
  standardVideoEnabled: boolean
  premiumMediaEnabled: boolean
  monthlyBudgetUsd: number | null
  defaultTextModel: string | null
  defaultImageModel: string
  defaultVideoModel: string
  defaultImageVideoModel: string
}

export const DEFAULT_AI_POLICY: ProjectAiPolicy = {
  imagesEnabled: true,
  standardVideoEnabled: false,
  premiumMediaEnabled: false,
  monthlyBudgetUsd: null,
  defaultTextModel: null,
  defaultImageModel: "nano-banana",
  defaultVideoModel: "hailuo",
  defaultImageVideoModel: "hailuo-i2v",
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
    defaultTextModel: stringValue(policy.default_text_model, DEFAULT_AI_POLICY.defaultTextModel),
    defaultImageModel: stringValue(policy.default_image_model, DEFAULT_AI_POLICY.defaultImageModel) ?? DEFAULT_AI_POLICY.defaultImageModel,
    defaultVideoModel: stringValue(policy.default_video_model, DEFAULT_AI_POLICY.defaultVideoModel) ?? DEFAULT_AI_POLICY.defaultVideoModel,
    defaultImageVideoModel: stringValue(policy.default_image_video_model, DEFAULT_AI_POLICY.defaultImageVideoModel) ?? DEFAULT_AI_POLICY.defaultImageVideoModel,
  }
}

export function paidMediaBudgetCapError(policy: ProjectAiPolicy, mediaKind: "video" | "premium_media"): string | null {
  if (policy.monthlyBudgetUsd && policy.monthlyBudgetUsd > 0) return null
  return mediaKind === "video"
    ? "Set a monthly AI budget cap before enabling client-paid video rendering."
    : "Set a monthly AI budget cap before enabling premium media models."
}

export type ProjectAiBudgetWarning = {
  level: "warn"
  code: "missing_budget_cap" | "unknown_request_cost" | "near_budget_cap" | "request_nears_budget_cap"
  message: string
  budgetUsd: number | null
  usedUsd: number
  requestedUsd: number | null
  remainingUsd: number | null
  threshold: number
}

export type ProjectAiBudgetCheck =
  | { ok: true; budgetUsd: number | null; usedUsd: number; requestedUsd: number | null; remainingUsd: number | null; warning: ProjectAiBudgetWarning | null }
  | { ok: false; budgetUsd: number; usedUsd: number; requestedUsd: number | null; remainingUsd: number; message: string }

const BUDGET_WARNING_THRESHOLD = 0.8

export async function checkProjectAiBudget(
  supabase: AdminClient,
  projectId: string,
  usage?: GenerationUsageEstimateInput,
): Promise<ProjectAiBudgetCheck> {
  const policy = await loadProjectAiPolicy(supabase, projectId)
  const budgetUsd = policy.monthlyBudgetUsd
  const requestedUsd = usage ? (await estimateGenerationUsageCostWithCatalog(supabase, usage))?.costUsd ?? null : null
  if (!budgetUsd || budgetUsd <= 0) {
    return {
      ok: true,
      budgetUsd: null,
      usedUsd: 0,
      requestedUsd,
      remainingUsd: null,
      warning: {
        level: "warn",
        code: "missing_budget_cap",
        message: requestedUsd !== null
          ? `No monthly AI budget cap is set for this client space. This request is estimated at ${formatUsd(requestedUsd)}.`
          : "No monthly AI budget cap is set for this client space, and this request cost cannot be estimated before submission.",
        budgetUsd: null,
        usedUsd: 0,
        requestedUsd,
        remainingUsd: null,
        threshold: BUDGET_WARNING_THRESHOLD,
      },
    }
  }

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

  return {
    ok: true,
    budgetUsd,
    usedUsd,
    requestedUsd,
    remainingUsd,
    warning: budgetWarning(budgetUsd, usedUsd, requestedUsd, remainingUsd),
  }
}

function budgetWarning(
  budgetUsd: number,
  usedUsd: number,
  requestedUsd: number | null,
  remainingUsd: number,
): ProjectAiBudgetWarning | null {
  const afterRequestUsd = usedUsd + (requestedUsd ?? 0)
  const usedRatio = budgetUsd > 0 ? usedUsd / budgetUsd : 0
  const afterRatio = budgetUsd > 0 ? afterRequestUsd / budgetUsd : 0
  const base = {
    level: "warn" as const,
    budgetUsd,
    usedUsd,
    requestedUsd,
    remainingUsd,
    threshold: BUDGET_WARNING_THRESHOLD,
  }

  if (requestedUsd === null) {
    return {
      ...base,
      code: "unknown_request_cost",
      message: `Could not estimate this request before submission. Current AI spend is ${formatUsd(usedUsd)} of ${formatUsd(budgetUsd)}.`,
    }
  }
  if (usedRatio >= BUDGET_WARNING_THRESHOLD) {
    return {
      ...base,
      code: "near_budget_cap",
      message: `This client space has used ${formatUsd(usedUsd)} of its ${formatUsd(budgetUsd)} monthly AI cap. Remaining: ${formatUsd(remainingUsd)}.`,
    }
  }
  if (afterRatio >= BUDGET_WARNING_THRESHOLD) {
    return {
      ...base,
      code: "request_nears_budget_cap",
      message: `This request is estimated at ${formatUsd(requestedUsd)} and will bring monthly AI spend near the ${formatUsd(budgetUsd)} cap.`,
    }
  }
  return null
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

function stringValue(value: Json | undefined, fallback: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}
