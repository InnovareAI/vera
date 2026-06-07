// vera-notice — periodic noticer. Walks projects, evaluates signals,
// writes agent_observations rows.
//
// Invoked by pg_cron every 30 min. Also callable manually:
//   POST /functions/v1/vera-notice
//   { project_id?: <uuid>, kinds?: ['stale_audit', ...] }  // both optional
//
// Signals shipped in v1:
//   · stale_audit    — linkedin_audits.created_at older than 21 days
//   · empty_queue    — active campaign with no scheduled posts in next 7 days
//   · knowledge_gap  — project has no brand_voice AND no project_knowledge
//
// Dedup: each observation has a dedup_key. The schema's partial unique
// index on (dedup_key) where status='open' enforces "one open
// observation per (kind, scope) at a time" — so re-running the noticer
// is safe.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Observation {
  org_id: string
  project_id: string | null
  kind: string
  severity: 'low' | 'medium' | 'high'
  title: string
  detail: string
  proposed_action: string
  action_kind: string
  action_payload: Record<string, unknown>
  dedup_key: string
  surface_until?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method not allowed' })

  let body: { project_id?: string; kinds?: string[] } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const observations: Observation[] = []

  // ── Project scope ──────────────────────────────────────────────
  let projectsQ = supabase.from('projects')
    .select('id, org_id, name, slug, instructions, is_archived')
    .eq('is_archived', false)
  if (body.project_id) projectsQ = projectsQ.eq('id', body.project_id)
  const { data: projects, error: projErr } = await projectsQ
  if (projErr) return json(500, { error: projErr.message })

  const wantedKinds = body.kinds ? new Set(body.kinds) : null
  const want = (k: string) => !wantedKinds || wantedKinds.has(k)

  // ── Per-project signal evaluation ─────────────────────────────
  for (const p of projects ?? []) {
    const projectId = p.id as string
    const orgId     = p.org_id as string
    const projectName = p.name as string

    // (stale_audit signal removed — VERA is multi-category; a LinkedIn-
    // shaped audit isn't a universal signal. The proposals it generated
    // ["no LinkedIn audit yet" / "audit is N days stale"] are gone.)

    // knowledge_gap — no brand_voice and no project_knowledge
    if (want('knowledge_gap')) {
      const [{ count: voiceCount }, { count: knowledgeCount }] = await Promise.all([
        supabase.from('brand_voice').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
        supabase.from('project_knowledge').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      ])
      if ((voiceCount ?? 0) === 0 && (knowledgeCount ?? 0) === 0) {
        observations.push({
          org_id: orgId, project_id: projectId,
          kind: 'knowledge_gap',
          severity: 'high',
          title: `${projectName} has no brief or brand voice`,
          detail: `I have nothing to ground drafts in for this project — anything I write will be generic B2B noise.`,
          proposed_action: 'Paste a brief or point me at your website',
          action_kind: 'prompt_knowledge_input',
          action_payload: { project_id: projectId },
          dedup_key: `knowledge_gap:${projectId}`,
        })
      }
    }

    // empty_queue — active campaign with no scheduled posts next 7 days
    if (want('empty_queue')) {
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id, name, theme, status')
        .eq('org_id', orgId)
        .eq('project_id', projectId)
        .eq('status', 'active')
      const sevenDaysIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      for (const c of campaigns ?? []) {
        const { count } = await supabase
          .from('content_posts')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', c.id as string)
          .gte('scheduled_at', new Date().toISOString())
          .lte('scheduled_at', sevenDaysIso)
        if ((count ?? 0) === 0) {
          observations.push({
            org_id: orgId, project_id: projectId,
            kind: 'empty_queue',
            severity: 'medium',
            title: `${c.name as string}: nothing scheduled next 7 days`,
            detail: c.theme
              ? `Active campaign · theme: "${(c.theme as string).slice(0, 100)}"`
              : `Active campaign with an empty 7-day window.`,
            proposed_action: 'Spin up 3 draft posts from the campaign theme',
            action_kind: 'draft_from_campaign',
            action_payload: { campaign_id: c.id, count: 3 },
            dedup_key: `empty_queue:${c.id}:week-${weekNumber()}`,
          })
        }
      }
    }
  }

  // ── Insert (dedup-aware) ──────────────────────────────────────
  // The schema's partial unique index makes upsert-by-dedup safe.
  // We use upsert with ignoreDuplicates so re-running is a no-op
  // when the same observation is already open.
  let inserted = 0
  let skipped = 0
  for (const obs of observations) {
    const { error } = await supabase
      .from('agent_observations')
      .insert(obs)
    if (error) {
      // Unique violation means an open observation already exists — fine.
      if (error.code === '23505') skipped++
      else console.warn(`obs insert failed: ${error.message}`)
    } else {
      inserted++
    }
  }

  return json(200, {
    ok: true,
    projects_scanned: projects?.length ?? 0,
    observations_generated: observations.length,
    inserted,
    skipped_duplicates: skipped,
  })
})

function weekNumber(): number {
  // Coarse week-of-year. Used in dedup_keys for "this week" scoped
  // observations like empty_queue so they re-trigger every Monday.
  const d = new Date()
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
}
