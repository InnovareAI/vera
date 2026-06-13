// weekly-learning-review - turns a weekly_learning notice into durable action.
//
// POST /functions/v1/weekly-learning-review
// {
//   observation_id: uuid,
//   activate_skill_ids?: uuid[],
//   queue_all_handoffs?: boolean,
//   queue_handoff_post_ids?: uuid[],
//   complete_review?: boolean
// }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js"
import type { Database } from "../_shared/database.types.ts"
import { requireObservationMember } from "../_shared/auth.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

type ReviewBody = {
  observation_id?: string
  activate_skill_ids?: unknown
  queue_all_handoffs?: unknown
  queue_handoff_post_ids?: unknown
  complete_review?: unknown
}

type WeeklySkillProposal = {
  id?: string
  name?: string
}

type WeeklyHandoffCandidate = {
  post_id?: string
  title?: string
  channel?: string
  score?: number
  triggers?: string[]
}

type WeeklyPayload = {
  week_key?: string
  skill_proposals?: WeeklySkillProposal[]
  sam_handoff_candidates?: WeeklyHandoffCandidate[]
}

type AdminClient = SupabaseClient<Database>

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  let body: ReviewBody
  try {
    body = await req.json()
  } catch {
    return json(400, { error: "invalid json" })
  }

  const observationId = cleanString(body.observation_id)
  if (!observationId) return json(400, { error: "observation_id required" })

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireObservationMember(req, supabase, SERVICE_KEY, observationId, cors)
  if (!auth.ok) return auth.response

  const { data: obs, error: obsError } = await supabase
    .from("agent_observations")
    .select("*")
    .eq("id", observationId)
    .maybeSingle()
  if (obsError) return json(500, { error: obsError.message })
  if (!obs) return json(404, { error: "observation not found" })
  if (obs.kind !== "weekly_learning") return json(400, { error: "observation is not a weekly learning review" })
  if (obs.status !== "open") return json(400, { error: `observation is already ${obs.status}` })
  if (!obs.project_id) return json(400, { error: "weekly learning review must be tied to a client project" })

  const now = new Date().toISOString()
  const payload = normalizeWeeklyPayload(obs.action_payload)
  const proposedSkillIds = new Set((payload.skill_proposals ?? []).map(skill => cleanString(skill.id)).filter(Boolean))
  const requestedSkillIds = cleanStringArray(body.activate_skill_ids)
  const skillIdsToActivate = requestedSkillIds.filter(id => proposedSkillIds.has(id))

  let activatedSkills: Array<{ id: string; name: string | null }> = []
  if (skillIdsToActivate.length > 0) {
    const { data, error } = await supabase
      .from("skills")
      .update({ is_active: true, last_reviewed_at: now })
      .eq("org_id", obs.org_id)
      .eq("project_id", obs.project_id)
      .eq("is_system", false)
      .in("id", skillIdsToActivate)
      .select("id, name")
    if (error) return json(500, { error: error.message })
    activatedSkills = (data ?? []) as Array<{ id: string; name: string | null }>
  }

  const selectedHandoffs = selectHandoffs(payload, body)
  const handoffResult = await queueHandoffs(supabase, {
    observationId: obs.id,
    orgId: obs.org_id,
    projectId: obs.project_id,
    createdBy: auth.userId,
    payload,
    candidates: selectedHandoffs,
  })
  if (!handoffResult.ok) return json(500, { error: handoffResult.error })

  const completeReview = body.complete_review === true
  const previousResult = isRecord(obs.acted_result) ? obs.acted_result : {}
  const actedResult = {
    ...previousResult,
    stage: completeReview ? "weekly_review_complete" : "weekly_review_updated",
    reviewed_at: now,
    reviewed_by: auth.userId,
    activated_skill_ids: activatedSkills.map(skill => skill.id),
    activated_skill_count: activatedSkills.length,
    queued_handoff_ids: handoffResult.queuedIds,
    queued_handoff_count: handoffResult.queuedIds.length,
    skipped_duplicate_handoff_count: handoffResult.skippedDuplicates,
  }

  const observationUpdate: Database["public"]["Tables"]["agent_observations"]["Update"] = {
    acted_result: actedResult,
  }
  if (completeReview) {
    observationUpdate.status = "actioned"
    observationUpdate.actioned_at = now
  }

  const { error: updateError } = await supabase
    .from("agent_observations")
    .update(observationUpdate)
    .eq("id", obs.id)
  if (updateError) return json(500, { error: updateError.message })

  return json(200, {
    ok: true,
    observation_id: obs.id,
    status: completeReview ? "actioned" : obs.status,
    activated_skills: activatedSkills,
    queued_handoff_ids: handoffResult.queuedIds,
    skipped_duplicate_handoff_count: handoffResult.skippedDuplicates,
  })
})

function normalizeWeeklyPayload(value: unknown): WeeklyPayload {
  if (!isRecord(value)) return {}
  return {
    week_key: cleanString(value.week_key) || undefined,
    skill_proposals: Array.isArray(value.skill_proposals)
      ? value.skill_proposals.filter(isRecord).map(item => ({
          id: cleanString(item.id) || undefined,
          name: cleanString(item.name) || undefined,
        }))
      : [],
    sam_handoff_candidates: Array.isArray(value.sam_handoff_candidates)
      ? value.sam_handoff_candidates.filter(isRecord).map(item => ({
          post_id: cleanString(item.post_id) || undefined,
          title: cleanString(item.title) || undefined,
          channel: cleanString(item.channel) || undefined,
          score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
          triggers: cleanStringArray(item.triggers),
        }))
      : [],
  }
}

function selectHandoffs(payload: WeeklyPayload, body: ReviewBody) {
  const candidates = (payload.sam_handoff_candidates ?? []).filter(candidate => cleanString(candidate.post_id))
  if (body.queue_all_handoffs === true) return candidates

  const requestedPostIds = new Set(cleanStringArray(body.queue_handoff_post_ids))
  if (requestedPostIds.size === 0) return []
  return candidates.filter(candidate => candidate.post_id && requestedPostIds.has(candidate.post_id))
}

async function queueHandoffs(
  supabase: AdminClient,
  args: {
    observationId: string
    orgId: string
    projectId: string
    createdBy: string | null
    payload: WeeklyPayload
    candidates: WeeklyHandoffCandidate[]
  },
): Promise<{ ok: true; queuedIds: string[]; skippedDuplicates: number } | { ok: false; error: string }> {
  if (args.candidates.length === 0) return { ok: true, queuedIds: [], skippedDuplicates: 0 }

  const { data: existing, error: existingError } = await supabase
    .from("sam_handoff_actions")
    .select("post_id")
    .eq("project_id", args.projectId)
  if (existingError) return { ok: false, error: existingError.message }

  const existingPostIds = new Set((existing ?? []).map(row => row.post_id).filter(Boolean))
  const rows = args.candidates
    .filter(candidate => candidate.post_id && !existingPostIds.has(candidate.post_id))
    .map(candidate => ({
      org_id: args.orgId,
      project_id: args.projectId,
      observation_id: args.observationId,
      post_id: candidate.post_id!,
      title: candidate.title || "SAM handoff candidate",
      channel: candidate.channel || null,
      score: candidate.score ?? 0,
      triggers: candidate.triggers ?? [],
      priority: handoffPriority(candidate),
      status: "queued",
      created_by: args.createdBy,
      payload: {
        source: "weekly_learning",
        week_key: args.payload.week_key ?? null,
        candidate,
      },
    }))

  if (rows.length === 0) {
    return { ok: true, queuedIds: [], skippedDuplicates: args.candidates.length }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("sam_handoff_actions")
    .insert(rows)
    .select("id")
  if (insertError) return { ok: false, error: insertError.message }

  return {
    ok: true,
    queuedIds: (inserted ?? []).map(row => row.id),
    skippedDuplicates: args.candidates.length - rows.length,
  }
}

function handoffPriority(candidate: WeeklyHandoffCandidate): "low" | "medium" | "high" {
  const triggers = new Set((candidate.triggers ?? []).map(trigger => trigger.toLowerCase()))
  if ((candidate.score ?? 0) >= 40) return "high"
  if (triggers.has("buyer_questions") || triggers.has("meeting_requests") || triggers.has("qualified_traffic")) return "high"
  if ((candidate.score ?? 0) >= 18 || triggers.has("comments") || triggers.has("shares")) return "medium"
  return "low"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => cleanString(item))
    .filter(Boolean)
}
