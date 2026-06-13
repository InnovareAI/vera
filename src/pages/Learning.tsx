import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, CheckCircle2, Check, Copy, Lightbulb, RefreshCw, Send, Share2, Sparkles, Target, TrendingUp, UserCheck, X, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { ContentMetricSnapshot, Post } from '../lib/supabase'
import { useAuth } from '../lib/auth'
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
import { Button, PageHeader, SectionLabel, color, radius, space, type as t, useToast } from '../design'

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

type SamHandoffStatus = 'queued' | 'in_progress' | 'done' | 'dismissed'

type SamHandoffAction = {
  id: string
  org_id: string
  project_id: string
  observation_id: string | null
  post_id: string | null
  title: string
  channel: string | null
  score: number
  triggers: string[]
  status: SamHandoffStatus
  priority: 'low' | 'medium' | 'high'
  payload: Record<string, unknown> | null
  created_by: string | null
  assigned_to: string | null
  assigned_at: string | null
  handed_to_sam_at: string | null
  completed_at: string | null
  dismissed_at: string | null
  actioned_at: string | null
  created_at: string
  updated_at: string
}

type LearningSkillProposal = {
  key: string
  name: string
  description: string
  triggerDescription: string
  triggerWhen: Record<string, unknown>
  promptModule: string
  gotchas: string[]
  goodExamples: Array<{ label: string; text: string }>
  sourceRefs: Array<{ label: string; text: string }>
  tags: string[]
  confidence: 'medium' | 'high'
  performanceNotes: string
  injectedInto: 'strategist' | 'writer' | 'all'
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

const HANDOFF_SELECT = 'id, org_id, project_id, observation_id, post_id, title, channel, score, triggers, status, priority, payload, created_by, assigned_to, assigned_at, handed_to_sam_at, completed_at, dismissed_at, actioned_at, created_at, updated_at'

export default function Learning() {
  const { activeProject } = useProject()
  const { user } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [snapshots, setSnapshots] = useState<ContentMetricSnapshot[]>([])
  const [handoffActions, setHandoffActions] = useState<SamHandoffAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skillMessage, setSkillMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [savingSkillKey, setSavingSkillKey] = useState<string | null>(null)
  const [handoffBusyKey, setHandoffBusyKey] = useState<string | null>(null)
  useRightRail(null, [])

  const load = useCallback(async () => {
    if (!activeProject?.id) {
      setPosts([])
      setSnapshots([])
      setHandoffActions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [postRes, metricRes, handoffRes] = await Promise.all([
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
      supabase
        .from('sam_handoff_actions')
        .select(HANDOFF_SELECT)
        .eq('project_id', activeProject.id)
        .order('updated_at', { ascending: false })
        .limit(80),
    ])
    const firstError = postRes.error ?? metricRes.error ?? handoffRes.error
    if (firstError) {
      setError(firstError.message)
    } else {
      setPosts((postRes.data ?? []) as Post[])
      setSnapshots((metricRes.data ?? []) as ContentMetricSnapshot[])
      setHandoffActions((handoffRes.data ?? []) as SamHandoffAction[])
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
  const activeHandoffActions = useMemo(() => handoffActions.filter(action => action.status !== 'done' && action.status !== 'dismissed'), [handoffActions])
  const closedHandoffActions = useMemo(() => handoffActions.filter(action => action.status === 'done' || action.status === 'dismissed').slice(0, 6), [handoffActions])
  const handoffActionByPost = useMemo(() => {
    const byPost = new Map<string, SamHandoffAction>()
    for (const action of handoffActions) {
      if (action.post_id && !byPost.has(action.post_id)) byPost.set(action.post_id, action)
    }
    return byPost
  }, [handoffActions])
  const untrackedHandoffCandidates = useMemo(
    () => handoffCandidates.filter(candidate => !handoffActionByPost.has(candidate.id)).slice(0, 6),
    [handoffCandidates, handoffActionByPost],
  )
  const skillProposals = useMemo(() => buildSkillProposals(posts, metrics, demandContext, channelRows), [posts, metrics, demandContext, channelRows])

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

  async function saveSkillProposal(proposal: LearningSkillProposal) {
    if (!activeProject?.id || !activeProject.org_id) {
      setSkillMessage({ tone: 'danger', text: 'Pick a client workspace before saving a learning skill.' })
      return
    }

    setSavingSkillKey(proposal.key)
    setSkillMessage(null)
    const payload = {
      org_id: activeProject.org_id,
      project_id: activeProject.id,
      type: 'content',
      name: proposal.name,
      description: proposal.description,
      injected_into: proposal.injectedInto,
      prompt_module: proposal.promptModule,
      trigger_when: proposal.triggerWhen,
      trigger_description: proposal.triggerDescription,
      gotchas: proposal.gotchas,
      good_examples: proposal.goodExamples,
      bad_examples: [],
      source_refs: proposal.sourceRefs,
      confidence: proposal.confidence,
      performance_notes: proposal.performanceNotes,
      tags: proposal.tags,
      is_system: false,
      is_active: false,
      last_reviewed_at: null,
    }

    const { data: existing, error: lookupError } = await supabase
      .from('skills')
      .select('id, is_active')
      .eq('project_id', activeProject.id)
      .eq('name', proposal.name)
      .maybeSingle()

    if (lookupError) {
      setSavingSkillKey(null)
      setSkillMessage({ tone: 'danger', text: lookupError.message })
      return
    }

    const result = existing?.id
      ? await supabase
          .from('skills')
          .update({ ...payload, is_active: Boolean(existing.is_active) })
          .eq('id', existing.id)
          .select('id')
          .single()
      : await supabase
          .from('skills')
          .insert(payload)
          .select('id')
          .single()

    setSavingSkillKey(null)
    if (result.error) {
      setSkillMessage({ tone: 'danger', text: result.error.message })
      return
    }
    setSkillMessage({
      tone: 'success',
      text: existing?.id
        ? 'Updated the existing client skill proposal. Active status was preserved.'
        : 'Saved an inactive client skill proposal. Review it in AI Settings before enabling.',
    })
  }

  function openSkillSettings() {
    navigate('/skills?view=skills&scope=client&q=learning-proposal')
  }

  async function queueHandoffCandidate(candidate: HandoffCandidate) {
    if (!activeProject?.id || !activeProject.org_id) return
    const existing = handoffActionByPost.get(candidate.id)
    if (existing) {
      push({ kind: 'info', title: 'Already tracked', body: 'This signal is already in the SAM handoff queue.' })
      return
    }
    const busyKey = `queue:${candidate.id}`
    setHandoffBusyKey(busyKey)
    const { data, error: insertError } = await supabase
      .from('sam_handoff_actions')
      .insert({
        org_id: activeProject.org_id,
        project_id: activeProject.id,
        post_id: candidate.id,
        title: candidate.title,
        channel: candidate.channel,
        score: candidate.score,
        triggers: candidate.triggers,
        status: 'queued',
        priority: handoffPriorityFromScore(candidate.score, candidate.triggers),
        created_by: user?.id ?? null,
        payload: {
          source: 'learning_loop',
          prompt: candidate.prompt,
          candidate,
        },
      })
      .select(HANDOFF_SELECT)
      .single()
    setHandoffBusyKey(null)
    if (insertError) {
      if (insertError.code === '23505') {
        push({ kind: 'warn', title: 'Already queued', body: 'This post already has a SAM handoff action.' })
        void load()
        return
      }
      push({ kind: 'danger', title: 'Queue failed', body: insertError.message })
      return
    }
    setHandoffActions(prev => [data as SamHandoffAction, ...prev])
    push({ kind: 'success', title: 'SAM handoff queued', body: 'The signal is now tracked for this client.' })
  }

  async function updateHandoffAction(id: string, patch: Partial<SamHandoffAction>, toast: { title: string; body: string }) {
    const busyKey = `action:${id}`
    setHandoffBusyKey(busyKey)
    const { data, error: updateError } = await supabase
      .from('sam_handoff_actions')
      .update(patch)
      .eq('id', id)
      .select(HANDOFF_SELECT)
      .single()
    setHandoffBusyKey(null)
    if (updateError) {
      push({ kind: 'danger', title: 'Handoff update failed', body: updateError.message })
      return null
    }
    setHandoffActions(prev => prev.map(action => action.id === id ? data as SamHandoffAction : action))
    push({ kind: 'success', title: toast.title, body: toast.body })
    return data as SamHandoffAction
  }

  async function assignHandoff(action: SamHandoffAction) {
    if (!user?.id) {
      push({ kind: 'warn', title: 'Sign in required', body: 'Sign in again before assigning handoffs.' })
      return
    }
    const now = new Date().toISOString()
    await updateHandoffAction(action.id, {
      assigned_to: user.id,
      assigned_at: action.assigned_at ?? now,
      status: action.status === 'queued' ? 'in_progress' : action.status,
    }, { title: 'Assigned', body: 'This SAM handoff is assigned to you.' })
  }

  async function handToSam(action: SamHandoffAction) {
    const prompt = buildSamHandoffText(action)
    try { await navigator.clipboard.writeText(prompt) } catch { /* clipboard can be blocked */ }
    const now = new Date().toISOString()
    await updateHandoffAction(action.id, {
      handed_to_sam_at: action.handed_to_sam_at ?? now,
      actioned_at: action.actioned_at ?? now,
      assigned_to: action.assigned_to ?? user?.id ?? null,
      assigned_at: action.assigned_at ?? (user?.id ? now : null),
      status: action.status === 'queued' ? 'in_progress' : action.status,
    }, { title: 'SAM brief copied', body: 'The handoff brief is ready to paste into SAM.' })
  }

  async function completeHandoff(action: SamHandoffAction) {
    const now = new Date().toISOString()
    await updateHandoffAction(action.id, {
      status: 'done',
      completed_at: action.completed_at ?? now,
      actioned_at: action.actioned_at ?? now,
    }, { title: 'Handoff completed', body: 'The SAM handoff is marked complete.' })
  }

  async function dismissHandoff(action: SamHandoffAction) {
    const now = new Date().toISOString()
    await updateHandoffAction(action.id, {
      status: 'dismissed',
      dismissed_at: action.dismissed_at ?? now,
    }, { title: 'Handoff dismissed', body: 'The signal is no longer active in the queue.' })
  }

  async function reopenHandoff(action: SamHandoffAction) {
    await updateHandoffAction(action.id, {
      status: 'queued',
      dismissed_at: null,
      completed_at: null,
    }, { title: 'Handoff reopened', body: 'The signal is back in the active queue.' })
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
            <span style={{ color: color.ghost, fontSize: t.size.cap }}>
              {activeHandoffActions.length} active · {untrackedHandoffCandidates.length} new signal{untrackedHandoffCandidates.length === 1 ? '' : 's'}
            </span>
          </div>
          {activeHandoffActions.length ? (
            <div style={{ display: 'grid', gap: space[3], marginBottom: untrackedHandoffCandidates.length ? space[5] : 0 }}>
              {activeHandoffActions.map(action => (
                <SamHandoffActionCard
                  key={action.id}
                  action={action}
                  busy={handoffBusyKey === `action:${action.id}`}
                  currentUserId={user?.id ?? null}
                  onAssign={() => void assignHandoff(action)}
                  onCopy={() => void handToSam(action)}
                  onComplete={() => void completeHandoff(action)}
                  onDismiss={() => void dismissHandoff(action)}
                  onReopen={() => void reopenHandoff(action)}
                />
              ))}
            </div>
          ) : (
            <LearningState>No active SAM handoffs yet. Queue a detected signal when VERA sees comments, shares, clicks, traffic, buyer questions, or meeting requests worth sales follow-up.</LearningState>
          )}

          {untrackedHandoffCandidates.length > 0 && (
            <div style={{ marginTop: activeHandoffActions.length ? 0 : space[4] }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3], marginBottom: space[3], flexWrap: 'wrap' }}>
                <span style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Detected signals</span>
                <span style={{ color: color.ghost, fontSize: t.size.cap }}>Queue the ones SAM should research</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[3] }}>
                {untrackedHandoffCandidates.map(candidate => (
                  <HandoffCard
                    key={candidate.id}
                    candidate={candidate}
                    onBrief={() => briefInVera(candidate)}
                    onQueue={() => void queueHandoffCandidate(candidate)}
                    queueing={handoffBusyKey === `queue:${candidate.id}`}
                  />
                ))}
              </div>
            </div>
          )}

          {closedHandoffActions.length > 0 && (
            <div style={{ marginTop: space[5], paddingTop: space[4], borderTop: `1px solid ${color.line}` }}>
              <div style={{ color: color.ghost, fontSize: t.size.cap, fontWeight: t.weight.medium, marginBottom: space[3] }}>Recent closed handoffs</div>
              <div style={{ display: 'grid', gap: space[2] }}>
                {closedHandoffActions.map(action => (
                  <SamHandoffActionCard
                    key={action.id}
                    action={action}
                    busy={handoffBusyKey === `action:${action.id}`}
                    currentUserId={user?.id ?? null}
                    compact
                    onAssign={() => void assignHandoff(action)}
                    onCopy={() => void handToSam(action)}
                    onComplete={() => void completeHandoff(action)}
                    onDismiss={() => void dismissHandoff(action)}
                    onReopen={() => void reopenHandoff(action)}
                  />
                ))}
              </div>
            </div>
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

      <section style={{ marginBottom: space[8] }}>
        <Panel>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3], marginBottom: space[4], flexWrap: 'wrap' }}>
            <SectionLabel>Reusable skill proposals</SectionLabel>
            <button onClick={openSkillSettings} style={{ border: 0, background: 'transparent', padding: 0, color: color.accent, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer' }}>
              Review in AI Settings
            </button>
          </div>
          <p style={{ margin: `0 0 ${space[4]}`, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
            These are inactive client skills generated from measured evidence. Save them as proposals, inspect the recipe, then enable the ones VERA should use.
          </p>
          {skillMessage && (
            <div style={{ marginBottom: space[4], padding: space[3], border: `1px solid ${skillMessage.tone === 'success' ? color.success : color.danger}`, borderRadius: radius.md, color: skillMessage.tone === 'success' ? color.success : color.danger, background: color.paper2, fontSize: t.size.cap }}>
              {skillMessage.text}
            </div>
          )}
          {skillProposals.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: space[3] }}>
              {skillProposals.map(proposal => (
                <SkillProposalCard
                  key={proposal.key}
                  proposal={proposal}
                  saving={savingSkillKey === proposal.key}
                  onSave={() => void saveSkillProposal(proposal)}
                />
              ))}
            </div>
          ) : (
            <LearningState>Learning skills appear once VERA has measured demand assets. Add manual metrics or sync provider metrics to produce evidence-backed proposals.</LearningState>
          )}
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

function HandoffCard({
  candidate,
  onBrief,
  onQueue,
  queueing,
}: {
  candidate: HandoffCandidate
  onBrief: () => void
  onQueue: () => void
  queueing: boolean
}) {
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[2], marginTop: 'auto' }}>
        <button onClick={onBrief} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 10px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surface, color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer' }}>
          <Send size={13} />
          Brief
        </button>
        <button onClick={onQueue} disabled={queueing} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 10px', borderRadius: radius.md, border: `1px solid ${color.accent}`, background: 'var(--accent-tint)', color: color.accent, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: queueing ? 'wait' : 'pointer', opacity: queueing ? 0.68 : 1 }}>
          <UserCheck size={13} />
          {queueing ? 'Queueing' : 'Queue'}
        </button>
      </div>
    </div>
  )
}

function SamHandoffActionCard({
  action,
  busy,
  compact = false,
  currentUserId,
  onAssign,
  onCopy,
  onComplete,
  onDismiss,
  onReopen,
}: {
  action: SamHandoffAction
  busy: boolean
  compact?: boolean
  currentUserId: string | null
  onAssign: () => void
  onCopy: () => void
  onComplete: () => void
  onDismiss: () => void
  onReopen: () => void
}) {
  const isClosed = action.status === 'done' || action.status === 'dismissed'
  const assignedLabel = action.assigned_to
    ? action.assigned_to === currentUserId ? 'Assigned to you' : 'Assigned'
    : 'Unassigned'
  const statusTone = action.status === 'done'
    ? color.success
    : action.status === 'dismissed'
      ? color.ghost
      : action.status === 'in_progress'
        ? color.info
        : color.warn
  const priorityTone = action.priority === 'high' ? color.danger : action.priority === 'medium' ? color.warn : color.ghost
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: space[3], padding: compact ? space[3] : space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{action.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: space[2] }}>
              <Pill tone={statusTone}>{handoffStatusLabel(action.status)}</Pill>
              <Pill tone={priorityTone}>{action.priority} priority</Pill>
              <Pill>{assignedLabel}</Pill>
              {action.channel && <Pill>{action.channel}</Pill>}
              <Pill>{action.score} score</Pill>
            </div>
          </div>
          {!compact && (
            <span style={{ color: color.ghost, fontSize: t.size.micro, whiteSpace: 'nowrap' }}>
              Updated {formatHandoffDate(action.updated_at)}
            </span>
          )}
        </div>
        {!compact && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: space[3] }}>
              {(action.triggers.length ? action.triggers : ['No trigger detail']).map(trigger => (
                <span key={trigger} style={{ padding: '3px 8px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: color.ink2, fontSize: t.size.micro }}>{trigger}</span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginTop: space[3], color: color.ghost, fontSize: t.size.micro }}>
              {action.assigned_at && <span>Assigned {formatHandoffDate(action.assigned_at)}</span>}
              {action.handed_to_sam_at && <span>Copied {formatHandoffDate(action.handed_to_sam_at)}</span>}
              {action.completed_at && <span>Completed {formatHandoffDate(action.completed_at)}</span>}
              {action.dismissed_at && <span>Dismissed {formatHandoffDate(action.dismissed_at)}</span>}
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: compact ? 'center' : 'flex-start', justifyContent: compact ? 'flex-end' : 'flex-start', gap: space[2], flexWrap: 'wrap' }}>
        {isClosed ? (
          <HandoffActionButton icon={RefreshCw} label="Reopen" disabled={busy} onClick={onReopen} />
        ) : (
          <>
            <HandoffActionButton icon={UserCheck} label={action.assigned_to ? 'Reassign' : 'Assign'} disabled={busy} onClick={onAssign} />
            <HandoffActionButton icon={Copy} label="Copy for SAM" disabled={busy} onClick={onCopy} />
            <HandoffActionButton icon={Check} label="Complete" disabled={busy} onClick={onComplete} tone={color.success} />
            <HandoffActionButton icon={X} label="Dismiss" disabled={busy} onClick={onDismiss} tone={color.ghost} />
          </>
        )}
      </div>
    </div>
  )
}

function Pill({ children, tone = color.ghost }: { children: ReactNode; tone?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: tone, fontSize: t.size.micro, fontWeight: t.weight.medium }}>
      {children}
    </span>
  )
}

function HandoffActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  tone = color.ink,
}: {
  icon: ElementType
  label: string
  disabled: boolean
  onClick: () => void
  tone?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 9px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surface, color: tone, fontSize: t.size.micro, fontWeight: t.weight.medium, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.65 : 1 }}
    >
      <Icon size={12} />
      {label}
    </button>
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

function SkillProposalCard({ proposal, saving, onSave }: { proposal: LearningSkillProposal; saving: boolean; onSave: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3] }}>
        <span style={{ width: 30, height: 30, borderRadius: radius.sm, background: color.surface, color: color.accent, border: `1px solid ${color.line}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Zap size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{proposal.name}</div>
          <p style={{ margin: `${space[1]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>{proposal.description}</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ padding: '3px 8px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: color.ghost, fontSize: t.size.micro }}>
          {proposal.confidence}
        </span>
        {proposal.tags.slice(0, 4).map(tag => (
          <span key={tag} style={{ padding: '3px 8px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: color.ghost, fontSize: t.size.micro }}>
            {tag}
          </span>
        ))}
      </div>
      <Button variant="secondary" size="sm" leading={<Zap size={13} />} loading={saving} onClick={onSave}>
        Save proposal
      </Button>
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

function handoffPriorityFromScore(score: number, triggers: string[]): 'low' | 'medium' | 'high' {
  const triggerText = triggers.join(' ').toLowerCase()
  if (score >= 45 || triggerText.includes('meeting request') || triggerText.includes('buyer question')) return 'high'
  if (score >= 20 || triggerText.includes('qualified visit') || triggerText.includes('comment') || triggerText.includes('share')) return 'medium'
  return 'low'
}

function handoffStatusLabel(status: SamHandoffStatus) {
  if (status === 'in_progress') return 'In progress'
  if (status === 'done') return 'Done'
  if (status === 'dismissed') return 'Dismissed'
  return 'Queued'
}

function formatHandoffDate(value: string | null) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function handoffPromptFromPayload(action: SamHandoffAction) {
  if (!isRecord(action.payload)) return null
  const prompt = action.payload.prompt
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null
}

function buildSamHandoffText(action: SamHandoffAction) {
  const existingPrompt = handoffPromptFromPayload(action)
  if (existingPrompt) return existingPrompt
  return [
    'Create a SAM handoff brief for this VERA content signal.',
    '',
    `Asset: ${action.title}`,
    `Channel: ${action.channel || 'Unassigned'}`,
    `Triggers: ${action.triggers.length ? action.triggers.join(', ') : 'No trigger detail'}`,
    `Demand score: ${action.score}`,
    `Priority: ${action.priority}`,
    '',
    'Return:',
    '1. why this signal matters',
    '2. likely buyer pain or intent',
    '3. accounts or people SAM should research',
    '4. outreach angle and objection to prepare for',
    '5. next VERA content experiment',
  ].join('\n')
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

function buildSkillProposals(
  posts: Post[],
  metrics: Map<string, LearningMetric>,
  context: BusinessContext,
  channels: ChannelLearningRow[],
): LearningSkillProposal[] {
  const proposals: LearningSkillProposal[] = []
  const top = buildTopRows(posts, metrics)[0]
  const topMetric = top ? metrics.get(top.id) : null
  const bestChannel = channels
    .filter(channel => channel.measured > 0)
    .sort((a, b) => b.score - a.score)[0]
  const company = context.companyName || 'this client'
  const platform = bestChannel?.label ?? top?.channel ?? 'the strongest measured channel'
  const topTitle = top?.title ?? 'the strongest measured asset'
  const evidenceLine = top && topMetric
    ? `${topTitle} on ${top.channel} scored ${top.score} from ${metricEvidence(topMetric)}.`
    : ''

  if (top && topMetric) {
    proposals.push({
      key: 'repeat-strongest-pattern',
      name: `Learning proposal: repeat ${platform} demand pattern`,
      description: `Use measured evidence from ${company} to repeat the strongest demand asset pattern without copying the same post.`,
      triggerDescription: `Use when drafting or reviewing ${platform} content after VERA identifies a top-performing demand asset.`,
      triggerWhen: {
        source: 'learning-loop',
        platform,
        job: ['draft', 'review', 'variant'],
        metric_signal: ['comments', 'shares', 'clicks', 'qualified_traffic', 'buyer_questions', 'meeting_requests'],
      },
      promptModule: [
        `Purpose: repeat the strongest measured demand pattern for ${company} without reusing the same copy.`,
        ``,
        `Evidence: ${evidenceLine}`,
        ``,
        `Process:`,
        `1. Identify the winning topic, hook, proof type, speaker, CTA, and buyer intent signal.`,
        `2. Keep the brand core and adapt the structure to the selected medium.`,
        `3. Create a fresh variation for the next ICP or buying situation.`,
        `4. Preserve claims discipline. Do not invent metrics, client names, or proof.`,
        `5. Define which metric should prove the pattern is worth scaling next.`,
        ``,
        `Output: draft, approval route, measurement target, and SAM handoff condition.`,
      ].join('\n'),
      gotchas: [
        'Do not copy the old post structure so closely that the channel looks repetitive.',
        'Do not optimize only for views if buyer questions or meeting requests are available.',
        'Do not use a named-person voice unless the speaker evidence supports it.',
      ],
      goodExamples: [{ label: 'Evidence', text: evidenceLine || topTitle }],
      sourceRefs: [{ label: 'Learning Loop', text: `Top asset: ${topTitle}` }],
      tags: ['learning-proposal', 'demand-pattern', platform.toLowerCase().replace(/\s+/g, '-')],
      confidence: top.score >= 30 ? 'high' : 'medium',
      performanceNotes: evidenceLine,
      injectedInto: 'writer',
    })
  }

  const totals = Array.from(metrics.values()).reduce((acc, metric) => ({
    qualifiedTraffic: acc.qualifiedTraffic + metric.qualifiedTraffic,
    buyerQuestions: acc.buyerQuestions + metric.buyerQuestions,
    meetingRequests: acc.meetingRequests + metric.meetingRequests,
  }), { qualifiedTraffic: 0, buyerQuestions: 0, meetingRequests: 0 })

  if (totals.buyerQuestions > 0 || totals.meetingRequests > 0) {
    proposals.push({
      key: 'buyer-intent-loop',
      name: 'Learning proposal: buyer intent response loop',
      description: `Turn buyer questions and meeting requests for ${company} into follow-up content and SAM research tasks.`,
      triggerDescription: 'Use when a content asset produces buyer questions, meeting intent, objections, or high-value comments.',
      triggerWhen: {
        source: 'learning-loop',
        job: ['sam-handoff', 'follow-up-content', 'reply-planning'],
        metric_signal: ['buyer_questions', 'meeting_requests', 'comments'],
      },
      promptModule: [
        `Purpose: convert buyer intent from content into the next VERA and SAM actions.`,
        ``,
        `Evidence: ${totals.buyerQuestions} buyer question${totals.buyerQuestions === 1 ? '' : 's'} and ${totals.meetingRequests} meeting request${totals.meetingRequests === 1 ? '' : 's'} are visible in the current learning window.`,
        ``,
        `Process:`,
        `1. Classify each question or meeting signal by pain, urgency, persona, and buying stage.`,
        `2. Recommend the reply, the next content asset, and the SAM research angle.`,
        `3. Identify the account or person fields SAM should enrich before outreach.`,
        `4. Keep the content useful. Do not turn every signal into a hard sales CTA.`,
        ``,
        `Output: buyer intent summary, reply angle, next asset brief, SAM handoff brief, and measurement target.`,
      ].join('\n'),
      gotchas: [
        'Do not treat low-context reactions as buyer intent.',
        'Do not publish a sales-heavy follow-up if the signal is only educational.',
        'Do not hand off to SAM without a clear research question or account trigger.',
      ],
      goodExamples: [{ label: 'Intent', text: `${totals.buyerQuestions} buyer questions, ${totals.meetingRequests} meeting requests.` }],
      sourceRefs: [{ label: 'Learning Loop', text: 'Buyer intent summary metrics.' }],
      tags: ['learning-proposal', 'buyer-intent', 'sam-handoff'],
      confidence: totals.meetingRequests > 0 ? 'high' : 'medium',
      performanceNotes: `${totals.buyerQuestions} buyer questions, ${totals.meetingRequests} meeting requests, ${totals.qualifiedTraffic} qualified visits.`,
      injectedInto: 'strategist',
    })
  } else if (totals.qualifiedTraffic > 0) {
    proposals.push({
      key: 'qualified-traffic-cta',
      name: 'Learning proposal: qualified traffic CTA test',
      description: `Use qualified traffic for ${company} to test a sharper CTA before scaling the same topic.`,
      triggerDescription: 'Use when content produces qualified visits but no buyer questions or meeting requests yet.',
      triggerWhen: {
        source: 'learning-loop',
        job: ['cta-test', 'conversion-brief'],
        metric_signal: ['qualified_traffic'],
      },
      promptModule: [
        `Purpose: turn qualified visits into buyer questions or meeting requests.`,
        ``,
        `Evidence: ${totals.qualifiedTraffic} qualified visit${totals.qualifiedTraffic === 1 ? '' : 's'} with no buyer question or meeting request yet.`,
        ``,
        `Process:`,
        `1. Keep the winning topic, but change the CTA and proof path.`,
        `2. Offer a next step that fits top-of-funnel intent.`,
        `3. Add one question that invites a real buyer objection or use case.`,
        `4. Measure buyer questions and meeting requests before increasing output volume.`,
      ].join('\n'),
      gotchas: [
        'Do not mistake traffic for commercial intent.',
        'Do not increase volume before testing a conversion path.',
      ],
      goodExamples: [{ label: 'Traffic', text: `${totals.qualifiedTraffic} qualified visits need a sharper conversion proof point.` }],
      sourceRefs: [{ label: 'Learning Loop', text: 'Qualified traffic without buyer intent.' }],
      tags: ['learning-proposal', 'qualified-traffic', 'cta-test'],
      confidence: 'medium',
      performanceNotes: `${totals.qualifiedTraffic} qualified visits without buyer questions or meeting requests.`,
      injectedInto: 'strategist',
    })
  }

  return proposals.slice(0, 3)
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
