import type { AdminClient } from "./auth.ts"

export type UnipileResearchConnection =
  | {
      ok: true
      accountId: string
      source: "workspace" | "platform"
      detail: string
      healthStatus: string | null
      connectedAt: string | null
    }
  | { ok: false; accountId: null; source: null; error: string }

const UNUSABLE_HEALTH_STATUSES = new Set(["stale", "error", "disconnected", "revoked"])

export async function resolveUnipileResearchConnection(
  supabase: AdminClient,
  orgId: string,
  options: { requesterUserId?: string | null } = {},
): Promise<UnipileResearchConnection> {
  const { data: workspace, error: workspaceError } = await supabase
    .from("organizations")
    .select("id, name, unipile_account_id, unipile_health_status, unipile_connected_at")
    .eq("id", orgId)
    .maybeSingle()

  if (workspaceError) {
    return { ok: false, accountId: null, source: null, error: `Unipile lookup failed: ${workspaceError.message}` }
  }

  const workspaceAccountId = cleanString((workspace as { unipile_account_id?: string | null } | null)?.unipile_account_id)
  const workspaceProfile = workspace as {
    unipile_health_status?: string | null
    unipile_connected_at?: string | null
  } | null
  const workspaceHealthStatus = cleanString(workspaceProfile?.unipile_health_status)
  if (workspaceAccountId) {
    if (!isUnusableHealthStatus(workspaceHealthStatus)) {
      return {
        ok: true,
        accountId: workspaceAccountId,
        source: "workspace",
        detail: "Workspace research profile",
        healthStatus: workspaceHealthStatus,
        connectedAt: cleanString(workspaceProfile?.unipile_connected_at),
      }
    }
  }

  const requesterUserId = cleanString(options.requesterUserId)
  if (!requesterUserId) {
    return {
      ok: false,
      accountId: null,
      source: null,
      error: workspaceAccountId
        ? `Workspace LinkedIn research profile is ${workspaceHealthStatus}; reconnect it or use an InnovareAI operator account.`
        : "No workspace LinkedIn research profile is connected.",
    }
  }

  const { data: masters, error: masterError } = await supabase
    .from("organizations")
    .select("id, name, unipile_account_id, unipile_health_status, unipile_connected_at")
    .eq("is_master", true)
    .not("unipile_account_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10)

  if (masterError) {
    return { ok: false, accountId: null, source: null, error: `Shared research lookup failed: ${masterError.message}` }
  }

  const masterRows = ((masters ?? []) as Array<{
    id?: string | null
    name?: string | null
    unipile_account_id?: string | null
    unipile_health_status?: string | null
    unipile_connected_at?: string | null
  }>)
    .filter(row => cleanString(row.id) && cleanString(row.unipile_account_id))
    .filter(row => !isUnusableHealthStatus(cleanString(row.unipile_health_status)))

  if (!masterRows.length) {
    return {
      ok: false,
      accountId: null,
      source: null,
      error: "No usable shared InnovareAI LinkedIn research profile is connected.",
    }
  }

  const masterIds = masterRows.map(row => row.id as string)
  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", requesterUserId)
    .in("org_id", masterIds)
    .limit(1)
    .maybeSingle()

  if (membershipError) {
    return { ok: false, accountId: null, source: null, error: `Shared research access lookup failed: ${membershipError.message}` }
  }
  if (!membership) {
    return {
      ok: false,
      accountId: null,
      source: null,
      error: "No workspace LinkedIn research profile is connected, and this user cannot use the shared InnovareAI research profile.",
    }
  }

  const selected = masterRows.find(row => row.id === (membership as { org_id?: string | null }).org_id) ?? masterRows[0]
  const accountId = cleanString(selected.unipile_account_id)
  if (!accountId) {
    return {
      ok: false,
      accountId: null,
      source: null,
      error: "Shared InnovareAI LinkedIn research profile is missing an account id.",
    }
  }

  return {
    ok: true,
    accountId,
    source: "platform",
    detail: `Shared InnovareAI research profile${selected.name ? ` (${selected.name})` : ""}`,
    healthStatus: cleanString(selected.unipile_health_status),
    connectedAt: cleanString(selected.unipile_connected_at),
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isUnusableHealthStatus(value: string | null): boolean {
  return !!value && UNUSABLE_HEALTH_STATUSES.has(value.toLowerCase())
}
