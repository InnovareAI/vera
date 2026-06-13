import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const TOKEN_RE = /^[a-f0-9]{32,128}$/i
const POST_COLUMNS =
  "id,title,copy,format,channel,media_url,media_type,media_metadata,profile_name,profile_title,author,publish_date,status,hashtags,created_at,updated_at,review_token_expires_at,review_token_revoked_at"

// Fetch + validate a post by its review token. Shared by the read (GET) and the
// edit (POST) paths so both honour revoke/expiry identically.
async function postForToken(
  supabase: SupabaseClient,
  token: string,
): Promise<{ post: Record<string, unknown> } | { error: Response }> {
  const { data: post, error } = await supabase
    .from("content_posts").select(POST_COLUMNS).eq("review_token", token).maybeSingle()
  if (error) return { error: jsonError(error.message, 500) }
  if (!post) return { error: jsonError("Review link not found", 404) }
  const row = post as Record<string, unknown>
  if (row.review_token_revoked_at) return { error: jsonError("Review link revoked", 410) }
  const expires = row.review_token_expires_at as string | null
  if (expires && new Date(expires).getTime() < Date.now()) return { error: jsonError("Review link expired", 410) }
  return { post: row }
}

function strip(post: Record<string, unknown>): Record<string, unknown> {
  const { review_token_expires_at: _e, review_token_revoked_at: _r, ...safe } = post
  void _e; void _r
  return safe
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Read the post behind the share token.
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token")?.trim() ?? ""
    if (!TOKEN_RE.test(token)) return jsonError("Invalid review token", 400)
    const res = await postForToken(supabase, token)
    if ("error" in res) return res.error
    return ok({ post: strip(res.post) })
  }

  // Save reviewer edits to the copy (and optionally title / hashtags). The share
  // link is intentionally always editable: holding a live, unrevoked token is the
  // same trust boundary as approving the post, so it can also revise it.
  if (req.method === "POST") {
    let body: { token?: string; copy?: string; title?: string; hashtags?: string[]; reviewer?: string }
    try { body = await req.json() } catch { return jsonError("Invalid JSON body", 400) }
    const token = (body.token ?? "").trim()
    if (!TOKEN_RE.test(token)) return jsonError("Invalid review token", 400)
    if (typeof body.copy !== "string") return jsonError("copy is required", 400)
    if (body.copy.length > 20000) return jsonError("copy is too long", 400)

    const res = await postForToken(supabase, token)
    if ("error" in res) return res.error
    const before = res.post
    const previousCopy = typeof before.copy === "string" ? before.copy : ""

    const updates: Record<string, unknown> = { copy: body.copy, updated_at: new Date().toISOString() }
    if (typeof body.title === "string") updates.title = body.title.slice(0, 300)
    if (Array.isArray(body.hashtags)) updates.hashtags = body.hashtags.slice(0, 60).map((h) => String(h).slice(0, 80))

    const { data: updated, error } = await supabase
      .from("content_posts").update(updates).eq("review_token", token).select(POST_COLUMNS).single()
    if (error) return jsonError(error.message, 500)
    if (body.copy !== previousCopy) {
      await recordEditOutcome(supabase, updated.id as string, {
        reviewer: body.reviewer,
        previousCopy,
        nextCopy: body.copy,
        changedFields: ["copy"],
      })
    }
    return ok({ post: strip(updated as Record<string, unknown>) })
  }

  return jsonError("Method not allowed", 405)
})

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

async function recordEditOutcome(
  supabase: SupabaseClient,
  postId: string,
  detail: {
    reviewer?: string
    previousCopy: string
    nextCopy: string
    changedFields: string[]
  },
): Promise<void> {
  const reviewer = typeof detail.reviewer === "string" && detail.reviewer.trim()
    ? detail.reviewer.trim().slice(0, 180)
    : null
  const { error } = await supabase.from("post_outcomes").insert({
    post_id: postId,
    outcome: "edited",
    feedback: reviewer ? `Reviewer copy edit by ${reviewer}` : "Reviewer copy edit from public review link",
    edit_summary: {
      source: "review-link",
      reviewer,
      changed_fields: detail.changedFields,
      previous_copy_length: detail.previousCopy.length,
      next_copy_length: detail.nextCopy.length,
      delta_length: detail.nextCopy.length - detail.previousCopy.length,
    },
  })
  if (error) {
    console.error("review-link post_outcome insert failed", { post_id: postId, error: error.message })
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}
