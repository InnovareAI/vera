// Dashboard — the client's Home (the desk).
//
// Answers ONE question: "What needs my attention right now?"
//   1. VERA wants to — open agent_observations (the agentic surface)
//   2. EmptyState — fresh client with nothing yet
//   3. Awaiting your review — pending posts
//
// No LinkedIn audit anywhere — VERA serves any category (luxury, wellness,
// food, B2B); a LinkedIn-shaped score has no place on a universal Home.

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, CheckCircle2, FolderOpen, Lightbulb, Send, Sparkles, TrendingUp, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { StatusChip } from '../components/Chip'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useRightRail } from '../lib/rightRailContext'
import { Button, SectionLabel, EmptyState, color, space, type as t } from '../design'

interface Observation {
  id: string
  org_id: string
  project_id: string | null
  kind: string
  severity: 'low' | 'medium' | 'high'
  title: string
  detail: string | null
  proposed_action: string | null
  action_kind: string | null
  action_payload: Record<string, unknown> | null
  status: string
  created_at: string
}

interface WeeklyLearningSummary {
  measuredPosts?: number
  comments?: number
  shares?: number
  clicks?: number
  qualifiedTraffic?: number
  buyerQuestions?: number
  meetingRequests?: number
  demandSignals?: number
  buyerIntent?: number
}

interface WeeklyLearningAsset {
  post_id?: string
  title?: string
  channel?: string
  score?: number
  evidence?: string
}

interface WeeklyLearningSkill {
  id?: string
  name?: string
  confidence?: string | null
  created_at?: string
}

interface WeeklyLearningHandoff {
  post_id?: string
  title?: string
  channel?: string
  score?: number
  triggers?: string[]
}

interface WeeklyLearningPayload {
  route?: string
  week_key?: string
  current?: WeeklyLearningSummary
  previous?: WeeklyLearningSummary
  top_assets?: WeeklyLearningAsset[]
  skill_proposals?: WeeklyLearningSkill[]
  sam_handoff_candidates?: WeeklyLearningHandoff[]
  approved_without_slot?: number
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { activeProject } = useProject()
  const { activeOrg } = useOrg()
  const [pendingPosts, setPendingPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [observations, setObservations] = useState<Observation[]>([])
  const [actingId, setActingId] = useState<string | null>(null)

  const projSlug = activeProject?.slug
  const path = (section: string) => projSlug ? `/p/${projSlug}/${section}` : `/${section}`

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('content_posts')
        .select('*')
        .in('status', ['draft', 'pending', 'Draft', 'Pending Review'])
        .order('created_at', { ascending: false })
        .limit(6)
      if (activeOrg?.id)     q = q.eq('org_id', activeOrg.id)
      if (activeProject?.id) q = q.eq('project_id', activeProject.id)
      const { data: pendingRes } = await q
      setPendingPosts(pendingRes || [])
      setLoading(false)
    }
    load()
  }, [activeOrg?.id, activeProject?.id])

  const loadObservations = useCallback(async () => {
    if (!activeOrg?.id) { setObservations([]); return }
    let q = supabase
      .from('agent_observations')
      .select('id, org_id, project_id, kind, severity, title, detail, proposed_action, action_kind, action_payload, status, created_at')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .neq('kind', 'stale_audit')   // LinkedIn audit removed — never surface its proposals
      .order('created_at', { ascending: false })
      .limit(8)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    const { data } = await q
    const sevOrder = { high: 0, medium: 1, low: 2 } as const
    const sorted = ((data as Observation[]) ?? [])
      .filter(o => o.action_kind !== 'run_audit')   // belt-and-suspenders against any audit action
      .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])
    setObservations(sorted)
  }, [activeOrg?.id, activeProject?.id])
  useEffect(() => { loadObservations() }, [loadObservations])

  async function actOn(obs: Observation) {
    if (obs.action_kind === 'review_weekly_learning') {
      navigate(weeklyLearningRoute(obs) ?? path('learning'))
      return
    }

    setActingId(obs.id)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      await fetch(`${supabaseUrl}/functions/v1/vera-act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` },
        body: JSON.stringify({ observation_id: obs.id }),
      }).catch(() => {})

      if (obs.action_kind === 'prompt_knowledge_input') {
        navigate(path('knowledge'))
        return
      }
      if (obs.action_kind === 'draft_from_campaign') {
        navigate(path('vera'))
        return
      }
    } finally {
      setActingId(null)
      loadObservations()
    }
  }

  async function dismiss(obs: Observation) {
    await supabase.from('agent_observations')
      .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
      .eq('id', obs.id)
    loadObservations()
  }

  async function markObservationActioned(obs: Observation) {
    await supabase.from('agent_observations')
      .update({ status: 'actioned', actioned_at: new Date().toISOString(), acted_result: { stage: 'opened_from_dashboard' } })
      .eq('id', obs.id)
    loadObservations()
  }

  function openLearning(obs: Observation) {
    navigate(weeklyLearningRoute(obs) ?? path('learning'))
  }

  function openLearningSkills() {
    navigate('/skills?view=skills&scope=client&q=learning-proposal')
  }

  function briefWeeklyLearning(obs: Observation, mode: 'next-brief' | 'sam-handoff') {
    if (!activeProject?.id) {
      navigate(path('vera'))
      return
    }
    const payload = parseWeeklyLearningPayload(obs.action_payload)
    const prompt = mode === 'sam-handoff'
      ? buildSamHandoffPrompt(activeProject.name, payload, obs.detail)
      : buildNextBriefPrompt(activeProject.name, payload, obs.detail)
    sessionStorage.setItem(`vera-command-prefill:${activeProject.id}`, prompt)
    navigate(path('vera'))
  }

  useRightRail(
    <DashboardRightRail pendingCount={pendingPosts.length} projSlug={projSlug ?? null} />,
    [pendingPosts.length, projSlug],
  )

  const isEmpty = !loading && pendingPosts.length === 0 && observations.length === 0
  const weeklyLearning = observations.filter(obs => obs.kind === 'weekly_learning')
  const otherObservations = observations.filter(obs => obs.kind !== 'weekly_learning')

  return (
    <div style={{ padding: space[8], maxWidth: 980 }}>

      {/* ─── VERA wants to — agentic surface ─────────────────────── */}
      {observations.length > 0 && (
        <section style={{ marginBottom: space[10] }}>
          <SectionLabel tone="accent" count={observations.length} style={{ marginBottom: space[5] }}>
            VERA wants to
          </SectionLabel>

          {weeklyLearning.length > 0 && (
            <div style={{ display: 'grid', gap: space[4], marginBottom: otherObservations.length ? space[6] : 0 }}>
              {weeklyLearning.map(obs => (
                <WeeklyLearningNotice
                  key={obs.id}
                  observation={obs}
                  onOpenLearning={() => openLearning(obs)}
                  onOpenSkills={openLearningSkills}
                  onBrief={() => briefWeeklyLearning(obs, 'next-brief')}
                  onHandoff={() => briefWeeklyLearning(obs, 'sam-handoff')}
                  onMarkReviewed={() => void markObservationActioned(obs)}
                  onDismiss={() => dismiss(obs)}
                />
              ))}
            </div>
          )}

          {otherObservations.length > 0 && (
          <div style={{ borderTop: `1px solid ${color.line}` }}>
            {otherObservations.map(obs => (
              <div
                key={obs.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: space[5],
                  padding: `${space[5]} 0`, borderBottom: `1px solid ${color.line}`,
                }}
              >
                <span
                  style={{
                    marginTop: 7, width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                    background:
                      obs.severity === 'high'   ? color.accent :
                      obs.severity === 'medium' ? color.accentInk :
                      color.faint,
                  }}
                  title={`${obs.severity} priority`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: t.size.body, fontWeight: t.weight.medium, color: color.ink, margin: 0, lineHeight: t.lineHeight.snug }}>
                    {obs.title}
                  </p>
                  {obs.detail && (
                    <p style={{ fontSize: t.size.cap, color: color.ink2, margin: 0, marginTop: space[2], lineHeight: t.lineHeight.normal }}>
                      {obs.detail}
                    </p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4], flexWrap: 'wrap' }}>
                    {obs.proposed_action && (
                      <Button size="sm" variant="primary" onClick={() => actOn(obs)} loading={actingId === obs.id} leading={<Sparkles size={11} strokeWidth={2} />}>
                        {obs.proposed_action}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => dismiss(obs)}>Dismiss</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}
        </section>
      )}

      {/* ─── Empty state — category-neutral, no audit ────────────── */}
      {isEmpty && activeOrg && (
        <EmptyState
          icon={<FolderOpen size={22} strokeWidth={1.5} />}
          title={`${activeProject?.name ?? activeOrg.name} — let's get started`}
          body="Drop this client's brief, brand book, or positioning into Knowledge so VERA can draft in their voice — then brief your first post."
          actions={
            <>
              <Button variant="primary" onClick={() => navigate(path('knowledge'))} trailing={<ArrowRight size={13} strokeWidth={2} />}>
                Add knowledge
              </Button>
              <Button variant="ghost" onClick={() => navigate(path('vera'))}>
                Brief a post
              </Button>
            </>
          }
        />
      )}

      {/* ─── Awaiting your review ───────────────────────────────── */}
      {(loading || pendingPosts.length > 0) && (
        <section>
          <SectionLabel
            count={!loading ? pendingPosts.length : undefined}
            action={!loading && pendingPosts.length > 0 ? (
              <button
                onClick={() => navigate(path('review'))}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.medium,
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: t.family.sans,
                }}
              >
                Open queue <ArrowRight size={11} strokeWidth={1.75} />
              </button>
            ) : undefined}
            style={{ marginBottom: space[4] }}
          >
            Awaiting your review
          </SectionLabel>
          <div style={{ borderTop: `1px solid ${color.line}` }}>
            {loading ? (
              <div style={{ padding: `${space[4]} 0`, fontSize: t.size.sm, color: color.ghost }}>Loading…</div>
            ) : pendingPosts.map(post => (
              <button
                key={post.id}
                onClick={() => navigate(path(`review/${post.id}`))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: space[5],
                  padding: `${space[4]} 0`, borderBottom: `1px solid ${color.line}`,
                  textAlign: 'left', background: 'transparent', cursor: 'pointer', fontFamily: t.family.sans,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = color.paper2)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1, minWidth: 0, padding: `0 ${space[2]}` }}>
                  <p style={{ fontSize: t.size.body, color: color.ink, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {post.title || 'Untitled post'}
                  </p>
                  <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0, marginTop: 2, textTransform: 'lowercase' }}>
                    {post.channel} · {post.format}
                  </p>
                </div>
                <StatusChip status={post.status} />
                <ArrowRight size={13} strokeWidth={1.5} style={{ color: color.faint, marginRight: space[2], flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function WeeklyLearningNotice({
  observation,
  onOpenLearning,
  onOpenSkills,
  onBrief,
  onHandoff,
  onMarkReviewed,
  onDismiss,
}: {
  observation: Observation
  onOpenLearning: () => void
  onOpenSkills: () => void
  onBrief: () => void
  onHandoff: () => void
  onMarkReviewed: () => void
  onDismiss: () => void
}) {
  const payload = parseWeeklyLearningPayload(observation.action_payload)
  const current = payload.current ?? {}
  const previousSignals = payload.previous?.demandSignals ?? 0
  const currentSignals = current.demandSignals ?? 0
  const signalDelta = currentSignals - previousSignals
  const topAssets = (payload.top_assets ?? []).slice(0, 3)
  const skills = payload.skill_proposals ?? []
  const handoffs = payload.sam_handoff_candidates ?? []
  const hasHandoffs = handoffs.length > 0

  return (
    <article style={{ border: `1px solid ${color.line}`, borderRadius: 8, background: color.surface, overflow: 'hidden' }}>
      <div style={{ padding: space[5], borderBottom: `1px solid ${color.line}`, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space[4], alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2], flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: 'var(--accent-tint)', color: color.accent, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
              <TrendingUp size={12} />
              Weekly Learning
            </span>
            {payload.week_key && (
              <span style={{ color: color.ghost, fontSize: t.size.micro }}>{payload.week_key}</span>
            )}
          </div>
          <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, lineHeight: 1.25 }}>
            {observation.title}
          </h2>
          {observation.detail && (
            <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
              {observation.detail}
            </p>
          )}
        </div>
        <button onClick={onMarkReviewed} title="Mark reviewed" style={{ border: `1px solid ${color.line}`, background: color.paper2, color: color.success, width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <CheckCircle2 size={15} />
        </button>
      </div>

      <div style={{ padding: space[5], display: 'grid', gap: space[4] }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(138px, 1fr))', gap: space[3] }}>
          <LearningMiniStat icon={BarChart3} label="Measured" value={current.measuredPosts ?? 0} detail="assets this week" />
          <LearningMiniStat icon={Sparkles} label="Demand signals" value={currentSignals} detail={formatDelta(signalDelta)} />
          <LearningMiniStat icon={Lightbulb} label="Buyer intent" value={current.buyerIntent ?? 0} detail={`${current.buyerQuestions ?? 0} questions, ${current.meetingRequests ?? 0} meetings`} />
          <LearningMiniStat icon={Zap} label="Skill proposals" value={skills.length} detail="need review" />
        </div>

        {(topAssets.length > 0 || hasHandoffs) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: space[4] }}>
            {topAssets.length > 0 && (
              <LearningList title="Top assets" items={topAssets.map(asset => ({
                key: asset.post_id ?? asset.title ?? 'asset',
                title: asset.title ?? 'Untitled asset',
                meta: `${asset.channel ?? 'Unassigned'} · score ${asset.score ?? 0}`,
              }))} />
            )}
            {hasHandoffs && (
              <LearningList title="SAM handoffs" items={handoffs.slice(0, 3).map(item => ({
                key: item.post_id ?? item.title ?? 'handoff',
                title: item.title ?? 'Untitled handoff',
                meta: `${item.channel ?? 'Unassigned'} · ${(item.triggers ?? []).slice(0, 2).join(', ') || `score ${item.score ?? 0}`}`,
              }))} />
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" leading={<TrendingUp size={12} />} onClick={onOpenLearning}>
            Review Learning
          </Button>
          <Button size="sm" variant="secondary" leading={<Zap size={12} />} onClick={onOpenSkills}>
            Review skills
          </Button>
          <Button size="sm" variant="secondary" leading={<Send size={12} />} onClick={onBrief}>
            Brief next move
          </Button>
          <Button size="sm" variant="secondary" leading={<Sparkles size={12} />} disabled={!hasHandoffs} onClick={onHandoff}>
            Queue SAM handoff
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    </article>
  )
}

function LearningMiniStat({ icon: Icon, label, value, detail }: { icon: typeof BarChart3; label: string; value: number; detail: string }) {
  return (
    <div style={{ padding: space[3], border: `1px solid ${color.line}`, borderRadius: 8, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <span style={{ color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.medium }}>{label}</span>
        <Icon size={13} style={{ color: color.accent }} />
      </div>
      <div style={{ color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, marginTop: space[2], lineHeight: 1 }}>{value}</div>
      <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 3 }}>{detail}</div>
    </div>
  )
}

function LearningList({ title, items }: { title: string; items: Array<{ key: string; title: string; meta: string }> }) {
  return (
    <div style={{ border: `1px solid ${color.line}`, borderRadius: 8, background: color.paper2, padding: space[3] }}>
      <div style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold, marginBottom: space[2] }}>{title}</div>
      <div style={{ display: 'grid', gap: space[2] }}>
        {items.map(item => (
          <div key={item.key} style={{ minWidth: 0 }}>
            <div style={{ color: color.ink2, fontSize: t.size.cap, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
            <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 1 }}>{item.meta}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Right rail — pending only, no audit scores ─────────────────────
function DashboardRightRail({ pendingCount, projSlug }: { pendingCount: number; projSlug: string | null }) {
  const reviewHref = projSlug ? `/p/${projSlug}/review` : '/review'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], padding: `${space[6]} ${space[5]} 0 ${space[2]}` }}>
      {pendingCount > 0 && (
        <section>
          <SectionLabel style={{ marginBottom: space[4] }}>Suggested next</SectionLabel>
          <a
            href={reviewHref}
            style={{ display: 'block', padding: `${space[4]} 0`, fontSize: t.size.cap, lineHeight: t.lineHeight.relaxed, color: color.ink2, textDecoration: 'none' }}
          >
            <b style={{ color: color.ink }}>{pendingCount}</b> {pendingCount === 1 ? 'post is' : 'posts are'} waiting on you. <span style={{ color: color.accent }}>Open queue →</span>
          </a>
        </section>
      )}
      <section>
        <SectionLabel style={{ marginBottom: space[4] }}>This week</SectionLabel>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: t.size.cap, color: color.ink2 }}>
          <span>Awaiting review</span>
          <b style={{ color: color.ink, fontVariantNumeric: 'tabular-nums' }}>{pendingCount}</b>
        </div>
      </section>
    </div>
  )
}

function parseWeeklyLearningPayload(value: Record<string, unknown> | null): WeeklyLearningPayload {
  if (!value || typeof value !== 'object') return {}
  return value as WeeklyLearningPayload
}

function weeklyLearningRoute(obs: Observation) {
  const payload = parseWeeklyLearningPayload(obs.action_payload)
  return typeof payload.route === 'string' && payload.route.startsWith('/') ? payload.route : null
}

function formatDelta(value: number) {
  if (value > 0) return `+${value} vs last week`
  if (value < 0) return `${value} vs last week`
  return 'flat vs last week'
}

function buildNextBriefPrompt(projectName: string, payload: WeeklyLearningPayload, detail: string | null) {
  const topAssets = (payload.top_assets ?? [])
    .slice(0, 3)
    .map(asset => `- ${asset.title ?? 'Untitled'} (${asset.channel ?? 'unassigned'}, score ${asset.score ?? 0}): ${asset.evidence ?? 'measured signal'}`)
    .join('\n')
  const skills = (payload.skill_proposals ?? [])
    .slice(0, 5)
    .map(skill => `- ${skill.name ?? 'Learning proposal'} (${skill.confidence ?? 'medium'})`)
    .join('\n')
  return [
    `Use the weekly VERA learning review to brief the next demand move for ${projectName}.`,
    ``,
    detail ? `Weekly summary: ${detail}` : '',
    payload.week_key ? `Week: ${payload.week_key}` : '',
    ``,
    topAssets ? `Top assets:\n${topAssets}` : '',
    skills ? `Pending learning skill proposals:\n${skills}` : '',
    ``,
    `Return:`,
    `1. what changed`,
    `2. the next content brief`,
    `3. the platform mix`,
    `4. the approval route`,
    `5. what VERA should measure next`,
  ].filter(Boolean).join('\n')
}

function buildSamHandoffPrompt(projectName: string, payload: WeeklyLearningPayload, detail: string | null) {
  const handoffs = (payload.sam_handoff_candidates ?? [])
    .slice(0, 6)
    .map(item => `- ${item.title ?? 'Untitled'} (${item.channel ?? 'unassigned'}, score ${item.score ?? 0}): ${(item.triggers ?? []).join(', ')}`)
    .join('\n')
  return [
    `Create SAM handoff actions from the weekly VERA learning review for ${projectName}.`,
    ``,
    detail ? `Weekly summary: ${detail}` : '',
    payload.week_key ? `Week: ${payload.week_key}` : '',
    ``,
    handoffs ? `Handoff candidates:\n${handoffs}` : 'No handoff candidates are listed yet. Explain what signal is missing before SAM should act.',
    ``,
    `Return:`,
    `1. the best handoff candidate`,
    `2. likely buyer pain or intent`,
    `3. accounts or people SAM should research`,
    `4. outreach angle and objection to prepare for`,
    `5. the next VERA content asset to create more of this signal`,
  ].filter(Boolean).join('\n')
}
