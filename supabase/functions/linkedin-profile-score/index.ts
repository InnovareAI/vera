// LinkedIn Profile Scorer
//
// Scores a LinkedIn profile against LinkedIn profile best practices. For client
// projects, the target comes from the active Strategy Brain LinkedIn profile URL.
// The connected Unipile account is research access, not the profile target.
// Returns a per-section breakdown with completeness + quality scores and fixes.
//
// POST { org_id, vanity?: string }  →  { success, profile, score, sections, fixes }
//
// When `vanity` is provided, scores that profile via the workspace research
// session. The default workspace can still fall back to /me for legacy use.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js'
import { requireProjectMember, type AdminClient } from '../_shared/auth.ts'
import type { Json } from '../_shared/database.types.ts'
import { checkProjectAiBudget, type ProjectAiBudgetWarning } from '../_shared/ai-policy.ts'
import { logGenerationUsage } from '../_shared/generation-usage.ts'
import { completeText, resolveProjectTextRuntime, textRuntimeUsageMetadata, type TextRuntime } from '../_shared/text-runtime.ts'
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
const HEADLINE_REVIEW_MAX_TOKENS = 600

type BudgetCheck =
  | { ok: true; warning: ProjectAiBudgetWarning | null }
  | { ok: false; message: string }

interface Profile {
  provider_id?: string
  public_identifier?: string
  first_name?: string
  last_name?: string
  headline?: string
  summary?: string
  location?: string
  follower_count?: number
  connections_count?: number
  profile_picture_url?: string
  background_picture_url?: string
  is_premium?: boolean
  is_creator?: boolean
  is_influencer?: boolean
  websites?: unknown[]
  hashtags?: unknown[]
  contact_info?: Record<string, unknown>
  work_experience?: Array<Record<string, unknown>>
  work_experience_total_count?: number
  education?: Array<Record<string, unknown>>
  education_total_count?: number
  skills?: Array<Record<string, unknown>>
  skills_total_count?: number
  languages?: Array<Record<string, unknown>>
  certifications?: Array<Record<string, unknown>>
  certifications_total_count?: number
  recommendations?: Record<string, unknown> | Array<unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  const { org_id, project_id, vanity, operator_user_id } = await req.json().catch(() => ({}))
  if (!org_id) return json({ success: false, error: 'org_id required' }, 400)
  if (!project_id) return json({ success: false, error: 'project_id required' }, 400)
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return json({ success: false, error: 'UNIPILE not configured' }, 500)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as unknown as AdminClient

  // Caller must be the service (internal) or an org member — never anonymous,
  // and never another tenant scoring this org's profile.
  const access = await requireProjectMember(req, supabase, SUPABASE_SERVICE_ROLE_KEY, project_id, corsHeaders, org_id)
  if (!access.ok) return access.response
  const requesterUserId = access.service ? cleanString(operator_user_id) : access.userId
  const runtimeResult = await resolveProjectTextRuntime(supabase, org_id, project_id, {
    purpose: 'LinkedIn profile qualitative review',
    anthropicModel: 'claude-haiku-4-5',
  })
  const textRuntime = runtimeResult.ok ? runtimeResult.runtime : null

  const { data: org } = await supabase
    .from('organizations').select('settings').eq('id', org_id).maybeSingle()
  const unipile = await resolveUnipileResearchConnection(supabase, org_id, { requesterUserId })
  if (!unipile.ok) {
    return json({ success: false, error: `${unipile.error} Connect LinkedIn for this workspace or use an InnovareAI operator account.` }, 400)
  }
  const accountId = unipile.accountId
  const headers = { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' }
  const sourceResolution = await resolveProjectAuditChannels(supabase, org_id, project_id)
  if (!projectHasLinkedInStrategy(sourceResolution)) {
    return json({
      success: false,
      error: 'LinkedIn audit is not enabled for this space strategy. Add a LinkedIn source or explicit LinkedIn strategy in the Strategy Brain first.',
    }, 400)
  }

  // Resolve target. Priority order:
  //   1. Explicit `vanity` param passed by the caller
  //   2. Active project's LinkedIn profile URL from Strategy Brain
  //   3. `/me`, but only for the default workspace project
  let resolvedTarget: string = (vanity ?? '').trim()
  let resolvedSource: 'param' | 'project' | 'legacy_channel' | 'me' = resolvedTarget ? 'param' : 'me'
  let resolvedUrl: string | null = null

  if (!resolvedTarget) {
    const personalUrl = linkedInPersonalUrl(sourceResolution.channels)
    if (personalUrl) {
      const m = personalUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)
      if (m) {
        resolvedTarget = decodeURIComponent(m[1]).replace(/\/+$/, '')
        resolvedSource = sourceResolution.source === 'project_brain' ? 'project' : 'legacy_channel'
        resolvedUrl = personalUrl
      }
    }
  }

  if (!resolvedTarget && !sourceResolution.project.is_default) {
    return json({
      success: false,
      error: "Add this space's LinkedIn profile URL to the Strategy Brain before scoring a profile. Shared research profiles cannot be scored as the brand profile.",
    }, 400)
  }

  const target = resolvedTarget || 'me'
  const initial = await fetch(
    `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(target)}?account_id=${encodeURIComponent(accountId)}`,
    { headers, signal: AbortSignal.timeout(30_000) },
  )
  if (!initial.ok) {
    const text = await initial.text()
    return json({ success: false, error: `Profile lookup failed (${initial.status}): ${text.slice(0, 200)}` }, 502)
  }
  const first = await initial.json() as Profile
  const richId = (target === 'me') ? first.provider_id : target
  let profile = first
  if (richId) {
    const rich = await fetch(
      `https://${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(richId)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*`,
      { headers, signal: AbortSignal.timeout(45_000) },
    )
    if (rich.ok) profile = await rich.json() as Profile
  }

  // Deterministic completeness scoring (no LLM call needed for these)
  const sections = scoreSections(profile)
  const completeness = sections.reduce((sum, s) => sum + s.score, 0) / sections.length

  // Optional: LLM-driven qualitative review of the headline (the highest-leverage field).
  // Keep prompt tiny so it returns in well under the edge wall-clock limit.
  let headlineReview: { score: number; observations: string[]; rewrite: string } | null = null
  let headlineReviewStatus: { status: 'completed' | 'skipped'; reason?: string; budget_warning?: ProjectAiBudgetWarning } = { status: 'skipped', reason: 'No space text runtime configured' }
  try {
    if (!textRuntime) throw new Error('No space text runtime configured')
    headlineReviewStatus = { status: 'skipped', reason: 'AI headline review failed' }
    const sys = `You are a LinkedIn headline expert. You score a headline 0-100 and propose one concrete rewrite. Output ONLY valid JSON:
{ "score": <0-100>, "observations": ["3-5 specific observations about the current headline"], "rewrite": "<a single concrete proposed headline, ≤120 chars>" }

Rules a great headline follows:
- ≤120 chars total.
- Starts with a verb describing what they DO (Building, Helping, Leading, Designing), not an adjective or noun phrase like "Founder of...".
- Names a single, sharp audience or outcome ("for sensitive-skin shoppers", "agentic AI for operations teams").
- ONE primary company only. If the person has multiple executive roles, demote secondary affiliations to Experience. DO NOT stack them in the headline.
- No more than one pipe. No credential stacking (no "ex-X | ex-Y | ex-Z").
- No emoji at the start.
- About / summary content (provided below) gives context for what they actually do. Use it to anchor the rewrite, don't invent a new positioning.

When the input headline contains TWO OR MORE executive roles (founder, co-founder, CEO, etc.) at different companies:
- Pick the primary company based on the About text (the company most central to their current focus).
- The rewrite features only the primary company.
- Call this out explicitly in observations ("Current headline lists N affiliations. Picked X as primary because Y").`
    // Pull audit_intent so the proposed headline targets the operator's
    // intended audience/positioning, not whatever the model guesses from the
    // current headline. This is the single biggest input to a good rewrite.
    const auditIntent = ((org?.settings as Record<string, unknown> | null) ?? {}).audit_intent as
      | { icp_summary?: string; role_positioning?: string; themes?: string[]; offer?: string; value_prop?: string }
      | undefined
    const intentBlock = auditIntent ? `

## Audit Intent (operator-set ground truth - the rewrite MUST align with this):
${auditIntent.icp_summary    ? `- Audience: ${auditIntent.icp_summary}` : ''}
${auditIntent.role_positioning ? `- Role positioning: ${auditIntent.role_positioning}` : ''}
${auditIntent.offer          ? `- Offer: ${auditIntent.offer}` : ''}
${auditIntent.value_prop     ? `- Value prop: ${auditIntent.value_prop}` : ''}
${auditIntent.themes?.length ? `- Themes: ${auditIntent.themes.join(', ')}` : ''}` : ''

    const userPrompt = `Headline: "${profile.headline ?? ''}"

Location: ${profile.location ?? '—'}
Followers: ${profile.follower_count ?? 0}
Is creator: ${profile.is_creator ?? false}

About / summary:
${(profile.summary ?? '').slice(0, 1500) || '(empty)'}${intentBlock}`
    const usageMetadata = textRuntimeUsageMetadata(textRuntime as TextRuntime, {
      target_source: resolvedSource,
      has_audit_intent: Boolean(auditIntent),
    })
    const budget = await checkAuditBudget(
      supabase,
      org_id,
      project_id,
      textRuntime as TextRuntime,
      'audit.linkedin_profile_headline',
      sys,
      userPrompt,
      HEADLINE_REVIEW_MAX_TOKENS,
      usageMetadata,
    )
    if (!budget.ok) {
      headlineReviewStatus = { status: 'skipped', reason: budget.message }
      throw new Error(budget.message)
    }
    const startedAt = Date.now()
    const response = await completeText(textRuntime as TextRuntime, {
      maxTokens: HEADLINE_REVIEW_MAX_TOKENS,
      temperature: 0.3,
      json: true,
      system: sys,
      user: userPrompt,
    })
    await logGenerationUsage(supabase, {
      orgId: org_id,
      projectId: project_id,
      provider: (textRuntime as TextRuntime).provider,
      model: (textRuntime as TextRuntime).model,
      operation: 'audit.linkedin_profile_headline',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs: Date.now() - startedAt,
      metadata: {
        ...usageMetadata,
        ...(budget.warning ? { budget_warning: budget.warning } : {}),
      },
    })
    const raw = response.text
    const m = raw.match(/\{[\s\S]*\}/)
    headlineReviewStatus = { status: 'skipped', reason: 'AI headline review did not return JSON', ...(budget.warning ? { budget_warning: budget.warning } : {}) }
    if (m) {
      headlineReview = JSON.parse(m[0])
      headlineReviewStatus = { status: 'completed', ...(budget.warning ? { budget_warning: budget.warning } : {}) }
    }
  } catch (error) {
    if (headlineReviewStatus.reason === 'AI headline review failed') {
      headlineReviewStatus = { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  // If the headline got a sharp LLM score, weight it into the headline section
  if (headlineReview) {
    const hSection = sections.find(s => s.id === 'headline')
    if (hSection) {
      hSection.score = Math.round((hSection.score + headlineReview.score) / 2)
      hSection.findings.push(...headlineReview.observations.slice(0, 3))
      hSection.suggestion = headlineReview.rewrite
    }
  }

  const overall = Math.round(sections.reduce((s, x) => s + x.score, 0) / sections.length)
  const grade = gradeFor(overall)
  const fixes = sections.filter(s => s.score < 60).sort((a, b) => a.score - b.score).slice(0, 5).map(s => ({
    section: s.label, score: s.score, fix: s.suggestion,
  }))

  const payload = {
    success: true,
    audited_target: {
      source: resolvedSource,
      slug: resolvedTarget === 'me' ? (profile.public_identifier ?? null) : resolvedTarget,
      url: resolvedUrl ?? (resolvedTarget !== 'me' ? `https://www.linkedin.com/in/${resolvedTarget}/` : null),
    },
    profile: {
      name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim(),
      headline: profile.headline ?? null,
      public_identifier: profile.public_identifier ?? null,
      location: profile.location ?? null,
      follower_count: profile.follower_count ?? 0,
      connections_count: profile.connections_count ?? 0,
      is_premium: !!profile.is_premium,
      is_creator: !!profile.is_creator,
      is_influencer: !!profile.is_influencer,
      profile_picture_url: profile.profile_picture_url ?? null,
      background_picture_url: profile.background_picture_url ?? null,
    },
    score: overall,
    grade,
    completeness_only_score: Math.round(completeness),
    sections,
    fixes,
    ai_review: headlineReviewStatus,
  }

  // Persist normal project scoring runs, but skip ad-hoc vanity lookups.
  if (!vanity || vanity === 'me') {
    await supabase.from('linkedin_audits').insert({ org_id, project_id, kind: 'profile', result: payload as unknown as Json })
  }

  return json(payload)
})

// ──────────────────────────────────────────────────────────────────────────────
// Section scoring (deterministic — these don't need an LLM)
// ──────────────────────────────────────────────────────────────────────────────

interface Section {
  id: string
  label: string
  score: number
  findings: string[]
  suggestion: string
}

function scoreSections(p: Profile): Section[] {
  return [
    scoreHeadline(p),
    scoreAbout(p),
    scoreExperience(p),
    scoreEducation(p),
    scoreSkills(p),
    scoreProfilePicture(p),
    scoreBackgroundPicture(p),
    scoreCustomUrl(p),
    scoreLocation(p),
    scoreNetwork(p),
    scoreCreatorMode(p),
    scoreHashtags(p),
    scoreWebsites(p),
    scoreContactInfo(p),
  ]
}

function scoreAbout(p: Profile): Section {
  const text = (p.summary ?? '').trim()
  const findings: string[] = []
  if (!text) {
    return { id: 'about', label: 'About section', score: 0, findings: ['Empty About section — LinkedIn shows the first 2 lines under your headline; this is prime real estate.'], suggestion: 'Write 4-8 short paragraphs: who you serve, what problem you solve, proof, CTA. Hook in the first 220 chars.' }
  }
  let score = 0
  if (text.length >= 400)   { score += 40; findings.push(`${text.length} chars (good length).`) }
  else if (text.length >= 150) { score += 25; findings.push(`${text.length} chars — usable but on the short side.`) }
  else { score += 10; findings.push(`${text.length} chars — too short to land a value prop.`) }
  // Hook in first ~220 chars (what shows above the fold before "see more")
  const hook = text.slice(0, 220).toLowerCase()
  if (/\b(i help|i build|i work with|most of|here'?s|why|what if|the problem|stop)\b/.test(hook)) {
    score += 25; findings.push('Hook present in first 220 chars.')
  } else {
    findings.push('No strong hook in the first 220 chars — readers see this before the "see more" cut.')
  }
  // Paragraph structure
  const paragraphs = text.split(/\n\s*\n/).length
  if (paragraphs >= 3) { score += 20; findings.push(`${paragraphs} paragraphs (good rhythm).`) }
  else findings.push('Single block of text — break into 3-5 paragraphs for scannability.')
  // CTA / contact
  if (/\b(reach out|book|email|message|dm|let'?s talk|contact|connect)\b/i.test(text)) { score += 15; findings.push('Has a CTA.') }
  else findings.push('No CTA — tell readers what to do next.')
  return { id: 'about', label: 'About section', score: Math.min(100, score), findings, suggestion: 'Lead with a hook, state who you serve and what problem you solve, add proof points, end with a CTA.' }
}

function scoreExperience(p: Profile): Section {
  const exps = (p.work_experience ?? []) as Array<Record<string, unknown>>
  if (!exps.length) {
    return { id: 'experience', label: 'Work experience', score: 0, findings: ['No work experience listed.'], suggestion: 'Add at least your current role and 2-3 previous positions with descriptions.' }
  }
  let score = Math.min(40, exps.length * 8) // up to 40 for having 5+ positions
  const withDescriptions = exps.filter(e => ((e.description as string) ?? '').trim().length >= 80).length
  const ratio = withDescriptions / exps.length
  score += Math.round(ratio * 40)
  const current = exps.find(e => !(e.end as string) || /present/i.test(e.end as string))
  if (current) score += 20
  const findings = [
    `${exps.length} position${exps.length === 1 ? '' : 's'}.`,
    `${withDescriptions} of ${exps.length} have meaningful descriptions (80+ chars).`,
    current ? `Current role: ${(current.position as string) || '?'} at ${(current.company as string) || '?'}.` : 'No current role marked — every role looks past-tense.',
  ]
  return { id: 'experience', label: 'Work experience', score: Math.min(100, score), findings, suggestion: withDescriptions < exps.length ? 'Add 2-3 sentence descriptions to every role focused on outcomes, not duties.' : 'Looks good — keep the most recent role description sharp.' }
}

function scoreEducation(p: Profile): Section {
  const edu = (p.education ?? []) as unknown[]
  if (!edu.length) return { id: 'education', label: 'Education', score: 30, findings: ['No education listed — minor signal but worth filling in for completeness.'], suggestion: 'Add your education entries.' }
  return { id: 'education', label: 'Education', score: 100, findings: [`${edu.length} entr${edu.length === 1 ? 'y' : 'ies'}.`], suggestion: '' }
}

function scoreSkills(p: Profile): Section {
  const total = (p.skills_total_count as number) ?? ((p.skills as unknown[]) ?? []).length
  if (total === 0) return { id: 'skills', label: 'Skills', score: 0, findings: ['No skills listed.'], suggestion: 'Add 20-30 skills relevant to your role; LinkedIn uses these for search matching.' }
  if (total < 10) return { id: 'skills', label: 'Skills', score: 40, findings: [`Only ${total} skills.`], suggestion: 'Aim for at least 20 skills.' }
  if (total < 25) return { id: 'skills', label: 'Skills', score: 70, findings: [`${total} skills — solid.`], suggestion: 'Push to 30+ for full search coverage.' }
  return { id: 'skills', label: 'Skills', score: 100, findings: [`${total} skills.`], suggestion: '' }
}

function scoreHeadline(p: Profile): Section {
  const h = (p.headline ?? '').trim()
  const findings: string[] = []
  let score = 0
  if (!h) {
    findings.push('No headline set — LinkedIn requires this and it is your primary algorithm signal.')
    return { id: 'headline', label: 'Headline', score: 0, findings, suggestion: 'Write a 60-120 character headline: <role> for <audience>, doing <outcome>.' }
  }
  // Length sweet spot 60-120 chars
  if (h.length < 30)       { score += 20; findings.push(`Only ${h.length} chars — too short to signal audience or outcome.`) }
  else if (h.length <= 120){ score += 50; findings.push(`Length OK (${h.length} chars).`) }
  else                     { score += 25; findings.push(`Over 120 chars (${h.length}) — risks being cropped in feeds and shows credential-stacking.`) }
  // Pipe stuffing
  const pipes = (h.match(/\|/g) ?? []).length
  if (pipes >= 3) findings.push(`Heavy pipe stuffing (${pipes} pipes) — reads as a CV, not a value prop.`)
  else            score += 10
  // Multi-affiliation / multi-company dilution — major 360Brew issue.
  // Counts role tokens; 2+ founder/CEO/exec roles means the algorithm can't
  // decide which entity to anchor you to.
  const roleMatches = h.match(/\b(founder|co-?founder|ceo|cto|cfo|coo|chief\s+[a-z]+\s+officer|president|vp|head\s+of|director)\b/gi) ?? []
  const distinctRoles = new Set(roleMatches.map(r => r.toLowerCase().replace(/[-\s]/g, '')))
  if (distinctRoles.size >= 2) {
    findings.push(`Multi-affiliation: ${roleMatches.length} executive roles in headline (${[...distinctRoles].join(', ')}). 360Brew can't pick one entity-anchor — splits authority across all of them. Move secondary roles to Experience.`)
  } else {
    score += 15
  }
  // Audience signal
  if (/\b(for|helping|serving|works with)\s+\w+/i.test(h)) { score += 15; findings.push('Clear audience signal present.') }
  else findings.push('No explicit audience callout ("for X", "helping Y").')
  // Emoji at start
  if (/^[\p{Extended_Pictographic}]/u.test(h)) findings.push('Starts with an emoji — distracts from semantic signal.')
  else score += 10
  return {
    id: 'headline',
    label: 'Headline',
    score: Math.min(100, score),
    findings,
    suggestion: distinctRoles.size >= 2
      ? 'Pick ONE primary entity for the headline (60-120 chars: "<verb> <outcome> for <audience> · Founder <primary company>"). Move the secondary company to Experience where it gets its own entity-anchor.'
      : 'Tighten to 60-120 chars in the shape "<role> for <audience>, building <outcome>". Drop credential stacking.',
  }
}

function scoreProfilePicture(p: Profile): Section {
  if (p.profile_picture_url) {
    return { id: 'profile_picture', label: 'Profile picture', score: 100, findings: ['Picture present.'], suggestion: '' }
  }
  return { id: 'profile_picture', label: 'Profile picture', score: 0, findings: ['Missing — profiles without a picture get 21× fewer views.'], suggestion: 'Upload a professional headshot.' }
}

function scoreBackgroundPicture(p: Profile): Section {
  if (p.background_picture_url) {
    return { id: 'background_picture', label: 'Background banner', score: 100, findings: ['Banner present.'], suggestion: '' }
  }
  return { id: 'background_picture', label: 'Background banner', score: 30, findings: ['Default LinkedIn banner — wasted real estate at the top of your profile.'], suggestion: 'Add a banner that states your positioning in one line.' }
}

function scoreCustomUrl(p: Profile): Section {
  const id = p.public_identifier ?? ''
  // Default LinkedIn URLs are like firstname-lastname-12345abc
  const looksDefault = /-\w{6,}$/.test(id) || /[a-z]+-[a-z]+-\d/.test(id)
  if (!id) return { id: 'custom_url', label: 'Custom URL', score: 0, findings: ['No public identifier returned.'], suggestion: 'Set a clean linkedin.com/in/<name> URL.' }
  if (looksDefault) return { id: 'custom_url', label: 'Custom URL', score: 50, findings: [`Looks like the default auto-generated URL: ${id}`], suggestion: `Claim linkedin.com/in/${id.split(/[-_]/)[0]}-${id.split(/[-_]/)[1] ?? ''} or similar.` }
  return { id: 'custom_url', label: 'Custom URL', score: 100, findings: [`Custom URL set: ${id}`], suggestion: '' }
}

function scoreLocation(p: Profile): Section {
  const loc = (p.location ?? '').trim()
  if (!loc) return { id: 'location', label: 'Location', score: 0, findings: ['No location set.'], suggestion: 'Add city + country — this is a strong matching signal for connection suggestions.' }
  return { id: 'location', label: 'Location', score: 100, findings: [`Location: ${loc}`], suggestion: '' }
}

function scoreNetwork(p: Profile): Section {
  const conn = p.connections_count ?? 0
  const fol  = p.follower_count    ?? 0
  let score = 0
  const findings: string[] = []
  if (conn >= 500)      { score += 50; findings.push(`${conn} connections — past the 500+ social-proof threshold.`) }
  else if (conn >= 100) { score += 30; findings.push(`${conn} connections — below the 500+ threshold.`) }
  else                  { score += 10; findings.push(`Only ${conn} connections — too new for algorithm to trust.`) }
  if (fol >= 5000)      { score += 50; findings.push(`${fol} followers — strong creator signal.`) }
  else if (fol >= 1000) { score += 35 }
  else if (fol >= 100)  { score += 20 }
  else                  { score += 5 }
  return { id: 'network', label: 'Network size', score: Math.min(100, score), findings, suggestion: conn < 500 ? 'Connect with relevant people in your target audience to cross the 500+ threshold.' : 'Lean into follower growth via consistent posting.' }
}

function scoreCreatorMode(p: Profile): Section {
  const on = p.is_creator || p.is_influencer
  if (on) return { id: 'creator_mode', label: 'Creator mode', score: 100, findings: ['Creator mode enabled.'], suggestion: '' }
  return { id: 'creator_mode', label: 'Creator mode', score: 40, findings: ['Creator mode appears off — you lose the followers-first CTA and topic hashtags.'], suggestion: 'Enable Creator mode and pin 3-5 topic hashtags.' }
}

function scoreHashtags(p: Profile): Section {
  const tags = (p.hashtags ?? []) as unknown[]
  if (tags.length >= 3) return { id: 'hashtags', label: 'Pinned hashtags', score: 100, findings: [`${tags.length} hashtags pinned.`], suggestion: '' }
  if (tags.length > 0)  return { id: 'hashtags', label: 'Pinned hashtags', score: 60, findings: [`Only ${tags.length} hashtags pinned.`], suggestion: 'Pin 3-5 niche hashtags so the algorithm knows your topic.' }
  return { id: 'hashtags', label: 'Pinned hashtags', score: 20, findings: ['No hashtags pinned.'], suggestion: 'Pin 3-5 niche hashtags via Creator mode.' }
}

function scoreWebsites(p: Profile): Section {
  const w = (p.websites ?? []) as unknown[]
  if (w.length > 0) return { id: 'websites', label: 'External links', score: 100, findings: [`${w.length} external link(s).`], suggestion: '' }
  return { id: 'websites', label: 'External links', score: 40, findings: ['No external links — missing a key CTA path off-platform.'], suggestion: 'Add your company URL or a single highest-priority link.' }
}

function scoreContactInfo(p: Profile): Section {
  const c = p.contact_info ?? {}
  const keys = Object.keys(c)
  if (keys.length >= 2) return { id: 'contact_info', label: 'Contact info', score: 100, findings: [`Contact info populated (${keys.length} channels).`], suggestion: '' }
  if (keys.length === 1) return { id: 'contact_info', label: 'Contact info', score: 60, findings: ['Only one contact channel.'], suggestion: 'Add at least one more channel (email + website).' }
  return { id: 'contact_info', label: 'Contact info', score: 20, findings: ['No contact info exposed.'], suggestion: 'Add email + website so people can reach you.' }
}

function gradeFor(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 85) return 'A'
  if (score >= 80) return 'A-'
  if (score >= 75) return 'B+'
  if (score >= 70) return 'B'
  if (score >= 65) return 'B-'
  if (score >= 60) return 'C+'
  if (score >= 55) return 'C'
  if (score >= 50) return 'C-'
  if (score >= 40) return 'D'
  return 'F'
}

function json(body: unknown, status = 200): Response {
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
