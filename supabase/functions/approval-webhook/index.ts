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

  if (!action) return jsonError("action is required", 400)
  if (!VALID_ACTIONS.has(action)) return jsonError(`action must be one of: ${[...VALID_ACTIONS].join(", ")}`, 400)
  if (action === "posted" && !posted_url) return jsonError("posted_url is required when action is 'posted'", 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const authHeader = req.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  const isServiceRole = bearer === SUPABASE_SERVICE_ROLE_KEY

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
      const allowed = await userCanAccessPost(supabase, user.id, post)
      if (!allowed) return jsonError("Not allowed for this post", 403)
    }
  } else {
    return jsonError("post_id or review_token is required", 400)
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {}
  if (action === "posted") {
    updates.posted_at = now
    updates.posted_url = posted_url
  } else {
    updates.status = action
    updates.reviewed_at = now
    if (reviewed_by !== undefined) updates.reviewed_by = reviewed_by
    if (feedback !== undefined) updates.feedback = feedback
  }

  const { data: updated, error } = await supabase
    .from("content_posts")
    .update(updates)
    .eq("id", post.id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

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
  title?: string | null
  channel?: string | null
  copy?: string | null
  posted_url?: string | null
  feedback?: string | null
  review_token_expires_at?: string | null
  review_token_revoked_at?: string | null
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
  const { data, error } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()
  return !error && !!data
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
