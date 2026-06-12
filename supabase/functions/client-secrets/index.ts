import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ENCRYPTION_KEY = Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? Deno.env.get("VAULT_ENC_KEY")

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type SecretRequest = {
  project_id?: string
  provider?: string
  label?: string
  secret?: string
  config?: unknown
}

type ProviderModel = {
  id: string
  display_name?: string
  capabilities: Record<string, boolean>
  context_window?: number | null
}

type DiscoveryResult =
  | { ok: true; models: ProviderModel[]; capabilities: Record<string, boolean>; warning?: string }
  | { ok: false; error: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return jsonError("Secret encryption key is not configured", 500)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: SecretRequest
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const projectId = body.project_id?.trim()
  const provider = body.provider?.trim().toLowerCase()
  const label = body.label?.trim()
  const secret = body.secret?.trim()
  const configResult = normalizeConfig(body.config)

  if (!projectId || !provider || !label || !secret) return jsonError("project_id, provider, label, and secret are required", 400)
  if (!configResult.ok) return jsonError(configResult.error, 400)
  if (provider.length > 80 || label.length > 120) return jsonError("Provider or label is too long", 400)
  if (secret.length < 8 || secret.length > 8000) return jsonError("Secret length is outside the accepted range", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const allowed = await canManageProject(supabase, auth.user.id, project.id, project.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const discovery = await discoverProvider(provider, secret, configResult.value)
  if (!discovery.ok) return jsonError(discovery.error, 400)

  const ciphertext = await encryptSecret(secret, ENCRYPTION_KEY)
  const preview = secretPreview(secret)
  const testedAt = new Date().toISOString()
  const { error } = await supabase
    .from("client_api_keys")
    .upsert({
      org_id: project.org_id,
      project_id: project.id,
      provider,
      label,
      config: configResult.value,
      models: discovery.models,
      capabilities: discovery.capabilities,
      secret_ciphertext: ciphertext,
      secret_preview: preview,
      status: "active",
      test_error: discovery.warning ?? null,
      last_tested_at: testedAt,
      created_by: auth.user.id,
      updated_by: auth.user.id,
      updated_at: testedAt,
    }, { onConflict: "project_id,provider,label" })

  if (error) return jsonError(error.message, 500)
  return json({
    ok: true,
    provider,
    label,
    secret_preview: preview,
    model_count: discovery.models.length,
    capabilities: discovery.capabilities,
    warning: discovery.warning,
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

function normalizeConfig(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: {} }
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Provider config must be a JSON object" }
  return { ok: true, value: value as Record<string, unknown> }
}

async function discoverProvider(provider: string, secret: string, config: Record<string, unknown>): Promise<DiscoveryResult> {
  try {
    if (provider === "openai") return discoverOpenAI(secret)
    if (provider === "anthropic") return discoverAnthropic(secret)
    if (provider === "google") return discoverGemini(secret)
    if (provider === "openrouter") return discoverOpenRouter(secret)
    if (provider === "azure_openai") return discoverAzureOpenAI(secret, config)
    if (provider === "fal" || provider === "fal_ai") {
      return {
        ok: true,
        models: [],
        capabilities: { image: true, video: true },
        warning: "Saved without live FAL validation. Use this key for client-owned image and video generation.",
      }
    }

    const capabilities = { chat: true }
    return {
      ok: true,
      models: [],
      capabilities,
      warning: "Saved without provider validation. Add a provider adapter before using this key for generation.",
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Provider validation failed" }
  }
}

async function discoverOpenAI(secret: string): Promise<DiscoveryResult> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (!response.ok) return { ok: false, error: `OpenAI rejected this key: ${await providerError(response)}` }

  const body = await response.json() as { data?: Array<{ id?: string }> }
  const models = (body.data ?? [])
    .filter(model => typeof model.id === "string" && model.id.length > 0)
    .map(model => buildModel("openai", model.id!))

  return { ok: true, models, capabilities: aggregateCapabilities(models) }
}

async function discoverOpenRouter(secret: string): Promise<DiscoveryResult> {
  // Validate against an authenticated endpoint (the model catalogue is public,
  // so fetching it can't confirm the key). 200 here means the key is live.
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (!response.ok) return { ok: false, error: `OpenRouter rejected this key: ${await providerError(response)}` }
  // OpenRouter routes both chat and image models (Flux, Nano Banana). The full
  // catalogue isn't synced here to avoid storing hundreds of model rows.
  return { ok: true, models: [], capabilities: { chat: true, image: true } }
}

async function discoverAnthropic(secret: string): Promise<DiscoveryResult> {
  const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: {
      "x-api-key": secret,
      "anthropic-version": "2023-06-01",
    },
  })
  if (!response.ok) return { ok: false, error: `Anthropic rejected this key: ${await providerError(response)}` }

  const body = await response.json() as {
    data?: Array<{
      id?: string
      display_name?: string
      max_input_tokens?: number
      capabilities?: Record<string, boolean>
    }>
  }
  const models = (body.data ?? [])
    .filter(model => typeof model.id === "string" && model.id.length > 0)
    .map(model => ({
      id: model.id!,
      display_name: model.display_name,
      context_window: typeof model.max_input_tokens === "number" ? model.max_input_tokens : null,
      capabilities: normalizeCapabilityObject(model.capabilities) ?? inferCapabilities("anthropic", model.id!),
    }))

  return { ok: true, models, capabilities: aggregateCapabilities(models) }
}

async function discoverGemini(secret: string): Promise<DiscoveryResult> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`)
  if (!response.ok) return { ok: false, error: `Gemini rejected this key: ${await providerError(response)}` }

  const body = await response.json() as {
    models?: Array<{
      name?: string
      displayName?: string
      inputTokenLimit?: number
      supportedGenerationMethods?: string[]
    }>
  }
  const models = (body.models ?? [])
    .filter(model => typeof model.name === "string" && model.name.length > 0)
    .map(model => {
      const id = model.name!.replace(/^models\//, "")
      return {
        id,
        display_name: model.displayName,
        context_window: typeof model.inputTokenLimit === "number" ? model.inputTokenLimit : null,
        capabilities: inferGeminiCapabilities(model.supportedGenerationMethods ?? [], id),
      }
    })

  return { ok: true, models, capabilities: aggregateCapabilities(models) }
}

async function discoverAzureOpenAI(secret: string, config: Record<string, unknown>): Promise<DiscoveryResult> {
  const endpoint = typeof config.endpoint === "string" ? config.endpoint.replace(/\/+$/, "") : ""
  const apiVersion = typeof config.api_version === "string" ? config.api_version : "2024-10-21"
  if (!endpoint) {
    const capabilities = { chat: true, vision: true, tool_use: true, structured_output: true }
    return {
      ok: true,
      models: [],
      capabilities,
      warning: "Saved without Azure model sync. Add endpoint and api_version in provider config to sync deployments later.",
    }
  }

  const response = await fetch(`${endpoint}/openai/models?api-version=${encodeURIComponent(apiVersion)}`, {
    headers: { "api-key": secret },
  })
  if (!response.ok) return { ok: false, error: `Azure OpenAI rejected this key: ${await providerError(response)}` }

  const body = await response.json() as { data?: Array<{ id?: string }> }
  const models = (body.data ?? [])
    .filter(model => typeof model.id === "string" && model.id.length > 0)
    .map(model => buildModel("openai", model.id!))

  return { ok: true, models, capabilities: aggregateCapabilities(models) }
}

function buildModel(provider: string, id: string): ProviderModel {
  return {
    id,
    capabilities: inferCapabilities(provider, id),
    context_window: inferContextWindow(provider, id),
  }
}

function inferCapabilities(provider: string, modelId: string): Record<string, boolean> {
  const id = modelId.toLowerCase()
  if (provider === "anthropic") return { chat: true, vision: true, files: true, tool_use: true, structured_output: true }
  if (id.includes("embedding") || id.includes("embed")) return { embeddings: true }
  if (id.includes("image") || id.includes("dall-e")) return { image_generation: true }
  if (id.includes("sora")) return { video: true }
  if (id.includes("tts") || id.includes("transcribe") || id.includes("whisper") || id.includes("audio")) return { audio: true }
  if (id.includes("realtime")) return { chat: true, audio: true, realtime: true, tool_use: true }
  if (id.startsWith("gpt-") || id.startsWith("o")) return { chat: true, vision: true, files: true, tool_use: true, structured_output: true }
  return { chat: true }
}

function inferGeminiCapabilities(methods: string[], modelId: string): Record<string, boolean> {
  const names = methods.map(method => method.toLowerCase())
  const id = modelId.toLowerCase()
  return {
    chat: names.includes("generatecontent"),
    vision: id.includes("gemini"),
    files: names.includes("generatecontent"),
    tool_use: names.includes("generatecontent"),
    structured_output: names.includes("generatecontent"),
    embeddings: names.includes("embedcontent") || names.includes("batchembedcontents"),
  }
}

function inferContextWindow(provider: string, modelId: string) {
  const id = modelId.toLowerCase()
  if (provider === "anthropic") return null
  if (id.includes("gpt-5") || id.includes("gpt-4.1")) return 1000000
  if (id.includes("gpt-4o") || id.startsWith("o")) return 128000
  return null
}

function normalizeCapabilityObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const capabilities: Record<string, boolean> = {}
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") capabilities[key] = enabled
  }
  return Object.keys(capabilities).length > 0 ? capabilities : null
}

function aggregateCapabilities(models: ProviderModel[]) {
  const capabilities: Record<string, boolean> = {}
  for (const model of models) {
    for (const [key, enabled] of Object.entries(model.capabilities)) {
      if (enabled) capabilities[key] = true
    }
  }
  return capabilities
}

async function encryptSecret(secret: string, keyMaterial: string) {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(keyMaterial))
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret)))
  return `aes-gcm:v1:${toBase64(iv)}:${toBase64(encrypted)}`
}

function secretPreview(secret: string) {
  const clean = secret.replace(/\s+/g, "")
  if (clean.length <= 8) return "saved"
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`
}

async function providerError(response: Response) {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === "string") return parsed.error
    if (parsed.error?.message) return parsed.error.message
    if (parsed.message) return parsed.message
  } catch {
    return text.slice(0, 220) || response.statusText
  }
  return response.statusText
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
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
