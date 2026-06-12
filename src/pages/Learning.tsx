import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { ArrowRight, BarChart3, Lightbulb, RefreshCw, Share2, Sparkles, Target, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { ContentMetricSnapshot, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { Button, PageHeader, SectionLabel, color, radius, space, type as t } from '../design'

type LearningMetric = {
  postId: string
  provider: string
  views: number
  engagements: number
  comments: number
  shares: number
  clicks: number
  saves: number
  pulledAt: string | null
}

type Insight = {
  title: string
  body: string
  tone: string
}

const DEMAND_METRICS = new Set(['views', 'impressions', 'reach', 'engagements', 'likes', 'comments', 'shares', 'clicks', 'saves'])

export default function Learning() {
  const { activeProject } = useProject()
  const [posts, setPosts] = useState<Post[]>([])
  const [snapshots, setSnapshots] = useState<ContentMetricSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useRightRail(null, [])

  const load = useCallback(async () => {
    if (!activeProject?.id) {
      setPosts([])
      setSnapshots([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [postRes, metricRes] = await Promise.all([
      supabase
        .from('content_posts')
        .select('*')
        .eq('project_id', activeProject.id)
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('content_metric_snapshots')
        .select('id, org_id, project_id, post_id, provider, provider_account_id, provider_object_id, object_type, metric_name, metric_value, metric_period, metric_time, pulled_at, raw, created_at')
        .eq('project_id', activeProject.id)
        .in('metric_name', Array.from(DEMAND_METRICS))
        .order('pulled_at', { ascending: false })
        .limit(1500),
    ])
    const firstError = postRes.error ?? metricRes.error
    if (firstError) {
      setError(firstError.message)
    } else {
      setPosts((postRes.data ?? []) as Post[])
      setSnapshots((metricRes.data ?? []) as ContentMetricSnapshot[])
    }
    setLoading(false)
  }, [activeProject?.id])

  useEffect(() => {
    const task = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(task)
  }, [load])

  const metrics = useMemo(() => buildMetrics(snapshots), [snapshots])
  const summary = useMemo(() => buildSummary(posts, metrics), [posts, metrics])
  const insights = useMemo(() => buildInsights(posts, metrics), [posts, metrics])
  const experiments = useMemo(() => buildExperiments(posts, metrics), [posts, metrics])
  const topRows = useMemo(() => buildTopRows(posts, metrics), [posts, metrics])

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1180 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? 'Client'}
        title="Learning Loop"
        subtitle="What VERA has learned from approvals, publishing, engagement, shares, clicks, and traffic signals."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div style={{ marginBottom: space[6], padding: space[4], border: `1px solid ${color.danger}`, borderRadius: radius.md, background: color.surface, color: color.danger, fontSize: t.size.sm }}>
          {error}
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: space[4], marginBottom: space[8] }}>
        <MetricCard icon={Target} label="Published assets" value={summary.published} detail={`${summary.approved} approved, ${summary.scheduled} scheduled`} />
        <MetricCard icon={BarChart3} label="Measured assets" value={summary.measured} detail={`${summary.metricCount} metric snapshots`} />
        <MetricCard icon={Share2} label="Demand signals" value={summary.demandSignals} detail="Comments, shares, saves, clicks" />
        <MetricCard icon={TrendingUp} label="Engagement rate" value={summary.engagementRateLabel} detail={summary.views ? `${summary.views.toLocaleString()} views or reach` : 'Waiting for traffic data'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: space[5], alignItems: 'start', marginBottom: space[8] }}>
        <Panel>
          <SectionLabel>What VERA learned</SectionLabel>
          <div style={{ display: 'grid', gap: space[3], marginTop: space[4] }}>
            {loading ? (
              <LearningState>Reading the latest content and metric signals...</LearningState>
            ) : insights.length ? insights.map(item => <InsightCard key={item.title} insight={item} />) : (
              <LearningState>Publish and sync metrics to start the learning loop. VERA needs content outcomes before it can recommend stronger demand patterns.</LearningState>
            )}
          </div>
        </Panel>

        <Panel>
          <SectionLabel>SAM handoff signals</SectionLabel>
          <div style={{ display: 'grid', gap: space[3], marginTop: space[4] }}>
            <SignalRow label="Comments" value={summary.comments} body="High-intent replies and objections should become SAM research context." />
            <SignalRow label="Shares" value={summary.shares} body="Shares indicate message resonance and account expansion potential." />
            <SignalRow label="Clicks" value={summary.clicks} body="Traffic from content should trigger follow-up angles, not just reporting." />
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space[5], alignItems: 'start', marginBottom: space[8] }}>
        <Panel>
          <SectionLabel>Next demand experiments</SectionLabel>
          <div style={{ display: 'grid', gap: space[3], marginTop: space[4] }}>
            {experiments.map(experiment => (
              <div key={experiment.title} style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
                <span style={{ width: 28, height: 28, borderRadius: radius.pill, background: 'var(--accent-tint)', color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Lightbulb size={15} />
                </span>
                <span>
                  <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{experiment.title}</span>
                  <span style={{ display: 'block', color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5, marginTop: 2 }}>{experiment.body}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionLabel>Top demand assets</SectionLabel>
          <div style={{ display: 'grid', gap: space[2], marginTop: space[4] }}>
            {topRows.length ? topRows.map(row => (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space[3], padding: `${space[3]} 0`, borderBottom: `1px solid ${color.line}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</div>
                  <div style={{ color: color.ghost, fontSize: t.size.cap, marginTop: 2 }}>{row.channel} · {row.status}</div>
                </div>
                <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, fontVariantNumeric: 'tabular-nums' }}>{row.score}</div>
              </div>
            )) : (
              <LearningState>No measured content yet.</LearningState>
            )}
          </div>
        </Panel>
      </section>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
      {children}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: ElementType; label: string; value: string | number; detail: string }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5], minHeight: 132 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <span style={{ color: color.ghost, fontSize: t.size.cap, fontWeight: t.weight.medium }}>{label}</span>
        <Icon size={16} style={{ color: color.accent }} />
      </div>
      <div style={{ color: color.ink, fontSize: t.size.h2, fontWeight: t.weight.semibold, marginTop: space[3], lineHeight: 1.1 }}>{value}</div>
      <div style={{ color: color.ghost, fontSize: t.size.cap, marginTop: space[2], lineHeight: 1.4 }}>{detail}</div>
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <span style={{ width: 28, height: 28, borderRadius: radius.pill, background: 'var(--accent-tint)', color: insight.tone, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Sparkles size={15} />
      </span>
      <span>
        <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{insight.title}</span>
        <span style={{ display: 'block', color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5, marginTop: 2 }}>{insight.body}</span>
      </span>
    </div>
  )
}

function SignalRow({ label, value, body }: { label: string; value: number; body: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr) auto', gap: space[3], alignItems: 'center', padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div>
        <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium }}>{label}</div>
        <div style={{ color: color.ghost, fontSize: t.size.cap, lineHeight: 1.4, marginTop: 1 }}>{body}</div>
      </div>
      <ArrowRight size={14} style={{ color: color.ghost }} />
    </div>
  )
}

function LearningState({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: space[5], color: color.ghost, fontSize: t.size.sm, lineHeight: 1.5, border: `1px dashed ${color.line}`, borderRadius: radius.md }}>
      {children}
    </div>
  )
}

function buildMetrics(rows: ContentMetricSnapshot[]) {
  const byPost = new Map<string, LearningMetric>()
  for (const row of rows) {
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
      pulledAt: row.pulled_at ?? null,
    }
    const value = Number(row.metric_value ?? 0)
    const name = row.metric_name.toLowerCase()
    if (name === 'views' || name === 'impressions' || name === 'reach') metric.views = Math.max(metric.views, value)
    else if (name === 'engagements' || name === 'likes') metric.engagements += value
    else if (name === 'comments') metric.comments += value
    else if (name === 'shares') metric.shares += value
    else if (name === 'clicks') metric.clicks += value
    else if (name === 'saves') metric.saves += value
    if (!metric.pulledAt || row.pulled_at > metric.pulledAt) metric.pulledAt = row.pulled_at
    byPost.set(row.post_id, metric)
  }
  return byPost
}

function buildSummary(posts: Post[], metrics: Map<string, LearningMetric>) {
  const published = posts.filter(post => post.posted_at || post.published_at || post.status?.toLowerCase() === 'posted').length
  const approved = posts.filter(post => post.status?.toLowerCase() === 'approved').length
  const scheduled = posts.filter(post => post.scheduled_at).length
  const measured = Array.from(metrics.values()).filter(metric => metric.views || metric.engagements || metric.comments || metric.shares || metric.clicks || metric.saves).length
  const totals = Array.from(metrics.values()).reduce((acc, metric) => ({
    views: acc.views + metric.views,
    engagements: acc.engagements + metric.engagements + metric.comments + metric.shares + metric.saves + metric.clicks,
    comments: acc.comments + metric.comments,
    shares: acc.shares + metric.shares,
    clicks: acc.clicks + metric.clicks,
    saves: acc.saves + metric.saves,
  }), { views: 0, engagements: 0, comments: 0, shares: 0, clicks: 0, saves: 0 })
  const rate = totals.views ? (totals.engagements / totals.views) * 100 : null
  return {
    published,
    approved,
    scheduled,
    measured,
    metricCount: metrics.size,
    views: totals.views,
    comments: totals.comments,
    shares: totals.shares,
    clicks: totals.clicks,
    demandSignals: totals.comments + totals.shares + totals.clicks + totals.saves,
    engagementRateLabel: rate === null ? 'New' : `${rate.toFixed(1)}%`,
  }
}

function buildInsights(posts: Post[], metrics: Map<string, LearningMetric>): Insight[] {
  const measuredPosts = posts.filter(post => post.id && metrics.has(post.id))
  const insights: Insight[] = []
  if (measuredPosts.length === 0) return insights

  const top = buildTopRows(posts, metrics)[0]
  if (top) {
    insights.push({
      title: 'Repeat the strongest demand asset pattern',
      body: `${top.title} is currently the strongest measured asset. Use its topic, hook structure, channel fit, and CTA as the next variation source.`,
      tone: color.accent,
    })
  }

  const channels = new Map<string, { count: number; score: number }>()
  for (const post of measuredPosts) {
    const metric = metrics.get(post.id)
    if (!metric) continue
    const channel = post.channel || metric.provider || 'Unassigned'
    const current = channels.get(channel) ?? { count: 0, score: 0 }
    current.count += 1
    current.score += demandScore(metric)
    channels.set(channel, current)
  }
  const bestChannel = Array.from(channels.entries()).sort((a, b) => (b[1].score / b[1].count) - (a[1].score / a[1].count))[0]
  if (bestChannel) {
    insights.push({
      title: `${bestChannel[0]} is carrying the strongest signal`,
      body: `Measured demand quality is highest there so far. Bias the next batch toward this channel until another channel proves stronger.`,
      tone: color.success,
    })
  }

  const unscheduledApproved = posts.filter(post => post.status?.toLowerCase() === 'approved' && !post.scheduled_at && !post.posted_at).length
  if (unscheduledApproved > 0) {
    insights.push({
      title: 'Approved demand is not fully distributed',
      body: `${unscheduledApproved} approved asset${unscheduledApproved === 1 ? '' : 's'} still need a publishing slot. Demand cannot compound while approved content sits idle.`,
      tone: color.warn,
    })
  }

  return insights
}

function buildExperiments(posts: Post[], metrics: Map<string, LearningMetric>): Insight[] {
  const top = buildTopRows(posts, metrics)[0]
  const base = top?.title ?? 'the current strongest client proof point'
  return [
    {
      title: 'Create three ICP-specific variations',
      body: `Turn ${base} into founder, operator, and technical buyer versions. Compare comments and shares by ICP.`,
      tone: color.accent,
    },
    {
      title: 'Test one problem-aware thread',
      body: 'Lead with the pain before the offer. Measure comments, saves, and profile or site clicks as the top-of-funnel signal.',
      tone: color.success,
    },
    {
      title: 'Build one SAM handoff angle',
      body: 'Convert the highest-engagement topic into a sales research angle for SAM, with objections and account triggers included.',
      tone: color.info,
    },
  ]
}

function buildTopRows(posts: Post[], metrics: Map<string, LearningMetric>) {
  return posts
    .map(post => {
      const metric = metrics.get(post.id)
      if (!metric) return null
      return {
        id: post.id,
        title: post.title || post.copy?.slice(0, 80) || 'Untitled content',
        channel: post.channel || metric.provider || 'Unassigned',
        status: post.status || 'draft',
        score: demandScore(metric),
      }
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
}

function demandScore(metric: LearningMetric) {
  return Math.round(metric.comments * 6 + metric.shares * 5 + metric.clicks * 4 + metric.saves * 3 + metric.engagements + metric.views * 0.01)
}
