import { createClient } from "npm:@supabase/supabase-js"

export type AdminClient = ReturnType<typeof createClient<any>>

export function jsonError(message: string, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

export async function requireSignedInOrService(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: boolean } | { ok: false; response: Response }> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (bearer && bearer === serviceKey) return { ok: true, userId: null, service: true }
  if (!bearer) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }

  const { data: auth, error } = await supabase.auth.getUser(bearer)
  if (error || !auth.user) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  return { ok: true, userId: auth.user.id, service: false }
}

export async function requireOrgMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  orgId: string,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok || auth.service) return auth

  const { data, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.userId)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!data) return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  return auth
}

export async function requireProjectMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  projectId: string,
  corsHeaders: Record<string, string>,
  expectedOrgId?: string | null,
): Promise<{ ok: true; userId: string | null; orgId: string; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok) return auth

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return { ok: false, response: jsonError(projectError.message, 500, corsHeaders) }
  if (!project) return { ok: false, response: jsonError("Client not found", 404, corsHeaders) }

  const orgId = (project as { org_id: string }).org_id
  if (expectedOrgId && expectedOrgId !== orgId) {
    return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  }
  if (auth.service) return { ok: true, userId: null, orgId, service: true }

  const [{ data: orgMember }, { data: projectMember }] = await Promise.all([
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", auth.userId).maybeSingle(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", auth.userId).maybeSingle(),
  ])
  if (orgMember || projectMember) return { ok: true, userId: auth.userId, orgId, service: false }
  return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
}
