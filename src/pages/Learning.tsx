import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, CheckCircle2, Lightbulb, RefreshCw, Send, Share2, Sparkles, Target, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { ContentMetricSnapshot, Post } from '../lib/supabase'
import { parseProjectInstructions, type BusinessContext, type BusinessContextKey } from '../lib/businessContext'
import {
  DEMAND_GROWTH_OUTCOMES,
  DEMAND_LEARNING_LOOP,
  DEMAND_PLATFORM_DEFINITIONS,
  applyDemandDefaults,
  type DemandPlatformKey,
} from '../lib/demandModel'
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
  qualifiedTraffic: number
  buyerQuestions: number
  meetingRequests: number
  pulledAt: string | null
}

type Insight = {
  title: string
  body: string
  tone: string
}

type Experiment = Insight & {
  prompt: string
}

type HandoffCandidate = {
  id: string
  title: string
  channel: string
  score: number
  triggers: string[]
  prompt: string
}

type ChannelLearningRow = {
  key: DemandPlatformKey
  label: string
  initials: string
  publishing: string
  role: string
  sourceSet: boolean
  posts: number
  measured: number
  score: number
  signals: string[]
}

const DEMAND_METRICS = new Set([
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
])

export default function Learning() {
  const { activeProject } = useProject()
  const navigate = useNavigate()
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
  const summary = useMemo(() => buildSummary(posts, metrics, snapshots.length), [posts, metrics, snapshots.length])
  const insights = useMemo(() => buildInsights(posts, metrics), [posts, metrics])
  const topRows = useMemo(() => buildTopRows(posts, metrics), [posts, metrics])
  const businessContext = useMemo(() => parseProjectInstructions(activeProject?.instructions ?? '').businessContext, [activeProject?.instructions])
  const demandContext = useMemo(() => applyDemandDefaults(businessContext), [businessContext])
  const operatingRows = useMemo(() => {
    return buildOperatingRows(demandContext)
  }, [demandContext])
  const channelRows = useMemo(() => buildChannelRows(posts, metrics, demandContext), [posts, metrics, demandContext])
  const experiments = useMemo(() => buildExperiments(posts, metrics, demandContext, channelRows), [posts, metrics, demandContext, channelRows])
  const measuredChannels = channelRows.filter(row => row.measured > 0).length
  const handoffCandidates = useMemo(() => buildHandoffCandidates(posts, metrics, demandContext), [posts, metrics, demandContext])

  function briefInVera(candidate: HandoffCandidate) {
    if (!activeProject?.id || !activeProject.slug) return
    sessionStorage.setItem(`vera-command-prefill:${activeProject.id}`, candidate.prompt)
    navigate(`/p/${activeProject.slug}/vera`)
  }

  function briefExperimentInVera(experiment: Experiment) {
    if (!activeProject?.id || !activeProject.slug) return
    sessionStorage.setItem(`vera-command-prefill:${activeProject.id}`, experiment.prompt)
    navigate(`/p/${activeProject.slug}/vera`)
  }

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
        <MetricCard icon={Share2} label="Demand signals" value={summary.demandSignals} detail="Comments, shares, saves, clicks, traffic" />
        <MetricCard icon={Sparkles} label="Buyer intent" value={summary.buyerIntent} detail={`${summary.buyerQuestions} questions, ${summary.meetingRequests} meeting requests`} />
        <MetricCard icon={TrendingUp} label="Engagement rate" value={summary.engagementRateLabel} detail={summary.views ? `${summary.views.toLocaleString()} views or reach` : 'Waiting for traffic data'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: space[5], alignItems: 'start', marginBottom: space[8] }}>
        <Panel>
          <SectionLabel>Learning model</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: space[3], marginTop: space[4] }}>
            {DEMAND_LEARNING_LOOP.map(step => (
              <div key={step.title} style={{ padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
                <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{step.title}</div>
                <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionLabel>Growth outcomes</SectionLabel>
          <p style={{ margin: `${space[4]} 0 ${space[3]}`, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
            Vera optimizes for demand signals, not raw output volume. The first wave is comments, shares, qualified traffic, buyer questions, and SAM research triggers.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {DEMAND_GROWTH_OUTCOMES.map(item => (
              <span key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ink2, fontSize: t.size.micro }}>
                <CheckCircle2 size={12} style={{ color: color.success }} />
                {item}
              </span>
            ))}
          </div>
        </Panel>
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
            <SignalRow label="Qualified traffic" value={summary.qualifiedTraffic} body="Useful visits are stronger than raw reach because they show movement toward owned conversion paths." />
            <SignalRow label="Buyer questions" value={summary.buyerQuestions} body="Commercial questions should become content angles and SAM research tasks." />
            <SignalRow label="Meeting requests" value={summary.meetingRequests} body="Meeting intent is the strongest signal that VERA should brief SAM and repeat the source pattern." />
            <SignalRow label="Reach" value={summary.views} body="Views and reach are useful only when they lead to engagement, qualified visits, or sharper market learning." />
          </div>
          <div style={{ display: 'grid', gap: space[2], marginTop: space[4] }}>
            {operatingRows.length ? operatingRows.map(row => (
              <OperatingRow key={row.label} label={row.label} value={row.value} />
            )) : (
              <LearningState>Add a demand operating model in the Demand Brain so VERA knows what traction, approval, and SAM handoff mean for this client.</LearningState>
            )}
          </div>
        </Panel>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <Panel>
          <SectionLabel action={`${measuredChannels}/${channelRows.length} measured`}>Channel learning coverage</SectionLabel>
          <p style={{ margin: `${space[4]} 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
            Each client can use all channels, but Vera should only scale the channels where source context, approval rules, and performance evidence exist.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: space[3] }}>
            {channelRows.map(row => <ChannelLearningCard key={row.key} row={row} />)}
          </div>
        </Panel>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <Panel>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3], marginBottom: space[4], flexWrap: 'wrap' }}>
            <SectionLabel>SAM handoff queue</SectionLabel>
            <span style={{ color: color.ghost, fontSize: t.size.cap }}>{handoffCandidates.length} candidate{handoffCandidates.length === 1 ? '' : 's'}</span>
          </div>
          {handoffCandidates.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[3] }}>
              {handoffCandidates.map(candidate => (
                <HandoffCard key={candidate.id} candidate={candidate} onBrief={() => briefInVera(candidate)} />
              ))}
            </div>
          ) : (
            <LearningState>No handoff candidates yet. VERA needs measured posts with comments, shares, clicks, saves, buyer questions, meeting requests, or a strong demand score.</LearningState>
          )}
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: space[5], alignItems: 'start', marginBottom: space[8] }}>
        <Panel>
          <SectionLabel>Next demand experiments</SectionLabel>
          <div style={{ display: 'grid', gap: space[3], marginTop: space[4] }}>
            {experiments.map(experiment => (
              <ExperimentCard key={experiment.title} experiment={experiment} onBrief={() => briefExperimentInVera(experiment)} />
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

function HandoffCard({ candidate, onBrief }: { candidate: HandoffCandidate; onBrief: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{candidate.title}</div>
          <div style={{ color: color.ghost, fontSize: t.size.cap, marginTop: 2 }}>{candidate.channel}</div>
        </div>
        <span style={{ flexShrink: 0, padding: '4px 8px', borderRadius: radius.pill, background: 'var(--accent-tint)', color: color.accent, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{candidate.score}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {candidate.triggers.map(trigger => (
          <span key={trigger} style={{ padding: '3px 8px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: color.ink2, fontSize: t.size.micro }}>{trigger}</span>
        ))}
      </div>
      <button onClick={onBrief} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', marginTop: 'auto', padding: '8px 11px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surface, color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer' }}>
        <Send size={13} />
        Brief in Vera
      </button>
    </div>
  )
}

function ExperimentCard({ experiment, onBrief }: { experiment: Experiment; onBrief: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: space[3], padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <span style={{ width: 28, height: 28, borderRadius: radius.pill, background: 'var(--accent-tint)', color: experiment.tone, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Lightbulb size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{experiment.title}</span>
        <span style={{ display: 'block', color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5, marginTop: 2 }}>{experiment.body}</span>
      </span>
      <button onClick={onBrief} title="Brief this experiment in Vera" style={{ flexShrink: 0, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: color.ink, fontSize: t.size.micro, fontWeight: t.weight.medium, cursor: 'pointer' }}>
        <Send size={12} />
        Brief
      </button>
    </div>
  )
}

function ChannelLearningCard({ row }: { row: ChannelLearningRow }) {
  const status = row.measured > 0
    ? 'Learning'
    : row.posts > 0
      ? 'Needs sync'
      : row.sourceSet
        ? 'Ready'
        : 'Needs source'
  const tone = row.measured > 0 ? color.success : row.posts > 0 ? color.warn : row.sourceSet ? color.info : color.ghost
  return (
    <div style={{ padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, minHeight: 176, display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], minWidth: 0 }}>
          <span style={{ width: 32, height: 32, borderRadius: radius.sm, background: color.surface, color: color.accent, border: `1px solid ${color.line}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
            {row.initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</div>
            <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 1 }}>{row.publishing}</div>
          </div>
        </div>
        <span style={{ color: tone, fontSize: t.size.micro, fontWeight: t.weight.semibold, whiteSpace: 'nowrap' }}>{status}</span>
      </div>
      <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{row.role}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 'auto' }}>
        <MiniStat label="Posts" value={row.posts} />
        <MiniStat label="Measured" value={row.measured} />
        <MiniStat label="Score" value={row.score} />
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {row.signals.slice(0, 3).map(signal => (
          <span key={signal} style={{ padding: '3px 7px', borderRadius: radius.pill, background: color.surface, border: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.micro }}>
            {signal}
          </span>
        ))}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: '7px 8px', borderRadius: radius.sm, background: color.surface, border: `1px solid ${color.line}` }}>
      <div style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 1 }}>{label}</div>
    </div>
  )
}

function OperatingRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: space[3], border: `1px solid ${color.line}`, borderRadius: radius.sm, background: color.surface }}>
      <div style={{ color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.medium, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</div>
      <div style={{ color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5, marginTop: 3 }}>{value}</div>
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

function buildOperatingRows(context: BusinessContext) {
  const fields: Array<{ key: BusinessContextKey; label: string }> = [
    { key: 'demandObjective', label: 'Objective' },
    { key: 'speakerStrategy', label: 'Speakers' },
    { key: 'platformToneOfVoice', label: 'Platform TOV' },
    { key: 'approvalStakeholders', label: 'Approvers' },
    { key: 'engagementSignals', label: 'Signals' },
    { key: 'samHandoffRules', label: 'SAM handoff' },
    { key: 'learningCadence', label: 'Learning cadence' },
  ]
  return fields
    .map(field => ({ label: field.label, value: context[field.key].trim() }))
    .filter(row => row.value.length > 0)
}

function buildChannelRows(posts: Post[], metrics: Map<string, LearningMetric>, context: BusinessContext): ChannelLearningRow[] {
  const byChannel = new Map<DemandPlatformKey, { posts: number; measured: number; score: number }>()
  for (const post of posts) {
    const metric = metrics.get(post.id)
    const key = platformKeyForPost(post, metric)
    if (!key) continue
    const current = byChannel.get(key) ?? { posts: 0, measured: 0, score: 0 }
    current.posts += 1
    if (metric && hasLearningSignal(metric)) {
      current.measured += 1
      current.score += demandScore(metric)
    }
    byChannel.set(key, current)
  }

  return DEMAND_PLATFORM_DEFINITIONS.map(platform => {
    const counts = byChannel.get(platform.key) ?? { posts: 0, measured: 0, score: 0 }
    return {
      key: platform.key,
      label: platform.label,
      initials: platform.initials,
      publishing: publishingLabel(platform.publishing),
      role: platform.role,
      sourceSet: platform.sourceKey ? !!context[platform.sourceKey].trim() : platform.key === 'email',
      posts: counts.posts,
      measured: counts.measured,
      score: counts.score,
      signals: platform.outcomeSignals,
    }
  })
}

function platformKeyForPost(post: Post, metric?: LearningMetric): DemandPlatformKey | null {
  const value = [post.channel, post.provider, metric?.provider]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!value) return null
  if (value.includes('linkedin') || value.includes('unipile')) return 'linkedin'
  if (value.includes('youtube') || value.includes('youtu.be')) return 'youtube'
  if (value.includes('medium')) return 'medium'
  if (value.includes('quora')) return 'quora'
  if (value.includes('reddit')) return 'reddit'
  if (value === 'x' || value.includes('twitter') || value.includes('x.com')) return 'x'
  if (value.includes('instagram') || value.includes('meta_instagram')) return 'instagram'
  if (value.includes('facebook') || value.includes('meta_facebook')) return 'facebook'
  if (value.includes('blog') || value.includes('wordpress') || value.includes('cms')) return 'blog'
  if (value.includes('email') || value.includes('newsletter')) return 'email'
  return null
}

function publishingLabel(value: string) {
  if (value === 'manual-first') return 'manual first'
  if (value === 'read-only') return 'read only'
  return value
}

function buildHandoffCandidates(posts: Post[], metrics: Map<string, LearningMetric>, context: BusinessContext): HandoffCandidate[] {
  return posts
    .map(post => {
      const metric = metrics.get(post.id)
      if (!metric) return null
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
      const title = post.title || post.copy?.slice(0, 84) || 'Untitled content'
      const channel = post.channel || metric.provider || 'Unassigned'
      const prompt = [
        `Create a SAM handoff brief for this VERA content signal.`,
        ``,
        `Client: ${context.companyName || 'current client'}`,
        `Asset: ${title}`,
        `Channel: ${channel}`,
        `Triggers: ${triggers.join(', ')}`,
        `Demand score: ${score}`,
        context.engagementSignals ? `Client-defined engagement signals: ${context.engagementSignals}` : '',
        context.samHandoffRules ? `Client-defined SAM handoff rules: ${context.samHandoffRules}` : '',
        context.approvalModel ? `Approval model: ${context.approvalModel}` : '',
        context.approvalStakeholders ? `Approval stakeholders: ${context.approvalStakeholders}` : '',
        context.speakerStrategy ? `Speaker strategy: ${context.speakerStrategy}` : '',
        context.platformToneOfVoice ? `Platform tone of voice: ${context.platformToneOfVoice}` : '',
        ``,
        `Return:`,
        `1. why this signal matters`,
        `2. likely buyer pain or intent`,
        `3. accounts or people SAM should research`,
        `4. outreach angle and objection to prepare for`,
        `5. next VERA content experiment`,
      ].filter(Boolean).join('\n')
      return { id: post.id, title, channel, score, triggers, prompt }
    })
    .filter((candidate): candidate is HandoffCandidate => !!candidate)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
}

function buildMetrics(rows: ContentMetricSnapshot[]) {
  const latestRows = new Map<string, ContentMetricSnapshot>()
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

function buildSummary(posts: Post[], metrics: Map<string, LearningMetric>, snapshotCount: number) {
  const published = posts.filter(post => post.posted_at || post.published_at || post.status?.toLowerCase() === 'posted').length
  const approved = posts.filter(post => post.status?.toLowerCase() === 'approved').length
  const scheduled = posts.filter(post => post.scheduled_at).length
  const measured = Array.from(metrics.values()).filter(hasLearningSignal).length
  const totals = Array.from(metrics.values()).reduce((acc, metric) => ({
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
  const rate = totals.views ? (totals.engagements / totals.views) * 100 : null
  return {
    published,
    approved,
    scheduled,
    measured,
    metricCount: snapshotCount,
    views: totals.views,
    comments: totals.comments,
    shares: totals.shares,
    clicks: totals.clicks,
    qualifiedTraffic: totals.qualifiedTraffic,
    buyerQuestions: totals.buyerQuestions,
    meetingRequests: totals.meetingRequests,
    buyerIntent: totals.buyerQuestions + totals.meetingRequests,
    demandSignals: totals.comments + totals.shares + totals.clicks + totals.saves + totals.qualifiedTraffic + totals.buyerQuestions + totals.meetingRequests,
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

  const intentTotals = Array.from(metrics.values()).reduce((acc, metric) => ({
    qualifiedTraffic: acc.qualifiedTraffic + metric.qualifiedTraffic,
    buyerQuestions: acc.buyerQuestions + metric.buyerQuestions,
    meetingRequests: acc.meetingRequests + metric.meetingRequests,
  }), { qualifiedTraffic: 0, buyerQuestions: 0, meetingRequests: 0 })
  if (intentTotals.buyerQuestions > 0 || intentTotals.meetingRequests > 0) {
    insights.push({
      title: 'Commercial intent is visible',
      body: `${intentTotals.buyerQuestions} buyer question${intentTotals.buyerQuestions === 1 ? '' : 's'} and ${intentTotals.meetingRequests} meeting request${intentTotals.meetingRequests === 1 ? '' : 's'} should become SAM research tasks and follow-up content angles.`,
      tone: color.success,
    })
  } else if (intentTotals.qualifiedTraffic > 0) {
    insights.push({
      title: 'Traffic needs conversion proof',
      body: `${intentTotals.qualifiedTraffic} qualified visit${intentTotals.qualifiedTraffic === 1 ? '' : 's'} came from content. The next brief should test a sharper CTA that turns visits into questions or meetings.`,
      tone: color.info,
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

function buildExperiments(
  posts: Post[],
  metrics: Map<string, LearningMetric>,
  context: BusinessContext,
  channels: ChannelLearningRow[],
): Experiment[] {
  const top = buildTopRows(posts, metrics)[0]
  const base = top?.title ?? 'the current strongest client proof point'
  const bestChannel = channels
    .filter(channel => channel.measured > 0)
    .sort((a, b) => b.score - a.score)[0]
  const nextChannel = bestChannel?.label ?? channels.find(channel => channel.sourceSet)?.label ?? 'LinkedIn'
  const speaker = context.speakerStrategy || 'Choose brand, founder, expert, or team voice based on the asset and source evidence.'
  const tone = context.platformToneOfVoice || 'Keep the brand core, then adapt structure and tone to the selected medium.'
  const approvals = context.approvalStakeholders || context.approvalModel || 'Use case-based approval routing before publishing.'
  const commonContext = [
    `Client: ${context.companyName || 'current client'}`,
    `Demand objective: ${context.demandObjective || 'create B2B top-of-funnel demand'}`,
    `Speaker strategy: ${speaker}`,
    `Platform tone of voice: ${tone}`,
    `Approval routing: ${approvals}`,
    `Engagement signals: ${context.engagementSignals || 'comments, shares, saves, clicks, and qualified traffic'}`,
    `SAM handoff rules: ${context.samHandoffRules || 'turn useful objections, buyer questions, and high-intent engagement into sales research'}`,
  ].join('\n')
  return [
    {
      title: 'Create three ICP-specific variations',
      body: `Turn ${base} into founder, operator, and technical buyer versions. Compare comments, shares, buyer questions, and meeting requests by ICP.`,
      tone: color.accent,
      prompt: [
        `Plan the next VERA demand experiment: three ICP-specific variations.`,
        ``,
        commonContext,
        ``,
        `Source asset or proof point: ${base}`,
        `Primary channel to test: ${nextChannel}`,
        ``,
        `Return the experiment brief, the three variants, the approval route for each, and the exact metric Vera should compare after publishing.`,
      ].join('\n'),
    },
    {
      title: 'Test one problem-aware thread',
      body: 'Lead with the pain before the offer. Measure comments, saves, clicks, qualified traffic, and buyer questions as the top-of-funnel signal.',
      tone: color.success,
      prompt: [
        `Plan and draft one problem-aware demand experiment.`,
        ``,
        commonContext,
        ``,
        `Primary channel to test: ${nextChannel}`,
        `Core proof or theme: ${base}`,
        ``,
        `Draft the asset, define the CTA, define the approval route, and explain which comments, shares, saves, clicks, qualified visits, buyer questions, or meeting requests would prove this angle is worth scaling.`,
      ].join('\n'),
    },
    {
      title: 'Build one SAM handoff angle',
      body: 'Convert the highest-engagement topic into a sales research angle for SAM, with objections and account triggers included.',
      tone: color.info,
      prompt: [
        `Create a SAM handoff experiment from VERA performance learning.`,
        ``,
        commonContext,
        ``,
        `Strongest current signal: ${base}`,
        `Channel context: ${nextChannel}`,
        ``,
        `Return a SAM research brief, likely account triggers, objections to prepare for, buyer questions to answer, and the next content asset Vera should create to create more of this signal.`,
      ].join('\n'),
    },
  ]
}

function buildTopRows(posts: Post[], metrics: Map<string, LearningMetric>) {
  return posts
    .map(post => {
      const metric = metrics.get(post.id)
      if (!metric || !hasLearningSignal(metric)) return null
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
