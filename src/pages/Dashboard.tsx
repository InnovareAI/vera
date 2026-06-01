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
import { ArrowRight, Sparkles, FolderOpen } from 'lucide-react'
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
        .in('status', ['Draft', 'Pending Review'])
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

  useRightRail(
    <DashboardRightRail pendingCount={pendingPosts.length} projSlug={projSlug ?? null} />,
    [pendingPosts.length, projSlug],
  )

  const isEmpty = !loading && pendingPosts.length === 0 && observations.length === 0

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
