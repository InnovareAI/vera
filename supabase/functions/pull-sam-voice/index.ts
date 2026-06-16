// pull-sam-voice — pull a person's learned LinkedIn voice profile from SAM into
// this space's VERA brand voice.
//
// SAM's commenting agent learns a workspace's tone, writing style, and do/don'ts
// through training. This function calls SAM's read-only voice-profile endpoint
// (guarded by VERA_INTEGRATION_SECRET), maps the profile onto VERA's brand_voice
// shape, and MERGES it into the space's project-scoped brand voice row (additive,
// so it never wipes an existing voice).
//
// Request:  POST { project_id, sam_workspace_id }
// Response: { ok, applied: { tone, writing_rules, system_prompt }, source }
import { createClient } from "npm:@supabase/supabase-js"
import type { Database } from "../_shared/database.types.ts"
import { requireProjectMember } from "../_shared/auth.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SAM_BASE_URL = (Deno.env.get("SAM_BASE_URL") ?? "").replace(/\/+$/, "")
const INTEGRATION_SECRET = Deno.env.get("VERA_INTEGRATION_SECRET") ?? ""

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } })
}

// Split a free-text field (commas, semicolons, newlines, bullets) into clean items.
function splitToItems(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n|;|•|•|·|(?<=[.!?])\s+(?=[A-Z])/)
    .flatMap(part => part.split(/,(?![^(]*\))/))
    .map(s => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter(s => s.length > 1)
}

function uniqMerge(existing: string[] | null | undefined, incoming: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of [...(existing ?? []), ...incoming]) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item.trim())
  }
  return out
}

type SamVoiceProfile = {
  tone_of_voice?: string | null
  writing_style?: string | null
  topics_and_perspective?: string | null
  dos_and_donts?: string | null
  comment_framework?: string | null
  system_prompt?: string | null
  max_characters?: number | null
  updated_at?: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)
  if (!SAM_BASE_URL) return json({ error: "SAM_BASE_URL is not configured on this VERA backend" }, 500)
  if (!INTEGRATION_SECRET) return json({ error: "VERA_INTEGRATION_SECRET is not configured on this VERA backend" }, 500)

  let body: { project_id?: string; sam_workspace_id?: string }
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }

  const projectId = body.project_id?.trim()
  const samWorkspaceId = body.sam_workspace_id?.trim()
  if (!projectId) return json({ error: "project_id required" }, 400)
  if (!samWorkspaceId) return json({ error: "sam_workspace_id required" }, 400)

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireProjectMember(req, supabase, SERVICE_KEY, projectId, cors)
  if (!auth.ok) return auth.response
  const orgId = auth.orgId

  // 1. Pull the profile from SAM.
  let samRes: Response
  try {
    samRes = await fetch(`${SAM_BASE_URL}/api/integrations/voice-profile?workspace_id=${encodeURIComponent(samWorkspaceId)}`, {
      headers: { Authorization: `Bearer ${INTEGRATION_SECRET}` },
    })
  } catch (e) {
    return json({ error: `Could not reach SAM: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }
  const samData = await samRes.json().catch(() => ({})) as { ok?: boolean; error?: string; voice_profile?: SamVoiceProfile }
  if (!samRes.ok || !samData.ok || !samData.voice_profile) {
    return json({ error: samData.error ?? `SAM returned HTTP ${samRes.status}` }, samRes.status === 404 ? 404 : 502)
  }
  const p = samData.voice_profile

  // 2. Map SAM profile → VERA brand_voice shape.
  const pulledTone = splitToItems(p.tone_of_voice)
  const pulledRules = [
    ...splitToItems(p.writing_style),
    p.topics_and_perspective ? `Topics & perspective: ${p.topics_and_perspective.trim()}` : "",
    p.comment_framework ? `Comment framework: ${p.comment_framework.trim()}` : "",
    p.dos_and_donts ? `Do's and don'ts: ${p.dos_and_donts.trim()}` : "",
  ].filter(Boolean) as string[]

  // 3. Merge into the project-scoped brand_voice row (additive, never clobbers).
  const { data: existing, error: selErr } = await supabase
    .from("brand_voice")
    .select("id, tone, writing_rules, system_prompt")
    .eq("project_id", projectId)
    .maybeSingle()
  if (selErr) return json({ error: selErr.message }, 500)

  const existingRow = existing as { id: string; tone?: string[] | null; writing_rules?: string[] | null; system_prompt?: string | null } | null
  const tone = uniqMerge(existingRow?.tone, pulledTone)
  const writingRules = uniqMerge(existingRow?.writing_rules, pulledRules)
  const systemPrompt = (existingRow?.system_prompt && existingRow.system_prompt.trim())
    ? existingRow.system_prompt
    : (p.system_prompt ?? null)

  if (existingRow) {
    const { error: updErr } = await supabase
      .from("brand_voice")
      .update({ tone, writing_rules: writingRules, system_prompt: systemPrompt, updated_at: new Date().toISOString() })
      .eq("id", existingRow.id)
    if (updErr) return json({ error: updErr.message }, 500)
  } else {
    const { error: insErr } = await supabase
      .from("brand_voice")
      .insert({ org_id: orgId, project_id: projectId, tone, writing_rules: writingRules, system_prompt: systemPrompt })
    if (insErr) return json({ error: insErr.message }, 500)
  }

  return json({
    ok: true,
    source: "sam",
    sam_workspace_id: samWorkspaceId,
    applied: { tone, writing_rules: writingRules, system_prompt: systemPrompt },
    profile_updated_at: p.updated_at ?? null,
  })
})
