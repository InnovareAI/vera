// Dashboard answers ONE question: "What needs my attention right now?"
//
// Applied the UX declutter skill (skills.tool.ux_declutter):
//   · Cut the H1 + date subtitle — rail already labels the page "Overview"
//   · Cut the 3-stat grid (Awaiting/Active/Recent) — numbers that don't
//     change meaningfully day-to-day, and the Review nav badge already
//     surfaces "Awaiting"
//   · Cut the "Recent activity" card — pure duplication of the rail's
//     Recent + In-progress sections
//   · Kept the LinkedIn audit card (the actual answer to client health)
//   · Kept the pending-approval list, framed as the work surface

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RotateCw, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { StatusChip } from '../components/Chip'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'

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

  const loadAudit = useCallback(async () => {
    const { data: latest } = await supabase
      .from('linkedin_audits')
      .select('org_id, kind, result, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!latest?.length) { setAudit(null); return }
    const orgId = latest[0].org_id as string
    const forOrg = latest.filter(r => r.org_id === orgId)
    const profile = forOrg.find(r => r.kind === 'profile')
    const brew    = forOrg.find(r => r.kind === 'brew360')
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()
    const lastRun = [profile?.created_at, brew?.created_at].filter(Boolean).sort().reverse()[0] as string | undefined
    setAudit({
      org_id: orgId,
      org_name: (org?.name as string) ?? 'Unknown',
      profile_score: (profile?.result as { score?: number } | undefined)?.score ?? null,
      profile_grade: (profile?.result as { grade?: string } | undefined)?.grade ?? null,
      brew_score:    (brew?.result    as { audit?: { overall_score?: number } } | undefined)?.audit?.overall_score ?? null,
      brew_grade:    (brew?.result    as { audit?: { grade?: string }         } | undefined)?.audit?.grade ?? null,
      last_run: lastRun ?? null,
    })
  }, [])

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
      // Pending list scoped to the active project (and workspace).
      // When no project is active yet (pre-migration), falls back to
      // workspace-level — same behavior as before projects shipped.
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

  return (
    <div className="p-8 max-w-4xl">
      {/* Client surface — the one-glance answer. Big scores, single ink   */}
      {/* CTA (Re-run), one quiet secondary (View detail). No padding-on-   */}
      {/* padding chrome.                                                    */}
      {audit && (
        <section className="mb-10">
          <div className="flex items-start justify-between gap-6 mb-4">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--ghost)' }}>Client surface</p>
              <p className="text-[20px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>{audit.org_name}</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--ghost)' }}>
                {audit.last_run ? `Audited ${relTime(audit.last_run)}` : 'Not yet audited'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => navigate(`/linkedin-score/${audit.org_id}`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium hover:opacity-80"
                style={{ color: 'var(--ink-quiet)' }}
              >
                Detail <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
              <button
                onClick={reRunAudits}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
              >
                {refreshing
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Re-running…</>
                  : <><RotateCw className="w-3.5 h-3.5" strokeWidth={2} /> Re-run</>}
              </button>
            </div>
          </div>
          <div className="flex gap-10 py-5" style={{ borderTop: '1px solid var(--paper-edge)', borderBottom: '1px solid var(--paper-edge)' }}>
            <ScoreChip label="Profile" score={audit.profile_score} grade={audit.profile_grade} />
            <ScoreChip label="Brew360" score={audit.brew_score} grade={audit.brew_grade} />
          </div>
          {refreshError && (
            <p
              className="mt-3 text-[12px] px-3 py-2"
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-tint)',
                border: '1px solid var(--accent-rule)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {refreshError}
            </p>
          )}
          {refreshing && (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--ghost)' }}>
              Running in the background — new score appears in ~30s.
            </p>
          )}
        </section>
      )}

      {/* Pending approval — the work surface. Empty state hides the      */}
      {/* whole section per the skill: don't show "Nothing yet" chrome.    */}
      {(loading || pendingPosts.length > 0) && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--ghost)' }}>
              Awaiting your review
              {!loading && pendingPosts.length > 0 && (
                <span className="ml-1.5 normal-case tracking-normal" style={{ color: 'var(--mist)' }}>{pendingPosts.length}</span>
              )}
            </p>
            {!loading && pendingPosts.length > 0 && (
              <button
                onClick={() => navigate('/review')}
                className="text-[12px] font-medium hover:opacity-80 inline-flex items-center gap-1"
                style={{ color: 'var(--ink-quiet)' }}
              >
                Open queue <ArrowRight className="w-3 h-3" strokeWidth={1.75} />
              </button>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--paper-edge)' }}>
            {loading ? (
              <div className="py-4 text-[13px]" style={{ color: 'var(--ghost)' }}>Loading…</div>
            ) : pendingPosts.map(post => (
              <button
                key={post.id}
                onClick={() => navigate(`/review/${post.id}`)}
                className="w-full flex items-center gap-3 py-3 text-left hover:bg-[var(--fog)] transition-colors"
                style={{ borderBottom: '1px solid var(--paper-edge)' }}
              >
                <div className="flex-1 min-w-0 px-2">
                  <p className="text-[14px] truncate" style={{ color: 'var(--ink)' }}>{post.title || 'Untitled post'}</p>
                  <p className="text-[11.5px] mt-0.5 lowercase" style={{ color: 'var(--ghost)' }}>{post.channel} · {post.format}</p>
                </div>
                <StatusChip status={post.status} />
                <ArrowRight className="w-3.5 h-3.5 mr-2 flex-shrink-0" strokeWidth={1.5} style={{ color: 'var(--mist)' }} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ScoreChip({ label, score, grade }: { label: string; score: number | null; grade: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[12px] font-medium" style={{ color: 'var(--ghost)' }}>{label}</span>
      <span className="text-[26px] font-semibold leading-none" style={{ color: 'var(--ink)' }}>{score ?? '—'}</span>
      {grade && <span className="text-[14px] font-semibold" style={{ color: 'var(--ink-quiet)' }}>{grade}</span>}
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
