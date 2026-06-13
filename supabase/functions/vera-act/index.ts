// vera-act — executes an agent_observation's proposed action.
//
// Called when the operator clicks the action button on a "VERA wants to"
// row. Marks the observation as actioned immediately, then runs the work
// in the background (EdgeRuntime.waitUntil) so the UI returns fast.
//
// POST /functions/v1/vera-act
//   { observation_id: <uuid> }
//
// Routes by observation.action_kind:
//   · run_audit              → fires linkedin-profile-score + brew360-audit
//   · draft_from_campaign    → calls vera-orchestrator with a prepared
//                              campaign-themed prompt; orchestrator writes
//                              the resulting post to content_posts
//   · prompt_knowledge_input → no-op server side (UI navigates to /knowledge)
//
// All routes write acted_result jsonb back on the observation row so
// the UI can show what happened.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { requireObservationMember, type AdminClient } from '../_shared/auth.ts'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method not allowed' })

  let body: { observation_id?: string }
  try { body = await req.json() } catch { return json(400, { error: 'invalid json' }) }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireObservationMember(req, supabase, SERVICE_KEY, body.observation_id, cors)
  if (!auth.ok) return auth.response
  if (!body.observation_id) return json(400, { error: 'observation_id required' })

  const { data: obs, error: obsErr } = await supabase
    .from('agent_observations')
    .select('*')
    .eq('id', body.observation_id)
    .maybeSingle()
  if (obsErr || !obs) return json(404, { error: 'observation not found' })
  if (obs.status !== 'open') return json(400, { error: `already ${obs.status}` })

  // Optimistic actioned — UI shows progress; background task runs.
  await supabase
    .from('agent_observations')
    .update({
      status: 'actioned',
      actioned_at: new Date().toISOString(),
      acted_result: { stage: 'started' },
    })
    .eq('id', obs.id)

  const kind = obs.action_kind as string
  switch (kind) {
    case 'run_audit':
      // @ts-expect-error EdgeRuntime is provided by the Supabase edge runtime.
      EdgeRuntime.waitUntil(runAudit(supabase, obs, auth.userId))
      return json(200, { ok: true, action: kind, status: 'started' })

    case 'draft_from_campaign':
      // @ts-expect-error EdgeRuntime is provided by the Supabase edge runtime.
      EdgeRuntime.waitUntil(draftFromCampaign(supabase, obs))
      return json(200, { ok: true, action: kind, status: 'started' })

    case 'prompt_knowledge_input':
      // Pure UX nudge — UI navigates to /knowledge. Server has nothing to do.
      await supabase
        .from('agent_observations')
        .update({ acted_result: { stage: 'nudge', destination: '/knowledge' } })
        .eq('id', obs.id)
      return json(200, { ok: true, action: kind, status: 'nudge' })

    default:
      // Unknown — leave the observation actioned, note in result
      await supabase
        .from('agent_observations')
        .update({ acted_result: { stage: 'unknown_action', kind } })
        .eq('id', obs.id)
      return json(200, { ok: true, action: kind, status: 'unknown_action' })
  }
})

// ─── runAudit ─────────────────────────────────────────────────────────
async function runAudit(supabase: AdminClient, obs: Record<string, unknown>, operatorUserId: string | null) {
  const orgId = (obs.action_payload as Record<string, unknown> | null)?.org_id as string
    ?? obs.org_id as string
  const projectId = (obs.action_payload as Record<string, unknown> | null)?.project_id as string
    ?? obs.project_id as string
    ?? null
  if (!orgId || !projectId) return

  try {
    // Fire both audit endpoints in parallel. They each write to linkedin_audits.
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    }
    const [profileRes, brewRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/functions/v1/linkedin-profile-score`, {
        method: 'POST', headers, body: JSON.stringify({ org_id: orgId, project_id: projectId, operator_user_id: operatorUserId }),
      }),
      // brew360-audit streams SSE — we just read it to completion
      fetch(`${SUPABASE_URL}/functions/v1/brew360-audit`, {
        method: 'POST', headers, body: JSON.stringify({ org_id: orgId, project_id: projectId, operator_user_id: operatorUserId }),
      }),
    ])

    // Drain brew stream
    if (brewRes.body) {
      const reader = brewRes.body.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    }

    await supabase
      .from('agent_observations')
      .update({
        acted_result: {
          stage: 'complete',
          profile_status: profileRes.status,
          brew_status: brewRes.status,
          finished_at: new Date().toISOString(),
        },
      })
      .eq('id', obs.id as string)
  } catch (e) {
    await supabase
      .from('agent_observations')
      .update({ acted_result: { stage: 'failed', error: e instanceof Error ? e.message : String(e) } })
      .eq('id', obs.id as string)
  }
}

// ─── draftFromCampaign ────────────────────────────────────────────────
async function draftFromCampaign(supabase: AdminClient, obs: Record<string, unknown>) {
  const payload = (obs.action_payload as Record<string, unknown> | null) ?? {}
  const campaignId = payload.campaign_id as string | undefined
  if (!campaignId) {
    await supabase.from('agent_observations')
      .update({ acted_result: { stage: 'failed', error: 'no campaign_id in payload' } })
      .eq('id', obs.id as string)
    return
  }

  try {
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, name, theme, project_id, org_id')
      .eq('id', campaignId)
      .maybeSingle()
    if (!campaign) throw new Error('campaign not found')

    // Build a campaign-grounded prompt. The orchestrator's persona +
    // active-project context will fill in the brand voice, audience,
    // knowledge — we just give it the campaign hook.
    const prompt = [
      `Draft a LinkedIn post for the active campaign "${campaign.name as string}".`,
      campaign.theme ? `Campaign theme: ${campaign.theme as string}` : '',
      `Lean on the project's brand voice. One specific hook in the opening line, one concrete number or example in the body, one question CTA at the end.`,
      `This will go straight to the review queue — make it operator-ready.`,
    ].filter(Boolean).join('\n\n')

    const res = await fetch(`${SUPABASE_URL}/functions/v1/vera-orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body: JSON.stringify({
        prompt,
        org_id: campaign.org_id as string,
        campaign_id: campaign.id as string,
      }),
    })
    if (!res.ok || !res.body) {
      throw new Error(`orchestrator HTTP ${res.status}`)
    }

    // Drain stream so the orchestrator runs to completion. The Publisher
    // agent at the end writes the post to content_posts as Pending Review.
    const reader = res.body.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // Find the newly created post (most recent for this campaign in the
    // last 2 min — orchestrator just wrote it)
    const sinceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: newPost } = await supabase
      .from('content_posts')
      .select('id, title, status')
      .eq('campaign_id', campaign.id as string)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    await supabase
      .from('agent_observations')
      .update({
        acted_result: {
          stage: 'complete',
          post_id: newPost?.id ?? null,
          post_title: newPost?.title ?? null,
          finished_at: new Date().toISOString(),
        },
      })
      .eq('id', obs.id as string)
  } catch (e) {
    await supabase
      .from('agent_observations')
      .update({ acted_result: { stage: 'failed', error: e instanceof Error ? e.message : String(e) } })
      .eq('id', obs.id as string)
  }
}
