import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RotateCw, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post, Campaign } from '../lib/supabase'
import { StatusBadge } from '../components/Layout'

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
  const [pendingPosts, setPendingPosts] = useState<Post[]>([])
  const [recentPosts, setRecentPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [audit, setAudit] = useState<LinkedInAuditSummary | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const loadAudit = useCallback(async () => {
    // Latest audited org (the org_id pulled from the most recent linkedin_audits row).
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
    const { data: org } = await supabase.from('organisations').select('name').eq('id', orgId).maybeSingle()
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
      // SECURITY DEFINER function loops every org with unipile_account_id and
      // fires both audits via pg_net. Same path the weekly cron uses.
      const { error } = await supabase.rpc('refresh_all_linkedin_audits')
      if (error) throw new Error(error.message)
      // The edge functions persist their results asynchronously (pg_net). Poll
      // for a fresh row after a short delay.
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
      const [pendingRes, recentRes, campaignsRes] = await Promise.all([
        supabase.from('content_posts').select('*').in('status', ['Draft', 'Pending Review']).order('created_at', { ascending: false }).limit(5),
        supabase.from('content_posts').select('*').order('updated_at', { ascending: false }).limit(5),
        supabase.from('campaigns').select('*').eq('status', 'active'),
      ])
      setPendingPosts(pendingRes.data || [])
      setRecentPosts(recentRes.data || [])
      setCampaigns(campaignsRes.data || [])
      setLoading(false)
      await loadAudit()
    }
    load()
  }, [loadAudit])

  const stats = [
    { value: loading ? '—' : pendingPosts.length, label: 'Awaiting approval' },
    { value: loading ? '—' : campaigns.length, label: 'Active campaigns' },
    { value: loading ? '—' : recentPosts.length, label: 'Recent posts' },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{dateStr}</p>
        </div>
        <button onClick={() => navigate('/generate')} className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          New content
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {stats.map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {audit && (
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">LinkedIn audit</p>
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{audit.org_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {audit.last_run ? `Last run ${relTime(audit.last_run)}` : 'Not yet run'}
                  {' · Auto-refresh: Sundays 04:00 UTC'}
                </p>
                <div className="flex gap-4 mt-4">
                  <ScoreChip label="Profile" score={audit.profile_score} grade={audit.profile_grade} />
                  <ScoreChip label="Brew360" score={audit.brew_score} grade={audit.brew_grade} />
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={() => navigate(`/linkedin-score/${audit.org_id}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-600 hover:text-violet-700">
                  View detail <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={reRunAudits} disabled={refreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {refreshing
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Re-running…</>
                    : <><RotateCw className="w-3.5 h-3.5" /> Re-run now</>}
                </button>
              </div>
            </div>
            {refreshError && (
              <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{refreshError}</p>
            )}
            {refreshing && (
              <p className="mt-3 text-xs text-gray-500">
                Fired via pg_cron's refresh function. Both audits are running in the background — the new score will appear once they complete (~30 s).
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Pending Approval</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</div>
          ) : pendingPosts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Nothing pending</div>
          ) : pendingPosts.map(post => (
            <div key={post.id} onClick={() => navigate('/review')} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{post.title || 'Untitled Post'}</p>
                <p className="text-xs text-gray-400 mt-0.5">{post.channel} · {post.format}</p>
              </div>
              <StatusBadge status={post.status} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Recent Activity</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</div>
          ) : recentPosts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">No activity yet</div>
          ) : recentPosts.map(post => (
            <div key={post.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{post.title || 'Untitled Post'}</p>
                <p className="text-xs text-gray-400 mt-0.5">{post.channel} · {new Date(post.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <StatusBadge status={post.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ScoreChip({ label, score, grade }: { label: string; score: number | null; grade: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{label}</span>
      <span className="text-2xl font-bold text-gray-900 leading-none">{score ?? '—'}</span>
      {grade && <span className="text-sm font-bold text-violet-600">{grade}</span>}
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
