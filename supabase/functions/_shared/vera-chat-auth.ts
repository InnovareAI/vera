import type { AdminClient } from "./auth.ts"

export type VeraChatMemberAccess =
  | { ok: true; userId: string; email: string | null; service: false }
  | { ok: false; response: Response }

type ChatMessageScope = {
  orgId: string
  projectId: string | null
  sessionId: string | null
  userId: string | null
  role: "user" | "assistant"
}

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function authorizeVeraChatMemberRequest(
  req: Request,
  supabase: AdminClient,
  orgId: string,
  projectId: string | null,
  serviceKey: string,
  corsHeaders: Record<string, string>,
): Promise<VeraChatMemberAccess> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const isService = !!bearer && bearer === serviceKey
  if (isService) return { ok: false, response: jsonError("User session required", 401, corsHeaders) }
  if (!bearer) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }

  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  const email = auth.user.email?.trim().toLowerCase() ?? null

  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, org_id")
      .eq("id", projectId)
      .maybeSingle()
    if (projectError) return { ok: false, response: jsonError(projectError.message, 500, corsHeaders) }
    if (!project) return { ok: false, response: jsonError("Client not found", 404, corsHeaders) }
    if ((project as { org_id: string }).org_id !== orgId) {
      return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
    }
  }

  if (projectId) {
    try {
      const allowed = await userHasVeraChatScopeAccess(supabase, auth.user.id, orgId, projectId)
      if (allowed) return { ok: true, userId: auth.user.id, email, service: false }
    } catch (error) {
      return { ok: false, response: jsonError(error instanceof Error ? error.message : "Could not verify user scope", 500, corsHeaders) }
    }
    return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  }

  const { data: orgMember, error: orgError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (orgError) return { ok: false, response: jsonError(orgError.message, 500, corsHeaders) }
  if (!orgMember) return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  return { ok: true, userId: auth.user.id, email, service: false }
}

export async function userHasVeraChatScopeAccess(
  supabase: AdminClient,
  userId: string,
  orgId: string,
  projectId: string | null,
): Promise<boolean> {
  const queries = [
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle(),
  ]
  if (projectId) {
    queries.push(supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle())
  }
  const [orgMember, projectMember] = await Promise.all(queries)
  if (orgMember.error) throw new Error(orgMember.error.message)
  if (projectMember?.error) throw new Error(projectMember.error.message)
  return !!orgMember.data || !!projectMember?.data
}

export async function resolveEffectiveVeraChatUserId(
  access: Extract<VeraChatMemberAccess, { ok: true }>,
  requestedUserId: string | null,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (!requestedUserId || requestedUserId === access.userId) return { ok: true, userId: access.userId }
  if (!isUuid(requestedUserId)) return { ok: false, response: jsonError("Invalid user_id", 400, corsHeaders) }
  return { ok: false, response: jsonError("user_id does not match authenticated user", 403, corsHeaders) }
}

export async function assertVeraChatMessageWritable(
  supabase: AdminClient,
  id: string | null,
  scope: ChatMessageScope,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!id) return { ok: true }
  if (!isUuid(id)) return { ok: false, response: jsonError("Invalid chat message id", 400, corsHeaders) }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, org_id, project_id, session_id, user_id, role")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!data) return { ok: true }

  const row = data as {
    org_id?: string | null
    project_id?: string | null
    session_id?: string | null
    user_id?: string | null
    role?: string | null
  }
  const rowUserId = row.user_id ?? null
  const sameScope =
    row.org_id === scope.orgId &&
    (row.project_id ?? null) === scope.projectId &&
    (row.session_id ?? null) === scope.sessionId &&
    row.role === scope.role
  const compatibleUser = scope.userId
    ? rowUserId === null || rowUserId === scope.userId
    : rowUserId === null
  if (sameScope && compatibleUser) return { ok: true }

  return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
}

function jsonError(message: string, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
