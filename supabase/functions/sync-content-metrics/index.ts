import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import { parseYouTubeVideoId, youtubeStatisticsToMetrics } from "../_shared/youtube-metrics.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ENCRYPTION_KEY = Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? Deno.env.get("VAULT_ENC_KEY")
const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY")
const UNIPILE_BASE_URL = normalizeUnipileBaseUrl(
  Deno.env.get("UNIPILE_BASE_URL") ?? Deno.env.get("UNIPILE_API_URL") ?? Deno.env.get("UNIPILE_DSN") ?? "",
)
const META_GRAPH_API_VERSION = normalizeGraphApiVersion(Deno.env.get("META_GRAPH_API_VERSION"))
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? Deno.env.get("GOOGLE_CLIENT_ID") ?? ""
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_CLIENT_SECRET") ?? ""

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type SyncRequest = {
  project_id?: string
  post_id?: string
  providers?: string[]
  limit?: number
}

type ProjectRow = {
  id: string
  org_id: string
}

type IntegrationRow = {
  id: string
  org_id: string
  project_id: string
  provider: string
  status: string
  config: Record<string, unknown>
  external_ref: Record<string, unknown>
  credential_ref: string | null
}

type ContentPostRow = {
  id: string
  org_id: string | null
  project_id: string | null
  campaign_id: string | null
  title: string | null
  copy: string
  channel: string
  status: string
  posted_at: string | null
  posted_url: string | null
  provider?: string | null
  provider_account_id?: string | null
  provider_post_id?: string | null
  provider_page_id?: string | null
  provider_media_id?: string | null
  provider_permalink?: string | null
}

type MetricRow = {
  org_id: string
  project_id: string
  post_id: string | null
  provider: string
  provider_account_id?: string | null
  provider_object_id?: string | null
  object_type: string
  metric_name: string
  metric_value: number
  metric_period: string
  metric_time?: string | null
  pulled_at: string
  raw: Record<string, unknown>
}

type PostSyncResult = {
  post_id: string
  provider: string
  status: "synced" | "skipped" | "error"
  metrics: number
  detail: string
}

type SourceSyncResult = {
  object_id: string
  object_type: string
  provider: string
  status: "synced" | "skipped" | "error"
  metrics: number
  detail: string
}

type MetricSyncResult = PostSyncResult | SourceSyncResult

type ObservationSyncResult = "opened" | "already_open" | "resolved"

type IntegrationMetricHealthResult = {
  integration_id: string
  provider: string
  status: "healthy" | "stale" | "error" | "unchanged"
  detail?: string
  observation?: ObservationSyncResult
}

type MetaSecret = {
  user_access_token?: string
  access_token?: string
  expires_at?: string | null
  pages?: Array<{
    id?: string
    name?: string
    access_token?: string | null
    instagram_business_account_id?: string | null
  }>
}

type GoogleSecret = {
  access_token?: string
  refresh_token?: string | null
  expires_at?: string | null
  scope?: string[] | string | null
  token_type?: string | null
}

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

type SearchConsoleRow = {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

type SearchConsoleResponse = {
  rows?: SearchConsoleRow[]
  responseAggregationType?: string
  metadata?: Record<string, unknown>
}

type Ga4ReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>
    metricValues?: Array<{ value?: string }>
  }>
  metricHeaders?: Array<{ name?: string; type?: string }>
  dimensionHeaders?: Array<{ name?: string }>
  rowCount?: number
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)

  const supabase = createAdminClient()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth, error: authError } = await supabase.auth.getUser(bearer)
  if (authError || !auth.user) return jsonError("Unauthorized", 401)

  let body: SyncRequest
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const projectId = body.project_id?.trim()
  if (!projectId) return jsonError("project_id is required", 400)

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return jsonError(projectError.message, 500)
  if (!project) return jsonError("Client not found", 404)

  const allowed = await canManageProject(supabase, auth.user.id, project.id, project.org_id)
  if (!allowed) return jsonError("Forbidden", 403)

  const requestedProviders = Array.isArray(body.providers)
    ? new Set(body.providers.map(provider => provider.trim()).filter(Boolean))
    : null
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 250)

  const integrationsQuery = supabase
    .from("client_integrations")
    .select("id, org_id, project_id, provider, status, config, external_ref, credential_ref")
    .eq("project_id", project.id)
    .in("status", ["connected", "pending"])

  const postsQuery = supabase
    .from("content_posts")
    .select("id, org_id, project_id, campaign_id, title, copy, channel, status, posted_at, posted_url, provider, provider_account_id, provider_post_id, provider_page_id, provider_media_id, provider_permalink")
    .eq("project_id", project.id)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit)

  if (body.post_id) postsQuery.eq("id", body.post_id)

  const [{ data: integrations, error: integrationsError }, { data: posts, error: postsError }] = await Promise.all([
    integrationsQuery,
    postsQuery,
  ])
  if (integrationsError) return jsonError(integrationsError.message, 500)
  if (postsError) return jsonError(postsError.message, 500)

  const integrationRows = ((integrations ?? []) as IntegrationRow[])
    .filter(row => !requestedProviders || requestedProviders.has(row.provider))
  const integrationByProvider = new Map(integrationRows.map(row => [row.provider, row]))

  const candidatePosts = ((posts ?? []) as ContentPostRow[])
    .filter(post => isPublished(post))
    .filter(post => {
      const provider = detectProvider(post)
      return provider && (!requestedProviders || requestedProviders.has(provider))
    })

  const results: PostSyncResult[] = []
  for (const post of candidatePosts) {
    const provider = detectProvider(post)
    if (!provider) continue
    const integration = integrationByProvider.get(provider)
    if (!integration) {
      results.push({
        post_id: post.id,
        provider,
        status: "skipped",
        metrics: 0,
        detail: "Provider is not connected for this client space.",
      })
      continue
    }

    try {
      if (provider === "linkedin") {
        results.push(await syncLinkedInPost(supabase, project as ProjectRow, integration, post))
      } else if (provider === "meta_facebook_pages") {
        results.push(await syncFacebookPost(supabase, project as ProjectRow, integration, post))
      } else if (provider === "meta_instagram") {
        results.push(await syncInstagramPost(supabase, project as ProjectRow, integration, post))
      } else if (provider === "youtube") {
        results.push(await syncYouTubePost(supabase, project as ProjectRow, integration, post))
      } else {
        results.push({
          post_id: post.id,
          provider,
          status: "skipped",
          metrics: 0,
          detail: "Metric adapter is not built for this provider yet.",
        })
      }
    } catch (error) {
      results.push({
        post_id: post.id,
        provider,
        status: "error",
        metrics: 0,
        detail: error instanceof Error ? error.message : "Metric sync failed",
      })
    }
  }

  const sourceResults: SourceSyncResult[] = []
  if (!body.post_id) {
    for (const integration of integrationRows) {
      if (integration.provider !== "google_search_console" && integration.provider !== "google_analytics_4") continue
      try {
        if (integration.provider === "google_search_console") {
          sourceResults.push(await syncSearchConsoleSource(supabase, project as ProjectRow, integration))
        } else {
          sourceResults.push(await syncGa4Source(supabase, project as ProjectRow, integration))
        }
      } catch (error) {
        sourceResults.push({
          object_id: firstString(integration.external_ref?.primary_ref, integration.config?.primary_ref, integration.id) ?? integration.id,
          object_type: integration.provider === "google_search_console" ? "search_site" : "analytics_property",
          provider: integration.provider,
          status: "error",
          metrics: 0,
          detail: error instanceof Error ? error.message : "Source metric sync failed",
        })
      }
    }
  }

  const synced = results.filter(result => result.status === "synced").length
  const syncedSources = sourceResults.filter(result => result.status === "synced").length
  const metricCount = [...results, ...sourceResults].reduce((sum, result) => sum + result.metrics, 0)
  const integrationHealth = await syncIntegrationMetricHealth(
    supabase,
    integrationRows,
    [...results, ...sourceResults],
    new Date().toISOString(),
  )

  return json({
    ok: true,
    project_id: project.id,
    checked_posts: candidatePosts.length,
    synced_posts: synced,
    checked_sources: sourceResults.length,
    synced_sources: syncedSources,
    metric_count: metricCount,
    integration_health: integrationHealth,
    results,
    source_results: sourceResults,
  })
})

async function syncLinkedInPost(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
  post: ContentPostRow,
): Promise<PostSyncResult> {
  if (!UNIPILE_API_KEY || !UNIPILE_BASE_URL) {
    return skipped(post, "linkedin", "Unipile is not configured.")
  }

  const accountId = firstString(
    post.provider_account_id,
    integration.external_ref?.unipile_account_id,
    integration.config?.unipile_account_id,
    integration.config?.account_id,
    integration.config?.primary_ref,
  )
  if (!accountId) return skipped(post, "linkedin", "LinkedIn account ID is missing.")

  const postReference = firstString(post.provider_post_id, parseLinkedInPostReference(post.posted_url))
  if (!postReference) return skipped(post, "linkedin", "LinkedIn provider post ID or activity URL is missing.")

  const providerPost = await unipileGet(`/posts/${encodeURIComponent(postReference)}`, {
    account_id: accountId,
  })
  const objectId = firstString(
    valueAt(providerPost, "social_id"),
    valueAt(providerPost, "provider_id"),
    valueAt(providerPost, "id"),
    postReference,
  )
  const permalink = firstString(valueAt(providerPost, "share_url"), post.posted_url)
  const pulledAt = new Date().toISOString()
  const rows = [
    metric(project, post, "linkedin", accountId, objectId, "impressions", valueAt(providerPost, "impressions_counter"), pulledAt, providerPost),
    metric(project, post, "linkedin", accountId, objectId, "reactions", valueAt(providerPost, "reaction_counter"), pulledAt, providerPost),
    metric(project, post, "linkedin", accountId, objectId, "comments", valueAt(providerPost, "comment_counter"), pulledAt, providerPost),
    metric(project, post, "linkedin", accountId, objectId, "shares", valueAt(providerPost, "repost_counter"), pulledAt, providerPost),
  ].filter((row): row is MetricRow => !!row)

  addEngagementRate(rows, project, post, "linkedin", accountId, objectId, pulledAt)
  if (!rows.length) return skipped(post, "linkedin", "Unipile returned the post but no counters.")
  await insertMetricRows(supabase, rows)
  await updatePostMetricState(supabase, post.id, {
    provider: "linkedin",
    provider_account_id: accountId,
    provider_post_id: objectId,
    provider_permalink: permalink,
    last_metric_sync_at: pulledAt,
  })
  return synced(post, "linkedin", rows.length, "LinkedIn metrics synced.")
}

async function syncFacebookPost(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
  post: ContentPostRow,
): Promise<PostSyncResult> {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return skipped(post, "meta_facebook_pages", "Secret encryption key is not configured.")
  const secret = await loadMetaSecret(supabase, project.id, integration.credential_ref)
  if (!secret) return skipped(post, "meta_facebook_pages", "Meta OAuth credential is missing.")

  const pageId = firstString(
    post.provider_page_id,
    integration.external_ref?.primary_ref,
    integration.config?.primary_ref,
  )
  const page = findMetaPage(secret, pageId)
  const accessToken = page?.access_token ?? secret.user_access_token ?? secret.access_token
  const objectId = firstString(post.provider_post_id, parseFacebookPostId(post.posted_url, page?.id ?? pageId))
  if (!accessToken) return skipped(post, "meta_facebook_pages", "Meta access token is missing.")
  if (!objectId) return skipped(post, "meta_facebook_pages", "Facebook Page post ID is missing.")

  const fields = "id,created_time,permalink_url,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)"
  const [objectResult, insightsResult] = await Promise.all([
    metaGet(`/${objectId}`, { fields, access_token: accessToken }),
    metaGet(`/${objectId}/insights`, {
      metric: "post_impressions,post_impressions_unique,post_clicks,post_reactions_by_type_total",
      access_token: accessToken,
    }).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ])

  const pulledAt = new Date().toISOString()
  const insights = metaInsightMap(insightsResult)
  const rows = [
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "impressions", insights.post_impressions, pulledAt, insightsResult),
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "reach", insights.post_impressions_unique, pulledAt, insightsResult),
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "clicks", insights.post_clicks, pulledAt, insightsResult),
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "reactions", summaryTotal(valueAt(objectResult, "reactions")), pulledAt, objectResult),
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "comments", summaryTotal(valueAt(objectResult, "comments")), pulledAt, objectResult),
    metric(project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, "shares", valueAt(valueAt(objectResult, "shares"), "count"), pulledAt, objectResult),
  ].filter((row): row is MetricRow => !!row)

  addEngagementRate(rows, project, post, "meta_facebook_pages", page?.id ?? pageId ?? null, objectId, pulledAt)
  if (!rows.length) return skipped(post, "meta_facebook_pages", "Meta returned the post but no counters.")
  await insertMetricRows(supabase, rows)
  await updatePostMetricState(supabase, post.id, {
    provider: "meta_facebook_pages",
    provider_account_id: page?.id ?? pageId,
    provider_page_id: page?.id ?? pageId,
    provider_post_id: objectId,
    provider_permalink: firstString(valueAt(objectResult, "permalink_url"), post.posted_url),
    last_metric_sync_at: pulledAt,
  })
  return synced(post, "meta_facebook_pages", rows.length, "Facebook Page metrics synced.")
}

async function syncInstagramPost(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
  post: ContentPostRow,
): Promise<PostSyncResult> {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return skipped(post, "meta_instagram", "Secret encryption key is not configured.")
  const secret = await loadMetaSecret(supabase, project.id, integration.credential_ref)
  if (!secret) return skipped(post, "meta_instagram", "Meta OAuth credential is missing.")

  const mediaId = firstString(post.provider_media_id, post.provider_post_id)
  if (!mediaId) return skipped(post, "meta_instagram", "Instagram media ID is missing.")

  const page = findMetaPage(secret, firstString(post.provider_page_id, integration.external_ref?.primary_ref, integration.config?.primary_ref))
  const accessToken = page?.access_token ?? secret.user_access_token ?? secret.access_token
  if (!accessToken) return skipped(post, "meta_instagram", "Meta access token is missing.")

  const [mediaResult, insightsResult] = await Promise.all([
    metaGet(`/${mediaId}`, {
      fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
      access_token: accessToken,
    }),
    metaGet(`/${mediaId}/insights`, {
      metric: "views,reach,saved,shares,total_interactions",
      access_token: accessToken,
    }).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ])

  const pulledAt = new Date().toISOString()
  const insights = metaInsightMap(insightsResult)
  const rows = [
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "views", insights.views, pulledAt, insightsResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "reach", insights.reach, pulledAt, insightsResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "likes", valueAt(mediaResult, "like_count"), pulledAt, mediaResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "comments", valueAt(mediaResult, "comments_count"), pulledAt, mediaResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "saves", insights.saved, pulledAt, insightsResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "shares", insights.shares, pulledAt, insightsResult),
    metric(project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, "engagements", insights.total_interactions, pulledAt, insightsResult),
  ].filter((row): row is MetricRow => !!row)

  addEngagementRate(rows, project, post, "meta_instagram", page?.id ?? post.provider_account_id ?? null, mediaId, pulledAt)
  if (!rows.length) return skipped(post, "meta_instagram", "Meta returned the media but no counters.")
  await insertMetricRows(supabase, rows)
  await updatePostMetricState(supabase, post.id, {
    provider: "meta_instagram",
    provider_account_id: page?.id ?? post.provider_account_id,
    provider_media_id: mediaId,
    provider_post_id: mediaId,
    provider_permalink: firstString(valueAt(mediaResult, "permalink"), post.posted_url),
    last_metric_sync_at: pulledAt,
  })
  return synced(post, "meta_instagram", rows.length, "Instagram media metrics synced.")
}

async function syncYouTubePost(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
  post: ContentPostRow,
): Promise<PostSyncResult> {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return skipped(post, "youtube", "Secret encryption key is not configured.")
  const secret = await loadGoogleSecret(supabase, project.id, integration.credential_ref)
  if (!secret) return skipped(post, "youtube", "Google OAuth credential is missing.")

  const accessToken = await resolveGoogleAccessToken(secret)
  if (!accessToken) return skipped(post, "youtube", "Google access token is missing.")

  const videoId = firstString(
    post.provider_media_id,
    post.provider_post_id,
    parseYouTubeVideoId(post.provider_permalink),
    parseYouTubeVideoId(post.posted_url),
  )
  if (!videoId) return skipped(post, "youtube", "YouTube video ID is missing.")

  const videoResult = await youtubeGet("/youtube/v3/videos", {
    part: "snippet,statistics",
    id: videoId,
  }, accessToken)
  const items = Array.isArray(valueAt(videoResult, "items")) ? valueAt(videoResult, "items") as unknown[] : []
  const video = items[0]
  if (!video || typeof video !== "object") return skipped(post, "youtube", "YouTube returned no video for this ID.")

  const snippet = recordValue(valueAt(video, "snippet"))
  const counts = youtubeStatisticsToMetrics(valueAt(video, "statistics"))
  const accountId = firstString(
    post.provider_account_id,
    snippet.channelId,
    integration.external_ref?.primary_ref,
    integration.config?.primary_ref,
  )
  const permalink = `https://www.youtube.com/watch?v=${videoId}`
  const pulledAt = new Date().toISOString()
  const rows = [
    metric(project, post, "youtube", accountId, videoId, "views", counts.views, pulledAt, videoResult),
    metric(project, post, "youtube", accountId, videoId, "likes", counts.likes, pulledAt, videoResult),
    metric(project, post, "youtube", accountId, videoId, "comments", counts.comments, pulledAt, videoResult),
    metric(project, post, "youtube", accountId, videoId, "favorites", counts.favorites, pulledAt, videoResult),
  ].filter((row): row is MetricRow => !!row)

  addEngagementRate(rows, project, post, "youtube", accountId, videoId, pulledAt)
  if (!rows.length) return skipped(post, "youtube", "YouTube returned the video but no counters.")
  await insertMetricRows(supabase, rows)
  await updatePostMetricState(supabase, post.id, {
    provider: "youtube",
    provider_account_id: accountId,
    provider_post_id: videoId,
    provider_media_id: videoId,
    provider_permalink: firstString(post.provider_permalink, post.posted_url, permalink),
    last_metric_sync_at: pulledAt,
  })
  return synced(post, "youtube", rows.length, "YouTube video metrics synced.")
}

async function syncSearchConsoleSource(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
): Promise<SourceSyncResult> {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return sourceSkipped(integration, "google_search_console", "search_site", "Secret encryption key is not configured.")
  const secret = await loadGoogleSecret(supabase, project.id, integration.credential_ref)
  if (!secret) return sourceSkipped(integration, "google_search_console", "search_site", "Google OAuth credential is missing.")

  const accessToken = await resolveGoogleAccessToken(secret)
  if (!accessToken) return sourceSkipped(integration, "google_search_console", "search_site", "Google access token is missing.")

  const siteUrl = firstString(
    integration.external_ref?.primary_ref,
    integration.config?.primary_ref,
    firstConfigSiteUrl(integration.config?.sites),
  )
  if (!siteUrl) return sourceSkipped(integration, "google_search_console", "search_site", "Search Console site property is missing.")

  const range = completedDateRange(28)
  const [dailyResult, pageResult] = await Promise.all([
    searchConsoleQuery(siteUrl, accessToken, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["date"],
      rowLimit: 25000,
    }),
    searchConsoleQuery(siteUrl, accessToken, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["page"],
      rowLimit: 10,
    }).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ])

  const rows = Array.isArray(dailyResult.rows) ? dailyResult.rows : []
  const topPages = Array.isArray(valueAt(pageResult, "rows")) ? valueAt(pageResult, "rows") as SearchConsoleRow[] : []
  const clicks = sumRows(rows, "clicks")
  const impressions = sumRows(rows, "impressions")
  const ctr = impressions > 0 ? clicks / impressions : weightedAverage(rows, "ctr", "impressions")
  const position = weightedAverage(rows, "position", "impressions")
  const pulledAt = new Date().toISOString()
  const metricTime = `${range.endDate}T00:00:00.000Z`
  const raw = {
    source: "google_search_console",
    start_date: range.startDate,
    end_date: range.endDate,
    response_aggregation_type: dailyResult.responseAggregationType ?? null,
    daily_rows: rows,
    top_pages: topPages,
  }
  const metricRows = [
    sourceMetric(project, "google_search_console", siteUrl, siteUrl, "search_site", "clicks", clicks, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_search_console", siteUrl, siteUrl, "search_site", "impressions", impressions, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_search_console", siteUrl, siteUrl, "search_site", "ctr", ctr, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_search_console", siteUrl, siteUrl, "search_site", "avg_position", position, "last_28d", metricTime, pulledAt, raw),
  ].filter((row): row is MetricRow => !!row)

  if (!metricRows.length) return sourceSkipped(integration, "google_search_console", "search_site", "Search Console returned no search metrics.")
  await insertMetricRows(supabase, metricRows)
  return sourceSynced(siteUrl, "search_site", "google_search_console", metricRows.length, "Search Console metrics synced.")
}

async function syncGa4Source(
  supabase: SupabaseAdminClient,
  project: ProjectRow,
  integration: IntegrationRow,
): Promise<SourceSyncResult> {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) return sourceSkipped(integration, "google_analytics_4", "analytics_property", "Secret encryption key is not configured.")
  const secret = await loadGoogleSecret(supabase, project.id, integration.credential_ref)
  if (!secret) return sourceSkipped(integration, "google_analytics_4", "analytics_property", "Google OAuth credential is missing.")

  const accessToken = await resolveGoogleAccessToken(secret)
  if (!accessToken) return sourceSkipped(integration, "google_analytics_4", "analytics_property", "Google access token is missing.")

  const property = normalizeGa4Property(firstString(
    integration.external_ref?.primary_ref,
    integration.config?.primary_ref,
    firstConfigGa4Property(integration.config?.properties),
  ))
  if (!property) return sourceSkipped(integration, "google_analytics_4", "analytics_property", "GA4 property is missing.")

  const range = completedDateRange(28)
  const metricNames = ["sessions", "activeUsers", "screenPageViews", "engagedSessions", "engagementRate", "eventCount"]
  const report = await ga4RunReport(property, accessToken, {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: metricNames.map(name => ({ name })),
    keepEmptyRows: false,
  })
  const values = ga4MetricMap(report, metricNames)
  const pulledAt = new Date().toISOString()
  const metricTime = `${range.endDate}T00:00:00.000Z`
  const raw = {
    source: "google_analytics_4",
    property,
    start_date: range.startDate,
    end_date: range.endDate,
    report,
  }
  const metricRows = [
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "sessions", values.sessions, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "users", values.activeUsers, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "page_views", values.screenPageViews, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "engaged_sessions", values.engagedSessions, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "engagement_rate", values.engagementRate, "last_28d", metricTime, pulledAt, raw),
    sourceMetric(project, "google_analytics_4", property, property, "analytics_property", "events", values.eventCount, "last_28d", metricTime, pulledAt, raw),
  ].filter((row): row is MetricRow => !!row)

  if (!metricRows.length) return sourceSkipped(integration, "google_analytics_4", "analytics_property", "GA4 returned no traffic metrics.")
  await insertMetricRows(supabase, metricRows)
  return sourceSynced(property, "analytics_property", "google_analytics_4", metricRows.length, "GA4 traffic metrics synced.")
}

async function insertMetricRows(supabase: SupabaseAdminClient, rows: MetricRow[]) {
  const { error } = await supabase.from("content_metric_snapshots").insert(rows)
  if (error) throw new Error(error.message)
}

async function updatePostMetricState(supabase: SupabaseAdminClient, postId: string, updates: Record<string, unknown>) {
  const clean = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined && value !== null && value !== ""))
  const { error } = await supabase.from("content_posts").update(clean).eq("id", postId)
  if (error) throw new Error(error.message)
}

function metric(
  project: ProjectRow,
  post: ContentPostRow,
  provider: string,
  accountId: string | null | undefined,
  objectId: string | null | undefined,
  name: string,
  rawValue: unknown,
  pulledAt: string,
  raw: unknown,
): MetricRow | null {
  const value = toNumber(rawValue)
  if (value == null) return null
  return {
    org_id: project.org_id,
    project_id: project.id,
    post_id: post.id,
    provider,
    provider_account_id: accountId ?? null,
    provider_object_id: objectId ?? null,
    object_type: "post",
    metric_name: name,
    metric_value: value,
    metric_period: "lifetime",
    metric_time: null,
    pulled_at: pulledAt,
    raw: sanitizeRaw(raw),
  }
}

function sourceMetric(
  project: ProjectRow,
  provider: string,
  accountId: string | null | undefined,
  objectId: string | null | undefined,
  objectType: string,
  name: string,
  rawValue: unknown,
  metricPeriod: string,
  metricTime: string | null,
  pulledAt: string,
  raw: unknown,
): MetricRow | null {
  const value = toNumber(rawValue)
  if (value == null) return null
  return {
    org_id: project.org_id,
    project_id: project.id,
    post_id: null,
    provider,
    provider_account_id: accountId ?? null,
    provider_object_id: objectId ?? null,
    object_type: objectType,
    metric_name: name,
    metric_value: value,
    metric_period: metricPeriod,
    metric_time: metricTime,
    pulled_at: pulledAt,
    raw: sanitizeRaw(raw),
  }
}

function addEngagementRate(
  rows: MetricRow[],
  project: ProjectRow,
  post: ContentPostRow,
  provider: string,
  accountId: string | null | undefined,
  objectId: string | null | undefined,
  pulledAt: string,
) {
  const values = new Map(rows.map(row => [row.metric_name, row.metric_value]))
  const engagements =
    values.get("engagements") ??
    (values.get("reactions") ?? 0) +
    (values.get("likes") ?? 0) +
    (values.get("comments") ?? 0) +
    (values.get("shares") ?? 0) +
    (values.get("saves") ?? 0) +
    (values.get("clicks") ?? 0)
  const denominator = values.get("views") ?? values.get("reach") ?? values.get("impressions") ?? 0
  if (!engagements || !denominator) return
  rows.push({
    org_id: project.org_id,
    project_id: project.id,
    post_id: post.id,
    provider,
    provider_account_id: accountId ?? null,
    provider_object_id: objectId ?? null,
    object_type: "post",
    metric_name: "engagement_rate",
    metric_value: Number((engagements / denominator).toFixed(4)),
    metric_period: "lifetime",
    metric_time: null,
    pulled_at: pulledAt,
    raw: { engagements, denominator },
  })
}

async function loadMetaSecret(
  supabase: SupabaseAdminClient,
  projectId: string,
  credentialRef: string | null,
): Promise<MetaSecret | null> {
  let query = supabase
    .from("client_api_keys")
    .select("id, secret_ciphertext")
    .eq("project_id", projectId)
    .eq("provider", "meta_oauth")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)

  if (credentialRef) query = query.eq("id", credentialRef)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  const ciphertext = (data as { secret_ciphertext?: string | null } | null)?.secret_ciphertext
  if (!ciphertext || !ENCRYPTION_KEY) return null
  const plaintext = await decryptSecret(ciphertext, ENCRYPTION_KEY)
  return JSON.parse(plaintext) as MetaSecret
}

async function loadGoogleSecret(
  supabase: SupabaseAdminClient,
  projectId: string,
  credentialRef: string | null,
): Promise<GoogleSecret | null> {
  let query = supabase
    .from("client_api_keys")
    .select("id, secret_ciphertext")
    .eq("project_id", projectId)
    .eq("provider", "google_oauth")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)

  if (credentialRef) query = query.eq("id", credentialRef)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  const ciphertext = (data as { secret_ciphertext?: string | null } | null)?.secret_ciphertext
  if (!ciphertext || !ENCRYPTION_KEY) return null
  const plaintext = await decryptSecret(ciphertext, ENCRYPTION_KEY)
  return JSON.parse(plaintext) as GoogleSecret
}

async function resolveGoogleAccessToken(secret: GoogleSecret): Promise<string | null> {
  const accessToken = firstString(secret.access_token)
  const expiresAt = parseDateMillis(secret.expires_at)
  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return accessToken

  const refreshToken = firstString(secret.refresh_token)
  if (!refreshToken) return accessToken
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth client is not configured.")
  }
  return refreshGoogleAccessToken(refreshToken)
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const token = await response.json().catch(async () => ({ error_description: await response.text() })) as GoogleTokenResponse
  if (!response.ok || !token.access_token) {
    throw new Error(`Google OAuth HTTP ${response.status}: ${token.error_description ?? token.error ?? "Refresh failed"}`)
  }
  return token.access_token
}

async function decryptSecret(ciphertext: string, keyMaterial: string) {
  const parts = ciphertext.split(":")
  if (parts.length !== 4 || parts[0] !== "aes-gcm" || parts[1] !== "v1") {
    throw new Error("Unsupported secret format")
  }
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(keyMaterial))
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"])
  const iv = base64ToBytes(parts[2])
  const encrypted = base64ToBytes(parts[3])
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted)
  return new TextDecoder().decode(decrypted)
}

async function unipileGet(path: string, query: Record<string, string>) {
  const url = new URL(`${UNIPILE_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-KEY": UNIPILE_API_KEY ?? "",
    },
  })
  const body = await response.json().catch(async () => ({ error: await response.text() }))
  if (!response.ok) throw new Error(`Unipile HTTP ${response.status}: ${compactError(body)}`)
  return body
}

async function metaGet(path: string, query: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url)
  const body = await response.json().catch(async () => ({ error: await response.text() }))
  if (!response.ok) throw new Error(`Meta HTTP ${response.status}: ${compactError(body)}`)
  return body
}

async function youtubeGet(path: string, query: Record<string, string>, accessToken: string) {
  const url = new URL(`https://www.googleapis.com${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const body = await response.json().catch(async () => ({ error: await response.text() }))
  if (!response.ok) throw new Error(`YouTube HTTP ${response.status}: ${compactError(body)}`)
  return body
}

async function searchConsoleQuery(siteUrl: string, accessToken: string, body: Record<string, unknown>): Promise<SearchConsoleResponse> {
  const encodedSite = encodeURIComponent(siteUrl)
  const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(async () => ({ error: await response.text() }))
  if (!response.ok) throw new Error(`Search Console HTTP ${response.status}: ${compactError(json)}`)
  return json as SearchConsoleResponse
}

async function ga4RunReport(property: string, accessToken: string, body: Record<string, unknown>): Promise<Ga4ReportResponse> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(async () => ({ error: await response.text() }))
  if (!response.ok) throw new Error(`GA4 HTTP ${response.status}: ${compactError(json)}`)
  return json as Ga4ReportResponse
}

async function canManageProject(
  supabase: SupabaseAdminClient,
  userId: string,
  projectId: string,
  orgId: string,
) {
  const [{ data: orgMember }, { data: projectMember }] = await Promise.all([
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

  if (["owner", "admin", "agency_admin"].includes((orgMember as { role?: string } | null)?.role ?? "")) return true
  return ["owner", "admin", "editor"].includes((projectMember as { role?: string } | null)?.role ?? "")
}

async function syncIntegrationMetricHealth(
  supabase: SupabaseAdminClient,
  integrations: IntegrationRow[],
  results: MetricSyncResult[],
  syncedAt: string,
): Promise<IntegrationMetricHealthResult[]> {
  const resultsByProvider = new Map<string, MetricSyncResult[]>()
  for (const result of results) {
    const list = resultsByProvider.get(result.provider) ?? []
    list.push(result)
    resultsByProvider.set(result.provider, list)
  }

  const updates: IntegrationMetricHealthResult[] = []
  for (const integration of integrations) {
    const providerResults = resultsByProvider.get(integration.provider) ?? []
    if (providerResults.length === 0) continue

    const issue = firstConnectorMetricIssue(providerResults)
    const hasSynced = providerResults.some(result => result.status === "synced")

    if (issue && !hasSynced) {
      const status = isStaleMetricIssue(issue.detail) ? "stale" : "error"
      const detail = issue.detail.slice(0, 500)
      await supabase
        .from("client_integrations")
        .update({
          last_sync_at: syncedAt,
          health_status: status,
          health_detail: detail,
        })
        .eq("id", integration.id)
      const observation = await syncConnectorHealthObservation(supabase, integration, status, detail)
      updates.push({ integration_id: integration.id, provider: integration.provider, status, detail, observation })
      continue
    }

    if (hasSynced) {
      await supabase
        .from("client_integrations")
        .update({
          last_sync_at: syncedAt,
          health_status: "healthy",
          health_detail: null,
        })
        .eq("id", integration.id)
      const observation = await syncConnectorHealthObservation(supabase, integration, "healthy")
      updates.push({ integration_id: integration.id, provider: integration.provider, status: "healthy", observation })
      continue
    }

    await supabase
      .from("client_integrations")
      .update({ last_sync_at: syncedAt })
      .eq("id", integration.id)
    updates.push({
      integration_id: integration.id,
      provider: integration.provider,
      status: "unchanged",
      detail: providerResults[0]?.detail,
    })
  }

  return updates
}

function firstConnectorMetricIssue(results: MetricSyncResult[]): MetricSyncResult | null {
  for (const result of results) {
    if (isPostReferenceMetricIssue(result.detail)) continue
    if (result.status === "error") return result
    if (isConnectorMetricIssue(result.detail)) return result
  }
  return null
}

function isConnectorMetricIssue(detail: string) {
  return /(credential|oauth|access token|account id|encryption key|unipile is not configured|secret|permission|unauthorized|forbidden|revoked)/i.test(detail)
}

function isStaleMetricIssue(detail: string) {
  return /(401|403|auth|oauth|access token|credential|permission|unauthorized|forbidden|revoked)/i.test(detail)
}

function isPostReferenceMetricIssue(detail: string) {
  return /(provider post id|activity url|facebook page post id|instagram media id|youtube video id|search console site property|ga4 property|returned the post but no counters|returned the media but no counters|returned no video|returned the video but no counters|returned no search metrics|returned no traffic metrics|adapter is not built|provider is not connected)/i.test(detail)
}

async function syncConnectorHealthObservation(
  supabase: SupabaseAdminClient,
  integration: IntegrationRow,
  status: "healthy" | "stale" | "error",
  detail?: string,
): Promise<ObservationSyncResult | undefined> {
  const dedupKey = `connector_health:client_integration:${integration.id}`

  if (status === "healthy") {
    const { data } = await supabase
      .from("agent_observations")
      .update({
        status: "actioned",
        actioned_at: new Date().toISOString(),
        acted_result: {
          stage: "resolved",
          source: "metric_sync",
          integration_id: integration.id,
          provider: integration.provider,
          resolved_at: new Date().toISOString(),
        },
      })
      .eq("dedup_key", dedupKey)
      .eq("status", "open")
      .select("id")
    return data && data.length > 0 ? "resolved" : undefined
  }

  const { error } = await supabase
    .from("agent_observations")
    .insert({
      org_id: integration.org_id,
      project_id: integration.project_id,
      kind: "connector_health",
      severity: status === "stale" ? "high" : "medium",
      title: `${providerLabel(integration.provider)} metric sync needs attention`,
      detail: metricHealthObservationDetail(integration.provider, status, detail),
      proposed_action: "Open integrations",
      action_kind: "open_integrations",
      action_payload: {
        scope: "client_integration",
        source: "metric_sync",
        integration_id: integration.id,
        provider: integration.provider,
        project_id: integration.project_id,
        status,
        detail: detail ?? null,
      },
      dedup_key: dedupKey,
      surface_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })

  if (!error) return "opened"
  if (error.code === "23505") return "already_open"
  console.warn(`metric connector_health observation failed for ${integration.id}: ${error.message}`)
  return undefined
}

function metricHealthObservationDetail(provider: string, status: "stale" | "error", detail?: string) {
  const label = providerLabel(provider)
  if (status === "stale") {
    return `${label} rejected metric access. Reconnect the integration before VERA relies on its performance data. ${detail ?? ""}`.trim()
  }
  return `${label} could not provide metrics during sync. Inspect the integration before using this data for the next brief. ${detail ?? ""}`.trim()
}

function providerLabel(provider: string) {
  return ({
    linkedin: "LinkedIn",
    meta_facebook_pages: "Facebook Pages",
    meta_instagram: "Instagram",
    google_search_console: "Google Search Console",
    google_analytics_4: "Google Analytics 4",
    youtube: "YouTube",
    medium: "Medium",
    quora: "Quora",
    reddit: "Reddit",
    x: "X",
  } as Record<string, string>)[provider] ?? provider.replace(/_/g, " ")
}

function detectProvider(post: ContentPostRow): string | null {
  if (post.provider) return post.provider
  const value = `${post.channel ?? ""} ${post.posted_url ?? ""}`.toLowerCase()
  if (value.includes("linkedin")) return "linkedin"
  if (value.includes("instagram")) return "meta_instagram"
  if (value.includes("facebook") || value.includes("fb.watch")) return "meta_facebook_pages"
  if (value.includes("youtube") || value.includes("youtu.be")) return "youtube"
  if (value.includes("medium")) return "medium"
  if (value.includes("quora")) return "quora"
  if (value.includes("reddit")) return "reddit"
  if (value.includes("twitter") || value.includes("x.com")) return "x"
  return null
}

function isPublished(post: ContentPostRow) {
  const status = (post.status ?? "").toLowerCase()
  return !!post.posted_at || !!post.posted_url || status.includes("posted") || status.includes("publish")
}

function parseLinkedInPostReference(url: string | null | undefined): string | null {
  if (!url) return null
  const decoded = decodeURIComponent(url)
  const activity = decoded.match(/activity[-/:](\d{8,})/i)?.[1]
  if (activity) return activity
  const ugc = decoded.match(/ugcPost[-/:](\d{8,})/i)?.[1]
  if (ugc) return `urn:li:ugcPost:${ugc}`
  const share = decoded.match(/share[-/:](\d{8,})/i)?.[1]
  if (share) return `urn:li:share:${share}`
  const urnActivity = decoded.match(/urn:li:activity:\d{8,}/i)?.[0]
  if (urnActivity) return urnActivity
  return decoded.match(/(\d{12,})/)?.[1] ?? null
}

function parseFacebookPostId(url: string | null | undefined, pageId?: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const story = parsed.searchParams.get("story_fbid") ?? parsed.searchParams.get("fbid")
    const id = parsed.searchParams.get("id") ?? pageId
    if (story && id) return `${id}_${story}`
    if (story) return story
    const path = parsed.pathname
    const posts = path.match(/\/posts\/(?:pfbid)?([A-Za-z0-9_.-]+)/i)?.[1]
    if (posts && pageId) return `${pageId}_${posts}`
    const videos = path.match(/\/videos\/(\d+)/i)?.[1]
    if (videos && pageId) return `${pageId}_${videos}`
    const photo = path.match(/\/photos\/(?:a\.\d+\/)?(\d+)/i)?.[1]
    if (photo && pageId) return `${pageId}_${photo}`
  } catch {
    return null
  }
  return null
}

function metaInsightMap(value: unknown): Record<string, number> {
  const map: Record<string, number> = {}
  const data = Array.isArray(valueAt(value, "data")) ? valueAt(value, "data") as unknown[] : []
  for (const item of data) {
    const name = valueAt(item, "name")
    const values = valueAt(item, "values")
    if (typeof name !== "string" || !Array.isArray(values) || values.length === 0) continue
    const latest = values[values.length - 1]
    const metricValue = valueAt(latest, "value")
    if (typeof metricValue === "number") map[name] = metricValue
    if (typeof metricValue === "string" && metricValue.trim()) {
      const parsed = Number(metricValue)
      if (Number.isFinite(parsed)) map[name] = parsed
    }
    if (metricValue && typeof metricValue === "object" && name === "post_reactions_by_type_total") {
      map.reactions = Object.values(metricValue as Record<string, unknown>)
        .reduce<number>((sum, raw) => sum + (toNumber(raw) ?? 0), 0)
    }
  }
  return map
}

function summaryTotal(value: unknown): number | null {
  const total = valueAt(valueAt(value, "summary"), "total_count")
  return toNumber(total)
}

function findMetaPage(secret: MetaSecret, pageId: string | null | undefined) {
  if (!Array.isArray(secret.pages)) return null
  if (!pageId) return secret.pages[0] ?? null
  return secret.pages.find(page => page.id === pageId) ?? secret.pages[0] ?? null
}

function parseDateMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function firstConfigSiteUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const siteUrl = firstString(valueAt(item, "siteUrl"), valueAt(item, "url"))
    if (siteUrl) return siteUrl
  }
  return null
}

function firstConfigGa4Property(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const property = firstString(valueAt(item, "property"), valueAt(item, "id"))
    if (property) return property
  }
  return null
}

function normalizeGa4Property(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^properties\/\d+$/i.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `properties/${trimmed}`
  return null
}

function completedDateRange(days: number) {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(1, days) + 1)
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
  }
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function sumRows(rows: SearchConsoleRow[], key: "clicks" | "impressions") {
  return rows.reduce((sum, row) => sum + (toNumber(row[key]) ?? 0), 0)
}

function weightedAverage(rows: SearchConsoleRow[], valueKey: "ctr" | "position", weightKey: "impressions") {
  let totalWeight = 0
  let weighted = 0
  for (const row of rows) {
    const value = toNumber(row[valueKey])
    const weight = toNumber(row[weightKey]) ?? 0
    if (value == null || weight <= 0) continue
    weighted += value * weight
    totalWeight += weight
  }
  if (totalWeight > 0) return weighted / totalWeight
  const values = rows.map(row => toNumber(row[valueKey])).filter((value): value is number => value != null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function ga4MetricMap(report: Ga4ReportResponse, metricNames: string[]): Record<string, number | null> {
  const firstRow = report.rows?.[0]
  const values: Record<string, number | null> = {}
  for (const [index, name] of metricNames.entries()) {
    values[name] = toNumber(firstRow?.metricValues?.[index]?.value)
  }
  return values
}

function valueAt(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function sanitizeRaw(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const raw = { ...(value as Record<string, unknown>) }
  delete raw.access_token
  delete raw.user_access_token
  delete raw.secret
  return raw
}

function compactError(value: unknown) {
  if (typeof value === "string") return value.slice(0, 400)
  const message = valueAt(valueAt(value, "error"), "message")
  if (typeof message === "string") return message.slice(0, 400)
  return JSON.stringify(value).slice(0, 400)
}

function base64ToBytes(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function normalizeUnipileBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`
}

function normalizeGraphApiVersion(value: string | null | undefined): string {
  return /^v\d+\.\d+$/.test(value ?? "") ? value as string : "v23.0"
}

function skipped(post: ContentPostRow, provider: string, detail: string): PostSyncResult {
  return { post_id: post.id, provider, status: "skipped", metrics: 0, detail }
}

function synced(post: ContentPostRow, provider: string, metrics: number, detail: string): PostSyncResult {
  return { post_id: post.id, provider, status: "synced", metrics, detail }
}

function sourceSkipped(integration: IntegrationRow, provider: string, objectType: string, detail: string): SourceSyncResult {
  return {
    object_id: firstString(integration.external_ref?.primary_ref, integration.config?.primary_ref, integration.id) ?? integration.id,
    object_type: objectType,
    provider,
    status: "skipped",
    metrics: 0,
    detail,
  }
}

function sourceSynced(objectId: string, objectType: string, provider: string, metrics: number, detail: string): SourceSyncResult {
  return {
    object_id: objectId,
    object_type: objectType,
    provider,
    status: "synced",
    metrics,
    detail,
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function jsonError(message: string, status = 400) {
  return json({ ok: false, error: message }, status)
}
