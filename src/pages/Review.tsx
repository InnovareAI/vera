import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutList, LayoutGrid, X, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import type { Post, Campaign } from '../lib/supabase'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
  quora: 'bg-red-100 text-red-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  blog: 'bg-amber-100 text-amber-700',
  email: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-gray-100 text-gray-700',
  reddit: 'bg-orange-100 text-orange-700',
  substack: 'bg-pink-100 text-pink-700',
}

const STATUS_TABS = ['Pending Review', 'Approved', 'Scheduled', 'Posted', 'Rejected'] as const
type StatusTab = typeof STATUS_TABS[number]
type View = 'list' | 'board'

// Status-tab → underlying DB status value. Pending and Posted are special
// (Pending matches a set of values; Posted is derived from posted_at).
const TAB_DROP_ACTION: Record<StatusTab, { kind: 'webhook' | 'direct' | 'forbidden'; value?: string; action?: string }> = {
  'Pending Review': { kind: 'direct',   value: 'Pending Review' },
  'Approved':       { kind: 'webhook',  action: 'approved' },
  'Scheduled':      { kind: 'direct',   value: 'Scheduled' },
  'Posted':         { kind: 'forbidden' },                       // needs posted_url; use detail page
  'Rejected':       { kind: 'webhook',  action: 'rejected' },
}

const isPending = (s: string) => ['Pending Review', 'Draft', 'pending', 'changes_requested'].includes(s)
const isPosted = (p: Post) => !!p.posted_at

function tabFor(post: Post): StatusTab {
  if (isPosted(post)) return 'Posted'
  if (post.status === 'Rejected' || post.status === 'rejected') return 'Rejected'
  if (post.status === 'Scheduled') return 'Scheduled'
  if (post.status === 'Approved' || post.status === 'approved') return 'Approved'
  return 'Pending Review'
}

function relativeTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const min = Math.round(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Review() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<StatusTab>('Pending Review')
  const [selected, setSelected] = useState<Post | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [view, setView] = useState<View>(() => (localStorage.getItem('reviewView') as View) ?? 'list')
  const [dragOverTab, setDragOverTab] = useState<StatusTab | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignFilter, setCampaignFilter] = useState<string>('all')   // 'all' | 'adhoc' | <campaign_id>
  const { activeOrg } = useOrg()
  const navigate = useNavigate()

  useEffect(() => {
    if (!activeOrg?.id) { setCampaigns([]); return }
    supabase.from('campaigns')
      .select('id, name, status, is_pinned, color, theme, start_date, end_date')
      .eq('org_id', activeOrg.id)
      .order('is_pinned', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => setCampaigns((data as Campaign[]) ?? []))
  }, [activeOrg?.id])

  const campaignsById = new Map(campaigns.map(c => [c.id, c]))

  useEffect(() => { localStorage.setItem('reviewView', view) }, [view])

  useEffect(() => {
    supabase.from('content_posts').select('*').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setPosts(data || []); setLoading(false) })

    const channel = supabase.channel('review-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_posts' }, payload => {
        if (payload.eventType === 'UPDATE') {
          setPosts(prev => prev.map(p => p.id === (payload.new as Post).id ? payload.new as Post : p))
          setSelected(prev => prev?.id === (payload.new as Post).id ? payload.new as Post : prev)
        }
        if (payload.eventType === 'INSERT') setPosts(prev => [payload.new as Post, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function moveToTab(postId: string, targetTab: StatusTab) {
    const rule = TAB_DROP_ACTION[targetTab]
    if (rule.kind === 'forbidden') {
      alert(`Can't drop here — "Posted" needs a live URL. Use the post detail page to mark it posted.`)
      return
    }
    setSaving(postId)
    if (rule.kind === 'webhook' && rule.action) {
      try {
        const res = await fetch(APPROVAL_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ post_id: postId, action: rule.action }),
        })
        const data = await res.json()
        if (res.ok && data.post) {
          setPosts(prev => prev.map(p => p.id === postId ? data.post as Post : p))
          setSelected(prev => prev?.id === postId ? data.post as Post : prev)
        }
      } catch { /* operator sees no movement and can retry */ }
    } else if (rule.kind === 'direct' && rule.value) {
      const { error } = await supabase.from('content_posts').update({ status: rule.value }).eq('id', postId)
      if (!error) {
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: rule.value! } : p))
        setSelected(prev => prev?.id === postId ? { ...prev, status: rule.value! } : prev)
      }
    }
    setSaving(null)
  }

  // Campaign filter narrows which posts feed into both views. 'all' = show all,
  // 'adhoc' = only posts NOT tied to any campaign, otherwise = specific campaign.
  const inFilter = (p: Post) => {
    if (campaignFilter === 'all')   return true
    if (campaignFilter === 'adhoc') return !p.campaign_id
    return p.campaign_id === campaignFilter
  }
  const scoped = posts.filter(inFilter)
  const filtered = scoped.filter(p => tabFor(p) === activeTab)

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = scoped.filter(p => tabFor(p) === tab).length
    return acc
  }, {} as Record<StatusTab, number>)

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Page header */}
      <div className="flex items-end justify-between mb-5 gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-none tracking-tight" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 144, "wght" 500' }}>
            Review queue
          </h1>
          <p className="text-[12px] uppercase tracking-wider font-mono mt-2" style={{ color: 'var(--ghost)' }}>
            {scoped.length} of {posts.length} posts · {tabCounts['Pending Review']} awaiting approval
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Campaign filter */}
          {campaigns.length > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5"
              style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
              <Layers size={12} style={{ color: 'var(--ghost)' }} />
              <select
                value={campaignFilter}
                onChange={e => setCampaignFilter(e.target.value)}
                className="text-[12px] outline-none cursor-pointer"
                style={{ background: 'transparent', color: 'var(--ink)', border: 'none', fontFamily: 'var(--font-body)' }}
              >
                <option value="all">All campaigns + ad-hoc</option>
                <option value="adhoc">Ad-hoc only (no campaign)</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.is_pinned ? '★ ' : ''}{c.name}{c.status !== 'active' ? ` · ${c.status}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        {/* View switcher */}
        <div className="inline-flex p-0.5" style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
          <button
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-all"
            style={{
              background: view === 'list' ? 'var(--paper)' : 'transparent',
              color: view === 'list' ? 'var(--ink)' : 'var(--ghost)',
              fontWeight: view === 'list' ? 500 : 400,
              boxShadow: view === 'list' ? '0 1px 3px rgba(14,14,15,0.06)' : 'none',
              borderRadius: '2px',
            }}
          >
            <LayoutList size={13} /> List
          </button>
          <button
            onClick={() => setView('board')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-all"
            style={{
              background: view === 'board' ? 'var(--paper)' : 'transparent',
              color: view === 'board' ? 'var(--ink)' : 'var(--ghost)',
              fontWeight: view === 'board' ? 500 : 400,
              boxShadow: view === 'board' ? '0 1px 3px rgba(14,14,15,0.06)' : 'none',
              borderRadius: '2px',
            }}
          >
            <LayoutGrid size={13} /> Board
          </button>
        </div>
        </div>
      </div>

      {view === 'list' ? (
        <ListView
          posts={posts}
          loading={loading}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabCounts={tabCounts}
          filtered={filtered}
          selected={selected}
          setSelected={setSelected}
          saving={saving}
          moveToTab={moveToTab}
          campaignsById={campaignsById}
        />
      ) : (
        <BoardView
          posts={scoped}
          loading={loading}
          tabCounts={tabCounts}
          dragOverTab={dragOverTab}
          setDragOverTab={setDragOverTab}
          campaignsById={campaignsById}
          onMove={moveToTab}
          onOpen={(p) => navigate(`/review/${p.id}`)}
        />
      )}
    </div>
  )
}

// ─── List view (existing UX, refactored) ─────────────────────────────────
function ListView({
  loading, activeTab, setActiveTab, tabCounts, filtered, selected, setSelected, saving, moveToTab, campaignsById,
}: {
  posts: Post[]
  loading: boolean
  activeTab: StatusTab
  setActiveTab: (t: StatusTab) => void
  tabCounts: Record<StatusTab, number>
  filtered: Post[]
  selected: Post | null
  setSelected: (p: Post | null) => void
  saving: string | null
  moveToTab: (postId: string, target: StatusTab) => void | Promise<void>
  campaignsById: Map<string, Campaign>
}) {
  return (
    <div className="flex flex-1 gap-6 min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-0.5" style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 px-3 py-1.5 text-[12px] transition-all inline-flex items-center justify-center gap-1.5"
              style={{
                background: activeTab === tab ? 'var(--paper)' : 'transparent',
                color: activeTab === tab ? 'var(--ink)' : 'var(--ghost)',
                fontWeight: activeTab === tab ? 500 : 400,
                boxShadow: activeTab === tab ? '0 1px 3px rgba(14,14,15,0.06)' : 'none',
                borderRadius: '2px',
              }}
            >
              {tab}
              {tabCounts[tab] > 0 && (
                <span className="text-[10px] font-mono px-1.5"
                  style={{
                    background: activeTab === tab ? 'var(--oxblood)' : 'var(--paper-edge)',
                    color: activeTab === tab ? 'var(--paper)' : 'var(--ink-quiet)',
                    borderRadius: '2px',
                  }}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--ghost)' }}>Loading posts…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40" style={{ color: 'var(--ghost)' }}>
              <span className="font-display text-2xl mb-2" style={{ color: 'var(--mist)' }}>—</span>
              <p className="text-sm">No posts in this queue</p>
            </div>
          ) : filtered.map(post => {
            const campaign = post.campaign_id ? campaignsById.get(post.campaign_id) : null
            return (
              <div
                key={post.id}
                onClick={() => setSelected(post)}
                className="cursor-pointer p-4 transition-all relative"
                style={{
                  background: 'var(--paper)',
                  border: `1px solid ${selected?.id === post.id ? 'var(--oxblood)' : 'var(--paper-edge)'}`,
                  borderRadius: '4px',
                  boxShadow: selected?.id === post.id ? '0 1px 3px rgba(122,31,43,0.10)' : 'none',
                }}
              >
                {/* Campaign tint — left edge bar */}
                {campaign && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[2px]"
                    style={{ background: 'var(--oxblood)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
                    title={`Campaign: ${campaign.name}`}
                  />
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {post.channel && (
                        <span className={`text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 ${PLATFORM_COLORS[post.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`} style={{ borderRadius: '2px' }}>
                          {post.channel}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5"
                        style={{
                          background: isPosted(post) ? 'var(--oxblood-tint)' : 'var(--paper-warm)',
                          color: isPosted(post) ? 'var(--oxblood)' : 'var(--ink-quiet)',
                          borderRadius: '2px',
                        }}>
                        {isPosted(post) ? 'Posted' : post.status}
                      </span>
                      {campaign && (
                        <span className="text-[10px] font-mono truncate" style={{ color: 'var(--oxblood)' }} title={campaign.theme || campaign.name}>
                          · {campaign.name}
                        </span>
                      )}
                      <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
                    </div>
                    <p className="font-display text-[15px] leading-snug truncate" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>{post.title || 'Untitled post'}</p>
                    <p className="text-[12px] mt-1 line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>{post.copy}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail side panel */}
      <div className="w-96 flex-shrink-0">
        {selected ? (
          <PostDetailPanel post={selected} onClose={() => setSelected(null)} saving={saving} onMove={moveToTab} />
        ) : (
          <div className="p-8 flex flex-col items-center justify-center text-center h-64"
            style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px' }}>
            <span className="font-display text-3xl mb-3" style={{ color: 'var(--mist)' }}>—</span>
            <p className="text-sm" style={{ color: 'var(--ghost)' }}>Select a post to preview and take action</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Board view (Trello-style, 5 columns with HTML5 drag/drop) ───────────
function BoardView({
  posts, loading, tabCounts, dragOverTab, setDragOverTab, onMove, onOpen, campaignsById,
}: {
  posts: Post[]
  loading: boolean
  tabCounts: Record<StatusTab, number>
  dragOverTab: StatusTab | null
  setDragOverTab: React.Dispatch<React.SetStateAction<StatusTab | null>>
  onMove: (postId: string, target: StatusTab) => void | Promise<void>
  onOpen: (p: Post) => void
  campaignsById: Map<string, Campaign>
}) {
  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--ghost)' }}>Loading posts…</div>
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, tab: StatusTab) {
    e.preventDefault()
    setDragOverTab(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) onMove(id, tab)
  }

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex gap-3 h-full min-w-fit pb-2">
        {STATUS_TABS.map(tab => {
          const columnPosts = posts.filter(p => tabFor(p) === tab)
          const isDragTarget = dragOverTab === tab
          const isForbidden = TAB_DROP_ACTION[tab].kind === 'forbidden'
          return (
            <div
              key={tab}
              onDragOver={(e) => {
                if (isForbidden) return
                e.preventDefault()
                setDragOverTab(tab)
              }}
              onDragLeave={() => setDragOverTab(curr => curr === tab ? null : curr)}
              onDrop={(e) => handleDrop(e, tab)}
              className="flex flex-col flex-shrink-0 w-[280px]"
              style={{
                background: isDragTarget ? 'var(--oxblood-tint)' : 'var(--paper-warm)',
                border: `1px dashed ${isDragTarget ? 'var(--oxblood)' : 'var(--paper-edge)'}`,
                borderRadius: '4px',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              {/* Column header */}
              <div className="px-3 pt-3 pb-2 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--paper-edge)' }}>
                <div className="flex items-center gap-2">
                  <span className="font-display text-[14px]" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>
                    {tab}
                  </span>
                  <span className="text-[10px] font-mono"
                    style={{
                      background: 'var(--paper)',
                      color: 'var(--ink-quiet)',
                      padding: '0 5px',
                      borderRadius: '2px',
                      border: '1px solid var(--paper-edge)',
                    }}>
                    {tabCounts[tab]}
                  </span>
                </div>
                {isForbidden && (
                  <span className="text-[9px] uppercase tracking-wider font-mono" style={{ color: 'var(--mist)' }}>
                    no drop
                  </span>
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnPosts.length === 0 ? (
                  <div className="text-center py-6">
                    <span className="font-display text-xl" style={{ color: 'var(--mist)' }}>—</span>
                  </div>
                ) : columnPosts.map(post => (
                  <BoardCard
                    key={post.id}
                    post={post}
                    campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                    onOpen={() => onOpen(post)}
                    draggable={!isForbidden /* Posted column items can be dragged out via detail page anyway */}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoardCard({ post, campaign, onOpen, draggable }: { post: Post; campaign: Campaign | null; onOpen: () => void; draggable: boolean }) {
  const [isDragging, setIsDragging] = useState(false)
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', post.id)
        e.dataTransfer.effectAllowed = 'move'
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
      onClick={onOpen}
      className="p-3 cursor-pointer group transition-all relative"
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--paper-edge)',
        borderRadius: '3px',
        opacity: isDragging ? 0.4 : 1,
        cursor: draggable ? 'grab' : 'pointer',
      }}
    >
      {/* Campaign tint — left edge bar */}
      {campaign && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px]"
          style={{ background: 'var(--oxblood)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
          title={`Campaign: ${campaign.name}`}
        />
      )}
      <div className="flex items-center gap-1.5 mb-1.5">
        {post.channel && (
          <span className={`text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 ${PLATFORM_COLORS[post.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`} style={{ borderRadius: '2px' }}>
            {post.channel}
          </span>
        )}
        {campaign && (
          <span className="text-[9px] font-mono truncate max-w-[120px]" style={{ color: 'var(--oxblood)' }} title={campaign.name}>
            · {campaign.name.replace(/^[A-Z][a-z]+ \d+ — /, '')}
          </span>
        )}
        <span className="text-[9px] font-mono ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
      </div>
      {post.media_url && (
        <div className="mb-2 overflow-hidden" style={{ borderRadius: '2px' }}>
          <img src={post.media_url} alt="" className="w-full h-20 object-cover" />
        </div>
      )}
      <p className="font-display text-[13px] leading-tight line-clamp-2 mb-1" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 18, "wght" 500' }}>
        {post.title || 'Untitled post'}
      </p>
      <p className="text-[11px] line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>
        {post.copy?.replace(/^Subject:.+\n+/, '')}
      </p>
      {isPosted(post) && post.posted_url && (
        <a
          href={post.posted_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="block mt-2 text-[10px] font-mono truncate underline"
          style={{ color: 'var(--oxblood)' }}
        >
          {post.posted_url}
        </a>
      )}
    </div>
  )
}

// ─── Detail side panel (kept from list view; mostly unchanged for now) ────
function PostDetailPanel({
  post, onClose, saving, onMove,
}: {
  post: Post
  onClose: () => void
  saving: string | null
  onMove: (postId: string, target: StatusTab) => void | Promise<void>
}) {
  return (
    <div className="sticky top-0 p-5"
      style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--ghost)' }}>— preview</h2>
        <button onClick={onClose} className="p-1 hover:bg-[var(--paper-warm)] rounded-sm" style={{ color: 'var(--ghost)' }}>
          <X size={14} />
        </button>
      </div>
      {post.channel && (
        <span className={`text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 ${PLATFORM_COLORS[post.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`} style={{ borderRadius: '2px' }}>
          {post.channel}
        </span>
      )}
      <h3 className="font-display text-[18px] mt-3 mb-3 leading-snug" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 32, "wght" 500' }}>
        {post.title || 'Untitled'}
      </h3>
      {post.media_url && (
        <div className="mb-3 overflow-hidden" style={{ borderRadius: '3px', border: '1px solid var(--paper-edge)' }}>
          <img src={post.media_url} alt="" className="w-full object-cover max-h-48" />
        </div>
      )}
      <div className="p-3 text-[13px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-4"
        style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', borderRadius: '3px' }}>
        {post.copy || 'No content'}
      </div>
      {post.hashtags && post.hashtags.length > 0 && (
        <p className="text-[11px] mb-4 font-mono" style={{ color: 'var(--oxblood-soft)' }}>{post.hashtags.join(' ')}</p>
      )}
      {post.model_used && (
        <p className="text-[10px] uppercase tracking-wider font-mono mb-4" style={{ color: 'var(--mist)' }}>Generated by {post.model_used}</p>
      )}
      {isPosted(post) && (
        <div className="mb-4 p-3 text-[12px]"
          style={{ background: 'var(--oxblood-tint)', border: '1px solid var(--oxblood-rule)', borderRadius: '3px' }}>
          <div className="font-medium mb-1" style={{ color: 'var(--oxblood)' }}>✓ Posted to {post.channel}</div>
          {post.posted_at && (
            <div className="text-[11px]" style={{ color: 'var(--ink-quiet)' }}>
              {new Date(post.posted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
          {post.posted_url && (
            <a href={post.posted_url} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-block underline truncate max-w-full text-[11px] font-mono"
              style={{ color: 'var(--oxblood)' }}>
              {post.posted_url}
            </a>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {isPending(post.status) && !isPosted(post) && (<>
          <button onClick={() => onMove(post.id, 'Approved')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--oxblood)', color: 'var(--paper)', borderRadius: '3px' }}>
            {saving === post.id ? 'Saving…' : '✓ Approve'}
          </button>
          <button onClick={() => onMove(post.id, 'Rejected')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] transition-colors disabled:opacity-50"
            style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
            ✕ Reject
          </button>
        </>)}
        {post.status === 'Approved' && !isPosted(post) && (
          <button onClick={() => onMove(post.id, 'Scheduled')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
            📅 Schedule
          </button>
        )}
        <a href={`/review/${post.id}`}
          className="w-full py-2 text-[13px] text-center transition-colors"
          style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
          Open detail →
        </a>
      </div>
    </div>
  )
}
