// project-ingest accepts paste / URL / file-already-in-storage,
// indexes or stores text content in project_knowledge and writes raw file
// metadata to project_assets.
//
// Modes:
//   { kind: 'paste',   project_id, title, content }
//     → chunks + embeds when the client has an embedding key, otherwise
//       stores raw project knowledge for fallback retrieval.
//
//   { kind: 'url',     project_id, title?, source_url }
//     → fetches URL, strips HTML, chunks + embeds when possible, stores in
//       project_knowledge with source_kind='url' + source_url.
//
//   { kind: 'file',    project_id, storage_path, file_name, mime_type,
//                      file_size, asset_kind }
//     → looks up the file in Storage, records in project_assets.
//       For text-bearing files (md, txt, csv, json), additionally fetches
//       and ingests text into project_knowledge, linking the two rows.
//       PDF / DOCX / images stored raw; text extraction is a follow-up.
//
// All flows return { ok: true, id, chunks_ingested?, indexed? }.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.types.ts'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import { isPlatformMediaProject, loadClientApiKey } from '../_shared/client-media-keys.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'
import mammoth from 'npm:mammoth@1.8.0'

const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const OPENAI_EMBED_MODEL = Deno.env.get('OPENAI_EMBED_MODEL') ?? 'text-embedding-3-small'
const ANTHROPIC_CLASSIFY_MODEL = Deno.env.get('ANTHROPIC_CLASSIFY_MODEL') ?? 'claude-haiku-4-5'
const OPENROUTER_CLASSIFY_MODEL = Deno.env.get('OPENROUTER_CLASSIFY_MODEL') ?? 'google/gemini-2.5-flash'
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type ProjectScope = { id: string; org_id: string; name?: string | null }
type EmbedRuntime = { provider: 'openai'; key: string; model: string; keySource: 'platform' | 'client' }
type RuntimeAudit = {
  selectionSource: 'recommended_standard'
  selectionReason: string
  requestedModel: string | null
  policyDefaultModel: string | null
}
type ClassifyRuntime =
  | ({ provider: 'anthropic'; key: string; model: string; keySource: 'platform' | 'client' } & RuntimeAudit)
  | ({ provider: 'openrouter'; key: string; model: string; keySource: 'client' } & RuntimeAudit)
type IngestRuntimes = {
  embedding: EmbedRuntime | null
  classifier: ClassifyRuntime | null
  embeddingUnavailableReason: string | null
}

// ─── helpers ─────────────────────────────────────────────────────────
function chunkText(text: string, max = 1200, overlap = 150): string[] {
  const out: string[] = []
  let i = 0
  const clean = text.replace(/\r\n/g, '\n').trim()
  while (i < clean.length) {
    out.push(clean.slice(i, i + max))
    i += max - overlap
  }
  return out.filter(c => c.trim().length > 50)
}

async function embed(
  supabase: AdminClient,
  project: ProjectScope,
  runtime: EmbedRuntime,
  text: string,
): Promise<number[]> {
  const startedAt = Date.now()
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${runtime.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: runtime.model,
      input: text.slice(0, 8000), // hard cap to be safe
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embed failed: ${res.status} ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } }
  await logGenerationUsage(supabase, {
    orgId: project.org_id,
    projectId: project.id,
    provider: runtime.provider,
    model: runtime.model,
    operation: 'knowledge.embed',
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? null,
    outputTokens: 0,
    durationMs: Date.now() - startedAt,
    metadata: { key_source: runtime.keySource },
  })
  return data.data[0].embedding
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`)
  const html = await res.text()
  return stripHtml(html)
}

const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/x-markdown',
  'application/json', 'application/javascript', 'text/javascript',
  'text/html',
])

// Binary text-bearing formats — parsed with dedicated libs before ingest.
const PDF_MIMES = new Set([
  'application/pdf',
  'application/x-pdf',
])
const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword',                                                       // .doc (mammoth handles many)
])

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  // unpdf is Deno/edge-friendly; returns array of per-page strings.
  const doc = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(doc, { mergePages: true })
  return Array.isArray(text) ? text.join('\n\n') : (text as string)
}

async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value ?? ''
}

// ─── handler ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method not allowed' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const kind = body.kind as string
  const project_id = body.project_id as string
  if (!project_id) return json(400, { error: 'project_id required' })

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireProjectMember(req, supabase, SERVICE_KEY, project_id, cors)
  if (!auth.ok) return auth.response

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, org_id, name')
    .eq('id', project_id)
    .maybeSingle()
  if (projErr || !project) return json(404, { error: 'project not found' })
  const projectScope = project as ProjectScope

  try {
    if (kind === 'paste') {
      const runtimes = await resolveIngestRuntimes(supabase as unknown as AdminClient, projectScope)
      if (!runtimes.ok) return runtimes.response
      return await ingestText(supabase, projectScope, runtimes.value, body.title as string ?? 'Pasted note', body.content as string, 'paste', null, null, null)
    }
    if (kind === 'url') {
      const sourceUrl = body.source_url as string
      if (!sourceUrl) return json(400, { error: 'source_url required for kind=url' })
      const runtimes = await resolveIngestRuntimes(supabase as unknown as AdminClient, projectScope)
      if (!runtimes.ok) return runtimes.response
      const text = await fetchUrlText(sourceUrl)
      const title = (body.title as string) || sourceUrl
      return await ingestText(supabase, projectScope, runtimes.value, title, text, 'url', sourceUrl, null, null)
    }
    if (kind === 'file') {
      const storagePath = body.storage_path as string
      const fileName = body.file_name as string
      const mimeType = body.mime_type as string
      const fileSize = body.file_size as number
      const assetKind = (body.asset_kind as string) ?? 'other'
      if (!storagePath || !fileName || !mimeType) {
        return json(400, { error: 'storage_path, file_name, mime_type required for kind=file' })
      }

      // 1. Record the asset
      const { data: assetRow, error: assetErr } = await supabase
        .from('project_assets')
        .insert({
          project_id,
          name: fileName,
          kind: assetKind,
          mime_type: mimeType,
          storage_path: storagePath,
          file_size: fileSize,
        })
        .select()
        .single()
      if (assetErr) throw new Error(`asset insert failed: ${assetErr.message}`)

      // 2. Text extraction — three paths depending on MIME:
      //    a. plain-text-like → fileBlob.text()
      //    b. PDF              → unpdf
      //    c. DOCX/DOC         → mammoth
      //    d. anything else (image/font/video/etc) → store raw, no extraction
      const isPlainText = TEXT_MIMES.has(mimeType) || mimeType.startsWith('text/')
      const isPdf       = PDF_MIMES.has(mimeType)
      const isDocx      = DOCX_MIMES.has(mimeType)

      if (isPlainText || isPdf || isDocx) {
        const runtimes = await resolveIngestRuntimes(supabase as unknown as AdminClient, projectScope)
        if (!runtimes.ok) {
          return json(200, {
            ok: true,
            asset_id: assetRow.id,
            chunks_ingested: 0,
            note: `asset stored; text was not made searchable: ${runtimes.message}`,
          })
        }
        const { data: fileBlob, error: dlErr } = await supabase.storage
          .from('project-assets')
          .download(storagePath)
        if (dlErr || !fileBlob) {
          return json(200, { ok: true, asset_id: assetRow.id, chunks_ingested: 0, note: 'asset stored; text extraction skipped (download failed)' })
        }
        let text = ''
        try {
          if (isPlainText) text = await fileBlob.text()
          else if (isPdf)  text = await extractPdfText(await fileBlob.arrayBuffer())
          else if (isDocx) text = await extractDocxText(await fileBlob.arrayBuffer())
        } catch (e) {
          // Extraction blew up — still keep the asset, just skip knowledge
          return json(200, {
            ok: true,
            asset_id: assetRow.id,
            chunks_ingested: 0,
            note: `asset stored; extraction failed: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
        if (!text || text.trim().length < 30) {
          return json(200, { ok: true, asset_id: assetRow.id, chunks_ingested: 0, note: 'asset stored; extracted text too short to embed' })
        }
        const knowledgeResult = await ingestText(supabase, projectScope, runtimes.value, fileName, text, 'upload', null, fileName, fileSize)
        const knowledgeJson = await knowledgeResult.json() as {
          id?: string
          chunks_ingested?: number
          chunks_available?: number
          indexed?: boolean
          note?: string
        }
        if (knowledgeJson.id) {
          await supabase.from('project_assets')
            .update({ knowledge_id: knowledgeJson.id })
            .eq('id', assetRow.id)
        }
        return json(200, {
          ok: true,
          asset_id: assetRow.id,
          knowledge_id: knowledgeJson.id,
          chunks_ingested: knowledgeJson.chunks_ingested,
          chunks_available: knowledgeJson.chunks_available,
          indexed: knowledgeJson.indexed,
          note: knowledgeJson.note,
          extracted_chars: text.length,
        })
      }

      // Other binary (image / font / video / etc) — stored raw, no extraction
      return json(200, { ok: true, asset_id: assetRow.id, chunks_ingested: 0, note: 'binary asset stored; no text extracted' })
    }

    return json(400, { error: `unknown kind: ${kind}` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json(500, { error: msg })
  }
})

async function resolveIngestRuntimes(
  supabase: AdminClient,
  project: ProjectScope,
): Promise<{ ok: true; value: IngestRuntimes } | { ok: false; response: Response; message: string }> {
  let platformProject: boolean
  try {
    platformProject = await isPlatformMediaProject(supabase, project.id, project.org_id)
  } catch (error) {
    return {
      ok: false,
      response: json(500, { error: `Could not resolve workspace billing policy: ${errorMessage(error)}` }),
      message: 'workspace billing policy could not be resolved',
    }
  }

  if (platformProject) {
    return {
      ok: true,
      value: {
        embedding: OPENAI_API_KEY
          ? { provider: 'openai', key: OPENAI_API_KEY, model: OPENAI_EMBED_MODEL, keySource: 'platform' }
          : null,
        classifier: ANTHROPIC_API_KEY
          ? classifierRuntime('anthropic', ANTHROPIC_API_KEY, ANTHROPIC_CLASSIFY_MODEL, 'platform')
          : null,
        embeddingUnavailableReason: OPENAI_API_KEY ? null : 'platform OpenAI embeddings are not configured',
      },
    }
  }

  let embedding: EmbedRuntime | null = null
  let embeddingUnavailableReason: string | null = null
  try {
    const openai = await loadClientApiKey(supabase, project.id, ['openai'])
    if (openai?.key) {
      embedding = { provider: 'openai', key: openai.key, model: OPENAI_EMBED_MODEL, keySource: 'client' }
    } else {
      embeddingUnavailableReason = 'no client OpenAI key configured for semantic embeddings'
    }
  } catch (error) {
    embeddingUnavailableReason = `client OpenAI key is unavailable: ${errorMessage(error)}`
  }

  const classifier = await resolveClientClassifierRuntime(supabase, project)

  return {
    ok: true,
    value: {
      embedding,
      classifier,
      embeddingUnavailableReason,
    },
  }
}

async function resolveClientClassifierRuntime(
  supabase: AdminClient,
  project: ProjectScope,
): Promise<ClassifyRuntime | null> {
  let openRouter: { key: string; provider: string } | null = null
  try {
    openRouter = await loadClientApiKey(supabase, project.id, ['openrouter'])
  } catch (error) {
    console.warn(`knowledge OpenRouter classifier key unavailable: ${errorMessage(error)}`)
  }
  if (openRouter?.key) {
    return classifierRuntime('openrouter', openRouter.key, OPENROUTER_CLASSIFY_MODEL, 'client')
  }

  let anthropic: { key: string; provider: string } | null = null
  try {
    anthropic = await loadClientApiKey(supabase, project.id, ['anthropic'])
  } catch (error) {
    console.warn(`knowledge Anthropic classifier key unavailable: ${errorMessage(error)}`)
  }
  if (anthropic?.key) {
    return classifierRuntime('anthropic', anthropic.key, ANTHROPIC_CLASSIFY_MODEL, 'client')
  }

  return null
}

function classifierRuntime(
  provider: ClassifyRuntime['provider'],
  key: string,
  model: string,
  keySource: ClassifyRuntime['keySource'],
): ClassifyRuntime {
  return {
    provider,
    key,
    model,
    keySource,
    selectionSource: 'recommended_standard',
    selectionReason: provider === 'openrouter'
      ? 'Knowledge classification uses the configured low-cost OpenRouter route.'
      : 'Knowledge classification uses the configured Anthropic classifier route.',
    requestedModel: null,
    policyDefaultModel: null,
  } as ClassifyRuntime
}

function classifierUsageMetadata(runtime: ClassifyRuntime): Record<string, unknown> {
  return {
    key_source: runtime.keySource,
    requested_model: runtime.requestedModel,
    policy_default_model: runtime.policyDefaultModel,
    model_selection_source: runtime.selectionSource,
    model_selection_reason: runtime.selectionReason,
  }
}

// ─── classify — VERA reads each ingested doc and tags it ──────────────
// Async, fire-and-forget after the knowledge row is inserted. Sets:
//   · kind        — brief / voice / audit / positioning / case_study /
//                   intel / reference / other
//   · summary     — 1-2 sentence VERA-voice summary
//   · extracted   — kind-specific structured fields
//   · suggestion  — one agentic propose-action
//
// Falls back silently on error — the knowledge row stays usable for
// retrieval even if classification fails.
async function classifyAndStore(
  supabase: AdminClient,
  project: ProjectScope,
  runtime: ClassifyRuntime | null,
  knowledgeId: string,
  content: string,
): Promise<void> {
  if (!runtime) return

  const sys = `You are VERA, a B2B content strategist reading a document an operator just dropped into their project's knowledge base.

Read it once. Classify what it is, summarize it, pull out the most useful structured fields, and propose ONE concrete next action.

Return ONLY a JSON object with this exact shape:
{
  "kind": "brief" | "voice" | "audit" | "positioning" | "case_study" | "intel" | "reference" | "other",
  "summary": "1-2 sentence summary in your voice — what this doc IS, plainly",
  "extracted": { /* kind-specific — see below — null if nothing fits */ },
  "suggestion": "One concrete next action you propose, written as if speaking to the operator"
}

Kind-specific 'extracted' shape:
  · brief        → { audience, value_prop, key_messages: [], cta, channel?: string }
  · voice        → { tone: [], writing_rules: [], forbidden_phrases: [], required_phrases: [] }
  · audit        → { overall_finding, top_fixes: [], strengths: [] }
  · positioning  → { category, differentiator, target_persona, against_who }
  · case_study   → { customer, outcome_number, mechanism, quote }
  · intel        → { competitor, what_happened, why_it_matters }
  · reference    → { what_it_documents, useful_when }
  · other        → null

Suggestion examples:
  · "Want me to apply these as the project's brand voice rules?"
  · "Want me to draft 3 posts from this brief?"
  · "Want me to update the audit context with this positioning?"
  · "Keep as reference — I'll pull it in when relevant."`

  const body = {
    model: runtime.model,
    max_tokens: 1024,
    system: sys,
    messages: [{
      role: 'user',
      content: `Document content (first 4000 chars):\n\n${content.slice(0, 4000)}`,
    }],
  }

  try {
    const startedAt = Date.now()
    const result = runtime.provider === 'openrouter'
      ? await classifyWithOpenRouter(runtime, sys, body.messages[0].content)
      : await classifyWithAnthropic(runtime, body)
    const text = result.text
    // Strip markdown fences if Claude wrapped JSON
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    let parsed: { kind?: string; summary?: string; extracted?: unknown; suggestion?: string }
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      console.warn(`classify: bad JSON: ${cleaned.slice(0, 200)}`)
      return
    }
    await supabase.from('project_knowledge').update({
      kind: parsed.kind ?? 'other',
      summary: parsed.summary ?? null,
      extracted: (parsed.extracted ?? null) as Json | null,
      suggestion: parsed.suggestion ?? null,
      classified_at: new Date().toISOString(),
    }).eq('id', knowledgeId)
    await logGenerationUsage(supabase, {
      orgId: project.org_id,
      projectId: project.id,
      provider: runtime.provider,
      model: runtime.model,
      operation: 'knowledge.classify',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: Date.now() - startedAt,
      metadata: classifierUsageMetadata(runtime),
    })
  } catch (e) {
    console.warn(`classify: ${e instanceof Error ? e.message : String(e)}`)
    await supabase.from('project_knowledge').update({
      kind: 'reference',
      summary: 'Stored as project knowledge. Classification failed, but VERA can still retrieve the content.',
      extracted: null,
      suggestion: null,
      classified_at: new Date().toISOString(),
    }).eq('id', knowledgeId).is('classified_at', null)
  }
}

async function classifyWithAnthropic(
  runtime: Extract<ClassifyRuntime, { provider: 'anthropic' }>,
  body: Record<string, unknown>,
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': runtime.key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  return {
    text: data.content?.find(c => c.type === 'text')?.text?.trim() ?? '',
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  }
}

async function classifyWithOpenRouter(
  runtime: Extract<ClassifyRuntime, { provider: 'openrouter' }>,
  system: string,
  userContent: string,
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vera.innovareai.com',
      'X-Title': 'VERA Knowledge Classification',
    },
    body: JSON.stringify({
      model: runtime.model,
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}`)
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? '',
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  }
}

// ─── ingestText — chunks, embeds, writes to project_knowledge ────────
async function ingestText(
  supabase: AdminClient,
  project: ProjectScope,
  runtimes: IngestRuntimes,
  title: string,
  content: string,
  sourceKind: 'paste' | 'url' | 'upload',
  sourceUrl: string | null,
  fileName: string | null,
  fileSize: number | null,
): Promise<Response> {
  if (!content || content.trim().length < 30) {
    return json(400, { error: 'content too short (<30 chars)' })
  }

  // For embedding a "document" head, embed first chunk as the representative.
  const chunks = chunkText(content)
  if (chunks.length === 0) return json(400, { error: 'no usable chunks after splitting' })

  // We store ONE row per document with the full content + an embedding of the
  // head (first ~1200 chars). For larger docs, future revision can split rows.
  const headEmbedding = runtimes.embedding
    ? await embed(supabase, project, runtimes.embedding, chunks[0])
    : null
  const indexed = Boolean(headEmbedding)
  const classifiedAt = runtimes.classifier ? null : new Date().toISOString()
  const rawSummary = indexed
    ? 'Stored as project knowledge. Add a classifier key to auto-summarize and tag future uploads.'
    : `Stored as raw project knowledge. ${runtimes.embeddingUnavailableReason ?? 'No embedding runtime is available.'}`

  const { data: row, error: insErr } = await supabase
    .from('project_knowledge')
    .insert({
      project_id: project.id,
      title,
      content,
      source_kind: sourceKind,
      source_url: sourceUrl,
      file_name: fileName,
      file_size: fileSize,
      embedding: headEmbedding as unknown as string | null,
      kind: runtimes.classifier ? null : 'reference',
      summary: runtimes.classifier ? null : rawSummary,
      extracted: runtimes.classifier
        ? null
        : {
            indexed,
            chunks: chunks.length,
            storage: indexed ? 'semantic' : 'raw',
            reason: indexed ? null : runtimes.embeddingUnavailableReason,
          } as Json,
      classified_at: classifiedAt,
    })
    .select()
    .single()
  if (insErr) throw new Error(`knowledge insert failed: ${insErr.message}`)

  // Agentic next step — VERA classifies the doc and proposes an action.
  // Fire-and-forget so the upload response stays fast; the UI polls or
  // re-fetches and shows the classification when ready (typically 1-3s).
  if (runtimes.classifier) {
    // @ts-expect-error EdgeRuntime is provided by the Supabase edge runtime.
    EdgeRuntime.waitUntil(classifyAndStore(supabase, project, runtimes.classifier, row.id as string, content))
  }

  return json(200, {
    ok: true,
    id: row.id,
    chunks_ingested: indexed ? chunks.length : 0,
    chunks_available: chunks.length,
    indexed,
    note: indexed ? null : rawSummary,
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
