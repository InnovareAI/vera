import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? ""
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? ""
const ENCRYPTION_KEY = Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? Deno.env.get("VAULT_ENC_KEY")
const STATE_SECRET = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET") ?? Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? SUPABASE_SERVICE_ROLE_KEY
const DEFAULT_REDIRECT_URI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/google-oauth-callback`
const DEFAULT_RETURN_URL = "https://vera.innovareai.com/settings?tab=integrations"
const DEFAULT_ALLOWED_RETURN_ORIGINS = [
  "https://vera.innovareai.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]

const PROVIDER_LABEL = "Google Search & Analytics OAuth"
const GOOGLE_KEY_PROVIDER = "google_oauth"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type OAuthState = {
  project_id: string
  org_id: string
  user_id: string
  providers: string[]
  return_url: string
  nonce: string
  exp: number
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

type GscSite = { siteUrl?: string; permissionLevel?: string }
type Ga4AccountSummary = { account?: string; displayName?: string; propertySummaries?: Ga4Property[] }
type Ga4Property = { property?: string; displayName?: string; parent?: string; propertyType?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "GET") return redirectWithError("Method not allowed")
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return redirectWithError("Google OAuth client is not configured")
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return redirectWithError("Secret encryption key is not configured")

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const stateParam = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  if (oauthError) return redirectWithError(oauthError, stateParam)
  if (!code || !stateParam) return redirectWithError("Missing OAuth code or state")

  const state = await verifyState(stateParam)
  if (!state.ok) return redirectWithError(state.error)
  if (state.value.exp < Math.floor(Date.now() / 1000)) return redirectWithError("OAuth state expired", stateParam)

  try {
    const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI
    const token = await exchangeCode(code, redirectUri)
    if (!token.access_token) return redirectTo(state.value.return_url, "error", token.error_description ?? token.error ?? "Google did not return an access token")

    const grantedScopes = (token.scope ?? "").split(/\s+/).filter(Boolean)
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null
    const [gscResult, ga4Result] = await Promise.all([
      fetchSearchConsoleSites(token.access_token),
      fetchGa4AccountSummaries(token.access_token),
    ])

    const supabase = createAdminClient()
    const existingKey = await loadExistingGoogleKey(supabase, state.value.project_id)
    const shouldReplaceSecret = !!token.refresh_token || !existingKey?.secret_ciphertext
    const encrypted = shouldReplaceSecret ? await encryptSecret(JSON.stringify({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      expires_at: expiresAt,
      scope: grantedScopes,
      token_type: token.token_type ?? "Bearer",
      issued_at: new Date().toISOString(),
    }), ENCRYPTION_KEY) : null

    const testedAt = new Date().toISOString()
    const tokenWarning = token.refresh_token || existingKey?.secret_ciphertext ? null : "Google did not return a refresh token. Reconnect with consent if long-running sync fails."
    const keyPayload = {
      org_id: state.value.org_id,
      project_id: state.value.project_id,
      provider: GOOGLE_KEY_PROVIDER,
      label: PROVIDER_LABEL,
      config: {
        scopes: grantedScopes,
        token_type: token.token_type ?? "Bearer",
        expires_at: expiresAt,
        providers: state.value.providers,
        search_console_sites: gscResult.sites,
        ga4_account_summaries: ga4Result.accountSummaries,
        ga4_properties: ga4Result.properties,
        search_console_site_count: gscResult.sites.length,
        ga4_property_count: ga4Result.properties.length,
        connected_via: "google-oauth-callback",
      },
      models: [],
      capabilities: {
        search_console: true,
        ga4: true,
        oauth: true,
        refresh_token: !!token.refresh_token || !!existingKey?.secret_ciphertext,
      },
      secret_preview: shouldReplaceSecret
        ? token.refresh_token ? "refresh token saved" : "access token saved"
        : "existing refresh token kept",
      status: "active",
      test_error: [tokenWarning, gscResult.warning, ga4Result.warning].filter(Boolean).join(" | ") || null,
      last_tested_at: testedAt,
      created_by: existingKey?.id ? undefined : state.value.user_id,
      updated_by: state.value.user_id,
      updated_at: testedAt,
    }

    const { data: keyRow, error: keyError } = existingKey?.id
      ? await supabase
          .from("client_api_keys")
          .update({
            ...keyPayload,
            ...(encrypted ? { secret_ciphertext: encrypted } : {}),
          })
          .eq("id", existingKey.id)
          .select("id")
          .single()
      : await supabase
          .from("client_api_keys")
          .insert({
            ...keyPayload,
            secret_ciphertext: encrypted,
          })
          .select("id")
          .single()
    if (keyError) throw new Error(keyError.message)

    await upsertIntegration(supabase, {
      orgId: state.value.org_id,
      projectId: state.value.project_id,
      userId: state.value.user_id,
      credentialRef: keyRow.id as string,
      provider: "google_search_console",
      category: "seo",
      displayName: "Google Search Console",
      primaryRef: gscResult.sites[0]?.siteUrl ?? "",
      status: "connected",
      healthStatus: gscResult.ok ? "healthy" : "stale",
      healthDetail: gscResult.ok
        ? `${gscResult.sites.length} Search Console site${gscResult.sites.length === 1 ? "" : "s"} available.`
        : gscResult.warning ?? "Search Console token saved, but site listing needs attention.",
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      capabilities: { read: true, ingest: true, analyze: true },
      extraConfig: {
        sites: gscResult.sites,
        search_console_site_count: gscResult.sites.length,
        warning: gscResult.warning,
      },
    })

    await upsertIntegration(supabase, {
      orgId: state.value.org_id,
      projectId: state.value.project_id,
      userId: state.value.user_id,
      credentialRef: keyRow.id as string,
      provider: "google_analytics_4",
      category: "analytics",
      displayName: "Google Analytics 4",
      primaryRef: ga4Result.properties[0]?.property ?? "",
      status: "connected",
      healthStatus: ga4Result.ok ? "healthy" : "stale",
      healthDetail: ga4Result.ok
        ? `${ga4Result.properties.length} GA4 propert${ga4Result.properties.length === 1 ? "y" : "ies"} available.`
        : ga4Result.warning ?? "GA4 token saved, but property listing needs attention.",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      capabilities: { read: true, ingest: true, analyze: true },
      extraConfig: {
        account_summaries: ga4Result.accountSummaries,
        properties: ga4Result.properties,
        ga4_property_count: ga4Result.properties.length,
        warning: ga4Result.warning,
      },
    })

    return redirectTo(state.value.return_url, "success", `Connected Google. Found ${gscResult.sites.length} Search Console sites and ${ga4Result.properties.length} GA4 properties.`)
  } catch (error) {
    return redirectTo(state.value.return_url, "error", error instanceof Error ? error.message : "Google OAuth callback failed")
  }
})

async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const token = await response.json() as TokenResponse
  if (!response.ok) {
    return {
      error: token.error ?? response.statusText,
      error_description: token.error_description ?? response.statusText,
    }
  }
  return token
}

async function fetchSearchConsoleSites(accessToken: string): Promise<{ ok: boolean; sites: GscSite[]; warning?: string }> {
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = await response.json().catch(() => ({})) as { siteEntry?: GscSite[]; error?: { message?: string } }
  if (!response.ok) {
    return { ok: false, sites: [], warning: body.error?.message ?? `Search Console returned HTTP ${response.status}` }
  }
  return { ok: true, sites: body.siteEntry ?? [] }
}

async function fetchGa4AccountSummaries(accessToken: string): Promise<{
  ok: boolean
  accountSummaries: Ga4AccountSummary[]
  properties: Ga4Property[]
  warning?: string
}> {
  const response = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = await response.json().catch(() => ({})) as {
    accountSummaries?: Ga4AccountSummary[]
    error?: { message?: string }
  }
  if (!response.ok) {
    return {
      ok: false,
      accountSummaries: [],
      properties: [],
      warning: body.error?.message ?? `GA4 Admin returned HTTP ${response.status}`,
    }
  }
  const accountSummaries = body.accountSummaries ?? []
  return {
    ok: true,
    accountSummaries,
    properties: accountSummaries.flatMap(account => account.propertySummaries ?? []),
  }
}

async function loadExistingGoogleKey(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{ id: string; secret_ciphertext: string | null } | null> {
  const { data, error } = await supabase
    .from("client_api_keys")
    .select("id, secret_ciphertext")
    .eq("project_id", projectId)
    .eq("provider", GOOGLE_KEY_PROVIDER)
    .eq("label", PROVIDER_LABEL)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as { id: string; secret_ciphertext: string | null } | null
}

async function upsertIntegration(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    orgId: string
    projectId: string
    userId: string
    credentialRef: string
    provider: "google_search_console" | "google_analytics_4"
    category: "seo" | "analytics"
    displayName: string
    primaryRef: string
    status: "connected"
    healthStatus: "healthy" | "stale"
    healthDetail: string
    scopes: string[]
    capabilities: Record<string, boolean>
    extraConfig: Record<string, unknown>
  },
) {
  const launch = input.provider === "google_search_console"
    ? {
      launch_priority: "wave_1",
      workstream: "Search & analytics",
      adapter_state: "Google OAuth connected. Build daily Search Console ingestion next.",
      next_build: "Add scheduled Search Analytics pulls for queries, pages, countries, devices, and indexing checks.",
      required_setup: ["Verified site property", "Daily ingestion schedule", "Content opportunity mapping"],
    }
    : {
      launch_priority: "wave_1",
      workstream: "Search & analytics",
      adapter_state: "Google OAuth connected. Build GA4 report ingestion next.",
      next_build: "Add GA4 property selection, traffic summaries, channel grouping, and page performance pulls.",
      required_setup: ["GA4 property selection", "Reporting date ranges", "Quota guardrails"],
    }

  const { error } = await supabase
    .from("client_integrations")
    .upsert({
      org_id: input.orgId,
      project_id: input.projectId,
      provider: input.provider,
      category: input.category,
      display_name: input.displayName,
      status: input.status,
      connection_kind: "oauth",
      config: {
        primary_ref: input.primaryRef,
        approval_required: true,
        credential_route: "Google OAuth refresh token stored as an encrypted client credential",
        setup_note: input.healthDetail,
        ...launch,
        ...input.extraConfig,
      },
      capabilities: input.capabilities,
      scopes: input.scopes,
      credential_ref: input.credentialRef,
      external_ref: {
        google_oauth_key_id: input.credentialRef,
        primary_ref: input.primaryRef,
      },
      health_status: input.healthStatus,
      health_detail: input.healthDetail,
      last_health_check: new Date().toISOString(),
      updated_by: input.userId,
      created_by: input.userId,
    }, { onConflict: "project_id,provider,display_name" })
  if (error) throw new Error(error.message)
}

async function verifyState(value: string): Promise<{ ok: true; value: OAuthState } | { ok: false; error: string }> {
  const [payload, signature] = value.split(".")
  if (!payload || !signature) return { ok: false, error: "Invalid OAuth state" }
  const expected = await hmac(payload)
  if (!timingSafeEqual(signature, expected)) return { ok: false, error: "OAuth state signature mismatch" }
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as OAuthState
    if (!decoded.project_id || !decoded.org_id || !decoded.user_id || !decoded.return_url || !decoded.exp) {
      return { ok: false, error: "OAuth state is incomplete" }
    }
    return { ok: true, value: decoded }
  } catch {
    return { ok: false, error: "OAuth state could not be decoded" }
  }
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

async function encryptSecret(secret: string, keyMaterial: string) {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(keyMaterial))
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret)))
  return `aes-gcm:v1:${toBase64(iv)}:${toBase64(encrypted)}`
}

function redirectWithError(error: string, stateParam?: string | null) {
  if (!stateParam) return html(`Google connection failed: ${escapeHtml(error)}`)
  return verifyState(stateParam)
    .then(state => {
      if (!state.ok) return html(`Google connection failed: ${escapeHtml(error)}`)
      return redirectTo(state.value.return_url, "error", error)
    })
}

function redirectTo(returnUrl: string, status: "success" | "error", detail: string) {
  const url = new URL(normalizeReturnUrl(returnUrl))
  url.searchParams.set("tab", "integrations")
  url.searchParams.set("google_status", status)
  url.searchParams.set("google_detail", detail.slice(0, 300))
  return Response.redirect(url.toString(), 302)
}

function normalizeReturnUrl(value: string): string {
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

function html(body: string, status = 400) {
  return new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status,
    headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
  })
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  let result = 0
  for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i]
  return result === 0
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
