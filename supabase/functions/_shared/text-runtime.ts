import Anthropic from "npm:@anthropic-ai/sdk"
import type { AdminClient } from "./auth.ts"
import { loadProjectAiPolicy } from "./ai-policy.ts"
import { isPlatformMediaProject, loadClientApiKey } from "./client-media-keys.ts"
import { selectTextModel, type ModelSelectionSource } from "./model-recommendations.ts"

const PLATFORM_ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""
const DEFAULT_ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_AUDIT_MODEL") ?? "claude-sonnet-4-6"
const DEFAULT_OPENROUTER_MODEL = Deno.env.get("OPENROUTER_TEXT_MODEL") ?? "google/gemini-2.5-flash"

type TextRuntimeAudit = {
  selectionSource: ModelSelectionSource
  selectionReason: string
  requestedModel: string | null
  policyDefaultModel: string | null
}

export type TextRuntime =
  | ({ provider: "anthropic"; key: string; model: string; keySource: "platform" | "client" } & TextRuntimeAudit)
  | ({ provider: "openrouter"; key: string; model: string; keySource: "client" } & TextRuntimeAudit)

export type TextRuntimeResult =
  | { ok: true; runtime: TextRuntime }
  | { ok: false; message: string; status: number }

export async function resolveProjectTextRuntime(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  opts: {
    anthropicModel?: string
    openRouterModel?: string
    preferOpenRouter?: boolean
    purpose?: string
  } = {},
): Promise<TextRuntimeResult> {
  const purpose = opts.purpose ?? "this AI operation"
  let defaultTextModel: string | null
  try {
    defaultTextModel = (await loadProjectAiPolicy(supabase, projectId)).defaultTextModel
  } catch {
    defaultTextModel = null
  }
  const anthropicSelection = selectTextModel({
    provider: "anthropic",
    requestedModel: opts.anthropicModel,
    policyDefaultModel: defaultTextModel,
    fallbackModel: DEFAULT_ANTHROPIC_MODEL,
  })
  const openRouterSelection = selectTextModel({
    provider: "openrouter",
    requestedModel: opts.openRouterModel,
    policyDefaultModel: defaultTextModel,
    fallbackModel: DEFAULT_OPENROUTER_MODEL,
  })

  let platformProject: boolean
  try {
    platformProject = await isPlatformMediaProject(supabase, projectId, orgId)
  } catch (error) {
    return { ok: false, status: 500, message: errorMessage(error) }
  }

  if (platformProject) {
    if (!PLATFORM_ANTHROPIC_KEY) {
      return { ok: false, status: 500, message: "ANTHROPIC_API_KEY is not configured" }
    }
    return {
      ok: true,
      runtime: {
        provider: "anthropic",
        key: PLATFORM_ANTHROPIC_KEY,
        model: anthropicSelection.alias,
        keySource: "platform",
        ...runtimeAudit(anthropicSelection, opts.anthropicModel, defaultTextModel),
      },
    }
  }

  const providerOrder = opts.preferOpenRouter === false
    ? [["anthropic"], ["openrouter"]]
    : [["openrouter"], ["anthropic"]]
  for (const providers of providerOrder) {
    let clientKey: { key: string; provider: string } | null
    try {
      clientKey = await loadClientApiKey(supabase, projectId, providers)
    } catch (error) {
      return { ok: false, status: 403, message: errorMessage(error) }
    }
    if (!clientKey?.key) continue
    if (clientKey.provider === "openrouter") {
      return {
        ok: true,
        runtime: {
          provider: "openrouter",
          key: clientKey.key,
          model: openRouterSelection.alias,
          keySource: "client",
          ...runtimeAudit(openRouterSelection, opts.openRouterModel, defaultTextModel),
        },
      }
    }
    return {
      ok: true,
      runtime: {
        provider: "anthropic",
        key: clientKey.key,
        model: anthropicSelection.alias,
        keySource: "client",
        ...runtimeAudit(anthropicSelection, opts.anthropicModel, defaultTextModel),
      },
    }
  }

  return {
    ok: false,
    status: 403,
    message: `${purpose} requires this client space to use its own OpenRouter or Anthropic key.`,
  }
}

export function textRuntimeUsageMetadata(
  runtime: TextRuntime,
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

export async function completeText(
  runtime: TextRuntime,
  params: {
    system?: string
    user: string
    maxTokens: number
    temperature?: number
    json?: boolean
  },
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  if (runtime.provider === "openrouter") return completeOpenRouter(runtime, params)
  return completeAnthropic(runtime, params)
}

export async function streamText(
  runtime: TextRuntime,
  params: {
    system?: string
    user: string
    maxTokens: number
    temperature?: number
    json?: boolean
    onText: (text: string) => void
  },
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  if (runtime.provider === "openrouter") {
    const result = await completeOpenRouter(runtime, params)
    if (result.text) params.onText(result.text)
    return result
  }

  const anthropic = new Anthropic({ apiKey: runtime.key })
  const msgStream = anthropic.messages.stream({
    model: runtime.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature ?? 0.2,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  })

  let text = ""
  for await (const ev of msgStream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      text += ev.delta.text
      params.onText(ev.delta.text)
    }
  }
  return { text, inputTokens: null, outputTokens: null }
}

async function completeAnthropic(
  runtime: Extract<TextRuntime, { provider: "anthropic" }>,
  params: {
    system?: string
    user: string
    maxTokens: number
    temperature?: number
  },
) {
  const anthropic = new Anthropic({ apiKey: runtime.key })
  const response = await anthropic.messages.create({
    model: runtime.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature ?? 0.2,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  })
  return {
    text: response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join(""),
    inputTokens: response.usage.input_tokens ?? null,
    outputTokens: response.usage.output_tokens ?? null,
  }
}

async function completeOpenRouter(
  runtime: Extract<TextRuntime, { provider: "openrouter" }>,
  params: {
    system?: string
    user: string
    maxTokens: number
    temperature?: number
    json?: boolean
  },
) {
  const messages: Array<{ role: "system" | "user"; content: string }> = []
  if (params.system) messages.push({ role: "system", content: params.system })
  messages.push({ role: "user", content: params.user })

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vera.innovareai.com",
      "X-Title": "VERA",
    },
    body: JSON.stringify({
      model: runtime.model,
      messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens,
      ...(params.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => "")
    throw new Error(`OpenRouter failed with HTTP ${res.status}: ${err.slice(0, 240)}`)
  }
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function runtimeAudit(
  selection: { source: ModelSelectionSource; reason: string },
  requestedModel: unknown,
  policyDefaultModel: string | null,
): TextRuntimeAudit {
  return {
    selectionSource: selection.source,
    selectionReason: selection.reason,
    requestedModel: cleanString(requestedModel),
    policyDefaultModel,
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
