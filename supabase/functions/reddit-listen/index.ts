// Reddit market-listening (READ-ONLY).
//
// Pulls what buyers are actually saying on Reddit about a topic via the
// Perplexity Sonar API, scoped to reddit.com, and returns a concise synthesis
// plus the cited Reddit threads. VERA never posts or comments to Reddit; this
// is intelligence only. The synthesis feeds the operator's real channels
// (LinkedIn, cold email, landing pages) and is saved to reddit_listens so it
// persists on the Measure surface.
//
// POST { project_id, topic }
//   -> { ok, listen: { id, topic, synthesis, sources, model, created_at } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import { checkProjectAiBudget, type ProjectAiBudgetWarning } from '../_shared/ai-policy.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY')
const PERPLEXITY_MODEL = Deno.env.get('PERPLEXITY_MODEL') ?? 'sonar'
const APPROX_CHARS_PER_TOKEN = 4
const REDDIT_LISTEN_MAX_TOKENS = 1200

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface SearchResult { title?: string; url?: string; date?: string }

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN))
}

async function checkResearchBudget(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  systemPrompt: string,
  userPrompt: string,
  metadata: Record<string, unknown>,
): Promise<BudgetCheck> {
  const budget = await checkProjectAiBudget(supabase, projectId, {
    orgId,
    projectId,
    provider: 'perplexity',
    model: PERPLEXITY_MODEL,
    operation: 'research.reddit_listen',
    inputTokens: approxTokens(`${systemPrompt}\n\n${userPrompt}`),
    outputTokens: REDDIT_LISTEN_MAX_TOKENS,
    metadata,
  })
  if (!budget.ok) return { ok: false, message: budget.message }
  return { ok: true, warning: budget.warning }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  let body: { project_id?: string; topic?: string }
  try { body = await req.json() } catch { return jsonError('Invalid JSON body', 400) }
  const projectId = body.project_id?.trim()
  const topic = body.topic?.trim()
  if (!projectId) return jsonError('project_id is required', 400)
  if (!topic) return jsonError('topic is required', 400)
  if (topic.length > 400) return jsonError('topic is too long (max 400 characters)', 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const auth = await requireProjectMember(
    req, supabase as unknown as AdminClient, SUPABASE_SERVICE_ROLE_KEY, projectId, corsHeaders,
  )
  if (!auth.ok) return auth.response

  if (!PERPLEXITY_API_KEY) {
    return jsonError('Reddit listening is not configured yet. Add the PERPLEXITY_API_KEY env var to enable it.', 503)
  }

  const system = [
    'You are a B2B market researcher mining Reddit for go-to-market intelligence.',
    'Using only what people actually say on Reddit, surface the buyer pain points, objections, desired outcomes, and the exact phrasing they use about the topic.',
    'Structure the answer as short markdown sections: Pain points, Objections, Desired outcomes, Notable quotes (verbatim and short), and Where to engage (the relevant subreddits).',
    'Be concise and concrete. Quote real phrasing where useful. Do not invent threads or quotes. If the evidence is thin, say so plainly.',
  ].join(' ')
  const userPrompt = `Topic: ${topic}\n\nWhat are buyers saying about this on Reddit right now?`
  const usageMetadata = {
    source: 'reddit_listening',
    search_domain_filter: ['reddit.com'],
    topic_length: topic.length,
  }
  const budget = await checkResearchBudget(
    supabase as unknown as AdminClient,
    auth.orgId,
    projectId,
    system,
    userPrompt,
    usageMetadata,
  )
  if (!budget.ok) return jsonError(budget.message, 402)

  let pplxRes: Response
  const startedAt = Date.now()
  try {
    pplxRes = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        search_domain_filter: ['reddit.com'],
        temperature: 0.2,
        max_tokens: REDDIT_LISTEN_MAX_TOKENS,
      }),
    })
  } catch (e) {
    return jsonError(`Perplexity request failed: ${(e as Error).message}`, 502)
  }

  if (!pplxRes.ok) {
    const detail = await pplxRes.text().catch(() => '')
    return jsonError(`Perplexity returned HTTP ${pplxRes.status}. ${detail.slice(0, 300)}`, 502)
  }

  const data = await pplxRes.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
    search_results?: SearchResult[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  } | null
  if (!data) return jsonError('Perplexity returned an unreadable response', 502)

  const synthesis = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!synthesis) return jsonError('Perplexity returned no synthesis', 502)

  // Prefer search_results (title + url); fall back to bare citation URLs.
  const sources = (data.search_results?.length
    ? data.search_results.map(s => ({ title: s.title ?? s.url ?? 'Reddit thread', url: s.url ?? '' }))
    : (data.citations ?? []).map(u => ({ title: u, url: u }))
  ).filter(s => s.url).slice(0, 20)

  const { data: row, error: insertErr } = await supabase
    .from('reddit_listens')
    .insert({
      org_id: auth.orgId,
      project_id: projectId,
      created_by: auth.userId,
      topic,
      synthesis,
      sources,
      model: PERPLEXITY_MODEL,
    })
    .select('id, topic, synthesis, sources, model, created_at')
    .single()
  if (insertErr) return jsonError(`Failed to save listen: ${insertErr.message}`, 500)

  await logGenerationUsage(supabase as unknown as AdminClient, {
    orgId: auth.orgId,
    projectId,
    provider: 'perplexity',
    model: PERPLEXITY_MODEL,
    operation: 'research.reddit_listen',
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? approxTokens(`${system}\n\n${userPrompt}`),
    outputTokens: data.usage?.completion_tokens ?? approxTokens(synthesis),
    durationMs: Date.now() - startedAt,
    metadata: {
      ...usageMetadata,
      result_count: sources.length,
      ...(budget.warning ? { budget_warning: budget.warning } : {}),
    },
  })

  return new Response(JSON.stringify({ ok: true, listen: row, ...(budget.warning ? { budget_warning: budget.warning } : {}) }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
