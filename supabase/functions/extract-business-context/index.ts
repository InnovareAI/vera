import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import Anthropic from "npm:@anthropic-ai/sdk"
import mammoth from "npm:mammoth@1.10.0"
import type { AdminClient } from "../_shared/auth.ts"
import { checkProjectAiBudget, loadProjectAiPolicy, type ProjectAiBudgetWarning } from "../_shared/ai-policy.ts"
import { isPlatformMediaProject, loadClientApiKey } from "../_shared/client-media-keys.ts"
import { logGenerationUsage } from "../_shared/generation-usage.ts"
import { selectTextModel, type ModelSelectionSource } from "../_shared/model-recommendations.ts"
import { resolveUnipileResearchConnection } from "../_shared/unipile-research.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? ""
const OPENAI_EMBED_MODEL = Deno.env.get("OPENAI_EMBED_MODEL") ?? "text-embedding-3-small"
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const ANTHROPIC_EXTRACT_MODEL = Deno.env.get("ANTHROPIC_EXTRACT_MODEL") ?? "claude-haiku-4-5"
const OPENROUTER_EXTRACT_MODEL = Deno.env.get("OPENROUTER_EXTRACT_MODEL") ?? "google/gemini-2.5-flash"
const APIFY_TOKEN = Deno.env.get("INNOVARE_APIFY_TOKEN") ?? Deno.env.get("APIFY_TOKEN") ?? Deno.env.get("APIFY_API_TOKEN")
const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY")
const UNIPILE_BASE_URL = normalizeUnipileBaseUrl(
  Deno.env.get("UNIPILE_BASE_URL") ?? Deno.env.get("UNIPILE_API_URL") ?? Deno.env.get("UNIPILE_DSN") ?? "",
)
const APPROX_CHARS_PER_TOKEN = 4
const BUSINESS_CONTEXT_EXTRACT_MAX_TOKENS = 1800
const EMBED_INPUT_CHAR_LIMIT = 8000

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
  activeChannels: string
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
  knowledgeStatus?: "stored" | "updated" | "stored_unindexed" | "updated_unindexed" | "failed"
  knowledgeId?: string
  knowledgeError?: string
}

type SourceDocument = {
  label: string
  url?: string
  source: "direct" | "apify" | "unipile"
  text: string
  items: number
  requestedItems?: number
}

type SourceKnowledgeSummary = {
  stored: number
  updated: number
  unindexed: number
  failed: number
  error?: string
}

type SourcePullDepth = "light" | "standard" | "deep"

type ProjectScope = { id: string; org_id: string; name?: string | null }
type EmbedRuntime = { provider: "openai"; key: string; model: string; keySource: "platform" | "client" }

type ExtractionRuntime =
  | ({ provider: "anthropic"; key: string; model: string; keySource: "platform" | "client" } & ExtractionRuntimeAudit)
  | ({ provider: "openrouter"; key: string; model: string; keySource: "client" } & ExtractionRuntimeAudit)

type ExtractionRuntimeAudit = {
  selectionSource: ModelSelectionSource
  selectionReason: string
  requestedModel: string | null
  policyDefaultModel: string | null
}

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

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
  "activeChannels",
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

function approxTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / APPROX_CHARS_PER_TOKEN))
}

function approxPromptChars(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "string") return value.length
  if (typeof value === "number" || typeof value === "boolean") return String(value).length
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + approxPromptChars(item), 0)
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (record.type === "document") {
      const source = record.source as Record<string, unknown> | undefined
      const data = typeof source?.data === "string" ? source.data : ""
      return data.length + approxPromptChars(record.title)
    }
    return Object.entries(record).reduce((sum, [key, item]) => sum + key.length + approxPromptChars(item), 0)
  }
  return 0
}

async function checkBusinessContextBudget(
  supabase: AdminClient,
  project: ProjectScope,
  runtime: ExtractionRuntime,
  content: unknown[],
  metadata: Record<string, unknown>,
): Promise<BudgetCheck> {
  const budget = await checkProjectAiBudget(supabase, project.id, {
    orgId: project.org_id,
    projectId: project.id,
    provider: runtime.provider,
    model: runtime.model,
    operation: "business_context.extract",
    inputTokens: approxTokensFromChars(approxPromptChars(content)),
    outputTokens: BUSINESS_CONTEXT_EXTRACT_MAX_TOKENS,
    metadata,
  })
  if (!budget.ok) return { ok: false, message: budget.message }
  return { ok: true, warning: budget.warning }
}

async function checkSourceEmbeddingBudget(
  supabase: AdminClient,
  project: ProjectScope,
  runtime: EmbedRuntime,
  text: string,
): Promise<BudgetCheck> {
  const budget = await checkProjectAiBudget(supabase, project.id, {
    orgId: project.org_id,
    projectId: project.id,
    provider: runtime.provider,
    model: runtime.model,
    operation: "knowledge.embed",
    inputTokens: approxTokensFromChars(text.slice(0, EMBED_INPUT_CHAR_LIMIT).length),
    outputTokens: 0,
    metadata: { key_source: runtime.keySource, source: "business_context_source_pull" },
  })
  if (!budget.ok) return { ok: false, message: budget.message }
  return { ok: true, warning: budget.warning }
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
  let pulledDocs: SourceDocument[] = []
  let content: { ok: true; value: unknown[] } | { ok: false; error: string }

  if (body.pull_sources) {
    fileName = "website and social sources"
    const pulled = await pullSourceContent(supabase, project.org_id, existing, auth.user.id)
    sources = pulled.sources
    pulledDocs = pulled.docs
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

  const usageMetadata = extractionRuntimeUsageMetadata(runtime.runtime, {
    task: "extract-business-context",
    source: fileName,
    pulled_sources: !!body.pull_sources,
    source_count: sources?.length ?? 0,
  })
  const budget = await checkBusinessContextBudget(
    supabase as unknown as AdminClient,
    project as ProjectScope,
    runtime.runtime,
    content.value,
    usageMetadata,
  )
  if (!budget.ok) return jsonError(budget.message, 402)

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
    metadata: {
      ...usageMetadata,
      ...(budget.warning ? { budget_warning: budget.warning } : {}),
    },
  })

  const context = parseContextJson(extraction.output)
  const knowledge = body.pull_sources && pulledDocs.length
    ? await persistPulledSourceKnowledge(supabase, project as ProjectScope, pulledDocs, sources ?? [])
    : undefined
  return json({ ok: true, context, source: fileName, sources, knowledge, ...(budget.warning ? { budget_warning: budget.warning } : {}) })
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
    max_tokens: BUSINESS_CONTEXT_EXTRACT_MAX_TOKENS,
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
      max_tokens: BUSINESS_CONTEXT_EXTRACT_MAX_TOKENS,
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
    docs,
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

function chunkText(text: string, max = 1200, overlap = 150): string[] {
  const out: string[] = []
  let i = 0
  const clean = text.replace(/\r\n/g, "\n").trim()
  while (i < clean.length) {
    out.push(clean.slice(i, i + max))
    i += max - overlap
  }
  return out.filter(chunk => chunk.trim().length > 50)
}

async function persistPulledSourceKnowledge(
  supabase: SupabaseAdminClient,
  project: ProjectScope,
  docs: SourceDocument[],
  reports: SourceReport[],
): Promise<SourceKnowledgeSummary> {
  const summary: SourceKnowledgeSummary = { stored: 0, updated: 0, unindexed: 0, failed: 0 }
  const runtimeResult = await resolveSourceKnowledgeEmbeddingRuntime(supabase as unknown as AdminClient, project)
  const runtime = runtimeResult.ok ? runtimeResult.runtime : null
  const embeddingSkipMessage = runtimeResult.ok ? null : runtimeResult.message
  if (embeddingSkipMessage) summary.error = embeddingSkipMessage

  for (const doc of docs) {
    const report = findSourceReport(reports, doc)
    try {
      const content = sourceDocumentKnowledgeContent(doc)
      const chunks = chunkText(content)
      if (!chunks.length) throw new Error("Source content is too short to store")
      let perDocEmbeddingSkipMessage = embeddingSkipMessage
      let embedding: number[] | null = null
      if (runtime) {
        const budget = await checkSourceEmbeddingBudget(supabase as unknown as AdminClient, project, runtime, chunks[0])
        if (budget.ok) {
          embedding = await embedSourceKnowledge(supabase as unknown as AdminClient, project, runtime, chunks[0], budget.warning)
        } else {
          perDocEmbeddingSkipMessage = budget.message
        }
      }
      const indexSkipMessage = embedding ? null : perDocEmbeddingSkipMessage
      const title = `${doc.label} source pull`
      const extracted = {
        source: doc.source,
        label: doc.label,
        url: doc.url ?? null,
        items: doc.items,
        requestedItems: doc.requestedItems ?? null,
        indexed: Boolean(embedding),
        collectedAt: new Date().toISOString(),
      }
      const existing = doc.url ? await findExistingSourceKnowledge(supabase, project.id, doc.url) : null
      if (existing?.id) {
        const { error } = await supabase
          .from("project_knowledge")
          .update({
            title,
            content,
            source_kind: "url",
            source_url: doc.url ?? null,
            kind: "source_pull",
            summary: sourceDocumentSummary(doc, Boolean(embedding)),
            extracted,
            suggestion: null,
            classified_at: null,
            embedding: embedding as unknown as string | null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
        if (error) throw new Error(`knowledge update failed: ${error.message}`)
        summary.updated += 1
        if (!embedding) summary.unindexed += 1
        if (report) {
          report.knowledgeStatus = embedding ? "updated" : "updated_unindexed"
          report.knowledgeId = existing.id
          if (indexSkipMessage) report.knowledgeError = indexSkipMessage
        }
      } else {
        const { data, error } = await supabase
          .from("project_knowledge")
          .insert({
            project_id: project.id,
            title,
            content,
            source_kind: "url",
            source_url: doc.url ?? null,
            kind: "source_pull",
            summary: sourceDocumentSummary(doc, Boolean(embedding)),
            extracted,
            suggestion: null,
            classified_at: null,
            embedding: embedding as unknown as string | null,
          })
          .select("id")
          .single()
        if (error) throw new Error(`knowledge insert failed: ${error.message}`)
        summary.stored += 1
        if (!embedding) summary.unindexed += 1
        if (report) {
          report.knowledgeStatus = embedding ? "stored" : "stored_unindexed"
          report.knowledgeId = data?.id as string | undefined
          if (indexSkipMessage) report.knowledgeError = indexSkipMessage
        }
      }
    } catch (error) {
      summary.failed += 1
      if (report) {
        report.knowledgeStatus = "failed"
        report.knowledgeError = errorMessage(error)
      }
    }
  }

  return summary
}

async function resolveSourceKnowledgeEmbeddingRuntime(
  supabase: AdminClient,
  project: ProjectScope,
): Promise<{ ok: true; runtime: EmbedRuntime } | { ok: false; message: string }> {
  let platformProject: boolean
  try {
    platformProject = await isPlatformMediaProject(supabase, project.id, project.org_id)
  } catch (error) {
    return { ok: false, message: `Workspace billing policy could not be resolved: ${errorMessage(error)}` }
  }

  if (platformProject) {
    if (!OPENAI_API_KEY) return { ok: false, message: "Platform OpenAI embeddings are not configured." }
    return { ok: true, runtime: { provider: "openai", key: OPENAI_API_KEY, model: OPENAI_EMBED_MODEL, keySource: "platform" } }
  }

  try {
    const openai = await loadClientApiKey(supabase, project.id, ["openai"])
    if (openai?.key) {
      return { ok: true, runtime: { provider: "openai", key: openai.key, model: OPENAI_EMBED_MODEL, keySource: "client" } }
    }
  } catch (error) {
    return { ok: false, message: `Client OpenAI key for semantic source indexing is unavailable: ${errorMessage(error)}` }
  }
  return { ok: false, message: "Add a client OpenAI key to make pulled source knowledge semantic-searchable." }
}

async function embedSourceKnowledge(
  supabase: AdminClient,
  project: ProjectScope,
  runtime: EmbedRuntime,
  text: string,
  budgetWarning: ProjectAiBudgetWarning | null,
): Promise<number[]> {
  const startedAt = Date.now()
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: runtime.model,
      input: text.slice(0, 8000),
    }),
  })
  if (!response.ok) throw new Error(`OpenAI embed failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const data = await response.json() as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } }
  const embedding = data.data?.[0]?.embedding
  if (!embedding?.length) throw new Error("OpenAI embed response did not include an embedding")
  await logGenerationUsage(supabase, {
    orgId: project.org_id,
    projectId: project.id,
    provider: runtime.provider,
    model: runtime.model,
    operation: "knowledge.embed",
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? null,
    outputTokens: 0,
    durationMs: Date.now() - startedAt,
    metadata: {
      key_source: runtime.keySource,
      source: "business_context_source_pull",
      ...(budgetWarning ? { budget_warning: budgetWarning } : {}),
    },
  })
  return embedding
}

async function findExistingSourceKnowledge(
  supabase: SupabaseAdminClient,
  projectId: string,
  sourceUrl: string,
) {
  const { data, error } = await supabase
    .from("project_knowledge")
    .select("id")
    .eq("project_id", projectId)
    .eq("source_url", sourceUrl)
    .eq("kind", "source_pull")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`knowledge lookup failed: ${error.message}`)
  return data as { id: string } | null
}

function findSourceReport(reports: SourceReport[], doc: SourceDocument) {
  return reports.find(report => report.ok && report.label === doc.label && report.url === doc.url)
    ?? reports.find(report => report.ok && report.label === doc.label)
}

function sourceDocumentKnowledgeContent(doc: SourceDocument) {
  return [
    `# ${doc.label}`,
    `Source URL: ${doc.url ?? ""}`,
    `Connector: ${sourceConnectorName(doc.source)}`,
    `Items collected: ${doc.items}${doc.requestedItems ? `/${doc.requestedItems}` : ""}`,
    "",
    doc.text.slice(0, 120_000),
  ].join("\n")
}

function sourceDocumentSummary(doc: SourceDocument, indexed: boolean) {
  const count = doc.requestedItems ? `${doc.items}/${doc.requestedItems}` : String(doc.items)
  return `${sourceConnectorName(doc.source)} pulled ${count} item${doc.items === 1 ? "" : "s"} from ${doc.label}${indexed ? "" : " (stored without semantic embedding)"}.`
}

function sourceConnectorName(source: SourceDocument["source"]) {
  if (source === "unipile") return "Unipile"
  if (source === "apify") return "Apify"
  return "Direct"
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
- "activeChannels" should list only the channels the source makes strategy-valid for this client. Use comma-separated platform keys from: linkedin, youtube, medium, quora, reddit, x, instagram, facebook, blog, email. If the source is only a URL list with no strategic intent, infer from the provided source URLs. If the source says a channel is not part of strategy, omit it even if a URL exists.
- Use source posts, events, and newsletters to infer positioning, recurring topics, proof points, and content goals, but keep URLs in their own fields.
- "offer" should capture products, services, or core value proposition.
- "audience" should capture target customers, users, communities, industries, or decision makers.
- "customerProblems" should capture pains the client solves.
- "differentiators" should capture positioning and why the client is different.
- "proofPoints" should capture facts, numbers, case studies, credentials, or named evidence.
- "contentGoals" should capture messaging goals, campaign goals, themes, or calls to action.
- "speakerStrategy" should capture who VERA may write as, including brand account, founder, named person, internal expert, or team voice, and when each should be used.
- "platformToneOfVoice" should capture whether tone differs by medium or platform. Keep a shared brand core, but note channel-specific tone and structure when evidence supports it.
- "demandObjective" should capture the content objective or working growth assumption.
- "conversionPath" should capture where attention or engagement should go next.
- "channelStrategy" should capture the role of each channel or medium.
- "contentFormats" should capture the formats VERA should produce.
- "approvalModel" should capture who approves what and when.
- "approvalStakeholders" should capture named approvers, required stakeholder groups, and when one person versus all required stakeholders should approve.
- "engagementSignals" should capture comments, shares, clicks, traffic, objections, or other traction signals that matter.
- "samHandoffRules" should capture when content engagement should become research, sales follow-up, support follow-up, community action, or another next workflow.
- "learningCadence" should capture how often VERA should review performance and update recommendations.
- "channelOperatingPolicies" should remain empty unless the source clearly defines per-channel speaker, approval, publishing guard, measurement, or follow-up rules. If present, return compact JSON keyed by platform.
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
