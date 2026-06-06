import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const POSTMARK_SERVER_TOKEN = Deno.env.get("POSTMARK_SERVER_TOKEN") ?? Deno.env.get("POSTMARK_API_TOKEN")
const POSTMARK_FROM = Deno.env.get("POSTMARK_INVITE_FROM") ?? "InnovareAI <hello@innovareai.com>"
const POSTMARK_MESSAGE_STREAM = Deno.env.get("POSTMARK_MESSAGE_STREAM") ?? "outbound"
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? Deno.env.get("SITE_URL") ?? "https://vera.innovareai.com").replace(/\/+$/, "")

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type InviteBody = {
  action?: "create" | "accept"
  project_id?: string
  email?: string
  role?: string
  token?: string
}

type ProjectInvite = {
  id: string
  org_id: string
  project_id: string
  email: string
  role: string
  status: string
  invite_token: string
  expires_at: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: InviteBody
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  if (body.action === "accept") return acceptInvite(supabase, auth.user, body.token)
  return createInvite(supabase, auth.user.id, body, req)
})

async function createInvite(supabase: SupabaseAdminClient, actorUserId: string, body: InviteBody, req: Request) {
  if (!POSTMARK_SERVER_TOKEN) return jsonError("Postmark is not configured for client invitations", 500)

  const projectId = body.project_id?.trim()
  const email = normalizeEmail(body.email)
  const role = normalizeRole(body.role)
  if (!projectId || !email) return jsonError("project_id and email are required", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id, name, slug")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const allowed = await canManageProject(supabase, actorUserId, project.id, project.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: existingInvite } = await supabase
    .from("project_invites")
    .select("id, invite_token")
    .eq("project_id", project.id)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle()

  const inviteResult = existingInvite
    ? await supabase
      .from("project_invites")
      .update({
        role,
        expires_at: expiresAt,
        created_by: actorUserId,
        send_error: null,
      })
      .eq("id", existingInvite.id)
      .select("id, org_id, project_id, email, role, status, invite_token, expires_at")
      .single()
    : await supabase
      .from("project_invites")
      .insert({
        org_id: project.org_id,
        project_id: project.id,
        email,
        role,
        created_by: actorUserId,
        expires_at: expiresAt,
      })
      .select("id, org_id, project_id, email, role, status, invite_token, expires_at")
      .single()

  if (inviteResult.error) return jsonError(inviteResult.error.message, 500)
  const invite = inviteResult.data as ProjectInvite
  const inviteUrl = `${originFor(req)}/invite/${invite.invite_token}`

  const emailResult = await sendInviteEmail({
    to: email,
    projectName: project.name,
    role,
    inviteUrl,
    expiresAt: invite.expires_at,
  })

  if (!emailResult.ok) {
    await supabase.from("project_invites").update({ send_error: emailResult.error }).eq("id", invite.id)
    return jsonError(emailResult.error, 502)
  }

  await supabase
    .from("project_invites")
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", invite.id)

  return json({ ok: true, invite_id: invite.id, email, role, sent: true })
}

async function acceptInvite(supabase: SupabaseAdminClient, authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }, token?: string) {
  const cleanToken = token?.trim()
  if (!cleanToken) return jsonError("Invite token is required", 400)
  if (!authUser.email) return jsonError("Your account does not have an email address", 400)

  const { data: invite, error: inviteError } = await supabase
    .from("project_invites")
    .select("id, org_id, project_id, email, role, status, invite_token, expires_at, projects(slug, name)")
    .eq("invite_token", cleanToken)
    .maybeSingle()
  if (inviteError) return jsonError(inviteError.message, 500)
  if (!invite) return jsonError("Invite not found", 404)

  const row = invite as ProjectInvite & { projects?: { slug?: string; name?: string } | null }
  if (row.status !== "pending") return jsonError("Invite is no longer pending", 409)
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await supabase.from("project_invites").update({ status: "expired" }).eq("id", row.id)
    return jsonError("Invite has expired", 410)
  }
  if (normalizeEmail(authUser.email) !== normalizeEmail(row.email)) return jsonError("This invite was sent to a different email address", 403)

  await ensureUserProfile(supabase, authUser, row.org_id)

  const { error: memberError } = await supabase
    .from("project_members")
    .upsert({
      org_id: row.org_id,
      project_id: row.project_id,
      user_id: authUser.id,
      role: normalizeRole(row.role),
      created_by: authUser.id,
    }, { onConflict: "project_id,user_id" })
  if (memberError) return jsonError(memberError.message, 500)

  const { error: updateError } = await supabase
    .from("project_invites")
    .update({ status: "accepted", accepted_by: authUser.id })
    .eq("id", row.id)
  if (updateError) return jsonError(updateError.message, 500)

  return json({
    ok: true,
    project_id: row.project_id,
    project_slug: row.projects?.slug ?? null,
    project_name: row.projects?.name ?? null,
  })
}

async function ensureUserProfile(
  supabase: SupabaseAdminClient,
  authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> },
  orgId: string,
) {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (existing) return

  const fullName =
    stringValue(authUser.user_metadata?.full_name) ??
    stringValue(authUser.user_metadata?.name) ??
    null

  await supabase.from("users").insert({
    id: authUser.id,
    org_id: orgId,
    email: normalizeEmail(authUser.email),
    full_name: fullName,
    role: "viewer",
  })
}

async function canManageProject(
  supabase: SupabaseAdminClient,
  userId: string,
  projectId: string,
  orgId: string,
) {
  const [{ data: orgMember }, { data: projectMember }] = await Promise.all([
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  ])

  if (["owner", "admin", "agency_admin"].includes((orgMember as { role?: string } | null)?.role ?? "")) return true
  return ((projectMember as { role?: string } | null)?.role ?? "") === "owner"
}

async function sendInviteEmail(input: { to: string; projectName: string; role: string; inviteUrl: string; expiresAt: string }) {
  const expires = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(input.expiresAt))
  const textBody = [
    `You have been invited to ${input.projectName} in Vera.`,
    ``,
    `Role: ${input.role}`,
    `Accept invite: ${input.inviteUrl}`,
    ``,
    `This invite expires on ${expires}.`,
  ].join("\n")

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;color:#18181b;line-height:1.5">
      <p>You have been invited to <strong>${escapeHtml(input.projectName)}</strong> in Vera.</p>
      <p><strong>Role:</strong> ${escapeHtml(input.role)}</p>
      <p><a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;background:#951b2d;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px">Accept invite</a></p>
      <p style="color:#71717a;font-size:13px">This invite expires on ${escapeHtml(expires)}.</p>
    </div>
  `

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN!,
    },
    body: JSON.stringify({
      From: POSTMARK_FROM,
      To: input.to,
      Subject: `You are invited to ${input.projectName} in Vera`,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: POSTMARK_MESSAGE_STREAM,
    }),
  })

  if (response.ok) return { ok: true as const }
  return { ok: false as const, error: `Postmark send failed: ${await providerError(response)}` }
}

async function providerError(response: Response) {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { Message?: string; message?: string; error?: string }
    return parsed.Message ?? parsed.message ?? parsed.error ?? response.statusText
  } catch {
    return text.slice(0, 220) || response.statusText
  }
}

function normalizeEmail(email: string | undefined) {
  return (email ?? "").trim().toLowerCase()
}

function normalizeRole(role: string | undefined) {
  return ["owner", "editor", "reviewer", "viewer"].includes(role ?? "") ? role! : "viewer"
}

function originFor(req: Request) {
  const origin = req.headers.get("origin")
  return origin?.startsWith("http") ? origin.replace(/\/+$/, "") : APP_BASE_URL
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function jsonError(message: string, status = 400) {
  return json({ ok: false, error: message }, status)
}
