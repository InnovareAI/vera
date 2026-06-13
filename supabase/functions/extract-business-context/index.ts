import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import Anthropic from "npm:@anthropic-ai/sdk"
import mammoth from "npm:mammoth@1.10.0"
import type { AdminClient } from "../_shared/auth.ts"
import { loadProjectAiPolicy } from "../_shared/ai-policy.ts"
import { isPlatformMediaProject, loadClientApiKey } from "../_shared/client-media-keys.ts"
import { logGenerationUsage } from "../_shared/generation-usage.ts"
import { selectTextModel, type ModelSelectionSource } from "../_shared/model-recommendations.ts"
import { resolveUnipileResearchConnection } from "../_shared/unipile-research.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const ANTHROPIC_EXTRACT_MODEL = Deno.env.get("ANTHROPIC_EXTRACT_MODEL") ?? "claude-haiku-4-5"
const OPENROUTER_EXTRACT_MODEL = Deno.env.get("OPENROUTER_EXTRACT_MODEL") ?? "google/gemini-2.5-flash"
const APIFY_TOKEN = Deno.env.get("INNOVARE_APIFY_TOKEN") ?? Deno.env.get("APIFY_TOKEN") ?? Deno.env.get("APIFY_API_TOKEN")
const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY")
const UNIPILE_BASE_URL = normalizeUnipileBaseUrl(
  Deno.env.get("UNIPILE_BASE_URL") ?? Deno.env.get("UNIPILE_API_URL") ?? Deno.env.get("UNIPILE_DSN") ?? "",
)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type BusinessContext = {
  companyName: string
  website: string
  linkedinCompany: string
  linkedinProfile: string
  linkedinEvents: string
  linkedinNewsletter: string
  instagram: string
  youtube: string
  medium: string
  quora: string
  reddit: string
  facebook: string
  x: string
  sourcePullDepth: string
  industry: string
  offer: string
  audience: string
  customerProblems: string
  differentiators: string
  competitors: string
  proofPoints: string
  contentGoals: string
  speakerStrategy: string
  platformToneOfVoice: string
  demandObjective: string
  conversionPath: string
  channelStrategy: string
  contentFormats: string
  approvalModel: string
  approvalStakeholders: string
  engagementSignals: string
  samHandoffRules: string
  learningCadence: string
  channelOperatingPolicies: string
  constraints: string
}

type ExtractRequest = {
  project_id?: string
  project_name?: string
  file_name?: string
  mime_type?: string
  text?: string
  data_base64?: string
  existing_context?: Partial<BusinessContext>
  pull_sources?: boolean
}

type SourceReport = {
  label: string
  url?: string
  ok: boolean
  items: number
  requestedItems?: number
  depth?: SourcePullDepth
  source?: "direct" | "apify" | "unipile"
  error?: string
}

type SourceDocument = {
  label: string
  url?: string
  source: "direct" | "apify" | "unipile"
  text: string
  items: number
  requestedItems?: number
}

type SourcePullDepth = "light" | "standard" | "deep"

type ExtractionRuntime =
  | ({ provider: "anthropic"; key: string; model: string; keySource: "platform" | "client" } & ExtractionRuntimeAudit)
  | ({ provider: "openrouter"; key: string; model: string; keySource: "client" } & ExtractionRuntimeAudit)

type ExtractionRuntimeAudit = {
  selectionSource: ModelSelectionSource
  selectionReason: string
  requestedModel: string | null
  policyDefaultModel: string | null
}

const FIELD_KEYS = [
  "website",
  "linkedinCompany",
  "linkedinProfile",
  "linkedinEvents",
  "linkedinNewsletter",
  "instagram",
  "youtube",
  "medium",
  "quora",
  "reddit",
  "facebook",
  "x",
  "sourcePullDepth",
  "companyName",
  "industry",
  "offer",
  "audience",
  "customerProblems",
  "differentiators",
  "competitors",
  "proofPoints",
  "contentGoals",
  "speakerStrategy",
  "platformToneOfVoice",
  "demandObjective",
  "conversionPath",
  "channelStrategy",
  "contentFormats",
  "approvalModel",
  "approvalStakeholders",
  "engagementSignals",
  "samHandoffRules",
  "learningCadence",
  "channelOperatingPolicies",
  "constraints",
] as const

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

function normalizeUnipileBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: ExtractRequest
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const projectId = body.project_id?.trim()
  if (!projectId) return jsonError("project_id is required", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id, name")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const allowed = await canManageProject(supabase, auth.user.id, project.id, project.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const projectName = body.project_name ?? project.name
  const existing = body.existing_context ?? {}
  let fileName = body.file_name?.trim() || "uploaded document"
  let sources: SourceReport[] | undefined
  let content: { ok: true; value: unknown[] } | { ok: false; error: string }

  if (body.pull_sources) {
    fileName = "website and social sources"
    const pulled = await pullSourceContent(supabase, project.org_id, existing, auth.user.id)
    sources = pulled.sources
    if (!pulled.text.trim()) return jsonError("No readable source content found. Check the URLs or configure Innovare Apify.", 400)
    content = {
      ok: true,
      value: [{ type: "text", text: buildPrompt({ projectName, fileName, existing, documentText: pulled.text.slice(0, 180_000) }) }],
    }
  } else {
    const mime = (body.mime_type ?? "").toLowerCase()
    content = await contentFromBody(body, mime, { projectName, fileName, existing })
  }
  if (!content.ok) return jsonError(content.error, 400)

  const requiresAnthropicDocuments = content.value.some(block =>
    !!block && typeof block === "object" && (block as { type?: unknown }).type === "document"
  )
  const runtime = await resolveExtractionRuntime(supabase as unknown as AdminClient, project.id, project.org_id, requiresAnthropicDocuments)
  if (!runtime.ok) return runtime.response

  const startedAt = Date.now()
  let extraction: Awaited<ReturnType<typeof runExtraction>>
  try {
    extraction = await runExtraction(runtime.runtime, content.value)
  } catch (error) {
    return jsonError(`Business context extraction failed: ${errorMessage(error)}`, 502)
  }
  await logGenerationUsage(supabase as unknown as AdminClient, {
    orgId: project.org_id,
    projectId: project.id,
    provider: runtime.runtime.provider,
    model: runtime.runtime.model,
    operation: "business_context.extract",
    inputTokens: extraction.inputTokens,
    outputTokens: extraction.outputTokens,
    durationMs: Date.now() - startedAt,
    metadata: extractionRuntimeUsageMetadata(runtime.runtime, {
      task: "extract-business-context",
      source: fileName,
      pulled_sources: !!body.pull_sources,
      source_count: sources?.length ?? 0,
    }),
  })

  const context = parseContextJson(extraction.output)
  return json({ ok: true, context, source: fileName, sources })
})

async function resolveExtractionRuntime(
  supabase: AdminClient,
  projectId: string,
  orgId: string,
  requiresAnthropicDocuments: boolean,
): Promise<{ ok: true; runtime: ExtractionRuntime } | { ok: false; response: Response }> {
  const policyDefaultModel = await loadProjectAiPolicy(supabase, projectId)
    .then(policy => policy.defaultTextModel)
    .catch(() => null)
  const anthropicSelection = selectTextModel({
    provider: "anthropic",
    requestedModel: null,
    policyDefaultModel,
    fallbackModel: ANTHROPIC_EXTRACT_MODEL,
  })
  const openRouterSelection = selectTextModel({
    provider: "openrouter",
    requestedModel: null,
    policyDefaultModel,
    fallbackModel: OPENROUTER_EXTRACT_MODEL,
  })

  let platformProject: boolean
  try {
    platformProject = await isPlatformMediaProject(supabase, projectId, orgId)
  } catch (error) {
    return { ok: false, response: jsonError(`Could not resolve workspace billing policy: ${errorMessage(error)}`, 500) }
  }
  if (platformProject) {
    if (!ANTHROPIC_API_KEY) return { ok: false, response: jsonError("ANTHROPIC_API_KEY is not configured", 500) }
    return {
      ok: true,
      runtime: {
        provider: "anthropic",
        key: ANTHROPIC_API_KEY,
        model: anthropicSelection.alias,
        keySource: "platform",
        ...extractionRuntimeAudit(anthropicSelection, null, policyDefaultModel),
      },
    }
  }

  let openRouter: { key: string; provider: string } | null
  let anthropic: { key: string; provider: string } | null
  try {
    const results = await Promise.all([
      requiresAnthropicDocuments ? Promise.resolve(null) : loadClientApiKey(supabase, projectId, ["openrouter"]),
      loadClientApiKey(supabase, projectId, ["anthropic"]),
    ])
    openRouter = results[0]
    anthropic = results[1]
  } catch (error) {
    return { ok: false, response: jsonError(`Client API key for business context extraction is unavailable: ${errorMessage(error)}`, 403) }
  }

  if (openRouter?.key) {
    return {
      ok: true,
      runtime: {
        provider: "openrouter",
        key: openRouter.key,
        model: openRouterSelection.alias,
        keySource: "client",
        ...extractionRuntimeAudit(openRouterSelection, null, policyDefaultModel),
      },
    }
  }
  if (anthropic?.key) {
    return {
      ok: true,
      runtime: {
        provider: "anthropic",
        key: anthropic.key,
        model: anthropicSelection.alias,
        keySource: "client",
        ...extractionRuntimeAudit(anthropicSelection, null, policyDefaultModel),
      },
    }
  }

  return {
    ok: false,
    response: jsonError(
      requiresAnthropicDocuments
        ? "Business context PDF extraction requires this client space to use its own Anthropic key."
        : "Business context extraction requires this client space to use its own OpenRouter or Anthropic key.",
      403,
    ),
  }
}

async function runExtraction(
  runtime: ExtractionRuntime,
  content: unknown[],
): Promise<{ output: string; inputTokens: number | null; outputTokens: number | null }> {
  if (runtime.provider === "openrouter") return runOpenRouterExtraction(runtime, content)
  return runAnthropicExtraction(runtime, content)
}

async function runAnthropicExtraction(
  runtime: Extract<ExtractionRuntime, { provider: "anthropic" }>,
  content: unknown[],
): Promise<{ output: string; inputTokens: number | null; outputTokens: number | null }> {
  const anthropic = new Anthropic({ apiKey: runtime.key })
  const response = await anthropic.messages.create({
    model: runtime.model,
    max_tokens: 1800,
    temperature: 0,
    messages: [{
      role: "user",
      content: content as any,
    }],
  })

  return {
    output: response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n"),
    inputTokens: response.usage.input_tokens ?? null,
    outputTokens: response.usage.output_tokens ?? null,
  }
}

async function runOpenRouterExtraction(
  runtime: Extract<ExtractionRuntime, { provider: "openrouter" }>,
  content: unknown[],
): Promise<{ output: string; inputTokens: number | null; outputTokens: number | null }> {
  const prompt = content
    .map(block => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      ? String((block as { text?: unknown }).text ?? "")
      : "")
    .join("\n\n")
    .trim()
  if (!prompt) throw new Error("OpenRouter extraction requires text content. For PDFs, add a client Anthropic key.")

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vera.innovareai.com",
      "X-Title": "VERA Business Context Extraction",
    },
    body: JSON.stringify({
      model: runtime.model,
      temperature: 0,
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) throw new Error(`OpenRouter extraction failed with HTTP ${response.status}`)
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    output: data.choices?.[0]?.message?.content ?? "{}",
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  }
}

async function pullSourceContent(
  supabase: SupabaseAdminClient,
  orgId: string,
  context: Partial<BusinessContext>,
  requesterUserId: string,
) {
  const docs: SourceDocument[] = []
  const sources: SourceReport[] = []
  const unipile = await resolveUnipileConnection(supabase, orgId, requesterUserId)
  const depth = normalizeSourcePullDepth(context.sourcePullDepth)
  const limits = sourcePullLimits(depth)

  async function addSource(
    label: string,
    rawUrl: string | undefined,
    loader: (url: string) => Promise<SourceDocument>,
  ) {
    const url = normalizeSourceUrl(rawUrl)
    if (!url) return
    try {
      const doc = await loader(url)
      docs.push(doc)
      sources.push({ label, url, ok: true, items: doc.items, requestedItems: doc.requestedItems, depth, source: doc.source })
    } catch (error) {
      sources.push({ label, url, ok: false, items: 0, depth, error: errorMessage(error) })
    }
  }

  await addSource("Website", context.website, url => pullGenericPage("Website", url, { maxResults: limits.publicPages }))
  await addSource("LinkedIn company page", context.linkedinCompany, url => pullConnectedSocial("LinkedIn company page", url, unipile, { isCompany: true, limit: limits.socialItems }))
  await addSource("LinkedIn profile", context.linkedinProfile, url => pullConnectedSocial("LinkedIn profile", url, unipile, { isCompany: false, limit: limits.socialItems }))
  await addSource("LinkedIn events", context.linkedinEvents, url => pullGenericPage("LinkedIn events", url, { maxResults: limits.publicPages }))
  await addSource("LinkedIn newsletter", context.linkedinNewsletter, url => pullGenericPage("LinkedIn newsletter", url, { maxResults: limits.publicPages }))
  await addSource("Instagram", context.instagram, url => pullConnectedSocial("Instagram", url, unipile, { isCompany: false, limit: limits.socialItems }))
  await addSource("YouTube", context.youtube, url => pullGenericPage("YouTube", url, { maxResults: limits.publicPages }))
  await addSource("Medium", context.medium, url => pullGenericPage("Medium", url, { maxResults: limits.publicPages }))
  await addSource("Quora", context.quora, url => pullGenericPage("Quora", url, { maxResults: limits.publicPages }))
  await addSource("Reddit", context.reddit, url => pullGenericPage("Reddit", url, { maxResults: limits.publicPages }))
  await addSource("Facebook page", context.facebook, url => pullFacebookPage("Facebook page", url, limits.socialItems))
  await addSource("X profile", context.x, url => pullXProfile("X profile", url, limits.socialItems))

  return {
    sources,
    text: docs
      .map(doc => [
        `## ${doc.label}`,
        `URL: ${doc.url ?? ""}`,
        `Collected by: ${doc.source}`,
        doc.text,
      ].join("\n"))
      .join("\n\n")
      .slice(0, 180_000),
  }
}

function normalizeSourcePullDepth(value: unknown): SourcePullDepth {
  return value === "light" || value === "deep" || value === "standard" ? value : "standard"
}

function sourcePullLimits(depth: SourcePullDepth) {
  if (depth === "light") return { socialItems: 10, publicPages: 1 }
  if (depth === "deep") return { socialItems: 50, publicPages: 3 }
  return { socialItems: 25, publicPages: 2 }
}

async function resolveUnipileConnection(supabase: SupabaseAdminClient, orgId: string, requesterUserId: string) {
  if (!UNIPILE_API_KEY || !UNIPILE_BASE_URL) return { accountId: null, error: "Unipile is not configured" }

  const connection = await resolveUnipileResearchConnection(supabase as AdminClient, orgId, { requesterUserId })
  if (!connection.ok) return { accountId: null, error: connection.error }
  return { accountId: connection.accountId, error: null }
}

async function pullConnectedSocial(
  label: string,
  url: string,
  unipile: { accountId: string | null; error: string | null },
  options: { isCompany: boolean; limit: number },
) {
  return withFallback(
    () => pullUnipileProfileAndPosts(label, url, unipile, options),
    () => pullGenericPage(label, url, { maxResults: 1 }),
  )
}

async function pullUnipileProfileAndPosts(
  label: string,
  url: string,
  unipile: { accountId: string | null; error: string | null },
  options: { isCompany: boolean; limit: number },
): Promise<SourceDocument> {
  if (!unipile.accountId) throw new Error(unipile.error ?? "Unipile is not connected")
  const identifier = publicIdentifierFromUrl(url)
  if (!identifier) throw new Error("Could not read the public profile identifier")

  const query: Record<string, string> = {
    account_id: unipile.accountId,
    limit: String(options.limit),
  }
  if (/linkedin\.com/i.test(url)) query.is_company = options.isCompany ? "true" : "false"

  const [profileResult, postsResult] = await Promise.allSettled([
    unipileGet(`/users/${encodeURIComponent(identifier)}`, query),
    unipileGet(`/users/${encodeURIComponent(identifier)}/posts`, query),
  ])

  const payloads: unknown[] = []
  if (profileResult.status === "fulfilled") payloads.push(profileResult.value)
  if (postsResult.status === "fulfilled") payloads.push(postsResult.value)
  const text = itemsToText(label, payloads)
  if (text.length < 80) {
    const errors = [profileResult, postsResult]
      .filter(result => result.status === "rejected")
      .map(result => errorMessage((result as PromiseRejectedResult).reason))
      .join("; ")
    throw new Error(errors || "Unipile returned no readable content")
  }

  return { label, url, source: "unipile", text, items: countItems(payloads), requestedItems: options.limit }
}

async function unipileGet(path: string, query: Record<string, string>) {
  const url = new URL(`${UNIPILE_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-KEY": UNIPILE_API_KEY ?? "",
    },
  })
  if (!response.ok) throw new Error(`Unipile HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

async function pullFacebookPage(label: string, url: string, limit: number) {
  return withFallback(
    () => pullApifyActor(label, url, "apify/facebook-posts-scraper", {
      startUrls: [{ url }],
      resultsLimit: limit,
      captionText: true,
    }, limit),
    () => pullGenericPage(label, url, { maxResults: 1 }),
  )
}

async function pullXProfile(label: string, url: string, limit: number) {
  return withFallback(
    () => pullApifyActor(label, url, "scraper_one/x-profile-posts-scraper", {
      profileUrls: [url],
      resultsLimit: limit,
      skipPinnedPosts: true,
    }, limit),
    () => pullGenericPage(label, url, { maxResults: 1 }),
  )
}

async function pullGenericPage(label: string, url: string, options: { maxResults: number }) {
  return withFallback(
    () => pullApifyActor(label, url, "apify/rag-web-browser", {
      query: url,
      maxResults: options.maxResults,
      outputFormats: ["markdown"],
      requestTimeoutSecs: 28,
      scrapingTool: "browser-playwright",
      htmlTransformer: "readable-text",
      dynamicContentWaitSecs: 4,
      maxRequestRetries: 1,
      proxyConfiguration: { useApifyProxy: true },
    }, options.maxResults),
    () => fetchUrlSource(label, url),
  )
}

async function pullApifyActor(label: string, url: string, actor: string, input: Record<string, unknown>, requestedItems?: number): Promise<SourceDocument> {
  if (!APIFY_TOKEN) throw new Error("Innovare Apify is not configured")
  const actorPath = actor.replace("/", "~")
  const response = await fetch(`https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?format=json&clean=true&token=${encodeURIComponent(APIFY_TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`Apify ${actor} HTTP ${response.status}: ${await response.text()}`)
  const data = await response.json()
  const items = Array.isArray(data) ? data : [data]
  const text = itemsToText(label, items)
  if (text.length < 80) throw new Error(`Apify ${actor} returned no readable content`)
  return { label, url, source: "apify", text, items: items.length, requestedItems }
}

async function fetchUrlSource(label: string, url: string): Promise<SourceDocument> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; VeraBot/1.0; +https://innovareai.com)",
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const raw = await response.text()
    const text = htmlToText(raw).slice(0, 45_000)
    if (text.length < 80) throw new Error("No readable public text found")
    return { label, url, source: "direct", text, items: 1 }
  } finally {
    clearTimeout(timeout)
  }
}

async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>) {
  try {
    return await primary()
  } catch (firstError) {
    try {
      return await fallback()
    } catch (secondError) {
      throw new Error(`${errorMessage(firstError)}; fallback failed: ${errorMessage(secondError)}`, { cause: secondError })
    }
  }
}

function normalizeSourceUrl(raw: string | undefined) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (!["http:", "https:"].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

function publicIdentifierFromUrl(raw: string) {
  const normalized = normalizeSourceUrl(raw)
  if (!normalized) return ""
  const url = new URL(normalized)
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  const parts = url.pathname.split("/").filter(Boolean).map(part => decodeURIComponent(part.replace(/^@/, "")))

  if (host.includes("instagram.com") || host === "x.com" || host === "twitter.com") return parts[0] ?? ""
  if (host.includes("linkedin.com")) {
    const section = parts[0]
    if (["company", "in", "showcase"].includes(section)) return parts[1] ?? ""
  }
  return parts[parts.length - 1] ?? ""
}

function itemsToText(label: string, value: unknown) {
  const items = flattenItems(value).slice(0, 35)
  return items
    .map((item, index) => {
      const text = itemToText(item)
      return text ? `### ${label} item ${index + 1}\n${text}` : ""
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 80_000)
}

function countItems(value: unknown) {
  return flattenItems(value).length
}

function flattenItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(item => flattenItems(item))
  if (!value || typeof value !== "object") return [value]

  const object = value as Record<string, unknown>
  if (Array.isArray(object.items)) return object.items
  if (Array.isArray(object.data)) return object.data
  if (Array.isArray(object.posts)) return object.posts
  if (Array.isArray(object.results)) return object.results
  return [value]
}

function itemToText(value: unknown, depth = 0): string {
  if (value == null) return ""
  if (typeof value === "string") return cleanExtractedText(value).slice(0, 1600)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map(item => itemToText(item, depth + 1))
      .filter(Boolean)
      .join("\n")
  }
  if (typeof value !== "object" || depth > 2) return ""

  const object = value as Record<string, unknown>
  const parts: string[] = []
  for (const [key, raw] of Object.entries(object)) {
    if (parts.length >= 22 || shouldSkipField(key, raw)) continue
    const useful = isUsefulField(key)
    const text = itemToText(raw, depth + 1)
    if (!text) continue
    if (useful || text.length > 40 || depth === 0) parts.push(`${humanizeKey(key)}: ${text.slice(0, 1200)}`)
  }
  return parts.join("\n")
}

function shouldSkipField(key: string, value: unknown) {
  if (/^(id|urn|tracking|debug|__typename)$/i.test(key)) return true
  if (/image|avatar|thumbnail|picture|media|video|audio|sprite|icon/i.test(key)) return true
  if (typeof value === "string") {
    if (value.startsWith("data:")) return true
    if (value.length > 6000 && !isUsefulField(key)) return true
  }
  return false
}

function isUsefulField(key: string) {
  return /text|content|caption|description|title|name|headline|summary|about|bio|url|link|date|time|published|created|reaction|comment|like|share|view|author|company|industry|followers|newsletter|event/i.test(key)
}

function humanizeKey(key: string) {
  return key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
}

function htmlToText(raw: string) {
  return cleanExtractedText(raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "))
}

function cleanExtractedText(raw: string) {
  return decodeHtml(raw)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
}

function decodeHtml(raw: string) {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ""
    })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function contentFromBody(
  body: ExtractRequest,
  mime: string,
  meta: { projectName: string; fileName: string; existing: Partial<BusinessContext> },
): Promise<{ ok: true; value: unknown[] } | { ok: false; error: string }> {
  if (typeof body.text === "string" && body.text.trim()) {
    return { ok: true, value: [{ type: "text", text: buildPrompt({ ...meta, documentText: body.text.slice(0, 160_000) }) }] }
  }

  if (!body.data_base64) return { ok: false, error: "Document text or base64 data is required" }

  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || body.file_name?.toLowerCase().endsWith(".docx")) {
    const bytes = base64ToBytes(body.data_base64)
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer })
    const value = result.value.trim()
    if (!value) return { ok: false, error: "No readable text found in DOCX" }
    return { ok: true, value: [{ type: "text", text: buildPrompt({ ...meta, documentText: value.slice(0, 160_000) }) }] }
  }

  if (mime === "application/pdf" || body.file_name?.toLowerCase().endsWith(".pdf")) {
    return {
      ok: true,
      value: [
        {
          type: "document",
          title: body.file_name ?? "document.pdf",
          source: { type: "base64", media_type: "application/pdf", data: body.data_base64 },
        },
        { type: "text", text: buildPrompt({ ...meta, documentText: "Read the attached PDF." }) },
      ],
    }
  }

  return { ok: false, error: "Unsupported document type. Use PDF, DOCX, TXT, Markdown, CSV, JSON, or HTML." }
}

function buildPrompt(input: {
  projectName: string
  fileName: string
  existing: Partial<BusinessContext>
  documentText: string
}) {
  return `Extract business context for a content generation workspace.

Project/client name: ${input.projectName}
Source file: ${input.fileName}

Existing context, preserve it when the document is silent:
${JSON.stringify(input.existing, null, 2)}

Return JSON only. Use exactly these keys:
${FIELD_KEYS.join(", ")}

Rules:
- Be concise but specific.
- If the document is silent for a field, return an empty string for that field.
- Do not invent facts.
- Treat "website" as the primary company URL when present.
- Extract LinkedIn company pages, LinkedIn personal profiles, LinkedIn events, LinkedIn newsletters, Instagram profiles, YouTube channels, Medium pages, Quora profiles, Reddit profiles or communities, Facebook pages, and X profiles only when explicitly present.
- "sourcePullDepth" should be "light", "standard", or "deep" only when the source explicitly says how much source history to inspect. Otherwise return an empty string.
- Use source posts, events, and newsletters to infer positioning, recurring topics, proof points, and content goals, but keep URLs in their own fields.
- "offer" should capture products, services, or core value proposition.
- "audience" should capture target buyers, users, industries, or decision makers.
- "customerProblems" should capture pains the client solves.
- "differentiators" should capture positioning and why the client is different.
- "proofPoints" should capture facts, numbers, case studies, credentials, or named evidence.
- "contentGoals" should capture messaging goals, campaign goals, themes, or calls to action.
- "speakerStrategy" should capture who VERA may write as, including brand account, founder, named person, internal expert, or team voice, and when each should be used.
- "platformToneOfVoice" should capture whether tone differs by medium or platform. Keep a shared brand core, but note channel-specific tone and structure when evidence supports it.
- "demandObjective" should capture the top-of-funnel demand goal.
- "conversionPath" should capture where attention or engagement should go next.
- "channelStrategy" should capture the role of each channel or medium.
- "contentFormats" should capture the formats VERA should produce.
- "approvalModel" should capture who approves what and when.
- "approvalStakeholders" should capture named approvers, required stakeholder groups, and when one person versus all required stakeholders should approve.
- "engagementSignals" should capture comments, shares, clicks, traffic, objections, or other traction signals that matter.
- "samHandoffRules" should capture when content engagement should become SAM research or sales follow-up.
- "learningCadence" should capture how often VERA should review performance and update recommendations.
- "channelOperatingPolicies" should remain empty unless the source clearly defines per-channel speaker, approval, publishing guard, measurement, or sales handoff rules. If present, return compact JSON keyed by platform.
- "constraints" should capture legal, compliance, wording, market, region, or brand restrictions.

Document:
${input.documentText}`
}

function parseContextJson(text: string): BusinessContext {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    parsed = {}
  }
  const context = {} as BusinessContext
  for (const key of FIELD_KEYS) {
    const value = parsed[key]
    context[key] = typeof value === "string" ? value.trim() : ""
  }
  return context
}

function base64ToBytes(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function extractionRuntimeAudit(
  selection: { source: ModelSelectionSource; reason: string },
  requestedModel: unknown,
  policyDefaultModel: string | null,
): ExtractionRuntimeAudit {
  return {
    selectionSource: selection.source,
    selectionReason: selection.reason,
    requestedModel: cleanString(requestedModel),
    policyDefaultModel,
  }
}

function extractionRuntimeUsageMetadata(
  runtime: ExtractionRuntime,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    key_source: runtime.keySource,
    requested_model: runtime.requestedModel,
    policy_default_model: runtime.policyDefaultModel,
    model_selection_source: runtime.selectionSource,
    model_selection_reason: runtime.selectionReason,
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
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
  return ["owner", "admin", "editor"].includes((projectMember as { role?: string } | null)?.role ?? "")
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
