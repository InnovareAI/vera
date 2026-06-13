// Single hub for status changes on content_posts. Public review actions require
// a revocable review_token. Internal server-to-server publish actions use the
// service role. Authenticated operator actions must belong to the post org.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import type { User } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const N8N_WEBHOOK_URL = Deno.env.get("N8N_WEBHOOK_URL")
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://vera.innovareai.com"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const VALID_ACTIONS = new Set(["approved", "rejected", "changes_requested", "posted"])
const REVIEW_ACTIONS = new Set(["approved", "rejected", "changes_requested"])
type Supabase = ReturnType<typeof createClient<any>>

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const post_id = body.post_id as string | undefined
  const review_token = body.review_token as string | undefined
  const action = body.action as string | undefined
  const feedback = body.feedback as string | undefined
  const reviewed_by = body.reviewed_by as string | undefined
  const posted_url = body.posted_url as string | undefined
  const provider_post_id = body.provider_post_id as string | undefined

  if (!action) return jsonError("action is required", 400)
  if (!VALID_ACTIONS.has(action)) return jsonError(`action must be one of: ${[...VALID_ACTIONS].join(", ")}`, 400)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const authHeader = req.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  const isServiceRole = bearer === SUPABASE_SERVICE_ROLE_KEY
  let authUserId: string | null = null

  let post: PostRow

  if (review_token) {
    if (!REVIEW_ACTIONS.has(action)) return jsonError("review_token can only be used for review actions", 403)
    if (!/^[a-f0-9]{32,128}$/i.test(review_token)) return jsonError("Invalid review token", 400)
    const result = await supabase.from("content_posts").select("*").eq("review_token", review_token).maybeSingle()
    if (result.error) return jsonError(result.error.message, 500)
    const fetchedPost = result.data as PostRow | null
    if (!fetchedPost) return jsonError("Review link not found", 404)
    post = fetchedPost
    const tokenError = validateReviewToken(post)
    if (tokenError) return tokenError
  } else if (post_id) {
    const result = await supabase.from("content_posts").select("*").eq("id", post_id).maybeSingle()
    if (result.error) return jsonError(result.error.message, 500)
    const fetchedPost = result.data as PostRow | null
    if (!fetchedPost) return jsonError(`No post with id ${post_id}`, 404)
    post = fetchedPost

    if (!isServiceRole) {
      const user = await authenticatedUser(supabase, bearer)
      if (!user) return jsonError("Authentication required", 401)
      authUserId = user.id
      const allowed = await userCanAccessPost(supabase, user.id, post)
      if (!allowed) return jsonError("Not allowed for this post", 403)
    }
  } else {
    return jsonError("post_id or review_token is required", 400)
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {}
  let updated: unknown
  if (action === "posted") {
    if (post.posted_at) {
      const alreadyPosted = await backfillPostedFields(supabase, post, { posted_url, provider_post_id })
      if (!alreadyPosted.ok) return jsonError(alreadyPosted.message, 500)
      return new Response(JSON.stringify({ success: true, already_posted: true, post: alreadyPosted.post }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    updates.posted_at = now
    if (posted_url !== undefined) updates.posted_url = posted_url
    if (provider_post_id !== undefined) updates.provider_post_id = provider_post_id

    const result = await supabase
      .from("content_posts")
      .update(updates)
      .eq("id", post.id)
      .is("posted_at", null)
      .select()
      .maybeSingle()

    if (result.error) return jsonError(result.error.message, 500)
    if (!result.data) {
      const refreshedResult = await supabase
        .from("content_posts")
        .select("*")
        .eq("id", post.id)
        .maybeSingle()
      if (refreshedResult.error) return jsonError(refreshedResult.error.message, 500)
      const refreshedPost = refreshedResult.data as PostRow | null
      if (refreshedPost?.posted_at) {
        const alreadyPosted = await backfillPostedFields(supabase, refreshedPost, { posted_url, provider_post_id })
        if (!alreadyPosted.ok) return jsonError(alreadyPosted.message, 500)
        return new Response(JSON.stringify({ success: true, already_posted: true, post: alreadyPosted.post }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      return jsonError("Post is already marked posted.", 409)
    }
    updated = result.data
    await recordPostOutcome(supabase, post.id, action, {
      feedback,
      recordedBy: authUserId,
      reviewedBy: reviewed_by,
      previousStatus: post.status,
      postedUrl: posted_url,
      providerPostId: provider_post_id,
    })
  } else {
    updates.status = action
    updates.reviewed_at = now
    if (reviewed_by !== undefined) updates.reviewed_by = reviewed_by
    if (feedback !== undefined) updates.feedback = feedback

    const result = await supabase
      .from("content_posts")
      .update(updates)
      .eq("id", post.id)
      .select()
      .single()

    if (result.error) return jsonError(result.error.message, 500)
    updated = result.data
    await recordPostOutcome(supabase, post.id, action, {
      feedback,
      recordedBy: authUserId,
      reviewedBy: reviewed_by,
      previousStatus: post.status,
    })
  }

  if (N8N_WEBHOOK_URL && action !== "posted") {
    fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: updated, action, feedback }),
    }).catch(() => {})
  }

  if (SLACK_WEBHOOK_URL && (action === "approved" || action === "posted")) {
    notifySlack(updated as PostRow, action).catch(() => {})
  }

  return new Response(JSON.stringify({ success: true, post: updated }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

interface PostRow {
  id: string
  org_id?: string | null
  project_id?: string | null
  status?: string | null
  title?: string | null
  channel?: string | null
  copy?: string | null
  posted_at?: string | null
  posted_url?: string | null
  provider_post_id?: string | null
  feedback?: string | null
  review_token_expires_at?: string | null
  review_token_revoked_at?: string | null
}

async function backfillPostedFields(
  supabase: Supabase,
  post: PostRow,
  fields: { posted_url?: string; provider_post_id?: string },
): Promise<{ ok: true; post: PostRow } | { ok: false; message: string }> {
  const updates: Record<string, unknown> = {}
  if (fields.posted_url !== undefined && !post.posted_url) updates.posted_url = fields.posted_url
  if (fields.provider_post_id !== undefined && !post.provider_post_id) updates.provider_post_id = fields.provider_post_id
  if (Object.keys(updates).length === 0) return { ok: true, post }

  const result = await supabase
    .from("content_posts")
    .update(updates)
    .eq("id", post.id)
    .select()
    .maybeSingle()
  if (result.error) return { ok: false, message: result.error.message }
  return { ok: true, post: (result.data as PostRow | null) ?? { ...post, ...updates } }
}

function validateReviewToken(post: PostRow): Response | null {
  if (post.review_token_revoked_at) return jsonError("Review link revoked", 410)
  if (post.review_token_expires_at && new Date(post.review_token_expires_at).getTime() < Date.now()) {
    return jsonError("Review link expired", 410)
  }
  return null
}

async function authenticatedUser(supabase: Supabase, bearer: string): Promise<User | null> {
  if (!bearer) return null
  const { data, error } = await supabase.auth.getUser(bearer)
  if (error) return null
  return data.user ?? null
}

async function userCanAccessPost(supabase: Supabase, userId: string, post: PostRow): Promise<boolean> {
  let orgId = post.org_id ?? null
  if (!orgId && post.project_id) {
    const { data: project } = await supabase.from("projects").select("org_id").eq("id", post.project_id).maybeSingle()
    orgId = (project as { org_id?: string | null } | null)?.org_id ?? null
  }
  if (!orgId) return false
  const checks = [
    supabase
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]
  if (post.project_id) {
    checks.push(
      supabase
        .from("project_members")
        .select("id")
        .eq("project_id", post.project_id)
        .eq("user_id", userId)
        .maybeSingle(),
    )
  }
  const [orgResult, projectResult] = await Promise.all(checks)
  if (orgResult.error || projectResult?.error) return false
  return !!orgResult.data || !!projectResult?.data
}

async function recordPostOutcome(
  supabase: Supabase,
  postId: string,
  outcome: string,
  detail: {
    feedback?: string | null
    recordedBy?: string | null
    reviewedBy?: string | null
    previousStatus?: string | null
    postedUrl?: string | null
    providerPostId?: string | null
  },
): Promise<void> {
  const edit_summary: Record<string, unknown> = {
    source: "approval-webhook",
    previous_status: detail.previousStatus ?? null,
  }
  if (detail.reviewedBy) edit_summary.reviewed_by_label = detail.reviewedBy
  if (detail.postedUrl) edit_summary.posted_url = detail.postedUrl
  if (detail.providerPostId) edit_summary.provider_post_id = detail.providerPostId

  const { error } = await supabase.from("post_outcomes").insert({
    post_id: postId,
    outcome,
    feedback: detail.feedback ?? null,
    recorded_by: detail.recordedBy ?? null,
    edit_summary,
  })
  if (error) {
    console.error("post_outcome insert failed", { post_id: postId, outcome, error: error.message })
  }
}

async function notifySlack(post: PostRow, action: "approved" | "posted"): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return

  const channel = post.channel ?? "unknown"
  const title = post.title ?? "Untitled post"
  const excerpt = (post.copy ?? "").slice(0, 240).replace(/\s+/g, " ").trim()
  const reviewLink = `${APP_BASE_URL}/review/${post.id}`

  const headline = action === "approved"
    ? `Approved: *${title}* (${channel})`
    : `Posted: *${title}* (${channel})`

  const blocks: Array<Record<string, unknown>> = [{ type: "section", text: { type: "mrkdwn", text: headline } }]
  if (excerpt) blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${excerpt}${(post.copy ?? "").length > 240 ? "..." : ""}` } })
  if (action === "posted" && post.posted_url) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${post.posted_url}|View live post> · <${reviewLink}|Open in VERA>` } })
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${reviewLink}|Open in VERA>` } })
  }

  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: headline, blocks }),
  })
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
