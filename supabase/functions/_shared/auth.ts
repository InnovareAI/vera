import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js"
import type { Database } from "./database.types.ts"

export type AdminClient = SupabaseClient<Database>

export function createAdminClient(url: string, serviceKey: string): AdminClient {
  return createClient<Database>(url, serviceKey)
}

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
): Promise<{ ok: true; userId: string | null; email: string | null; service: boolean } | { ok: false; response: Response }> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (bearer && bearer === serviceKey) return { ok: true, userId: null, email: null, service: true }
  if (!bearer) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }

  const { data: auth, error } = await supabase.auth.getUser(bearer)
  if (error || !auth.user) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  return { ok: true, userId: auth.user.id, email: auth.user.email?.trim().toLowerCase() ?? null, service: false }
}

export async function requireOrgMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  orgId: string,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; email: string | null; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok || auth.service) return auth
  if (!auth.userId) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  const userId = auth.userId

  const { data, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!data) return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  return { ok: true, userId, email: auth.email, service: false }
}

export async function requireProjectMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  projectId: string,
  corsHeaders: Record<string, string>,
  expectedOrgId?: string | null,
): Promise<{ ok: true; userId: string | null; email: string | null; orgId: string; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok) return auth

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return { ok: false, response: jsonError(projectError.message, 500, corsHeaders) }
  if (!project) return { ok: false, response: jsonError("Space not found", 404, corsHeaders) }

  const orgId = (project as { org_id: string }).org_id
  if (expectedOrgId && expectedOrgId !== orgId) {
    return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
  }
  if (auth.service) return { ok: true, userId: null, email: null, orgId, service: true }
  if (!auth.userId) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  const userId = auth.userId

  const [{ data: orgMember }, { data: projectMember }] = await Promise.all([
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
  ])
  if (orgMember || projectMember) return { ok: true, userId, email: auth.email, orgId, service: false }
  return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
}

export async function requirePostMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  postId: string | null | undefined,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok || auth.service || !postId) return auth

  const { data: post, error } = await supabase
    .from("content_posts")
    .select("id, org_id, project_id")
    .eq("id", postId)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!post) return { ok: false, response: jsonError("Post not found", 404, corsHeaders) }

  return await requireOrgProjectMember(
    supabase,
    auth.userId,
    (post as { org_id: string }).org_id,
    ((post as { project_id?: string | null }).project_id ?? null),
    corsHeaders,
  )
}

export async function requirePublisherActionAccess(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok || auth.service) return auth

  if (body.action === "connect") {
    const orgId = typeof body.org_id === "string" ? body.org_id : null
    if (!orgId) return auth
    const projectId = publisherClientProjectId(body)
    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, org_id")
        .eq("id", projectId)
        .maybeSingle()
      if (projectError) return { ok: false, response: jsonError(projectError.message, 500, corsHeaders) }
      if (!project) return { ok: false, response: jsonError("Space not found", 404, corsHeaders) }
      if ((project as { org_id: string }).org_id !== orgId) return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
    }
    if (projectId) {
      return await requireOrgProjectManager(supabase, auth.userId, orgId, projectId, corsHeaders)
    }
    return await requireOrgProjectMember(supabase, auth.userId, orgId, null, corsHeaders)
  }

  const publisherId = typeof body.publisher_id === "string" ? body.publisher_id : null
  if (!publisherId) return auth
  const { data: publisher, error } = await supabase
    .from("publishers")
    .select("id, org_id, project_id")
    .eq("id", publisherId)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!publisher) return { ok: false, response: jsonError("Publisher not found", 404, corsHeaders) }

  const publisherRow = publisher as { org_id: string; project_id?: string | null }
  const publisherOrgId = publisherRow.org_id
  const publisherProjectId = publisherRow.project_id ?? null
  const postId = typeof body.post_id === "string" ? body.post_id : null
  if (postId) {
    const { data: post, error: postError } = await supabase
      .from("content_posts")
      .select("id, org_id, project_id")
      .eq("id", postId)
      .maybeSingle()
    if (postError) return { ok: false, response: jsonError(postError.message, 500, corsHeaders) }
    if (!post) return { ok: false, response: jsonError("Post not found", 404, corsHeaders) }
    const postRow = post as { org_id: string; project_id?: string | null }
    if (postRow.org_id !== publisherOrgId) return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
    const postProjectId = postRow.project_id ?? null
    if (postProjectId && publisherProjectId !== postProjectId) {
      return { ok: false, response: jsonError("Publisher is not connected to this space", 403, corsHeaders) }
    }
    if (!postProjectId && publisherProjectId) {
      return { ok: false, response: jsonError("Publisher is space-scoped and cannot publish workspace-level posts", 403, corsHeaders) }
    }
    return await requireOrgProjectMember(supabase, auth.userId, publisherOrgId, postRow.project_id ?? null, corsHeaders)
  }

  return await requireOrgProjectMember(supabase, auth.userId, publisherOrgId, publisherProjectId, corsHeaders)
}

export function publisherClientProjectId(body: Record<string, unknown>): string | null {
  const direct = typeof body.client_project_id === "string" ? body.client_project_id.trim() : ""
  if (direct) return direct

  const nested = body.client && typeof body.client === "object"
    ? (body.client as Record<string, unknown>)
    : null
  const nestedId = nested && typeof nested.project_id === "string" ? nested.project_id.trim() : ""
  return nestedId || null
}

export async function requireObservationMember(
  req: Request,
  supabase: AdminClient,
  serviceKey: string,
  observationId: string | null | undefined,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: boolean } | { ok: false; response: Response }> {
  const auth = await requireSignedInOrService(req, supabase, serviceKey, corsHeaders)
  if (!auth.ok || auth.service || !observationId) return auth

  const { data: observation, error } = await supabase
    .from("agent_observations")
    .select("id, org_id, project_id")
    .eq("id", observationId)
    .maybeSingle()
  if (error) return { ok: false, response: jsonError(error.message, 500, corsHeaders) }
  if (!observation) return { ok: false, response: jsonError("Observation not found", 404, corsHeaders) }

  return await requireOrgProjectMember(
    supabase,
    auth.userId,
    (observation as { org_id: string }).org_id,
    ((observation as { project_id?: string | null }).project_id ?? null),
    corsHeaders,
  )
}

async function requireOrgProjectMember(
  supabase: AdminClient,
  userId: string | null,
  orgId: string,
  projectId: string | null,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: false } | { ok: false; response: Response }> {
  if (!userId) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }
  const queries = [
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle(),
  ]
  if (projectId) {
    queries.push(supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle())
  }
  const [orgResult, projectResult] = await Promise.all(queries)
  if (orgResult.error) return { ok: false, response: jsonError(orgResult.error.message, 500, corsHeaders) }
  if (projectResult?.error) return { ok: false, response: jsonError(projectResult.error.message, 500, corsHeaders) }
  if (orgResult.data || projectResult?.data) return { ok: true, userId, service: false }
  return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
}

async function requireOrgProjectManager(
  supabase: AdminClient,
  userId: string | null,
  orgId: string,
  projectId: string,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true; userId: string | null; service: false } | { ok: false; response: Response }> {
  if (!userId) return { ok: false, response: jsonError("Unauthorized", 401, corsHeaders) }

  const [orgResult, projectResult] = await Promise.all([
    supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle(),
  ])

  if (orgResult.error) return { ok: false, response: jsonError(orgResult.error.message, 500, corsHeaders) }
  if (projectResult.error) return { ok: false, response: jsonError(projectResult.error.message, 500, corsHeaders) }

  const orgRole = (orgResult.data as { role?: string } | null)?.role ?? null
  const projectRole = (projectResult.data as { role?: string } | null)?.role ?? null
  if (orgRole && ["owner", "admin", "agency_admin"].includes(orgRole)) return { ok: true, userId, service: false }
  if (projectRole === "owner") return { ok: true, userId, service: false }

  return { ok: false, response: jsonError("Forbidden", 403, corsHeaders) }
}
