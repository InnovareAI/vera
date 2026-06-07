import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const META_CLIENT_ID = Deno.env.get("META_OAUTH_CLIENT_ID") ?? Deno.env.get("META_APP_ID") ?? ""
const META_CLIENT_SECRET = Deno.env.get("META_OAUTH_CLIENT_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? ""
const ENCRYPTION_KEY = Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? Deno.env.get("VAULT_ENC_KEY")
const STATE_SECRET = Deno.env.get("META_OAUTH_STATE_SECRET") ?? Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? SUPABASE_SERVICE_ROLE_KEY
const META_GRAPH_API_VERSION = normalizeGraphApiVersion(Deno.env.get("META_GRAPH_API_VERSION"))
const DEFAULT_REDIRECT_URI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-oauth-callback`
const DEFAULT_RETURN_URL = "https://vera.innovareai.com/settings?tab=integrations"
const DEFAULT_ALLOWED_RETURN_ORIGINS = [
  "https://vera.innovareai.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]

const PROVIDER_LABEL = "Meta OAuth"
const META_KEY_PROVIDER = "meta_oauth"
const META_SCOPES_BY_PROVIDER: Record<MetaProvider, string[]> = {
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

type MetaProvider = "meta_facebook_pages" | "meta_instagram"

type MetaTokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
  error?: {
    message?: string
    type?: string
    code?: number
  }
}

type MetaUser = {
  id?: string
  name?: string
}

type MetaPage = {
  id?: string
  name?: string
  category?: string
  access_token?: string
  tasks?: string[]
  perms?: string[]
  instagram_business_account?: MetaInstagramAccount
}

type MetaInstagramAccount = {
  id?: string
  username?: string
  name?: string
  profile_picture_url?: string
  followers_count?: number
  media_count?: number
}

type MetaPagesResult = {
  ok: boolean
  pages: MetaPage[]
  warning?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "GET") return redirectWithError("Method not allowed")
  if (!META_CLIENT_ID || !META_CLIENT_SECRET) return redirectWithError("Meta OAuth client is not configured")
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return redirectWithError("Secret encryption key is not configured")

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const stateParam = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error") ?? url.searchParams.get("error_message")
  if (oauthError) return redirectWithError(oauthError, stateParam)
  if (!code || !stateParam) return redirectWithError("Missing OAuth code or state")

  const state = await verifyState(stateParam)
  if (!state.ok) return redirectWithError(state.error)
  if (state.value.exp < Math.floor(Date.now() / 1000)) return redirectWithError("OAuth state expired", stateParam)

  try {
    const redirectUri = Deno.env.get("META_OAUTH_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI
    const shortToken = await exchangeCode(code, redirectUri)
    if (!shortToken.access_token) return redirectTo(state.value.return_url, "error", metaErrorMessage(shortToken, "Meta did not return an access token"))

    const longToken = await exchangeLongLivedToken(shortToken.access_token)
    const accessToken = longToken.access_token ?? shortToken.access_token
    const tokenExpiresIn = longToken.expires_in ?? shortToken.expires_in
    const expiresAt = tokenExpiresIn ? new Date(Date.now() + tokenExpiresIn * 1000).toISOString() : null
    const requestedProviders = normalizeProviders(state.value.providers)
    const wantsFacebookPages = requestedProviders.includes("meta_facebook_pages")
    const wantsInstagram = requestedProviders.includes("meta_instagram")
    const grantedScopes = scopesForProviders(requestedProviders)
    const [userResult, pagesResult] = await Promise.all([
      fetchMetaUser(accessToken),
      fetchMetaPages(accessToken),
    ])
    const instagramAccounts = pagesResult.pages
      .map(page => ({ page, account: page.instagram_business_account }))
      .filter((item): item is { page: MetaPage; account: MetaInstagramAccount } => !!item.account?.id)

    const supabase = createAdminClient()
    const existingKey = await loadExistingMetaKey(supabase, state.value.project_id)
    const existingConfig = recordValue(existingKey?.config)
    const existingCapabilities = recordValue(existingKey?.capabilities)
    const testedAt = new Date().toISOString()
    const encrypted = await encryptSecret(JSON.stringify({
      user_access_token: accessToken,
      expires_at: expiresAt,
      token_type: longToken.token_type ?? shortToken.token_type ?? "bearer",
      scope: grantedScopes,
      issued_at: testedAt,
      user: userResult,
      pages: pagesResult.pages.map(page => ({
        id: page.id,
        name: page.name,
        access_token: page.access_token ?? null,
        tasks: page.tasks ?? [],
        perms: page.perms ?? [],
        instagram_business_account_id: page.instagram_business_account?.id ?? null,
      })),
    }), ENCRYPTION_KEY)
    const keyConfig = {
      ...existingConfig,
      scopes: mergeStrings(stringArray(existingConfig.scopes), grantedScopes),
      providers: mergeStrings(stringArray(existingConfig.providers), requestedProviders),
      token_type: longToken.token_type ?? shortToken.token_type ?? "bearer",
      expires_at: expiresAt,
      meta_user: sanitizeMetaUser(userResult),
      pages: sanitizePages(pagesResult.pages),
      instagram_accounts: sanitizeInstagramAccounts(instagramAccounts),
      page_count: pagesResult.pages.length,
      instagram_account_count: instagramAccounts.length,
      connected_via: "meta-oauth-callback",
    }
    const keyCapabilities = {
      ...existingCapabilities,
      oauth: true,
      refresh_token: true,
      ...(wantsFacebookPages ? { facebook_pages: true } : {}),
      ...(wantsInstagram ? { instagram: true } : {}),
    }
    const keyPayload = {
      org_id: state.value.org_id,
      project_id: state.value.project_id,
      provider: META_KEY_PROVIDER,
      label: PROVIDER_LABEL,
      config: keyConfig,
      models: [],
      capabilities: keyCapabilities,
      secret_preview: "long-lived Meta token saved",
      status: "active",
      test_error: pagesResult.warning ?? null,
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
            secret_ciphertext: encrypted,
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

    const detailParts: string[] = []

    if (wantsFacebookPages) {
      await upsertIntegration(supabase, {
        orgId: state.value.org_id,
        projectId: state.value.project_id,
        userId: state.value.user_id,
        credentialRef: keyRow.id as string,
        provider: "meta_facebook_pages",
        displayName: "Facebook Pages",
        primaryRef: pagesResult.pages[0]?.id ?? "",
        healthStatus: pagesResult.ok && pagesResult.pages.length > 0 ? "healthy" : "stale",
        healthDetail: pagesResult.ok
          ? `${pagesResult.pages.length} Facebook Page${pagesResult.pages.length === 1 ? "" : "s"} available.`
          : pagesResult.warning ?? "Meta token saved, but Page listing needs attention.",
        scopes: META_SCOPES_BY_PROVIDER.meta_facebook_pages,
        capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
        extraConfig: {
          pages: sanitizePages(pagesResult.pages),
          page_count: pagesResult.pages.length,
          warning: pagesResult.warning,
        },
      })
      detailParts.push(`${pagesResult.pages.length} Facebook Page${pagesResult.pages.length === 1 ? "" : "s"}`)
    }

    if (wantsInstagram) {
      await upsertIntegration(supabase, {
        orgId: state.value.org_id,
        projectId: state.value.project_id,
        userId: state.value.user_id,
        credentialRef: keyRow.id as string,
        provider: "meta_instagram",
        displayName: "Instagram Professional",
        primaryRef: instagramAccounts[0]?.account.id ?? "",
        healthStatus: pagesResult.ok && instagramAccounts.length > 0 ? "healthy" : "stale",
        healthDetail: pagesResult.ok
          ? `${instagramAccounts.length} Instagram Professional account${instagramAccounts.length === 1 ? "" : "s"} available.`
          : pagesResult.warning ?? "Meta token saved, but Instagram account listing needs attention.",
        scopes: META_SCOPES_BY_PROVIDER.meta_instagram,
        capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
        extraConfig: {
          instagram_accounts: sanitizeInstagramAccounts(instagramAccounts),
          instagram_account_count: instagramAccounts.length,
          warning: pagesResult.warning,
        },
      })
      detailParts.push(`${instagramAccounts.length} Instagram account${instagramAccounts.length === 1 ? "" : "s"}`)
    }

    const detail = detailParts.length
      ? `Connected Meta. Found ${detailParts.join(" and ")}.`
      : "Connected Meta OAuth."

    return redirectTo(state.value.return_url, "success", detail)
  } catch (error) {
    return redirectTo(state.value.return_url, "error", error instanceof Error ? error.message : "Meta OAuth callback failed")
  }
})

async function exchangeCode(code: string, redirectUri: string): Promise<MetaTokenResponse> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`)
  url.searchParams.set("client_id", META_CLIENT_ID)
  url.searchParams.set("client_secret", META_CLIENT_SECRET)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("code", code)

  const response = await fetch(url.toString())
  const token = await response.json() as MetaTokenResponse
  if (!response.ok) return { error: token.error ?? { message: response.statusText } }
  return token
}

async function exchangeLongLivedToken(accessToken: string): Promise<MetaTokenResponse> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`)
  url.searchParams.set("grant_type", "fb_exchange_token")
  url.searchParams.set("client_id", META_CLIENT_ID)
  url.searchParams.set("client_secret", META_CLIENT_SECRET)
  url.searchParams.set("fb_exchange_token", accessToken)

  const response = await fetch(url.toString())
  const token = await response.json() as MetaTokenResponse
  if (!response.ok) return { error: token.error ?? { message: response.statusText } }
  return token
}

async function fetchMetaUser(accessToken: string): Promise<MetaUser> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me`)
  url.searchParams.set("fields", "id,name")
  url.searchParams.set("access_token", accessToken)
  const response = await fetch(url.toString())
  if (!response.ok) return {}
  return await response.json() as MetaUser
}

async function fetchMetaPages(accessToken: string): Promise<MetaPagesResult> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts`)
  url.searchParams.set("fields", "id,name,category,access_token,tasks,perms,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}")
  url.searchParams.set("limit", "100")
  url.searchParams.set("access_token", accessToken)

  const response = await fetch(url.toString())
  const body = await response.json().catch(() => ({})) as {
    data?: MetaPage[]
    error?: { message?: string }
  }
  if (!response.ok) {
    return {
      ok: false,
      pages: [],
      warning: body.error?.message ?? `Meta Pages returned HTTP ${response.status}`,
    }
  }
  return { ok: true, pages: body.data ?? [] }
}

async function loadExistingMetaKey(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{
  id: string
  config: Record<string, unknown> | null
  capabilities: Record<string, unknown> | null
} | null> {
  const { data, error } = await supabase
    .from("client_api_keys")
    .select("id, config, capabilities, updated_at")
    .eq("project_id", projectId)
    .eq("provider", META_KEY_PROVIDER)
    .eq("label", PROVIDER_LABEL)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as {
    id: string
    config: Record<string, unknown> | null
    capabilities: Record<string, unknown> | null
  } | null
}

async function upsertIntegration(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    orgId: string
    projectId: string
    userId: string
    credentialRef: string
    provider: MetaProvider
    displayName: string
    primaryRef: string
    healthStatus: "healthy" | "stale"
    healthDetail: string
    scopes: string[]
    capabilities: Record<string, boolean>
    extraConfig: Record<string, unknown>
  },
) {
  const { error } = await supabase
    .from("client_integrations")
    .upsert({
      org_id: input.orgId,
      project_id: input.projectId,
      provider: input.provider,
      category: "social",
      display_name: input.displayName,
      status: "connected",
      connection_kind: "oauth",
      config: {
        primary_ref: input.primaryRef,
        approval_required: true,
        credential_route: "Meta OAuth token and Page access tokens stored as encrypted client credentials",
        setup_note: input.healthDetail,
        ...launchForProvider(input.provider),
        ...input.extraConfig,
      },
      capabilities: input.capabilities,
      scopes: input.scopes,
      credential_ref: input.credentialRef,
      external_ref: {
        meta_oauth_key_id: input.credentialRef,
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

function launchForProvider(provider: MetaProvider): Record<string, unknown> {
  if (provider === "meta_facebook_pages") {
    return {
      launch_priority: "wave_1",
      workstream: "Meta",
      adapter_state: "Meta OAuth connected. Build Facebook Page selection, dry-run publishing, and insight ingestion next.",
      next_build: "Add Page selector, post and media publishing dry run, comment moderation, insight sync, and approval gates.",
      required_setup: ["Meta developer app", "Facebook Page task access", "App review for Page permissions", "Publishing approval gates"],
    }
  }

  return {
    launch_priority: "wave_1",
    workstream: "Meta",
    adapter_state: "Meta OAuth connected. Build Instagram account selection, media container dry runs, and insight ingestion next.",
    next_build: "Add Instagram Professional account selector, media container creation, publish dry run, insight sync, and approval gates.",
    required_setup: ["Professional Instagram account", "Connected Facebook Page", "App review for Instagram permissions", "Media URL hosting"],
  }
}

function normalizeProviders(value: unknown): MetaProvider[] {
  if (!Array.isArray(value)) return ["meta_facebook_pages", "meta_instagram"]
  const allowed = new Set<MetaProvider>(["meta_facebook_pages", "meta_instagram"])
  const providers = value.filter((provider): provider is MetaProvider => typeof provider === "string" && allowed.has(provider as MetaProvider))
  return providers.length ? providers : ["meta_facebook_pages", "meta_instagram"]
}

function scopesForProviders(providers: MetaProvider[]): string[] {
  return Array.from(new Set(providers.flatMap(provider => META_SCOPES_BY_PROVIDER[provider] ?? [])))
}

function sanitizeMetaUser(user: MetaUser): MetaUser {
  return {
    id: user.id,
    name: user.name,
  }
}

function sanitizePages(pages: MetaPage[]): Array<Record<string, unknown>> {
  return pages.map(page => ({
    id: page.id,
    name: page.name,
    category: page.category,
    tasks: page.tasks ?? [],
    perms: page.perms ?? [],
    instagram_business_account: page.instagram_business_account
      ? sanitizeInstagramAccount(page.instagram_business_account)
      : null,
  }))
}

function sanitizeInstagramAccounts(items: Array<{ page: MetaPage; account: MetaInstagramAccount }>): Array<Record<string, unknown>> {
  return items.map(({ page, account }) => ({
    ...sanitizeInstagramAccount(account),
    page_id: page.id,
    page_name: page.name,
  }))
}

function sanitizeInstagramAccount(account: MetaInstagramAccount): Record<string, unknown> {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    profile_picture_url: account.profile_picture_url,
    followers_count: account.followers_count,
    media_count: account.media_count,
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function mergeStrings(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()))
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
  if (!stateParam) return html(`Meta connection failed: ${escapeHtml(error)}`)
  return verifyState(stateParam)
    .then(state => {
      if (!state.ok) return html(`Meta connection failed: ${escapeHtml(error)}`)
      return redirectTo(state.value.return_url, "error", error)
    })
}

function redirectTo(returnUrl: string, status: "success" | "error", detail: string) {
  const url = new URL(normalizeReturnUrl(returnUrl))
  url.searchParams.set("tab", "integrations")
  url.searchParams.set("meta_status", status)
  url.searchParams.set("meta_detail", detail.slice(0, 300))
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

function normalizeGraphApiVersion(value: string | null | undefined): string {
  return /^v\d+\.\d+$/.test(value ?? "") ? value as string : "v23.0"
}

function metaErrorMessage(token: MetaTokenResponse, fallback: string): string {
  return token.error?.message ?? fallback
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
