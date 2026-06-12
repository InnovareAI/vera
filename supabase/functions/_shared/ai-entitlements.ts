import type { AdminClient } from "./auth.ts"

export type AiUserCapability =
  | "platform_fal_video"
  | "platform_premium_video"
  | "platform_fal_image"

export type AiEntitlementCheck = {
  userId: string | null | undefined
  orgId: string
  projectId: string
  capability: AiUserCapability
}

export async function hasAiUserEntitlement(
  supabase: AdminClient,
  check: AiEntitlementCheck,
): Promise<boolean> {
  const userId = cleanId(check.userId)
  if (!userId) return false

  const { data, error } = await supabase
    .from("ai_user_entitlements")
    .select("org_id, project_id, expires_at")
    .eq("user_id", userId)
    .eq("capability", check.capability)
    .eq("enabled", true)

  if (error) throw new Error(error.message)

  const now = Date.now()
  return ((data ?? []) as Array<{ org_id?: string | null; project_id?: string | null; expires_at?: string | null }>)
    .some(row => {
      if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false
      if (row.project_id) return row.project_id === check.projectId
      if (row.org_id) return row.org_id === check.orgId
      return true
    })
}

export async function userCanAccessProject(
  supabase: AdminClient,
  userId: string | null | undefined,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  const cleanUserId = cleanId(userId)
  if (!cleanUserId) return false

  const [{ data: orgMember, error: orgError }, { data: projectMember, error: projectError }] = await Promise.all([
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", cleanUserId).maybeSingle(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", cleanUserId).maybeSingle(),
  ])
  if (orgError) throw new Error(orgError.message)
  if (projectError) throw new Error(projectError.message)
  return !!orgMember || !!projectMember
}

function cleanId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}
