// Brew360 Filter — ported from SAM's lib/brew-audit/run-audit.ts
//
// Scores a LinkedIn profile + recent posts against the 5 principles of
// LinkedIn's 360Brew algorithm (their unified 150B-parameter recommendation
// model). Returns a structured JSON audit with per-principle scores, profile
// optimisation suggestions, content strategy, and quick wins.
//
// Uses the active project's Strategy Brain LinkedIn profile URL as the audit
// target. The connected Unipile account is read-only research access, not proof
// that the connected account itself is the client profile.
//
// POST { org_id }  →  { success, audit, profile_summary, posts_analyzed }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import type { Json } from '../_shared/database.types.ts'
import { checkProjectAiBudget, type ProjectAiBudgetWarning } from '../_shared/ai-policy.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'
import { resolveProjectTextRuntime, streamText, textRuntimeUsageMetadata, type TextRuntime } from '../_shared/text-runtime.ts'
import { resolveUnipileResearchConnection } from '../_shared/unipile-research.ts'
import { linkedInPersonalUrl, projectHasLinkedInStrategy, resolveProjectAuditChannels } from '../_shared/project-sources.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN     = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')
const APPROX_CHARS_PER_TOKEN = 4
const BREW360_MAX_TOKENS = 4096

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  const { org_id, project_id, principles: enabledIn, operator_user_id } = await req.json().catch(() => ({}))
  if (!org_id) return jsonResponse({ success: false, error: 'org_id required' }, 400)
  if (!project_id) return jsonResponse({ success: false, error: 'project_id required' }, 400)
  // Caller can pass a subset of the 5 principles to score. Default: all 5.
  const ALL_PRINCIPLES = ['semantic_personalization','meaningful_engagement','relationship_intelligence','language_purity','content_authority'] as const
  const enabled: string[] = Array.isArray(enabledIn) && enabledIn.length
    ? (enabledIn as string[]).filter(p => (ALL_PRINCIPLES as readonly string[]).includes(p))
    : [...ALL_PRINCIPLES]
  if (!enabled.length) return jsonResponse({ success: false, error: 'At least one principle must be enabled.' }, 400)
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return jsonResponse({ success: false, error: 'UNIPILE not configured' }, 500)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as unknown as AdminClient

  // Caller must be the service (internal) or an org member — never anonymous,
  // and never another tenant reading this org's audit.
  const access = await requireProjectMember(req, supabase, SUPABASE_SERVICE_ROLE_KEY, project_id, corsHeaders, org_id)
  if (!access.ok) return access.response
  const requesterUserId = access.service ? cleanString(operator_user_id) : access.userId
  const runtime = await resolveProjectTextRuntime(supabase, org_id, project_id, {
    purpose: 'Brew360 audit',
  })
  if (!runtime.ok) return jsonResponse({ success: false, error: runtime.message }, runtime.status)

  // 1) Get read-only LinkedIn research access + the project's source URLs.
  //    The Unipile account is just a research token. The target to audit must
  //    come from the client Strategy Brain for client projects.
  const { data: org } = await supabase
    .from('organizations')
    .select('name, settings')
    .eq('id', org_id)
    .maybeSingle()
  const accountName = (org as { name?: string | null } | null)?.name ?? 'Workspace'
  const unipile = await resolveUnipileResearchConnection(supabase, org_id, { requesterUserId })
  if (!unipile.ok) {
    return jsonResponse({ success: false, error: `${unipile.error} Connect LinkedIn for this workspace or use an InnovareAI operator account.` }, 400)
  }
  const accountId = unipile.accountId
  const headers = { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' }
  const sourceResolution = await resolveProjectAuditChannels(supabase, org_id, project_id)
  if (!projectHasLinkedInStrategy(sourceResolution)) {
    return jsonResponse({
      success: false,
      error: 'LinkedIn audit is not enabled for this client strategy. Add a LinkedIn source or explicit LinkedIn strategy in the Strategy Brain first.',
    }, 400)
  }

  // Resolve audit target: prefer the project's LinkedIn profile URL. Fall back
  // to /me only for the default workspace project, preserving legacy internal
  // behavior without letting client projects audit the operator profile.
  let targetSlug: string | null = null
  let targetSource: 'project' | 'legacy_channel' | 'me' = 'me'
  let targetUrl: string | null = null

  const personalUrl = linkedInPersonalUrl(sourceResolution.channels)
  if (personalUrl) {
    const m = personalUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)
    if (m) {
      targetSlug = decodeURIComponent(m[1]).replace(/\/+$/, '')
      targetSource = sourceResolution.source === 'project_brain' ? 'project' : 'legacy_channel'
      targetUrl = personalUrl
    }
  }

  if (!targetSlug && !sourceResolution.project.is_default) {
    return jsonResponse({
      success: false,
      error: 'Add this client LinkedIn profile URL to the Strategy Brain before running a 360Brew audit. Shared research profiles cannot be audited as the client.',
    }, 400)
  }

  // 2) Fetch the target profile. If we resolved a channel slug, use it
  //    directly; otherwise fall back to /me (existing behavior).
  let myProviderId: string | null = null
  let fullProfile: Record<string, unknown> = {}

  if (targetSlug) {
    const profileRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(targetSlug)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*`,
      { headers, signal: AbortSignal.timeout(30_000) },
    )
    if (profileRes.ok) {
      fullProfile = await profileRes.json() as Record<string, unknown>
      myProviderId = (fullProfile.provider_id as string) ?? null
    } else {
      if (!sourceResolution.project.is_default) {
        const errText = await profileRes.text()
        return jsonResponse({
          success: false,
          error: `Client LinkedIn profile lookup failed (${profileRes.status}). Check the Strategy Brain LinkedIn profile URL. ${errText.slice(0, 200)}`,
        }, 502)
      }
      // Slug did not resolve for the legacy default workspace path, preserve
      // the old /me fallback there only.
      console.warn(`brew360: slug "${targetSlug}" lookup failed (HTTP ${profileRes.status}); falling back to /me`)
      targetSlug = null
      targetSource = 'me'
      targetUrl = null
    }
  }

  if (!targetSlug) {
    const meRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/users/me?account_id=${accountId}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    )
    if (!meRes.ok) {
      return jsonResponse({ success: false, error: `Failed to fetch LinkedIn profile (HTTP ${meRes.status})` }, 502)
    }
    const meData = await meRes.json() as Record<string, unknown>
    myProviderId = (meData.provider_id as string) ?? null
    fullProfile = meData
    // Now refetch with linkedin_sections=* via provider_id (the /me shape is stripped)
    if (myProviderId) {
      const rich = await fetch(
        `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(myProviderId)}?account_id=${accountId}&linkedin_sections=*`,
        { headers, signal: AbortSignal.timeout(30_000) },
      )
      if (rich.ok) fullProfile = await rich.json() as Record<string, unknown>
    }
  }

  // 2b) Fetch recent posts for the resolved target via provider_id
  let posts: Array<Record<string, unknown>> = []
  if (myProviderId) {
    const postsRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(myProviderId)}/posts?account_id=${accountId}&limit=10`,
      { headers, signal: AbortSignal.timeout(30_000) },
    )
    if (postsRes.ok) {
      const postsData = await postsRes.json() as { items?: unknown[] }
      posts = (postsData.items ?? []) as Array<Record<string, unknown>>
    }
  }

  // 3) Pull brand_voice if it exists, preferring the active client project and
  // falling back to the org-level legacy row only when no project row exists.
  const { data: brandRows } = await supabase
    .from('brand_voice')
    .select('tone, writing_rules, forbidden_phrases, required_phrases, system_prompt, project_id, updated_at')
    .eq('org_id', org_id)
    .or(`project_id.eq.${project_id},project_id.is.null`)
    .order('updated_at', { ascending: false })
    .limit(8)
  const brandCandidates = (brandRows ?? []) as Array<{
    tone?: string[] | null
    writing_rules?: string[] | null
    forbidden_phrases?: string[] | null
    required_phrases?: string[] | null
    system_prompt?: string | null
    project_id?: string | null
  }>
  const brand = brandCandidates.find(row => row.project_id === project_id)
    ?? brandCandidates.find(row => row.project_id == null)
    ?? null

  // 4) Build context from the rich profile (linkedin_sections=*)
  const profileContext = {
    name: `${(fullProfile.first_name as string) || ''} ${(fullProfile.last_name as string) || ''}`.trim(),
    headline: (fullProfile.headline as string) ?? '',
    about: (fullProfile.summary as string) ?? '',
    location: (fullProfile.location as string) ?? '',
    connections: (fullProfile.connections_count as number) ?? 0,
    followers: (fullProfile.follower_count as number) ?? 0,
    is_creator: (fullProfile.is_creator as boolean) ?? false,
    positions: ((fullProfile.work_experience as Array<Record<string, unknown>>) ?? [])
      .slice(0, 5).map(p => ({
        position: (p.position as string) ?? '',
        company: (p.company as string) ?? '',
        location: (p.location as string) ?? '',
        description: ((p.description as string) ?? '').slice(0, 400),
        start: (p.start as string) ?? '',
        end: (p.end as string) ?? '',
      })),
    education: ((fullProfile.education as Array<Record<string, unknown>>) ?? [])
      .slice(0, 3).map(e => ({
        degree: (e.degree as string) ?? '',
        school: (e.school as string) ?? '',
      })),
    skills: ((fullProfile.skills as Array<Record<string, unknown>>) ?? [])
      .slice(0, 20).map(s => (s.name as string) ?? '').filter(Boolean),
    skills_total: (fullProfile.skills_total_count as number) ?? 0,
    languages: ((fullProfile.languages as Array<Record<string, unknown>>) ?? [])
      .map(l => (l.name as string) ?? '').filter(Boolean),
    certifications: (fullProfile.certifications_total_count as number) ?? 0,
  }

  const postsContext = posts.slice(0, 10).map(p => ({
    text: ((p.text as string) ?? '').slice(0, 300),
    reactions: (p.reaction_counter as number) ?? (p.reactions_count as number) ?? (p.likes_count as number) ?? 0,
    comments:  (p.comment_counter as number) ?? (p.comments_count as number) ?? 0,
    shares:    (p.repost_counter as number) ?? (p.reposts_count as number) ?? (p.shares_count as number) ?? 0,
    impressions: (p.impressions as number) ?? (p.views as number) ?? 0,
  }))

  const brandContext = brand ? [
    brand.tone?.length ? `Tone: ${(brand.tone as string[]).join(', ')}` : '',
    brand.writing_rules?.length ? `Writing rules:\n${(brand.writing_rules as string[]).map((r: string) => `• ${r}`).join('\n')}` : '',
    brand.required_phrases?.length ? `Required phrases: ${(brand.required_phrases as string[]).join(', ')}` : '',
    brand.forbidden_phrases?.length ? `Forbidden phrases: ${(brand.forbidden_phrases as string[]).join(', ')}` : '',
    brand.system_prompt ? `System prompt: ${brand.system_prompt}` : '',
  ].filter(Boolean).join('\n') : ''

  // 5) AI analysis

  const principleDefs: Record<string, string> = {
    semantic_personalization: '**SEMANTIC_PERSONALIZATION** - Does the profile headline + about section align with posted content topics? Building authority in a specific domain or scattered?',
    meaningful_engagement:    '**MEANINGFUL_ENGAGEMENT** - Are posts generating meaningful engagement (comments > reactions)? Post depth, questions, insights, stories?',
    relationship_intelligence:'**RELATIONSHIP_INTELLIGENCE** - Posting frequency consistent (ideal: 3-5x/week)? Community engagement vs. broadcasting? Content variety?',
    language_purity:          '**LANGUAGE_PURITY** - Single consistent language? Profile language matches content language?',
    content_authority:        '**CONTENT_AUTHORITY** - Posts demonstrate real expertise with data/results? Headline communicates what they do and for whom? About section has value prop?',
  }
  const principlesBlock = enabled.map((p, i) => `${i + 1}. ${principleDefs[p]}`).join('\n\n')
  const principlesJsonShape = enabled.map(p => `    "${p}": { "score": <0-100>, "findings": ["..."], "suggestions": ["..."] }`).join(',\n')

  const systemPrompt = `You are a LinkedIn 360Brew algorithm expert. 360Brew is LinkedIn's unified 150B-parameter recommendation model — it scores semantic alignment between profile, content, and audience.

Audit a profile against ${enabled.length === 5 ? 'the 5 core 360Brew principles' : `${enabled.length} 360Brew principle${enabled.length === 1 ? '' : 's'}`}. Output JSON ONLY, no prose, no markdown fences.

## Principles (score 0-100 each):

${principlesBlock}

## Output (strict JSON):
{
  "audited_against": "<echo the audit_intent summary verbatim if provided, otherwise write a 1-sentence note that no intent was set>",
  "overall_score": <0-100>,
  "grade": "<A+|A|B+|B|C+|C|D|F>",
  "verdict": "<2-3 sentence narrative tying the overall_score back to specific gaps against the audit_intent — what's working, what's missing, what to fix first>",
  "principles": {
${principlesJsonShape}
  },
  "profile_optimization": {
    "headline":   { "score": <0-100>, "suggestion": "<concrete rewrite, ≤120 chars>" },
    "about":      { "score": <0-100>, "suggestion": "<≤25 words>" },
    "experience": { "score": <0-100>, "suggestion": "<≤25 words>" }
  },
  "content_strategy": {
    "posting_frequency": "<≤15 words>",
    "recommended_topics": ["<5 topics, 2-4 words each>"],
    "content_mix": "<≤20 words>"
  },
  "quick_wins": ["<≤25 words>", "<≤25 words>", "<≤25 words>"]
}

## Output constraints (HARD)
- Each "findings" entry: ≤20 words, factual observation from the data, no padding.
- Each "suggestions" entry: ≤20 words, concrete action.
- Max 3 findings + 2 suggestions per principle.
- Reference actual content from the profile/posts — no generic best practices.
- Be terse. Sentence fragments are fine.`

  // Pull explicit audit intent from organizations.settings (operator-set via
  // the Audit Context form on /linkedin-score/:orgId or VERA's set_audit_intent
  // tool). Without this, the LLM has to GUESS who this profile is for —
  // scores drift run-to-run because the implicit target changes.
  const auditIntent = ((org?.settings as Record<string, unknown> | null) ?? {}).audit_intent as
    | {
        summary?: string
        icp_summary?: string; offer?: string; value_prop?: string
        role_positioning?: string; themes?: string[]; tone_target?: string; success_criteria?: string
      }
    | undefined

  const intentBlock = auditIntent ? `## Audit Intent (operator-set ground truth - score AGAINST this, not against generic best practices)
${auditIntent.summary        ? `**Summary (echo this verbatim into the "audited_against" field of your output):**\n${auditIntent.summary}\n` : ''}
${auditIntent.icp_summary    ? `- **Audience** (who this profile is for): ${auditIntent.icp_summary}` : ''}
${auditIntent.offer          ? `- **Offer**: ${auditIntent.offer}` : ''}
${auditIntent.value_prop     ? `- **Value prop**: ${auditIntent.value_prop}` : ''}
${auditIntent.role_positioning ? `- **Role positioning**: ${auditIntent.role_positioning}` : ''}
${auditIntent.themes?.length  ? `- **Content themes**: ${auditIntent.themes.join(', ')}` : ''}
${auditIntent.tone_target    ? `- **Tone target**: ${auditIntent.tone_target}` : ''}
${auditIntent.success_criteria ? `- **Success criteria**: ${auditIntent.success_criteria}` : ''}

Treat this as the north-star. A profile that scores 95 against a generic "good LinkedIn profile" rubric but 60 against THIS specific intent is a 60. Findings + suggestions must reference the intent fields by name when applicable.

The "verdict" field in your output must explicitly tie the overall_score back to the most consequential gap against this intent — not just "your headline is weak" but "your headline doesn't signal [role_positioning value]; this is why the score landed at N rather than higher".` : `## Audit Intent
Not set — score against generic 360Brew principles. Set "audited_against" to: "No audit intent configured. Run extract-audit-intent or set manually for sharper scoring."`

  const userMessage = `## LinkedIn Profile
${JSON.stringify(profileContext)}

## Recent Posts (${postsContext.length} posts)
${postsContext.length > 0 ? JSON.stringify(postsContext) : 'No recent posts found.'}

${brandContext ? `## Brand Guidelines\n${brandContext}` : ''}

${intentBlock}

Analyze this profile and content against the 360Brew algorithm. Return the JSON audit report.`

  const profile_summary = {
    name: profileContext.name,
    headline: profileContext.headline,
    connections: profileContext.connections,
    followers: profileContext.followers,
    about_chars: profileContext.about.length,
    positions_count: profileContext.positions.length,
    skills_count: profileContext.skills_total,
    // Resolved audit target — operator can verify the audit ran against the
    // intended profile, not whatever account happens to be connected.
    audited_target: targetSource === 'project' || targetSource === 'legacy_channel'
      ? { source: targetSource, slug: targetSlug, url: targetUrl }
      : { source: 'me', slug: (fullProfile.public_identifier as string) ?? null, url: null },
  }

  // Stream the response so sonnet has time to finish (~30-60s) without
  // tripping the edge-runtime supervisor's wall-clock timeout.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))

      send('started', { profile_summary, posts_analyzed: postsContext.length, account_name: accountName })

      let raw = ''
      try {
        const usageMetadata = textRuntimeUsageMetadata(runtime.runtime, {
          posts_analyzed: postsContext.length,
          principles_enabled: enabled,
        })
        const budget = await checkAuditBudget(
          supabase,
          org_id,
          project_id,
          runtime.runtime,
          'audit.brew360',
          systemPrompt,
          userMessage,
          BREW360_MAX_TOKENS,
          usageMetadata,
        )
        if (!budget.ok) throw new Error(budget.message)
        if (budget.warning) send('budget_warning', { warning: budget.warning })
        const startedAt = Date.now()
        const completion = await streamText(runtime.runtime, {
          maxTokens: BREW360_MAX_TOKENS,
          temperature: 0.3,
          system: systemPrompt,
          user: userMessage,
          json: true,
          onText: text => {
            raw += text
            send('chunk', { text })
          },
        })
        raw = completion.text

        const match = raw.match(/\{[\s\S]*\}/)
        if (!match) throw new Error('No JSON found in AI response')
        const audit = JSON.parse(match[0])

        const payload = { success: true, audit, profile_summary, posts_analyzed: postsContext.length, account_name: accountName }
        await supabase.from('linkedin_audits').insert({
          org_id, project_id, kind: 'brew360', result: payload as Json, enabled_principles: enabled,
        })
        await logGenerationUsage(supabase, {
          orgId: org_id,
          projectId: project_id,
          provider: runtime.runtime.provider,
          model: runtime.runtime.model,
          operation: 'audit.brew360',
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          durationMs: Date.now() - startedAt,
          metadata: {
            ...usageMetadata,
            ...(budget.warning ? { budget_warning: budget.warning } : {}),
          },
        })
        send('done', payload)
        controller.close()
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err), raw_preview: raw.slice(0, 500) })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN))
}

async function checkAuditBudget(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
  runtime: TextRuntime,
  operation: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  metadata: Record<string, unknown>,
): Promise<BudgetCheck> {
  const budget = await checkProjectAiBudget(supabase, projectId, {
    orgId,
    projectId,
    provider: runtime.provider,
    model: runtime.model,
    operation,
    inputTokens: approxTokens(`${systemPrompt}\n\n${userPrompt}`),
    outputTokens: maxTokens,
    metadata,
  })
  if (!budget.ok) return { ok: false, message: budget.message }
  return { ok: true, warning: budget.warning }
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
