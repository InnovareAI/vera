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
//   · weekly_learning - current-week demand signals, skill proposals, SAM handoffs
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
const DEMAND_METRICS = [
  'views',
  'impressions',
  'reach',
  'engagements',
  'likes',
  'reactions',
  'comments',
  'shares',
  'clicks',
  'saves',
  'qualified_traffic',
  'buyer_questions',
  'meeting_requests',
]

type AdminClient = ReturnType<typeof createClient<any>>

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

interface ProjectRow {
  id: string
  org_id: string
  name: string
  slug: string
}

interface ContentPostRow {
  id: string
  title: string | null
  copy: string | null
  channel: string | null
  status: string | null
  provider: string | null
  posted_at: string | null
  published_at: string | null
  scheduled_at: string | null
  created_at: string | null
}

interface MetricSnapshotRow {
  post_id: string | null
  provider: string
  metric_name: string
  metric_value: number
  pulled_at: string
}

interface SkillProposalRow {
  id: string
  name: string
  confidence: string | null
  performance_notes: string | null
  tags: string[] | null
  created_at: string
}

interface LearningMetric {
  postId: string
  provider: string
  views: number
  engagements: number
  comments: number
  shares: number
  clicks: number
  saves: number
  qualifiedTraffic: number
  buyerQuestions: number
  meetingRequests: number
  pulledAt: string | null
}

interface LearningSummary {
  measuredPosts: number
  views: number
  engagements: number
  comments: number
  shares: number
  clicks: number
  saves: number
  qualifiedTraffic: number
  buyerQuestions: number
  meetingRequests: number
  demandSignals: number
  buyerIntent: number
}

interface HandoffCandidate {
  post_id: string
  title: string
  channel: string
  score: number
  triggers: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method not allowed' })

  let body: { project_id?: string; kinds?: string[] } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY)
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

    // weekly_learning - summarize demand evidence and next actions
    if (want('weekly_learning')) {
      const weekly = await buildWeeklyLearningObservation(supabase, {
        id: projectId,
        org_id: orgId,
        name: projectName,
        slug: p.slug as string,
      })
      if (weekly) observations.push(weekly)
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

async function buildWeeklyLearningObservation(
  supabase: AdminClient,
  project: ProjectRow,
): Promise<Observation | null> {
  const now = new Date()
  const thisWeekStart = startOfIsoWeek(now)
  const previousWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const nextWeekStart = new Date(thisWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [postRes, metricRes, skillRes] = await Promise.all([
    supabase
      .from('content_posts')
      .select('id, title, copy, channel, status, provider, posted_at, published_at, scheduled_at, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(250),
    supabase
      .from('content_metric_snapshots')
      .select('post_id, provider, metric_name, metric_value, pulled_at')
      .eq('project_id', project.id)
      .in('metric_name', DEMAND_METRICS)
      .gte('pulled_at', previousWeekStart.toISOString())
      .lt('pulled_at', nextWeekStart.toISOString())
      .order('pulled_at', { ascending: false })
      .limit(1500),
    supabase
      .from('skills')
      .select('id, name, confidence, performance_notes, tags, created_at')
      .eq('project_id', project.id)
      .eq('is_active', false)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  if (postRes.error) {
    console.warn(`weekly_learning posts failed for ${project.id}: ${postRes.error.message}`)
    return null
  }
  if (metricRes.error) {
    console.warn(`weekly_learning metrics failed for ${project.id}: ${metricRes.error.message}`)
    return null
  }
  if (skillRes.error) {
    console.warn(`weekly_learning skills failed for ${project.id}: ${skillRes.error.message}`)
    return null
  }

  const posts = (postRes.data ?? []) as ContentPostRow[]
  const metrics = (metricRes.data ?? []) as MetricSnapshotRow[]
  const currentMetrics = buildMetrics(metrics.filter(row => inRange(row.pulled_at, thisWeekStart, nextWeekStart)))
  const previousMetrics = buildMetrics(metrics.filter(row => inRange(row.pulled_at, previousWeekStart, thisWeekStart)))
  const current = buildLearningSummary(currentMetrics)
  const previous = buildLearningSummary(previousMetrics)
  const skillProposals = ((skillRes.data ?? []) as SkillProposalRow[])
    .filter(skill => skill.name.toLowerCase().startsWith('learning proposal:') || (skill.tags ?? []).includes('learning-proposal'))
    .slice(0, 8)
  const handoffs = buildHandoffCandidates(posts, currentMetrics)
  const topAssets = buildTopAssets(posts, currentMetrics)
  const publishedThisWeek = posts.filter(post => {
    const date = post.posted_at ?? post.published_at ?? null
    return date ? inRange(date, thisWeekStart, nextWeekStart) : false
  }).length
  const approvedNotScheduled = posts.filter(post =>
    (post.status ?? '').toLowerCase() === 'approved' &&
    !post.scheduled_at &&
    !post.posted_at &&
    !post.published_at
  ).length

  if (
    current.measuredPosts === 0 &&
    previous.measuredPosts === 0 &&
    skillProposals.length === 0 &&
    handoffs.length === 0 &&
    publishedThisWeek === 0 &&
    approvedNotScheduled === 0
  ) {
    return null
  }

  const change = current.demandSignals - previous.demandSignals
  const detailParts = [
    `This week: ${current.measuredPosts} measured asset${current.measuredPosts === 1 ? '' : 's'}, ${publishedThisWeek} published, ${approvedNotScheduled} approved without a slot.`,
    signalSummary(current),
    changeSummary(change, previous.demandSignals),
    `${skillProposals.length} learning skill proposal${skillProposals.length === 1 ? '' : 's'} need review.`,
    `${handoffs.length} SAM handoff candidate${handoffs.length === 1 ? '' : 's'} should be queued.`,
  ].filter(Boolean)

  const severity: Observation['severity'] =
    current.meetingRequests > 0 || current.buyerQuestions > 0 || handoffs.length >= 3
      ? 'high'
      : current.measuredPosts > 0 || skillProposals.length > 0 || approvedNotScheduled > 0
        ? 'medium'
        : 'low'

  return {
    org_id: project.org_id,
    project_id: project.id,
    kind: 'weekly_learning',
    severity,
    title: `${project.name}: weekly learning review is ready`,
    detail: detailParts.join(' '),
    proposed_action: 'Review learning, enable useful skills, and queue the next brief',
    action_kind: 'review_weekly_learning',
    action_payload: {
      project_id: project.id,
      route: `/p/${project.slug}/learning`,
      week_key: isoWeekKey(now),
      current,
      previous,
      change: {
        demand_signals: change,
        previous_demand_signals: previous.demandSignals,
      },
      top_assets: topAssets,
      skill_proposals: skillProposals.map(skill => ({
        id: skill.id,
        name: skill.name,
        confidence: skill.confidence,
        created_at: skill.created_at,
      })),
      sam_handoff_candidates: handoffs,
      approved_without_slot: approvedNotScheduled,
      generated_at: now.toISOString(),
    },
    dedup_key: `weekly_learning:${project.id}:${isoWeekKey(now)}`,
    surface_until: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

function buildMetrics(rows: MetricSnapshotRow[]) {
  const latestRows = new Map<string, MetricSnapshotRow>()
  for (const row of rows) {
    if (!row.post_id) continue
    const name = row.metric_name.toLowerCase()
    const key = `${row.post_id}:${name}`
    const current = latestRows.get(key)
    if (!current || new Date(row.pulled_at).getTime() > new Date(current.pulled_at).getTime()) {
      latestRows.set(key, row)
    }
  }

  const byPost = new Map<string, LearningMetric>()
  for (const row of latestRows.values()) {
    if (!row.post_id) continue
    const metric = byPost.get(row.post_id) ?? {
      postId: row.post_id,
      provider: row.provider,
      views: 0,
      engagements: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      saves: 0,
      qualifiedTraffic: 0,
      buyerQuestions: 0,
      meetingRequests: 0,
      pulledAt: row.pulled_at ?? null,
    }
    const value = Number(row.metric_value ?? 0)
    const name = row.metric_name.toLowerCase()
    if (name === 'views' || name === 'impressions' || name === 'reach') metric.views = Math.max(metric.views, value)
    else if (name === 'engagements' || name === 'likes' || name === 'reactions') metric.engagements += value
    else if (name === 'comments') metric.comments += value
    else if (name === 'shares') metric.shares += value
    else if (name === 'clicks') metric.clicks += value
    else if (name === 'saves') metric.saves += value
    else if (name === 'qualified_traffic') metric.qualifiedTraffic += value
    else if (name === 'buyer_questions') metric.buyerQuestions += value
    else if (name === 'meeting_requests') metric.meetingRequests += value
    if (!metric.pulledAt || row.pulled_at > metric.pulledAt) metric.pulledAt = row.pulled_at
    byPost.set(row.post_id, metric)
  }
  return byPost
}

function buildLearningSummary(metrics: Map<string, LearningMetric>): LearningSummary {
  const rows = Array.from(metrics.values()).filter(hasLearningSignal)
  const totals = rows.reduce((acc, metric) => ({
    views: acc.views + metric.views,
    engagements: acc.engagements + metric.engagements + metric.comments + metric.shares + metric.saves + metric.clicks,
    comments: acc.comments + metric.comments,
    shares: acc.shares + metric.shares,
    clicks: acc.clicks + metric.clicks,
    saves: acc.saves + metric.saves,
    qualifiedTraffic: acc.qualifiedTraffic + metric.qualifiedTraffic,
    buyerQuestions: acc.buyerQuestions + metric.buyerQuestions,
    meetingRequests: acc.meetingRequests + metric.meetingRequests,
  }), { views: 0, engagements: 0, comments: 0, shares: 0, clicks: 0, saves: 0, qualifiedTraffic: 0, buyerQuestions: 0, meetingRequests: 0 })
  return {
    measuredPosts: rows.length,
    ...totals,
    demandSignals: totals.comments + totals.shares + totals.clicks + totals.saves + totals.qualifiedTraffic + totals.buyerQuestions + totals.meetingRequests,
    buyerIntent: totals.buyerQuestions + totals.meetingRequests,
  }
}

function buildTopAssets(posts: ContentPostRow[], metrics: Map<string, LearningMetric>) {
  const postById = new Map(posts.map(post => [post.id, post]))
  return Array.from(metrics.values())
    .filter(hasLearningSignal)
    .map(metric => {
      const post = postById.get(metric.postId)
      return {
        post_id: metric.postId,
        title: postTitle(post),
        channel: post?.channel || metric.provider || 'Unassigned',
        score: demandScore(metric),
        evidence: metricEvidence(metric),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

function buildHandoffCandidates(posts: ContentPostRow[], metrics: Map<string, LearningMetric>): HandoffCandidate[] {
  const postById = new Map(posts.map(post => [post.id, post]))
  return Array.from(metrics.values())
    .map(metric => {
      const score = demandScore(metric)
      const triggers = [
        metric.comments > 0 ? `${metric.comments} comment${metric.comments === 1 ? '' : 's'}` : '',
        metric.shares > 0 ? `${metric.shares} share${metric.shares === 1 ? '' : 's'}` : '',
        metric.clicks > 0 ? `${metric.clicks} click${metric.clicks === 1 ? '' : 's'}` : '',
        metric.saves > 0 ? `${metric.saves} save${metric.saves === 1 ? '' : 's'}` : '',
        metric.qualifiedTraffic > 0 ? `${metric.qualifiedTraffic} qualified visit${metric.qualifiedTraffic === 1 ? '' : 's'}` : '',
        metric.buyerQuestions > 0 ? `${metric.buyerQuestions} buyer question${metric.buyerQuestions === 1 ? '' : 's'}` : '',
        metric.meetingRequests > 0 ? `${metric.meetingRequests} meeting request${metric.meetingRequests === 1 ? '' : 's'}` : '',
        score >= 25 ? `score ${score}` : '',
      ].filter(Boolean)
      if (!triggers.length) return null
      const post = postById.get(metric.postId)
      return {
        post_id: metric.postId,
        title: postTitle(post),
        channel: post?.channel || metric.provider || 'Unassigned',
        score,
        triggers,
      }
    })
    .filter((candidate): candidate is HandoffCandidate => !!candidate)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
}

function hasLearningSignal(metric: LearningMetric) {
  return !!(
    metric.views ||
    metric.engagements ||
    metric.comments ||
    metric.shares ||
    metric.clicks ||
    metric.saves ||
    metric.qualifiedTraffic ||
    metric.buyerQuestions ||
    metric.meetingRequests
  )
}

function demandScore(metric: LearningMetric) {
  return Math.round(
    metric.meetingRequests * 20 +
    metric.buyerQuestions * 12 +
    metric.qualifiedTraffic * 7 +
    metric.comments * 6 +
    metric.shares * 5 +
    metric.clicks * 4 +
    metric.saves * 3 +
    metric.engagements +
    metric.views * 0.01,
  )
}

function metricEvidence(metric: LearningMetric) {
  const parts = [
    metric.comments ? `${metric.comments} comments` : '',
    metric.shares ? `${metric.shares} shares` : '',
    metric.clicks ? `${metric.clicks} clicks` : '',
    metric.qualifiedTraffic ? `${metric.qualifiedTraffic} qualified visits` : '',
    metric.buyerQuestions ? `${metric.buyerQuestions} buyer questions` : '',
    metric.meetingRequests ? `${metric.meetingRequests} meeting requests` : '',
    metric.views ? `${metric.views} views or reach` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'measured demand signals'
}

function signalSummary(summary: LearningSummary) {
  if (!summary.measuredPosts) return 'No fresh measured demand signals yet.'
  const parts = [
    summary.comments ? `${summary.comments} comments` : '',
    summary.shares ? `${summary.shares} shares` : '',
    summary.clicks ? `${summary.clicks} clicks` : '',
    summary.qualifiedTraffic ? `${summary.qualifiedTraffic} qualified visits` : '',
    summary.buyerQuestions ? `${summary.buyerQuestions} buyer questions` : '',
    summary.meetingRequests ? `${summary.meetingRequests} meeting requests` : '',
  ].filter(Boolean)
  return parts.length ? `Signals: ${parts.join(', ')}.` : `Signals: ${summary.views} views or reach.`
}

function changeSummary(change: number, previous: number) {
  if (previous === 0 && change > 0) return `Demand signals are new versus last week.`
  if (previous === 0) return `No prior-week signal baseline yet.`
  if (change === 0) return `Demand signals are flat versus last week.`
  const direction = change > 0 ? 'up' : 'down'
  return `Demand signals are ${direction} ${Math.abs(change)} versus last week.`
}

function postTitle(post?: ContentPostRow) {
  return post?.title || post?.copy?.slice(0, 84) || 'Untitled content'
}

function inRange(value: string | null, start: Date, end: Date) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime()
}

function startOfIsoWeek(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function isoWeekKey(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
