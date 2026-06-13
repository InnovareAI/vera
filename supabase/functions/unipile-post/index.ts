// LinkedIn auto-post via Unipile.
//
// POST { post_id, as_organization?, auto_mark_posted? }
//   - post_id: content_posts row to publish
//   - as_organization: optional LinkedIn org URN; when set, posts as the
//                      company page instead of the connected personal profile.
//                      If you have a linkedin_company channel configured, the
//                      function resolves the org URN automatically.
//   - auto_mark_posted: default true. When true, on a successful post the
//                       function calls approval-webhook with action:'posted'
//                       to set posted_at + posted_url and fire the Slack notify.
//                       Set false when n8n wants to chain its own post-publish
//                       steps (e.g. Airtable log) before marking posted.
//
// Response (200): { unipile_response, posted_url, urn }
// Errors come back as { error: "..." } with the appropriate HTTP status.
//
// Per Unipile docs: POST /api/v1/posts with X-API-KEY. Required fields:
// account_id + text. Images are multipart/form-data with binary file parts —
// no remote-URL field is documented, so media_url is fetched server-side and
// re-uploaded. Response shape is not contractually documented; we log it and
// extract whatever URL/URN field is present.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import { requirePostMember } from "../_shared/auth.ts"
import {
  claimPublish,
  completePublishClaim,
  markPublishClaimError,
  releasePublishClaim,
} from "../_shared/publish-claims.ts"
import {
  getUnipileAccountId,
  resolveClientLinkedInOrganization,
} from "../_shared/unipile-publishing.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN")
const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY")

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type JsonRecord = Record<string, unknown>

type PostRow = {
  id: string
  org_id: string | null
  project_id: string | null
  channel: string | null
  copy: string | null
  hashtags: unknown
  media_url: string | null
  title: string | null
  posted_at: string | null
}

type ClientIntegrationRow = {
  id: string
  provider: string
  status: string
  config: JsonRecord | null
  external_ref: JsonRecord | null
  health_status: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return jsonError("UNIPILE_DSN / UNIPILE_API_KEY not configured", 500)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const supabase = createAdminClient()
  const auth = await requirePostMember(req, supabase, SUPABASE_SERVICE_ROLE_KEY, body.post_id as string | undefined, corsHeaders)
  if (!auth.ok) return auth.response

  const post_id = body.post_id as string | undefined
  const explicitOrgUrn = body.as_organization as string | undefined
  const autoMarkPosted = body.auto_mark_posted !== false // default true

  if (!post_id) return jsonError("post_id is required", 400)

  // 1. Look up the post + the org's Unipile account
  const { data: postData, error: postErr } = await supabase
    .from("content_posts")
    .select("id, org_id, project_id, channel, copy, hashtags, media_url, title, posted_at")
    .eq("id", post_id)
    .maybeSingle()

  if (postErr) return jsonError(`Post lookup failed: ${postErr.message}`, 500)
  if (!postData) return jsonError(`No post with id ${post_id}`, 404)
  const post = postData as PostRow
  if (post.posted_at) return jsonError("Post is already marked posted; refusing to re-publish.", 409)

  const channel = (post.channel ?? "").toLowerCase()
  const SUPPORTED = new Set(["linkedin", "instagram"]) // Unipile create-post providers
  if (!SUPPORTED.has(channel)) {
    return jsonError(`unipile-post handles linkedin + instagram; got channel='${channel}'`, 400)
  }

  // Resolve the account. Project posts must use a project-scoped connection.
  // The legacy org-level LinkedIn column is only allowed for old org-wide posts
  // that have no project_id.
  let unipileAccountId: string | null = null
  let clientIntegration: ClientIntegrationRow | null = null
  if (post.project_id) {
    const integrationProvider = integrationProviderForChannel(channel)
    const { data: integrationData, error: integrationErr } = await supabase
      .from("client_integrations")
      .select("id, provider, status, config, external_ref, health_status")
      .eq("project_id", post.project_id)
      .eq("provider", integrationProvider)
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (integrationErr) return jsonError(`Client integration lookup failed: ${integrationErr.message}`, 500)

    const integration = integrationData as ClientIntegrationRow | null
    clientIntegration = integration
    unipileAccountId = getUnipileAccountId(integration)
    if (!unipileAccountId) {
      return jsonError(`No connected ${channel} Unipile account for this client. Connect it in client integrations first.`, 400)
    }
    if (integration?.health_status === "stale" || integration?.health_status === "error") {
      return jsonError(`Connected ${channel} account is ${integration.health_status}. Reconnect it before publishing.`, 400)
    }
  }
  if (!post.project_id && !unipileAccountId && channel === "linkedin" && post.org_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("unipile_account_id")
      .eq("id", post.org_id)
      .maybeSingle()
    unipileAccountId = (org?.unipile_account_id as string | null) ?? null
  }
  if (!unipileAccountId) {
    return jsonError(`No connected ${channel} account for this client — connect it first.`, 400)
  }

  // Instagram posts must carry media — there is no text-only IG post.
  if (channel === "instagram" && !post.media_url) {
    return jsonError("Instagram posts require an image or video (media_url).", 400)
  }

  // 2. Resolve company URN if needed. Project posts can only publish as a
  // company page that is explicitly stored on this client's integration.
  // Legacy org-wide posts can still use channel_profiles for auto-detection.
  let asOrganization: string | undefined
  if (channel === "linkedin" && post.project_id) {
    const orgResolution = resolveClientLinkedInOrganization(clientIntegration, explicitOrgUrn)
    if (!orgResolution.ok) return jsonError(orgResolution.message, orgResolution.status)
    asOrganization = orgResolution.asOrganization
  } else {
    asOrganization = explicitOrgUrn
  }

  if (channel === "linkedin" && !asOrganization && !post.project_id && post.org_id) {
    const { data: channels } = await supabase
      .from("channel_profiles")
      .select("channel, url")
      .eq("org_id", post.org_id)
      .eq("is_active", true)
    const companyChan = channels?.find(c => c.channel === "linkedin_company")
    if (companyChan?.url) {
      const slug = companyChan.url.match(/linkedin\.com\/company\/([^\/\?#]+)/i)?.[1]
      if (slug) {
        const lookup = await fetch(
          `https://${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(unipileAccountId)}`,
          { headers: { "X-API-KEY": UNIPILE_API_KEY, "Accept": "application/json" } },
        )
        if (lookup.ok) {
          const profile = await lookup.json() as Record<string, unknown>
          const orgId = profile.id as string | undefined
          if (orgId) asOrganization = orgId
        }
      }
    }
  }

  // 3. Build the post text — copy + hashtags, separated by newline so the
  //    hashtag block sits below the body (matches how operators paste manually).
  const textParts: string[] = []
  if (post.copy) textParts.push((post.copy as string).trim())
  if (Array.isArray(post.hashtags) && post.hashtags.length) {
    textParts.push((post.hashtags as string[]).join(" "))
  }
  const text = textParts.join("\n\n").trim()
  if (!text) return jsonError("Post has no copy to publish.", 400)

  const claim = await claimPublish(supabase, post, channel, "unipile-post")
  if (!claim.ok) return jsonError(claim.message, claim.status)

  // 4. Build the request. JSON when no media; multipart/form-data when media_url
  //    is set — Unipile does not document a remote-URL field for attachments.
  const mediaUrl = post.media_url as string | null | undefined
  let unipileRes: Response
  try {
    if (mediaUrl) {
      // Fetch the image and re-upload as a file part
      const imgRes = await fetch(mediaUrl)
      if (!imgRes.ok) {
        await releasePublishClaim(supabase, post_id, `Could not fetch media_url (${imgRes.status})`)
        return jsonError(`Could not fetch media_url (${imgRes.status})`, 502)
      }
      const imgBlob = await imgRes.blob()
      const contentType = imgRes.headers.get("content-type") ?? "image/jpeg"
      const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg"
      const filename = `post-${post_id.slice(0, 8)}.${ext}`

      const form = new FormData()
      form.append("account_id", unipileAccountId)
      form.append("text", text)
      if (asOrganization) form.append("as_organization", asOrganization)
      form.append("attachments", new File([imgBlob], filename, { type: contentType }))

      unipileRes = await fetch(`https://${UNIPILE_DSN}/api/v1/posts`, {
        method: "POST",
        headers: { "X-API-KEY": UNIPILE_API_KEY, "Accept": "application/json" },
        body: form,
      })
    } else {
      const payload: Record<string, unknown> = {
        account_id: unipileAccountId,
        text,
      }
      if (asOrganization) payload.as_organization = asOrganization

      unipileRes = await fetch(`https://${UNIPILE_DSN}/api/v1/posts`, {
        method: "POST",
        headers: {
          "X-API-KEY": UNIPILE_API_KEY,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markPublishClaimError(supabase, post_id, message)
    return jsonError(`Unipile publish request failed: ${message}`, 502)
  }

  // 5. Parse the response. Shape is undocumented; we log everything and pull
  //    the URN/URL with a multi-candidate fallback.
  const responseText = await unipileRes.text()
  let unipileBody: Record<string, unknown> = {}
  try { unipileBody = JSON.parse(responseText) } catch { /* leave empty */ }

  if (!unipileRes.ok) {
    console.error("unipile-post failed", { status: unipileRes.status, body: responseText.slice(0, 500) })
    await releasePublishClaim(supabase, post_id, `Unipile returned ${unipileRes.status}: ${responseText.slice(0, 300)}`)
    return jsonError(
      `Unipile returned ${unipileRes.status}: ${responseText.slice(0, 300)}`,
      unipileRes.status >= 500 ? 502 : 400,
    )
  }
  console.log("unipile-post raw response", JSON.stringify(unipileBody).slice(0, 800))

  const { urn, posted_url } = extractUrlAndUrn(unipileBody)
  await completePublishClaim(supabase, post, urn, posted_url)

  // 6. Optionally close the loop: route through approval-webhook so the DB
  //    write + Slack notify run through the single hub.
  let autoMarkedPosted = false
  if (autoMarkPosted) {
    try {
      const postedPayload: Record<string, unknown> = { post_id, action: "posted" }
      if (posted_url) postedPayload.posted_url = posted_url
      if (urn) postedPayload.provider_post_id = urn
      const markRes = await fetch(`${SUPABASE_URL}/functions/v1/approval-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify(postedPayload),
      })
      autoMarkedPosted = markRes.ok
      if (!markRes.ok) {
        console.error("approval-webhook mark-posted failed after successful Unipile post", {
          status: markRes.status,
          body: (await markRes.text()).slice(0, 500),
        })
      }
    } catch (e) {
      // The Unipile call already succeeded; surface the chain failure but don't
      // fail the whole request — operator can mark posted manually.
      console.error("approval-webhook chain failed after successful Unipile post", e)
    }
  }

  return new Response(JSON.stringify({
    unipile_response: unipileBody,
    posted_url,
    urn,
    auto_marked_posted: autoMarkedPosted,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

function integrationProviderForChannel(channel: string): string {
  if (channel === "linkedin") return "linkedin"
  if (channel === "instagram") return "meta_instagram"
  return channel
}

// Unipile's response field names aren't documented for POST /api/v1/posts.
// Probe the common candidates; fall back to deriving from a URN.
function extractUrlAndUrn(body: Record<string, unknown>): { urn?: string; posted_url?: string } {
  // Try direct URL fields first
  const directUrl =
    (body.share_url as string | undefined) ??
    (body.permalink as string | undefined) ??
    (body.url as string | undefined) ??
    (body.post_url as string | undefined)

  // URN candidates — LinkedIn shares vs ugcPosts
  const urn =
    (body.urn as string | undefined) ??
    (body.social_id as string | undefined) ??
    (body.id as string | undefined) ??
    (body.post_id as string | undefined)

  if (directUrl) return { urn, posted_url: directUrl }
  if (urn && (urn.startsWith("urn:li:") || urn.startsWith("urn:linkedin:"))) {
    return { urn, posted_url: `https://www.linkedin.com/feed/update/${urn}` }
  }
  // No URN match; return whatever URN-ish string we got so callers can debug
  return { urn, posted_url: undefined }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
