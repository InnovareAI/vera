import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Star, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import type { Post, Campaign, Audience } from '../lib/supabase'

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
  quora: 'bg-red-100 text-red-700',
  facebook: 'bg-indigo-100 text-indigo-700',
}

const STATUS_COLORS: Record<string, string> = {
  Published: 'bg-emerald-100 text-emerald-700',
  Approved: 'bg-green-100 text-green-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'Pending Review': 'bg-amber-100 text-amber-700',
  Draft: 'bg-gray-100 text-gray-600',
  Rejected: 'bg-red-100 text-red-600',
}

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

  const platforms = ['All', 'LinkedIn', 'Twitter', 'Instagram', 'Quora', 'Facebook']
  const statuses = ['All', 'Published', 'Approved', 'Scheduled', 'Pending Review', 'Draft', 'Rejected']

  useEffect(() => {
    supabase.from('content_posts').select('*').order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setPosts(data || []); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!activeOrg?.id) { setCampaigns([]); setAudiences([]); return }
    const orgId = activeOrg.id
    supabase.from('campaigns')
      .select('id, name, theme, status, is_pinned, post_count, color, start_date, end_date, description')
      .eq('org_id', orgId)
      .order('is_pinned', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => setCampaigns((data as Campaign[]) ?? []))
    supabase.from('audiences')
      .select('*')
      .eq('org_id', orgId)
      .order('is_primary', { ascending: false })
      .order('kind', { ascending: true })
      .then(({ data }) => setAudiences((data as Audience[]) ?? []))
  }, [activeOrg?.id])

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

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-6">
          <h1 className="font-display text-[28px] leading-none tracking-tight" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 144, "wght" 500' }}>Library</h1>
          <p className="text-[12px] uppercase tracking-wider font-mono mt-2" style={{ color: 'var(--ghost)' }}>
            {audiences.length} audiences · {campaigns.length} campaigns · {posts.length} posts
          </p>
        </div>

        {/* Audiences section — ICPs and Buyer Personas */}
        {audiences.length > 0 && (
          <div className="mb-6">
            <div className="px-1 pb-2 flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] font-mono" style={{ color: 'var(--ghost)' }}>
                — audiences · icps + buyer personas
              </span>
              <span className="flex-1 h-px" style={{ background: 'var(--oxblood-rule)' }} />
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
                      borderRadius: '4px',
                    }}
                  >
                    {a.is_primary && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[2px]"
                        style={{ background: 'var(--oxblood)', borderRadius: '0 1px 1px 0' }}
                      />
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <Users size={11} style={{ color: 'var(--ghost)' }} />
                      <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5"
                        style={{
                          background: a.kind === 'icp' ? 'var(--oxblood-tint)' : 'var(--paper-warm)',
                          color: a.kind === 'icp' ? 'var(--oxblood)' : 'var(--ink-quiet)',
                          borderRadius: '2px',
                        }}>
                        {kindLabel}
                      </span>
                      {a.is_primary && <Star size={10} style={{ color: 'var(--oxblood)' }} />}
                    </div>
                    <p className="font-display text-[15px] leading-snug mb-1" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>
                      {a.name}
                    </p>
                    {parent && (
                      <p className="text-[10px] uppercase tracking-wider font-mono mb-2" style={{ color: 'var(--mist)' }}>
                        inside ICP: {parent.name}
                      </p>
                    )}
                    {Array.isArray(a.pain_points) && a.pain_points.length > 0 && (
                      <p className="text-[11px] line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>
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
              <span className="text-[10px] uppercase tracking-[0.18em] font-mono" style={{ color: 'var(--ghost)' }}>
                — campaigns
              </span>
              <span className="flex-1 h-px" style={{ background: 'var(--oxblood-rule)' }} />
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
                      borderRadius: '4px',
                    }}
                  >
                    {/* Oxblood left bar for active/pinned */}
                    {(c.is_pinned || c.status === 'active') && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[2px]"
                        style={{ background: 'var(--oxblood)', opacity: c.is_pinned ? 1 : 0.5, borderRadius: '0 1px 1px 0' }}
                      />
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      {c.is_pinned && <Star size={11} style={{ color: 'var(--oxblood)' }} />}
                      <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5"
                        style={{
                          background: c.status === 'active' ? 'var(--oxblood-tint)' : 'var(--paper-warm)',
                          color: c.status === 'active' ? 'var(--oxblood)' : 'var(--ink-quiet)',
                          borderRadius: '2px',
                        }}>
                        {c.status}
                      </span>
                      {dateRange && (
                        <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--mist)' }}>{dateRange}</span>
                      )}
                    </div>
                    <p className="font-display text-[15px] leading-snug mb-1" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>
                      {c.name}
                    </p>
                    {c.theme && (
                      <p className="text-[11px] line-clamp-2 mb-2" style={{ color: 'var(--ink-quiet)' }}>
                        {c.theme}
                      </p>
                    )}
                    <p className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--ghost)' }}>
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
          <span className="text-[10px] uppercase tracking-[0.18em] font-mono" style={{ color: 'var(--ghost)' }}>
            — all posts
          </span>
          <span className="flex-1 h-px" style={{ background: 'var(--oxblood-rule)' }} />
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
              <div key={post.id} onClick={() => setSelected(post)}
                className={`bg-white rounded-xl p-4 cursor-pointer border-2 transition-all hover:border-gray-300 ${selected?.id === post.id ? 'border-violet-400' : 'border-transparent'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {post.channel && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[post.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                      {post.channel}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[post.status] || 'bg-gray-100 text-gray-600'}`}>
                    {post.status}
                  </span>
                  {post.scheduled_at && (
                    <span className="text-xs text-gray-400 ml-auto">{new Date(post.scheduled_at).toLocaleDateString()}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-900">{post.title || 'Untitled'}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{post.copy}</p>
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
              {selected.channel && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[selected.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                  {selected.channel}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selected.status] || 'bg-gray-100 text-gray-600'}`}>
                {selected.status}
              </span>
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
