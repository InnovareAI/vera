import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const META_CLIENT_ID = Deno.env.get("META_OAUTH_CLIENT_ID") ?? Deno.env.get("META_APP_ID") ?? ""
const META_BUSINESS_LOGIN_CONFIG_ID = Deno.env.get("META_BUSINESS_LOGIN_CONFIG_ID") ?? Deno.env.get("META_OAUTH_CONFIG_ID") ?? ""
const STATE_SECRET = Deno.env.get("META_OAUTH_STATE_SECRET") ?? Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? SUPABASE_SERVICE_ROLE_KEY
const META_GRAPH_API_VERSION = normalizeGraphApiVersion(Deno.env.get("META_GRAPH_API_VERSION"))
const DEFAULT_REDIRECT_URI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-oauth-callback`
const DEFAULT_RETURN_URL = "https://vera.innovareai.com/settings?tab=integrations"
const DEFAULT_ALLOWED_RETURN_ORIGINS = [
  "https://vera.innovareai.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]

const META_SCOPES_BY_PROVIDER: Record<string, string[]> = {
  meta_facebook_pages: [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_engagement",
    "read_insights",
  ],
  meta_instagram: [
    "pages_show_list",
    "pages_read_engagement",
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_comments",
    "instagram_business_manage_insights",
  ],
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type StartRequest = {
  project_id?: string
  return_url?: string
  providers?: string[]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)
  if (!META_CLIENT_ID) return jsonError("META_OAUTH_CLIENT_ID is not configured", 500)
  if (!STATE_SECRET || STATE_SECRET.length < 32) return jsonError("Meta OAuth state secret is not configured", 500)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: StartRequest
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const projectId = body.project_id?.trim()
  if (!projectId) return jsonError("project_id is required", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const allowed = await canManageProject(supabase, auth.user.id, project.id, project.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const returnUrl = normalizeReturnUrl(body.return_url)
  const providers = normalizeProviders(body.providers)
  const scopes = scopesForProviders(providers)
  const redirectUri = Deno.env.get("META_OAUTH_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI
  const state = await signState({
    project_id: project.id,
    org_id: project.org_id,
    user_id: auth.user.id,
    providers,
    return_url: returnUrl,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  })

  const params = new URLSearchParams({
    client_id: META_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    auth_type: "rerequest",
  })

  if (META_BUSINESS_LOGIN_CONFIG_ID) {
    params.set("config_id", META_BUSINESS_LOGIN_CONFIG_ID)
    params.set("override_default_response_type", "true")
  } else {
    params.set("scope", scopes.join(","))
  }

  return json({
    ok: true,
    auth_url: `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`,
    redirect_uri: redirectUri,
    scopes,
    uses_business_login_config: !!META_BUSINESS_LOGIN_CONFIG_ID,
  })
})

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

function normalizeProviders(value: unknown): string[] {
  if (!Array.isArray(value)) return ["meta_facebook_pages", "meta_instagram"]
  const allowed = new Set(["meta_facebook_pages", "meta_instagram"])
  const providers = value.filter(provider => typeof provider === "string" && allowed.has(provider))
  return providers.length ? providers : ["meta_facebook_pages", "meta_instagram"]
}

function scopesForProviders(providers: string[]): string[] {
  return Array.from(new Set(providers.flatMap(provider => META_SCOPES_BY_PROVIDER[provider] ?? [])))
}

function normalizeReturnUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_RETURN_URL
  try {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol)) return DEFAULT_RETURN_URL
    if (!allowedReturnOrigins().includes(url.origin)) return DEFAULT_RETURN_URL
    return url.toString()
  } catch {
    return DEFAULT_RETURN_URL
  }
}

function allowedReturnOrigins(): string[] {
  const configured = (Deno.env.get("VERA_ALLOWED_RETURN_ORIGINS") ?? "")
    .split(",")
    .map(value => value.trim().replace(/\/+$/, ""))
    .filter(Boolean)
  const appUrls = [
    Deno.env.get("VERA_APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("APP_URL"),
  ]
    .filter((value): value is string => !!value)
    .map(value => {
      try {
        return new URL(value).origin
      } catch {
        return ""
      }
    })
    .filter(Boolean)

  return Array.from(new Set([...DEFAULT_ALLOWED_RETURN_ORIGINS, ...configured, ...appUrls]))
}

async function signState(payload: Record<string, unknown>) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await hmac(body)
  return `${body}.${signature}`
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))
  return base64UrlEncode(signature)
}

function normalizeGraphApiVersion(value: string | null | undefined): string {
  return /^v\d+\.\d+$/.test(value ?? "") ? value as string : "v23.0"
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function jsonError(error: string, status = 400) {
  return json({ ok: false, error }, status)
}
