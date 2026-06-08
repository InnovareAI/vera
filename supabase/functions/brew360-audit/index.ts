// Brew360 Filter — ported from SAM's lib/brew-audit/run-audit.ts
//
// Scores a LinkedIn profile + recent posts against the 5 principles of
// LinkedIn's 360Brew algorithm (their unified 150B-parameter recommendation
// model). Returns a structured JSON audit with per-principle scores, profile
// optimisation suggestions, content strategy, and quick wins.
//
// Reads the connected LinkedIn account from organizations.unipile_account_id.
// Optional: pulls brand_voice for the org to give the auditor context.
//
// POST { org_id }  →  { success, audit, profile_summary, posts_analyzed }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'
import { requireOrgMember, type AdminClient } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN     = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  const { org_id, principles: enabledIn } = await req.json().catch(() => ({}))
  if (!org_id) return jsonResponse({ success: false, error: 'org_id required' }, 400)
  // Caller can pass a subset of the 5 principles to score. Default: all 5.
  const ALL_PRINCIPLES = ['semantic_personalization','meaningful_engagement','relationship_intelligence','language_purity','content_authority'] as const
  const enabled: string[] = Array.isArray(enabledIn) && enabledIn.length
    ? (enabledIn as string[]).filter(p => (ALL_PRINCIPLES as readonly string[]).includes(p))
    : [...ALL_PRINCIPLES]
  if (!enabled.length) return jsonResponse({ success: false, error: 'At least one principle must be enabled.' }, 400)
  if (!ANTHROPIC_API_KEY) return jsonResponse({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500)
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return jsonResponse({ success: false, error: 'UNIPILE not configured' }, 500)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Caller must be the service (internal) or an org member — never anonymous,
  // and never another tenant reading this org's audit.
  const access = await requireOrgMember(req, supabase as unknown as AdminClient, SUPABASE_SERVICE_ROLE_KEY, org_id, corsHeaders)
  if (!access.ok) return access.response

  // 1) Get connected LinkedIn account + the org's channel URLs (channel_profiles
  //    is the source of truth for "which profile to audit"; the Unipile session
  //    is just the auth token — the operator who connected Unipile may not be
  //    the same person as the brand's primary LinkedIn identity).
  const { data: org } = await supabase
    .from('organizations')
    .select('name, unipile_account_id, settings')
    .eq('id', org_id)
    .maybeSingle()
  if (!org?.unipile_account_id) {
    return jsonResponse({ success: false, error: 'No LinkedIn account connected. Run the Connect LinkedIn step first.' }, 400)
  }
  const accountId = org.unipile_account_id as string
  const headers = { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' }

  // Resolve audit target: prefer the org's linkedin_personal channel URL slug.
  // Fall back to /me (the connected account) only if no channel URL exists.
  let targetSlug: string | null = null
  let targetSource: 'channel' | 'me' = 'me'
  let targetUrl: string | null = null

  const { data: channels } = await supabase
    .from('channel_profiles')
    .select('channel, url')
    .eq('org_id', org_id)
    .eq('is_active', true)
  const personalCh = (channels ?? []).find(c => c.channel === 'linkedin_personal')
  if (personalCh?.url) {
    const m = (personalCh.url as string).match(/linkedin\.com\/in\/([^/?#]+)/i)
    if (m) {
      targetSlug = decodeURIComponent(m[1]).replace(/\/+$/, '')
      targetSource = 'channel'
      targetUrl = personalCh.url as string
    }
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
      // Slug didn't resolve (private profile, typo, etc.) — fall back to /me
      // with a warning rather than failing.
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

  // 3) Pull brand_voice if it exists for this org (optional context)
  const { data: brand } = await supabase
    .from('brand_voice')
    .select('tone, writing_rules, forbidden_phrases, required_phrases, system_prompt')
    .eq('org_id', org_id)
    .maybeSingle()

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

  // 5) Claude analysis
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

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

  const intentBlock = auditIntent ? `## Audit Intent (operator-set ground truth — score AGAINST this, not against generic best practices)
${auditIntent.summary        ? `**Summary (echo this verbatim into the "audited_against" field of your output):**\n${auditIntent.summary}\n` : ''}
${auditIntent.icp_summary    ? `- **ICP** (who this profile is for): ${auditIntent.icp_summary}` : ''}
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
    audited_target: targetSource === 'channel'
      ? { source: 'channel', slug: targetSlug, url: targetUrl }
      : { source: 'me', slug: (fullProfile.public_identifier as string) ?? null, url: null },
  }

  // Stream the response so sonnet has time to finish (~30-60s) without
  // tripping the edge-runtime supervisor's wall-clock timeout.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...((data ?? {}) as object) })}\n\n`))

      send('started', { profile_summary, posts_analyzed: postsContext.length, account_name: org.name })

      let raw = ''
      try {
        const msgStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          temperature: 0.3,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })
        for await (const ev of msgStream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            raw += ev.delta.text
            send('chunk', { text: ev.delta.text })
          }
        }

        const match = raw.match(/\{[\s\S]*\}/)
        if (!match) throw new Error('No JSON found in AI response')
        const audit = JSON.parse(match[0])

        const payload = { success: true, audit, profile_summary, posts_analyzed: postsContext.length, account_name: org.name }
        await supabase.from('linkedin_audits').insert({
          org_id, kind: 'brew360', result: payload, enabled_principles: enabled,
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
