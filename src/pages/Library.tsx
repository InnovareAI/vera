import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Star, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import type { Post, Campaign, Audience } from '../lib/supabase'
import { PlatformChip, StatusChip, Chip } from '../components/Chip'

export default function Library() {
  const [posts, setPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selected, setSelected] = useState<Post | null>(null)
  const [copied, setCopied] = useState(false)
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()

  const platforms = ['All', 'LinkedIn', 'Twitter', 'Instagram', 'Quora', 'Facebook']
  const statuses = ['All', 'Published', 'Approved', 'Scheduled', 'Pending Review', 'Draft', 'Rejected']

  useEffect(() => {
    if (!activeOrg?.id) { setPosts([]); setLoading(false); return }
    setLoading(true)
    let q = supabase.from('content_posts').select('*').order('created_at', { ascending: false }).limit(200)
      .eq('org_id', activeOrg.id)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ data }) => { setPosts(data || []); setLoading(false) })
  }, [activeOrg?.id, activeProject?.id])

  useEffect(() => {
    if (!activeOrg?.id) { setCampaigns([]); setAudiences([]); return }
    const orgId = activeOrg.id
    let campQ = supabase.from('campaigns')
      .select('id, name, theme, status, is_pinned, post_count, color, start_date, end_date, description, project_id')
      .eq('org_id', orgId)
      .order('is_pinned', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })
    if (activeProject?.id) campQ = campQ.eq('project_id', activeProject.id)
    campQ.then(({ data }) => setCampaigns((data as Campaign[]) ?? []))
    // Audiences stay workspace-scoped — they're org-level constants
    // (ICPs + buyer personas), not project-specific.
    supabase.from('audiences')
      .select('*')
      .eq('org_id', orgId)
      .order('is_primary', { ascending: false })
      .order('kind', { ascending: true })
      .then(({ data }) => setAudiences((data as Audience[]) ?? []))
  }, [activeOrg?.id, activeProject?.id])

  const postCountByCampaign = posts.reduce((acc, p) => {
    if (p.campaign_id) acc[p.campaign_id] = (acc[p.campaign_id] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const filtered = posts.filter(p => {
    const matchSearch = !search || (p.title || '').toLowerCase().includes(search.toLowerCase()) || p.copy.toLowerCase().includes(search.toLowerCase())
    const matchPlatform = platformFilter === 'All' || p.channel?.toLowerCase() === platformFilter.toLowerCase()
    const matchStatus = statusFilter === 'All' || p.status === statusFilter
    return matchSearch && matchPlatform && matchStatus
  })

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Right rail — search + filter summary + counts. Quick-jump to active
  // campaigns and audiences from here so the canvas can focus on posts.
  const primaryAudience = audiences.find(a => a.is_primary && a.kind === 'buyer_persona')
    ?? audiences.find(a => a.is_primary) ?? audiences[0]
  const activeCampaign = campaigns.find(c => c.is_pinned && c.status === 'active')
    ?? campaigns.find(c => c.status === 'active') ?? campaigns[0]

  useRightRail(
    <LibraryRightRail
      total={posts.length}
      filtered={filtered.length}
      campaignsCount={campaigns.length}
      audiencesCount={audiences.length}
      activeFilters={[
        search ? `"${search}"` : null,
        platformFilter !== 'All' ? platformFilter : null,
        statusFilter !== 'All' ? statusFilter : null,
      ].filter(Boolean) as string[]}
      primaryAudience={primaryAudience ?? null}
      activeCampaign={activeCampaign ?? null}
    />,
    [posts.length, filtered.length, campaigns.length, audiences.length, search, platformFilter, statusFilter, primaryAudience?.id, activeCampaign?.id],
  )

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight tracking-tight font-semibold" style={{ color: 'var(--ink)' }}>Library</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ghost)' }}>
            {audiences.length} audiences · {campaigns.length} campaigns · {posts.length} posts
          </p>
        </div>

        {/* Audiences section — ICPs and Buyer Personas */}
        {audiences.length > 0 && (
          <div className="mb-6">
            <div className="px-1 pb-2 flex items-baseline gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ghost)' }}>
                Audiences
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {audiences.map(a => {
                const parent = a.parent_id ? audiences.find(x => x.id === a.parent_id) : null
                const kindLabel = a.kind === 'icp' ? 'ICP' : a.kind === 'buyer_persona' ? 'Buyer Persona' : a.kind === 'consumer_persona' ? 'Consumer Persona' : 'Audience'
                return (
                  <div
                    key={a.id}
                    className="p-4 relative"
                    style={{
                      background: 'var(--paper)',
                      border: '1px solid var(--paper-edge)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    {a.is_primary && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[2px]"
                        style={{ background: 'var(--ink)', borderRadius: '0 1px 1px 0' }}
                      />
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <Users size={12} style={{ color: 'var(--ghost)' }} strokeWidth={1.75} />
                      <Chip dotColor={a.kind === 'icp' ? 'var(--ink)' : 'var(--ghost)'}>
                        {kindLabel}
                      </Chip>
                      {a.is_primary && <Star size={11} style={{ color: 'var(--ink)' }} fill="var(--ink)" />}
                    </div>
                    <p className="text-[15px] font-medium leading-snug mb-1" style={{ color: 'var(--ink)' }}>
                      {a.name}
                    </p>
                    {parent && (
                      <p className="text-[12px] mb-2" style={{ color: 'var(--mist)' }}>
                        Inside ICP: {parent.name}
                      </p>
                    )}
                    {Array.isArray(a.pain_points) && a.pain_points.length > 0 && (
                      <p className="text-[13px] line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>
                        {(a.pain_points as string[]).slice(0, 2).join(' · ')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Campaigns section — folders for monthly groupings */}
        {campaigns.length > 0 && (
          <div className="mb-6">
            <div className="px-1 pb-2 flex items-baseline gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ghost)' }}>
                Campaigns
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {campaigns.map(c => {
                const count = postCountByCampaign[c.id] ?? c.post_count ?? 0
                const dateRange = c.start_date && c.end_date
                  ? `${new Date(c.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → ${new Date(c.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                  : null
                return (
                  <Link
                    key={c.id}
                    to={`/review?campaign=${c.id}`}
                    className="block p-4 transition-all hover:shadow-sm relative"
                    style={{
                      background: 'var(--paper)',
                      border: '1px solid var(--paper-edge)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {c.is_pinned && <Star size={12} style={{ color: 'var(--ink)' }} fill="var(--ink)" />}
                      <StatusChip status={c.status} />
                      {dateRange && (
                        <span className="text-[12px] ml-auto" style={{ color: 'var(--mist)' }}>{dateRange}</span>
                      )}
                    </div>
                    <p className="text-[15px] font-medium leading-snug mb-1" style={{ color: 'var(--ink)' }}>
                      {c.name}
                    </p>
                    {c.theme && (
                      <p className="text-[13px] line-clamp-2 mb-2" style={{ color: 'var(--ink-quiet)' }}>
                        {c.theme}
                      </p>
                    )}
                    <p className="text-[12px]" style={{ color: 'var(--ghost)' }}>
                      {count} {count === 1 ? 'post' : 'posts'}
                    </p>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Posts section header */}
        <div className="px-1 pb-2 flex items-baseline gap-2">
          <span className="text-[12px] font-medium" style={{ color: 'var(--ghost)' }}>
            All posts
          </span>
        </div>

        <div className="flex gap-3 mb-4 flex-wrap">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search posts…"
            className="flex-1 min-w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400">
            {platforms.map(p => <option key={p}>{p}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400">
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <p className="text-xs text-gray-400 mb-3">{filtered.length} post{filtered.length !== 1 ? 's' : ''}</p>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading library…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <span className="text-4xl mb-3">📚</span>
            <p className="text-sm">No posts found</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-2">
            {filtered.map(post => (
              <div
                key={post.id}
                onClick={() => setSelected(post)}
                className="cursor-pointer p-4 transition-all"
                style={{
                  background: 'var(--paper-warm)',
                  border: `1px solid ${selected?.id === post.id ? 'var(--ink)' : 'var(--paper-edge)'}`,
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <PlatformChip channel={post.channel} />
                  <StatusChip status={post.status} />
                  {post.scheduled_at && (
                    <span className="text-[12px] ml-auto" style={{ color: 'var(--mist)' }}>{new Date(post.scheduled_at).toLocaleDateString()}</span>
                  )}
                </div>
                <p className="text-[14px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>{post.title || 'Untitled'}</p>
                <p className="text-[13px] mt-1 line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>{post.copy}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-80 flex-shrink-0">
        {selected ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">Post Detail</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              <PlatformChip channel={selected.channel} />
              <StatusChip status={selected.status} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">{selected.title || 'Untitled'}</h3>
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-3">
              {selected.copy}
            </div>
            {selected.hashtags && selected.hashtags.length > 0 && (
              <p className="text-xs text-blue-500 mb-3">{selected.hashtags.join(' ')}</p>
            )}
            {selected.model_used && (
              <p className="text-xs text-gray-400 mb-3">Model: {selected.model_used}</p>
            )}
            <button onClick={() => copyToClipboard(selected.copy)}
              className="w-full py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center justify-center text-center h-48">
            <span className="text-3xl mb-2">📖</span>
            <p className="text-xs text-gray-400">Select a post to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Library right rail ────────────────────────────────────────────────
// Search + filter summary, with counts and quick-pivots to the active
// campaign + primary audience. Canvas keeps the post browser; the rail
// is reference info.
function LibraryRightRail({
  total, filtered, campaignsCount, audiencesCount, activeFilters,
  primaryAudience, activeCampaign,
}: {
  total: number
  filtered: number
  campaignsCount: number
  audiencesCount: number
  activeFilters: string[]
  primaryAudience: Audience | null
  activeCampaign: Campaign | null
}) {
  return (
    <div className="flex flex-col gap-6 py-6 pr-5 pl-1">
      <section>
        <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
          Library
        </p>
        <div className="text-[12px] flex flex-col gap-1.5" style={{ color: 'var(--ink-quiet)' }}>
          <div className="flex justify-between">
            <span>Showing</span>
            <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {filtered}
              {filtered !== total && <span style={{ color: 'var(--ghost)', fontWeight: 400 }}> of {total}</span>}
            </b>
          </div>
          <div className="flex justify-between">
            <span>Campaigns</span>
            <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{campaignsCount}</b>
          </div>
          <div className="flex justify-between">
            <span>Audiences</span>
            <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{audiencesCount}</b>
          </div>
        </div>
      </section>

      {activeFilters.length > 0 && (
        <section>
          <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
            Active filters
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map(f => (
              <span
                key={f}
                className="inline-flex items-center text-[11px] px-2 py-0.5"
                style={{ background: 'var(--fog)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-sm)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </section>
      )}

      {activeCampaign && (
        <section>
          <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
            Active campaign
          </p>
          <Link
            to={`/review?campaign=${activeCampaign.id}`}
            className="block text-[12.5px] hover:opacity-80 transition-opacity"
            style={{ color: 'var(--ink-quiet)' }}
          >
            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>
              {activeCampaign.is_pinned && '★ '}{activeCampaign.name}
            </div>
            {activeCampaign.theme && (
              <div className="text-[11.5px] mt-1 line-clamp-2" style={{ color: 'var(--ghost)' }}>
                {activeCampaign.theme}
              </div>
            )}
          </Link>
        </section>
      )}

      {primaryAudience && (
        <section>
          <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
            Primary audience
          </p>
          <div className="text-[12.5px]" style={{ color: 'var(--ink-quiet)' }}>
            <div style={{ color: 'var(--ink)', fontWeight: 500 }}>★ {primaryAudience.name}</div>
            {Array.isArray(primaryAudience.pain_points) && primaryAudience.pain_points.length > 0 && (
              <div className="text-[11.5px] mt-1" style={{ color: 'var(--ghost)' }}>
                Pain · {(primaryAudience.pain_points as string[])[0]}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
