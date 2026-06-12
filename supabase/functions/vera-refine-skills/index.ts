// VERA weekly skill refinement.
//
// For each skill with enough signal (≥10 invocations, mixed outcomes),
// ask Claude to propose a revised prompt_module that addresses the
// patterns evident in recent outcomes + operator feedback. The proposal
// goes to skill_revisions, status='pending' — nothing applies until an
// operator approves it in the Skills UI.
//
// Trigger: weekly via pg_cron (Sundays 05:00 UTC), or manually:
//   curl -X POST https://supabase-content-eu.innovareai.com/functions/v1/vera-refine-skills \
//     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
//     -d '{}'
//
// Optional body params:
//   { skill_ids?: string[], min_invocations?: number, dry_run?: boolean }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODEL = 'claude-sonnet-4-6'  // refinement deserves the heavier model
const MIN_INVOCATIONS_DEFAULT = 10
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const REFINE_PROMPT = (skill: SkillSnapshot) => `
You are refining a content-generation skill module based on real-world
outcome data. The operator (human reviewer) approves or rejects each
draft; you'll see the rates here, plus any verbatim feedback they gave.

Your job: propose a REVISED prompt_module that addresses the patterns
without overcorrecting. Small targeted improvements beat dramatic rewrites.

CURRENT SKILL:
Name: ${skill.name}
Type: ${skill.type}
Description: ${skill.description}

CURRENT PROMPT MODULE:
"""
${skill.current_module}
"""

PERFORMANCE OVER LAST ${skill.window_days} DAYS:
- Total invocations: ${skill.total_invocations}
- Approved: ${skill.approved_count} (${skill.approval_rate ?? '?'}%)
- Rejected: ${skill.rejected_count}
- Edited: ${skill.edited_count}

RELEVANT OPERATOR FEEDBACK (verbatim, most recent first):
${skill.feedback_memories.length === 0 ? '(none)' : skill.feedback_memories.map(f => `- ${f}`).join('\n')}

SAMPLE OUTCOME PATTERNS (last 10 rejections + their feedback, if any):
${skill.recent_rejections.length === 0 ? '(no rejections in window)' : skill.recent_rejections.map(r => `- ${r}`).join('\n')}

RULES FOR YOUR REVISION:
- Do NOT change the skill's fundamental identity or scope. If the skill
  is "LinkedIn carousel", the revision still produces LinkedIn carousels.
- Targeted edits only. Add or sharpen constraints based on the feedback.
- Never just append "...and also do X" at the bottom — integrate the
  improvement into the relevant section of the module.
- Keep the same overall structure and length (within 20%).
- If the feedback is contradictory or unclear, propose a smaller change
  with lower confidence rather than a sweeping one.
- If there's no clear signal in the data (approval_rate is fine, no
  consistent feedback theme), return confidence: 0.0 and current_module
  unchanged — we'd rather skip than churn.

OUTPUT FORMAT (JSON only, no preamble):
{
  "revised_module": "<the full revised prompt_module text>",
  "changes_summary": "<2-4 sentence explanation of what changed and why, citing specific feedback when possible>",
  "confidence": <number between 0 and 1>
}
`.trim()

interface SkillSnapshot {
  id: string
  name: string
  type: string
  description: string
  current_module: string
  total_invocations: number
  approved_count: number
  rejected_count: number
  edited_count: number
  approval_rate: number | null
  window_days: number
  feedback_memories: string[]
  recent_rejections: string[]
}

interface Refinement {
  revised_module: string
  changes_summary: string
  confidence: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!isServiceRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { skill_ids?: string[]; min_invocations?: number; dry_run?: boolean } = {}
  try { body = await req.json().catch(() => ({})) } catch { /* default */ }

  const minInvocations = body.min_invocations ?? MIN_INVOCATIONS_DEFAULT
  const dryRun = body.dry_run === true

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    SUPABASE_SERVICE_ROLE_KEY,
  )

  // Pull candidate skills — those with ≥min_invocations
  let candidatesQuery = supabase.from('skill_performance')
    .select('skill_id, name, type, total_invocations, approved_count, rejected_count, edited_count, approval_rate')
    .gte('total_invocations', minInvocations)
  if (body.skill_ids?.length) {
    candidatesQuery = candidatesQuery.in('skill_id', body.skill_ids)
  }

  const { data: candidates, error: candErr } = await candidatesQuery
  if (candErr) {
    return new Response(JSON.stringify({ error: candErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: Array<{
    skill_id: string; name: string
    status: 'proposed' | 'skipped' | 'error'
    detail?: string
    confidence?: number
  }> = []

  for (const cand of candidates ?? []) {
    try {
      // Pull the full skill row (we need prompt_module)
      const { data: skill } = await supabase.from('skills')
        .select('id, name, type, description, prompt_module, org_id')
        .eq('id', cand.skill_id)
        .maybeSingle()
      if (!skill) {
        results.push({ skill_id: cand.skill_id, name: cand.name, status: 'skipped', detail: 'skill row missing' })
        continue
      }

      // Pull recent rejections with their feedback
      const { data: rejections } = await supabase.from('post_outcomes')
        .select('feedback')
        .eq('outcome', 'rejected')
        .not('feedback', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(10)
      const recentRejections = (rejections ?? [])
        .map(r => (r.feedback as string).slice(0, 300))
        .filter(Boolean)

      // Pull feedback memories for this skill or this skill's type
      const { data: memories } = await supabase.from('vera_memories')
        .select('value')
        .eq('org_id', skill.org_id ?? cand.skill_id)
        .ilike('key', `feedback.%`)
        .order('created_at', { ascending: false })
        .limit(20)
      const feedbackMemories = (memories ?? []).map(m => (m.value as string).slice(0, 250))

      const snapshot: SkillSnapshot = {
        id: skill.id as string,
        name: skill.name as string,
        type: skill.type as string,
        description: skill.description as string,
        current_module: skill.prompt_module as string,
        total_invocations: cand.total_invocations as number,
        approved_count: cand.approved_count as number,
        rejected_count: cand.rejected_count as number,
        edited_count: cand.edited_count as number,
        approval_rate: cand.approval_rate as number | null,
        window_days: 7,
        feedback_memories: feedbackMemories,
        recent_rejections: recentRejections,
      }

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: 'You are a content-skill refinement engine. Output JSON only — no markdown fences, no preamble.',
        messages: [{ role: 'user', content: REFINE_PROMPT(snapshot) }],
      })

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
      const cleaned = text.replace(/^```(json)?\s*|\s*```$/g, '').trim()

      let refinement: Refinement
      try {
        refinement = JSON.parse(cleaned) as Refinement
      } catch (parseErr) {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'error', detail: `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        })
        continue
      }

      // Skip low-confidence proposals — Claude told us there's no signal
      if (refinement.confidence < 0.4) {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'skipped',
          detail: `low confidence (${refinement.confidence}): ${refinement.changes_summary}`,
          confidence: refinement.confidence,
        })
        continue
      }

      // Skip if revised text is identical to current
      if (refinement.revised_module.trim() === (skill.prompt_module as string).trim()) {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'skipped', detail: 'no changes proposed',
        })
        continue
      }

      if (dryRun) {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'proposed', detail: `[dry-run] ${refinement.changes_summary}`,
          confidence: refinement.confidence,
        })
        continue
      }

      // Queue the revision
      const { error: insErr } = await supabase.from('skill_revisions').insert({
        skill_id: skill.id,
        current_module: skill.prompt_module,
        proposed_module: refinement.revised_module,
        changes_summary: refinement.changes_summary,
        confidence: refinement.confidence,
        evidence: {
          total_invocations: snapshot.total_invocations,
          approval_rate: snapshot.approval_rate,
          rejected_count: snapshot.rejected_count,
          feedback_memory_count: feedbackMemories.length,
          recent_rejection_count: recentRejections.length,
        },
      })

      if (insErr) {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'error', detail: insErr.message,
        })
      } else {
        results.push({
          skill_id: skill.id as string, name: skill.name as string,
          status: 'proposed', detail: refinement.changes_summary,
          confidence: refinement.confidence,
        })
      }
    } catch (err) {
      results.push({
        skill_id: cand.skill_id as string, name: cand.name as string,
        status: 'error', detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return new Response(JSON.stringify({
    examined: candidates?.length ?? 0,
    proposed: results.filter(r => r.status === 'proposed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errored: results.filter(r => r.status === 'error').length,
    results,
    dry_run: dryRun,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function isServiceRequest(req: Request): boolean {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const apiKey = req.headers.get('apikey') ?? ''
  return !!SUPABASE_SERVICE_ROLE_KEY && (bearer === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY)
}
