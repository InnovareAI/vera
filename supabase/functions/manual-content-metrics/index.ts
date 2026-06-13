import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type ManualMetricBody = {
  project_id?: string
  post_id?: string
  provider?: string
  live_url?: string
  metric_time?: string
  metrics?: Record<string, unknown>
}

type ProjectRow = {
  id: string
  org_id: string
}

type PostRow = {
  id: string
  org_id: string
  project_id: string | null
  channel: string | null
  status: string | null
  posted_at: string | null
  posted_url: string | null
  provider: string | null
  provider_post_id: string | null
  provider_permalink: string | null
}

type MetricRow = {
  org_id: string
  project_id: string
  post_id: string
  provider: string
  provider_object_id: string | null
  object_type: string
  metric_name: string
  metric_value: number
  metric_period: string
  metric_time: string
  pulled_at: string
  raw: Record<string, unknown>
}

const ALLOWED_METRICS = [
  "views",
  "reach",
  "reactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "qualified_traffic",
  "buyer_questions",
  "meeting_requests",
] as const

const PROVIDER_ALIASES: Record<string, string> = {
  facebook: "meta_facebook_pages",
  fb: "meta_facebook_pages",
  instagram: "meta_instagram",
  ig: "meta_instagram",
  twitter: "x",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: ManualMetricBody
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const projectId = cleanString(body.project_id)
  const postId = cleanString(body.post_id)
  if (!projectId || !postId) return jsonError("project_id and post_id are required", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const projectRow = project as ProjectRow
  const allowed = await canManageProject(supabase, auth.user.id, projectRow.id, projectRow.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const { data: post, error: postError } = await supabase
    .from("content_posts")
    .select("id, org_id, project_id, channel, status, posted_at, posted_url, provider, provider_post_id, provider_permalink")
    .eq("id", postId)
    .maybeSingle()
  if (postError) return jsonError(postError.message, 500)
  if (!post) return jsonError("Post not found", 404)

  const postRow = post as PostRow
  if (postRow.project_id !== projectRow.id || postRow.org_id !== projectRow.org_id) return jsonError("Forbidden", 403)

  const provider = normalizeProvider(body.provider, postRow)
  if (!provider) return jsonError("provider is required", 400)

  const metricTime = normalizeMetricTime(body.metric_time)
  const pulledAt = new Date().toISOString()
  const liveUrl = cleanUrl(body.live_url)
  const metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {}
  const rows: MetricRow[] = []

  for (const metricName of ALLOWED_METRICS) {
    const metricValue = positiveMetricValue(metrics[metricName])
    if (metricValue === null) continue
    rows.push({
      org_id: projectRow.org_id,
      project_id: projectRow.id,
      post_id: postRow.id,
      provider,
      provider_object_id: postRow.provider_post_id ?? liveUrl ?? postRow.provider_permalink ?? postRow.posted_url ?? null,
      object_type: "post",
      metric_name: metricName,
      metric_value: metricValue,
      metric_period: "lifetime",
      metric_time: metricTime,
      pulled_at: pulledAt,
      raw: {
        source: "manual",
        entered_by: auth.user.id,
        live_url: liveUrl,
      },
    })
  }

  if (!rows.length) return jsonError("Enter at least one metric value.", 400)

  const { error: insertError } = await supabase.from("content_metric_snapshots").insert(rows)
  if (insertError) return jsonError(insertError.message, 500)

  const postUpdates: Record<string, unknown> = {
    provider,
    last_metric_sync_at: pulledAt,
  }
  if (liveUrl) {
    postUpdates.posted_url = liveUrl
    postUpdates.provider_permalink = liveUrl
    if (!postRow.posted_at) postUpdates.posted_at = metricTime
  }

  const { error: updateError } = await supabase
    .from("content_posts")
    .update(postUpdates)
    .eq("id", postRow.id)
  if (updateError) return jsonError(updateError.message, 500)

  return json({
    ok: true,
    post_id: postRow.id,
    provider,
    metric_count: rows.length,
    pulled_at: pulledAt,
  })
})

async function canManageProject(
  supabase: SupabaseAdminClient,
  userId: string,
  projectId: string,
  orgId: string,
) {
  const [{ data: orgMember, error: orgError }, { data: projectMember, error: projectError }] = await Promise.all([
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  ])

  if (orgError || projectError) return false
  if (["owner", "admin", "agency_admin"].includes((orgMember as { role?: string } | null)?.role ?? "")) return true
  return ["owner", "admin", "editor"].includes((projectMember as { role?: string } | null)?.role ?? "")
}

function normalizeProvider(input: unknown, post: PostRow): string | null {
  const direct = cleanString(input)
  const raw = direct || post.provider || providerFromText(`${post.channel ?? ""} ${post.posted_url ?? ""} ${post.provider_permalink ?? ""}`)
  if (!raw) return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_")
  return PROVIDER_ALIASES[normalized] ?? normalized
}

function providerFromText(value: string): string | null {
  const text = value.toLowerCase()
  if (text.includes("linkedin")) return "linkedin"
  if (text.includes("instagram")) return "meta_instagram"
  if (text.includes("facebook") || text.includes("fb.watch")) return "meta_facebook_pages"
  if (text.includes("youtube") || text.includes("youtu.be")) return "youtube"
  if (text.includes("medium")) return "medium"
  if (text.includes("quora")) return "quora"
  if (text.includes("reddit")) return "reddit"
  if (text.includes("twitter") || text.includes("x.com")) return "x"
  return null
}

function normalizeMetricTime(input: unknown): string {
  const raw = cleanString(input)
  if (!raw) return new Date().toISOString()
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function positiveMetricValue(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null
  const value = typeof input === "number" ? input : Number(String(input).replace(/,/g, ""))
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 10000) / 10000
}

function cleanString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null
}

function cleanUrl(input: unknown): string | null {
  const raw = cleanString(input)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status)
}
