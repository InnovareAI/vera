// Dashboard — refactored onto the design system primitives.
//
// Answers ONE question: "What needs my attention right now?"
//
// Page structure (top → bottom):
//   1. VERA wants to — open agent_observations (agentic surface)
//   2. EmptyState — when nothing's loaded for a fresh workspace
//   3. Client surface — latest audit card with re-run CTA
//   4. Awaiting your review — pending posts list
//
// Right rail: Suggested next + This week stats (see useRightRail call).

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, RotateCw, Sparkles, Telescope } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { StatusChip } from '../components/Chip'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useRightRail } from '../lib/rightRailContext'
import {
  Button,
  SectionLabel,
  EmptyState,
  color,
  space,
  type as t,
  radius,
} from '../design'

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

interface LinkedInAuditSummary {
  org_id: string
  org_name: string
  profile_score: number | null
  profile_grade: string | null
  brew_score: number | null
  brew_grade: string | null
  last_run: string | null
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { activeProject } = useProject()
  const { activeOrg } = useOrg()
  const [pendingPosts, setPendingPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [audit, setAudit] = useState<LinkedInAuditSummary | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [observations, setObservations] = useState<Observation[]>([])
  const [actingId, setActingId] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    if (!activeOrg?.id) { setAudit(null); return }
    const { data: latest } = await supabase
      .from('linkedin_audits')
      .select('org_id, kind, result, created_at')
      .eq('org_id', activeOrg.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (!latest?.length) { setAudit(null); return }
    const profile = latest.find(r => r.kind === 'profile')
    const brew    = latest.find(r => r.kind === 'brew360')
    const lastRun = [profile?.created_at, brew?.created_at].filter(Boolean).sort().reverse()[0] as string | undefined
    setAudit({
      org_id: activeOrg.id,
      org_name: activeOrg.name,
      profile_score: (profile?.result as { score?: number } | undefined)?.score ?? null,
      profile_grade: (profile?.result as { grade?: string } | undefined)?.grade ?? null,
      brew_score:    (brew?.result    as { audit?: { overall_score?: number } } | undefined)?.audit?.overall_score ?? null,
      brew_grade:    (brew?.result    as { audit?: { grade?: string }         } | undefined)?.audit?.grade ?? null,
      last_run: lastRun ?? null,
    })
  }, [activeOrg?.id, activeOrg?.name])

  async function reRunAudits() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const { error } = await supabase.rpc('refresh_all_linkedin_audits')
      if (error) throw new Error(error.message)
      await new Promise(r => setTimeout(r, 30_000))
      await loadAudit()
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('content_posts')
        .select('*')
        .in('status', ['Draft', 'Pending Review'])
        .order('created_at', { ascending: false })
        .limit(6)
      if (activeOrg?.id)     q = q.eq('org_id', activeOrg.id)
      if (activeProject?.id) q = q.eq('project_id', activeProject.id)
      const { data: pendingRes } = await q
      setPendingPosts(pendingRes || [])
      setLoading(false)
      await loadAudit()
    }
    load()
  }, [loadAudit, activeOrg?.id, activeProject?.id])

  const loadObservations = useCallback(async () => {
    if (!activeOrg?.id) { setObservations([]); return }
    let q = supabase
      .from('agent_observations')
      .select('id, org_id, project_id, kind, severity, title, detail, proposed_action, action_kind, action_payload, status, created_at')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(8)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    const { data } = await q
    const sevOrder = { high: 0, medium: 1, low: 2 } as const
    const sorted = ((data as Observation[]) ?? []).sort(
      (a, b) => sevOrder[a.severity] - sevOrder[b.severity],
    )
    setObservations(sorted)
  }, [activeOrg?.id, activeProject?.id])
  useEffect(() => { loadObservations() }, [loadObservations])

  async function actOn(obs: Observation) {
    setActingId(obs.id)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      await fetch(`${supabaseUrl}/functions/v1/vera-act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ observation_id: obs.id }),
      }).catch(() => {})

      if (obs.action_kind === 'prompt_knowledge_input') {
        const slug = activeProject?.slug
        navigate(slug ? `/p/${slug}/knowledge` : '/knowledge')
        return
      }
      if (obs.action_kind === 'run_audit' && obs.org_id) {
        navigate(`/linkedin-score/${obs.org_id}`)
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

  useRightRail(
    <DashboardRightRail
      auditOrgId={audit?.org_id}
      profileScore={audit?.profile_score}
      brewScore={audit?.brew_score}
      pendingCount={pendingPosts.length}
    />,
    [audit?.org_id, audit?.profile_score, audit?.brew_score, pendingPosts.length],
  )

  const isEmpty = !loading && !audit && pendingPosts.length === 0 && observations.length === 0

  return (
    <div style={{ padding: space[8], maxWidth: 980 }}>

      {/* ─── VERA wants to — agentic surface ─────────────────────── */}
      {observations.length > 0 && (
        <section style={{ marginBottom: space[10] }}>
          <SectionLabel tone="accent" count={observations.length} style={{ marginBottom: space[5] }}>
            VERA wants to
          </SectionLabel>
          <div style={{ borderTop: `1px solid ${color.line}` }}>
            {observations.map(obs => (
              <div
                key={obs.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: space[5],
                  padding: `${space[5]} 0`,
                  borderBottom: `1px solid ${color.line}`,
                }}
              >
                <span
                  style={{
                    marginTop: 7,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background:
                      obs.severity === 'high'   ? color.accent :
                      obs.severity === 'medium' ? color.accentInk :
                      color.faint,
                    flexShrink: 0,
                  }}
                  title={`${obs.severity} priority`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: t.size.body,
                    fontWeight: t.weight.medium,
                    color: color.ink,
                    margin: 0,
                    lineHeight: t.lineHeight.snug,
                  }}>
                    {obs.title}
                  </p>
                  {obs.detail && (
                    <p style={{
                      fontSize: t.size.cap,
                      color: color.ink2,
                      margin: 0,
                      marginTop: space[2],
                      lineHeight: t.lineHeight.normal,
                    }}>
                      {obs.detail}
                    </p>
                  )}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[3],
                    marginTop: space[4],
                    flexWrap: 'wrap',
                  }}>
                    {obs.proposed_action && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => actOn(obs)}
                        loading={actingId === obs.id}
                        leading={<Sparkles size={11} strokeWidth={2} />}
                      >
                        {obs.proposed_action}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => dismiss(obs)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Empty workspace state ──────────────────────────────── */}
      {isEmpty && activeOrg && (
        <EmptyState
          icon={<Telescope size={22} strokeWidth={1.5} />}
          title={`Welcome to VERA · ${activeOrg.name}`}
          body="Start by auditing your LinkedIn surface — VERA needs to know how the algorithm sees you before drafting content."
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => navigate(`/onboarding/audit/${activeOrg.id}`)}
                trailing={<ArrowRight size={13} strokeWidth={2} />}
              >
                Run first audit
              </Button>
              <Button variant="ghost" onClick={() => navigate('/generate')}>
                Skip — draft a brief
              </Button>
            </>
          }
        />
      )}

      {/* ─── Client surface — audit card ────────────────────────── */}
      {audit && (
        <section style={{ marginBottom: space[10] }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: space[6],
            marginBottom: space[5],
          }}>
            <div>
              <SectionLabel style={{ marginBottom: space[3] }}>Client surface</SectionLabel>
              <p style={{
                fontSize: t.size.h3,
                fontWeight: t.weight.semibold,
                color: color.ink,
                margin: 0,
                lineHeight: t.lineHeight.tight,
                letterSpacing: t.letterSpacing.snug,
              }}>
                {audit.org_name}
              </p>
              <p style={{
                fontSize: t.size.cap,
                color: color.ghost,
                marginTop: space[2],
                marginBottom: 0,
              }}>
                {audit.last_run ? `Audited ${relTime(audit.last_run)}` : 'Not yet audited'}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexShrink: 0 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/linkedin-score/${audit.org_id}`)}
                trailing={<ArrowRight size={13} strokeWidth={1.75} />}
              >
                Detail
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={reRunAudits}
                loading={refreshing}
                leading={<RotateCw size={13} strokeWidth={2} />}
              >
                {refreshing ? 'Re-running…' : 'Re-run'}
              </Button>
            </div>
          </div>
          <div style={{
            display: 'flex',
            gap: space[10],
            padding: `${space[5]} 0`,
            borderTop: `1px solid ${color.line}`,
            borderBottom: `1px solid ${color.line}`,
          }}>
            <ScoreChip label="Profile" score={audit.profile_score} grade={audit.profile_grade} />
            <ScoreChip label="Brew360" score={audit.brew_score} grade={audit.brew_grade} />
          </div>
          {refreshError && (
            <p style={{
              marginTop: space[3],
              fontSize: t.size.cap,
              padding: `${space[2]} ${space[3]}`,
              color: color.danger,
              background: 'rgba(185,28,28,0.06)',
              border: `1px solid rgba(185,28,28,0.18)`,
              borderRadius: radius.sm,
            }}>
              {refreshError}
            </p>
          )}
          {refreshing && (
            <p style={{ marginTop: space[3], fontSize: t.size.cap, color: color.ghost }}>
              Running in the background — new score appears in ~30s.
            </p>
          )}
        </section>
      )}

      {/* ─── Awaiting your review ───────────────────────────────── */}
      {(loading || pendingPosts.length > 0) && (
        <section>
          <SectionLabel
            count={!loading ? pendingPosts.length : undefined}
            action={!loading && pendingPosts.length > 0 ? (
              <button
                onClick={() => navigate('/review')}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.medium,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: t.family.sans,
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
              <div style={{ padding: `${space[4]} 0`, fontSize: t.size.sm, color: color.ghost }}>
                Loading…
              </div>
            ) : pendingPosts.map(post => (
              <button
                key={post.id}
                onClick={() => navigate(`/review/${post.id}`)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[5],
                  padding: `${space[4]} 0`,
                  borderBottom: `1px solid ${color.line}`,
                  textAlign: 'left',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: t.family.sans,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = color.paper2)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1, minWidth: 0, padding: `0 ${space[2]}` }}>
                  <p style={{
                    fontSize: t.size.body,
                    color: color.ink,
                    margin: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {post.title || 'Untitled post'}
                  </p>
                  <p style={{
                    fontSize: t.size.cap,
                    color: color.ghost,
                    margin: 0,
                    marginTop: 2,
                    textTransform: 'lowercase',
                  }}>
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

// ─── ScoreChip — kept inline (dashboard-specific layout) ────────────
function ScoreChip({ label, score, grade }: { label: string; score: number | null; grade: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: space[3] }}>
      <span style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ghost }}>
        {label}
      </span>
      <span style={{
        fontSize: t.size.h2,
        fontWeight: t.weight.semibold,
        lineHeight: 1,
        color: color.ink,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {score ?? '—'}
      </span>
      {grade && (
        <span style={{ fontSize: t.size.lg, fontWeight: t.weight.semibold, color: color.ink2 }}>
          {grade}
        </span>
      )}
    </div>
  )
}

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return `${d}d ago`
}

// ─── Right rail content ─────────────────────────────────────────────
function DashboardRightRail({
  auditOrgId, profileScore, brewScore, pendingCount,
}: {
  auditOrgId: string | undefined
  profileScore: number | null | undefined
  brewScore: number | null | undefined
  pendingCount: number
}) {
  const suggestions: Array<{ id: string; text: React.ReactNode; href?: string }> = []

  if (typeof brewScore === 'number' && brewScore < 70) {
    suggestions.push({
      id: 'brew',
      text: <>Brew360 is at <b style={{ color: color.ink }}>{brewScore}</b> — below 70. <span style={{ color: color.accent }}>Open audit →</span></>,
      href: auditOrgId ? `/linkedin-score/${auditOrgId}` : undefined,
    })
  }
  if (pendingCount > 0) {
    suggestions.push({
      id: 'review',
      text: <><b style={{ color: color.ink }}>{pendingCount}</b> {pendingCount === 1 ? 'post is' : 'posts are'} waiting on you. <span style={{ color: color.accent }}>Open queue →</span></>,
      href: '/review',
    })
  }
  if (typeof profileScore === 'number' && profileScore >= 85) {
    suggestions.push({
      id: 'profile',
      text: <>Profile score <b style={{ color: color.ink }}>{profileScore}</b> · {profileScore >= 90 ? 'A+' : 'A'}. Solid foundation — focus next on Brew360 fixes.</>,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], padding: `${space[6]} ${space[5]} 0 ${space[2]}` }}>
      {suggestions.length > 0 && (
        <section>
          <SectionLabel style={{ marginBottom: space[4] }}>Suggested next</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {suggestions.map((s, i) => (
              <a
                key={s.id}
                href={s.href}
                style={{
                  display: 'block',
                  padding: `${space[4]} 0`,
                  fontSize: t.size.cap,
                  lineHeight: t.lineHeight.relaxed,
                  color: color.ink2,
                  textDecoration: 'none',
                  borderBottom: i < suggestions.length - 1 ? `1px solid ${color.line}` : 'none',
                  cursor: s.href ? 'pointer' : 'default',
                }}
              >
                {s.text}
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionLabel style={{ marginBottom: space[4] }}>This week</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], fontSize: t.size.cap, color: color.ink2 }}>
          {[
            ['Awaiting review', pendingCount],
            ['Profile score',  profileScore ?? '—'],
            ['Brew360 fit',    brewScore ?? '—'],
          ].map(([label, value]) => (
            <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{label}</span>
              <b style={{ color: color.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
