import type { AdminClient } from "./auth.ts"
import type { Json } from "./database.types.ts"

export type ProjectAiPolicy = {
  imagesEnabled: boolean
  standardVideoEnabled: boolean
  premiumMediaEnabled: boolean
}

export const DEFAULT_AI_POLICY: ProjectAiPolicy = {
  imagesEnabled: true,
  standardVideoEnabled: false,
  premiumMediaEnabled: false,
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
  }
}

function booleanValue(value: Json | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}
