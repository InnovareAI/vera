import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LayoutList, LayoutGrid, Calendar as CalendarIcon, X, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import type { Post, Campaign } from '../lib/supabase'
import { PlatformChip, StatusChip } from '../components/Chip'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Platform + status chip helpers moved to ../components/Chip — neutral
// chips with coloured dots replace the older bright Tailwind pills.

const STATUS_TABS = ['Pending Review', 'Approved', 'Scheduled', 'Posted', 'Rejected'] as const
type StatusTab = typeof STATUS_TABS[number]
type View = 'list' | 'board' | 'calendar'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const campaignFilter = searchParams.get('campaign') ?? 'all'   // 'all' | 'adhoc' | <campaign_id>
  const setCampaignFilter = (next: string) => {
    if (next === 'all') {
      searchParams.delete('campaign')
    } else {
      searchParams.set('campaign', next)
    }
    setSearchParams(searchParams, { replace: true })
  }
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
          <h1 className="text-[28px] leading-tight tracking-tight font-semibold" style={{ color: 'var(--ink)' }}>
            Review queue
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ghost)' }}>
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
            onClick={() => setView('calendar')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-all"
            style={{
              background: view === 'calendar' ? 'var(--paper)' : 'transparent',
              color: view === 'calendar' ? 'var(--ink)' : 'var(--ghost)',
              fontWeight: view === 'calendar' ? 500 : 400,
              boxShadow: view === 'calendar' ? '0 1px 3px rgba(14,14,15,0.06)' : 'none',
              borderRadius: '2px',
            }}
          >
            <CalendarIcon size={13} /> Calendar
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

      {view === 'list' && (
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
      )}
      {view === 'calendar' && (
        <CalendarView
          posts={scoped}
          loading={loading}
          onOpen={(p) => navigate(`/review/${p.id}`)}
        />
      )}
      {view === 'board' && (
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
                <span className="text-[11px] px-1.5"
                  style={{
                    background: activeTab === tab ? 'var(--ink)' : 'var(--paper-edge)',
                    color: activeTab === tab ? 'var(--paper-warm)' : 'var(--ink-quiet)',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 500,
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
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: selected?.id === post.id ? '0 1px 3px rgba(122,31,43,0.10)' : 'none',
                }}
              >
                {/* Campaign tint — left edge bar */}
                {campaign && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[2px]"
                    style={{ background: 'var(--ink)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
                    title={`Campaign: ${campaign.name}`}
                  />
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <PlatformChip channel={post.channel} />
                      <StatusChip status={isPosted(post) ? 'Posted' : post.status} />
                      {campaign && (
                        <span className="text-[12px] truncate" style={{ color: 'var(--ghost)' }} title={campaign.theme || campaign.name}>
                          · {campaign.name}
                        </span>
                      )}
                      <span className="text-[12px] ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
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
            style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}>
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
                borderRadius: 'var(--radius-lg)',
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
          style={{ background: 'var(--ink)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
          title={`Campaign: ${campaign.name}`}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <PlatformChip channel={post.channel} size="sm" />
        {campaign && (
          <span className="text-[11px] truncate max-w-[120px]" style={{ color: 'var(--ghost)' }} title={campaign.name}>
            {campaign.name.replace(/^[A-Z][a-z]+ \d+ — /, '')}
          </span>
        )}
        <span className="text-[11px] ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
      </div>
      {post.media_url && (
        <div className="mb-2 overflow-hidden" style={{ borderRadius: 'var(--radius-sm)' }}>
          <img src={post.media_url} alt="" className="w-full h-20 object-cover" />
        </div>
      )}
      <p className="text-[14px] font-medium leading-snug line-clamp-2 mb-1" style={{ color: 'var(--ink)' }}>
        {post.title || 'Untitled post'}
      </p>
      <p className="text-[13px] line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>
        {post.copy?.replace(/^Subject:.+\n+/, '')}
      </p>
      {isPosted(post) && post.posted_url && (
        <a
          href={post.posted_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="block mt-2 text-[10px] font-mono truncate underline"
          style={{ color: 'var(--ink-quiet)' }}
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
      style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ghost)' }}>Preview</h2>
        <button onClick={onClose} className="p-1 hover:bg-[var(--fog)] transition-colors" style={{ color: 'var(--ghost)', borderRadius: 'var(--radius-sm)' }}>
          <X size={14} />
        </button>
      </div>
      <PlatformChip channel={post.channel} />
      <h3 className="text-[17px] font-semibold mt-3 mb-3 leading-snug" style={{ color: 'var(--ink)' }}>
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
          style={{ background: 'var(--fog)', border: '1px solid var(--oxblood-rule)', borderRadius: '3px' }}>
          <div className="font-medium mb-1" style={{ color: 'var(--ink-quiet)' }}>✓ Posted to {post.channel}</div>
          {post.posted_at && (
            <div className="text-[11px]" style={{ color: 'var(--ink-quiet)' }}>
              {new Date(post.posted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
          {post.posted_url && (
            <a href={post.posted_url} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-block underline truncate max-w-full text-[11px] font-mono"
              style={{ color: 'var(--ink-quiet)' }}>
              {post.posted_url}
            </a>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {isPending(post.status) && !isPosted(post) && (<>
          <button onClick={() => onMove(post.id, 'Approved')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
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

// ─── Calendar view ──────────────────────────────────────────────────────
// Week grid (Mon-Sun) showing posts on their target date. A post's date is:
//   posted_at  > scheduled_at > publish_date
// Drafts without a target date are EXCLUDED — they don't belong to a day
// yet. Operator can navigate prev/next week or jump back to "this week".
//
// Visual: status-coded left border per event (draft/pending/scheduled/posted),
// click → /review/:id detail. Empty days show as blank cells, not "Nothing
// scheduled" chrome.
function CalendarView({
  posts, loading, onOpen,
}: {
  posts: Post[]
  loading: boolean
  onOpen: (p: Post) => void
}) {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()))

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); days.push(d)
  }

  // Bucket posts by ISO date string. Posts without a target date are dropped.
  const byDay = new Map<string, Post[]>()
  for (const p of posts) {
    const iso = p.posted_at || p.scheduled_at || p.publish_date
    if (!iso) continue
    const key = isoDay(new Date(iso))
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(p)
  }

  const today = new Date()
  const todayKey = isoDay(today)
  const isCurrentWeek = isoDay(weekStart) === isoDay(mondayOf(today))

  const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${
    days[6].toLocaleDateString(undefined, {
      month: days[0].getMonth() !== days[6].getMonth() ? 'short' : undefined,
      day: 'numeric',
    })
  }`

  function jumpWeek(delta: number) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + 7 * delta); setWeekStart(d)
  }

  return (
    <div className="px-6 pb-10">
      {/* Week nav */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => jumpWeek(-1)}
          className="px-2 py-1 text-[13px] hover:bg-[var(--fog)] rounded transition-colors"
          style={{ color: 'var(--ink-quiet)' }}
        >‹</button>
        <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
          {weekLabel}
        </span>
        <button
          onClick={() => jumpWeek(1)}
          className="px-2 py-1 text-[13px] hover:bg-[var(--fog)] rounded transition-colors"
          style={{ color: 'var(--ink-quiet)' }}
        >›</button>
        {!isCurrentWeek && (
          <button
            onClick={() => setWeekStart(mondayOf(new Date()))}
            className="text-[12px] hover:opacity-80 transition-opacity"
            style={{ color: 'var(--ink-quiet)' }}
          >
            Today
          </button>
        )}
        {loading && (
          <span className="text-[12px] ml-auto" style={{ color: 'var(--ghost)' }}>Loading…</span>
        )}
      </div>

      {/* Week grid */}
      <div
        className="grid grid-cols-7"
        style={{
          background: 'var(--paper-edge)',
          gap: '1px',
          border: '1px solid var(--paper-edge)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {days.map(d => {
          const key = isoDay(d)
          const events = byDay.get(key) ?? []
          const isToday = key === todayKey
          const dayName = d.toLocaleDateString(undefined, { weekday: 'short' })
          return (
            <div
              key={key}
              className="flex flex-col min-h-[200px] p-2"
              style={{ background: 'var(--paper-warm)' }}
            >
              <div className="flex items-baseline justify-between mb-2 px-1">
                <span
                  className="text-[10px] uppercase font-medium"
                  style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}
                >
                  {dayName}
                </span>
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: isToday ? 'var(--accent)' : 'var(--ink)' }}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {events.map(p => (
                  <CalendarEvent key={p.id} post={p} onOpen={() => onOpen(p)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CalendarEvent({ post, onOpen }: { post: Post; onOpen: () => void }) {
  const tab = tabFor(post)
  const border =
    tab === 'Posted'        ? '#3B82F6'
    : tab === 'Approved'    ? '#10B981'
    : tab === 'Scheduled'   ? '#10B981'
    : tab === 'Rejected'    ? '#EF4444'
    : '#F59E0B'  // pending review
  const isPosted = tab === 'Posted'
  const timeIso = post.posted_at || post.scheduled_at || post.publish_date
  const time = timeIso ? new Date(timeIso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <button
      onClick={onOpen}
      className="text-left px-2 py-1.5 transition-colors hover:bg-[var(--fog)]"
      style={{
        background: 'var(--paper)',
        borderRadius: '3px',
        borderLeft: `3px solid ${border}`,
        opacity: isPosted ? 0.7 : 1,
      }}
    >
      <div
        className="text-[11px] leading-snug line-clamp-2"
        style={{ color: 'var(--ink)' }}
      >
        <span
          className="font-medium uppercase mr-1"
          style={{ color: 'var(--ghost)', fontSize: '9.5px', letterSpacing: '0.04em' }}
        >
          {(post.channel ?? 'post').slice(0, 2)}
        </span>
        {post.title || 'Untitled'}
      </div>
      {time && (
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--ghost)', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </div>
      )}
    </button>
  )
}

function mondayOf(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay() // 0=Sun, 1=Mon, ... 6=Sat
  x.setDate(x.getDate() - ((day + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

function isoDay(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
