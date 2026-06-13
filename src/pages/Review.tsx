import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Calendar as CalendarIcon, CalendarPlus, Check, ExternalLink, Filter, LayoutGrid, LayoutList, Layers, MessageSquare, Search, Send, Sparkles, Target, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import type { Post, Campaign } from '../lib/supabase'
import type { BusinessContext } from '../lib/businessContext'
import { parseProjectInstructions } from '../lib/businessContext'
import { approvalRouteForPost } from '../lib/approvalRouting'
import { PlatformChip, StatusChip } from '../components/Chip'
import { PlatformPostPreview } from '../components/PlatformPostPreview'
import { ApprovalRouteChip, ApprovalRouteSection } from '../components/ApprovalRoute'
import { useRightRail } from '../lib/rightRailContext'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Platform + status chip helpers moved to ../components/Chip, neutral
// chips with coloured dots replace the older bright Tailwind pills.

const STATUS_TABS = ['Draft', 'Pending Review', 'Changes Requested', 'Approved', 'Scheduled', 'Posted', 'Rejected'] as const
type StatusTab = typeof STATUS_TABS[number]
const REVIEW_VIEWS = ['list', 'board', 'calendar'] as const
type View = typeof REVIEW_VIEWS[number]
type MediaFrame = { url: string; text?: string | null }
type ReviewFilters = {
  search: string
  platform: string
  media: string
  owner: string
  date: string
}
type ReviewMetricSummary = {
  total: number
  drafts: number
  pending: number
  changes: number
  approved: number
  scheduled: number
  needsDate: number
  posted: number
  rejected: number
}

const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
  search: '',
  platform: 'all',
  media: 'all',
  owner: 'all',
  date: 'all',
}

// Status-tab → underlying DB status value. Scheduled and Posted are derived
// delivery states: scheduled needs a date, posted needs a live URL.
const TAB_DROP_ACTION: Record<StatusTab, { kind: 'webhook' | 'direct' | 'forbidden'; value?: string; action?: string }> = {
  'Draft':          { kind: 'direct',   value: 'draft' },
  'Pending Review': { kind: 'direct',   value: 'pending' },
  'Changes Requested': { kind: 'webhook', action: 'changes_requested' },
  'Approved':       { kind: 'webhook',  action: 'approved' },
  'Scheduled':      { kind: 'forbidden' },                       // needs a date; use Calendar
  'Posted':         { kind: 'forbidden' },                       // needs posted_url; use detail page
  'Rejected':       { kind: 'webhook',  action: 'rejected' },
}

const normalizeStatus = (status?: string | null) => (status ?? '').trim().toLowerCase().replace(/\s+/g, '_')
const isPosted = (p: Post) => !!p.posted_at || !!p.published_at || ['posted', 'published'].includes(normalizeStatus(p.status))
const isDraftLike = (s: string) => ['draft'].includes(normalizeStatus(s))
const isReviewLike = (s: string) => ['pending', 'pending_review', 'review'].includes(normalizeStatus(s))
const isChangesRequested = (s: string) => normalizeStatus(s) === 'changes_requested'
const isActionableReview = (s: string) => isDraftLike(s) || isReviewLike(s) || isChangesRequested(s)

function tabFor(post: Post): StatusTab {
  const status = normalizeStatus(post.status)
  if (isPosted(post)) return 'Posted'
  if (status === 'rejected') return 'Rejected'
  if (status === 'scheduled' || ((post.scheduled_at || post.publish_date) && status === 'approved')) return 'Scheduled'
  if (status === 'approved') return 'Approved'
  if (status === 'changes_requested') return 'Changes Requested'
  if (status === 'draft') return 'Draft'
  return 'Pending Review'
}

function lifecycleLabel(post: Post): string {
  return tabFor(post)
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function platformValue(post: Post) {
  return post.channel?.trim() || 'Unassigned'
}

function postOwner(post: Post) {
  return post.author?.trim() || post.profile_name?.trim() || 'Unassigned'
}

function mediaKind(post: Post) {
  const type = (post.media_type ?? '').toLowerCase()
  if (type.includes('carousel')) return 'carousel'
  if (type.includes('video')) return 'video'
  if (post.media_url || postMediaFrames(post).length > 0) return 'image'
  return 'text'
}

function mediaKindLabel(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function targetDate(post: Post) {
  const raw = post.posted_at || post.scheduled_at || post.publish_date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function isThisWeek(date: Date | null) {
  if (!date) return false
  const start = mondayOf(new Date())
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return date >= start && date < end
}

function formatDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatDateOnly(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function matchesReviewFilters(post: Post, filters: ReviewFilters, campaignFilter: string, campaignsById: Map<string, Campaign>) {
  if (campaignFilter === 'adhoc' && post.campaign_id) return false
  if (campaignFilter !== 'all' && campaignFilter !== 'adhoc' && post.campaign_id !== campaignFilter) return false
  if (filters.platform !== 'all' && platformValue(post) !== filters.platform) return false
  if (filters.media !== 'all' && mediaKind(post) !== filters.media) return false
  if (filters.owner !== 'all' && postOwner(post) !== filters.owner) return false
  if (filters.date !== 'all') {
    const date = targetDate(post)
    if (filters.date === 'unscheduled' && date) return false
    if (filters.date === 'scheduled' && tabFor(post) !== 'Scheduled') return false
    if (filters.date === 'posted' && tabFor(post) !== 'Posted') return false
    if (filters.date === 'this_week' && !isThisWeek(date)) return false
  }
  const query = filters.search.trim().toLowerCase()
  if (!query) return true
  const campaign = post.campaign_id ? campaignsById.get(post.campaign_id) : null
  const haystack = [
    post.title,
    post.copy,
    post.channel,
    post.format,
    post.status,
    post.feedback,
    campaign?.name,
    campaign?.theme,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}

function postMeta(post: Post, campaign: Campaign | null) {
  const status = tabFor(post)
  if (status === 'Scheduled') return `Scheduled ${formatDateTime(post.scheduled_at || post.publish_date)}`
  if (status === 'Posted') return post.posted_url ? 'Live URL saved' : `Posted ${formatDateTime(post.posted_at)}`
  if (status === 'Changes Requested') return post.feedback ? `Feedback: ${post.feedback}` : 'Waiting on edits'
  if (status === 'Approved') return targetDate(post) ? `Planned ${formatDateOnly(post.scheduled_at || post.publish_date)}` : 'Approved, not scheduled'
  if (status === 'Rejected') return post.feedback ? `Rejected: ${post.feedback}` : 'Parked from publishing'
  if (status === 'Draft') return 'Drafting'
  return campaign ? `Campaign: ${campaign.name}` : 'Ready for review'
}

function storedView(value: string | null, allowCalendar: boolean): View | null {
  if (!value || !REVIEW_VIEWS.includes(value as View)) return null
  if (value === 'calendar' && !allowCalendar) return null
  return value as View
}

function storedTab(value: string | null): StatusTab | null {
  if (!value || !STATUS_TABS.includes(value as StatusTab)) return null
  return value as StatusTab
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

export default function Review({ initialView }: { initialView?: 'list' | 'board' | 'calendar' } = {}) {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<StatusTab>('Pending Review')
  const [selected, setSelected] = useState<Post | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [view, setView] = useState<View>(initialView ?? 'list')
  const [dragOverTab, setDragOverTab] = useState<StatusTab | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const campaignFilter = searchParams.get('campaign') ?? 'all'   // 'all' | 'adhoc' | <campaign_id>
  const setCampaignFilter = (next: string) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'all') {
      nextParams.delete('campaign')
    } else {
      nextParams.set('campaign', next)
    }
    setSearchParams(nextParams, { replace: true })
  }
  const navigate = useNavigate()
  const preferenceScope = activeProject?.id ?? activeOrg?.id ?? 'global'
  const reviewViewPreferenceKey = `vera-review-view:${preferenceScope}`
  const reviewTabPreferenceKey = `vera-review-tab:${preferenceScope}`
  const businessContext = useMemo(
    () => parseProjectInstructions(activeProject?.instructions).businessContext,
    [activeProject?.instructions],
  )

  useEffect(() => {
    if (initialView) {
      setView(initialView)
      return
    }
    setView(storedView(localStorage.getItem(reviewViewPreferenceKey), false) ?? 'list')
  }, [initialView, reviewViewPreferenceKey])

  useEffect(() => {
    if (initialView === 'calendar' && view === 'calendar') return
    localStorage.setItem(reviewViewPreferenceKey, view)
  }, [initialView, reviewViewPreferenceKey, view])

  useEffect(() => {
    setActiveTab(storedTab(localStorage.getItem(reviewTabPreferenceKey)) ?? 'Pending Review')
  }, [reviewTabPreferenceKey])

  useEffect(() => {
    localStorage.setItem(reviewTabPreferenceKey, activeTab)
  }, [reviewTabPreferenceKey, activeTab])

  useEffect(() => {
    if (!activeOrg?.id) { setCampaigns([]); return }
    let q = supabase.from('campaigns')
      .select('id, name, status, is_pinned, color, theme, start_date, end_date, project_id')
      .eq('org_id', activeOrg.id)
      .order('is_pinned', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ data }) => setCampaigns((data as Campaign[]) ?? []))
  }, [activeOrg?.id, activeProject?.id])

  const campaignsById = useMemo(() => new Map(campaigns.map(c => [c.id, c])), [campaigns])

  useEffect(() => {
    // Scope posts to active workspace + project. Without the project
    // filter, switching projects would show all posts from every project
    // the feature would feel dead.
    if (!activeOrg?.id) { setPosts([]); setLoading(false); return }
    setLoading(true)
    let q = supabase.from('content_posts').select('*').order('created_at', { ascending: false }).limit(100)
      .eq('org_id', activeOrg.id)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ data }) => { setPosts(data || []); setLoading(false) })

    const matchesScope = (post: Post) => (
      post.org_id === activeOrg.id &&
      (!activeProject?.id || post.project_id === activeProject.id)
    )

    const channel = supabase.channel('review-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_posts' }, payload => {
        if (payload.eventType === 'DELETE') {
          const oldPost = payload.old as Post
          setPosts(prev => prev.filter(p => p.id !== oldPost.id))
          setSelected(prev => prev?.id === oldPost.id ? null : prev)
          return
        }

        const nextPost = payload.new as Post
        const inScope = matchesScope(nextPost)

        if (payload.eventType === 'UPDATE') {
          setPosts(prev => {
            const exists = prev.some(p => p.id === nextPost.id)
            if (!inScope) return prev.filter(p => p.id !== nextPost.id)
            if (exists) return prev.map(p => p.id === nextPost.id ? nextPost : p)
            return [nextPost, ...prev]
          })
          setSelected(prev => {
            if (prev?.id !== nextPost.id) return prev
            return inScope ? nextPost : null
          })
        }

        if (payload.eventType === 'INSERT' && inScope) {
          setPosts(prev => prev.some(p => p.id === nextPost.id) ? prev : [nextPost, ...prev])
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeOrg?.id, activeProject?.id])

  async function moveToTab(postId: string, targetTab: StatusTab, feedback?: string) {
    const rule = TAB_DROP_ACTION[targetTab]
    if (rule.kind === 'forbidden') {
      alert(targetTab === 'Scheduled'
        ? `Scheduling needs a date. Use the Calendar page to place this post.`
        : `Can't drop here, "Posted" needs a live URL. Use the post detail page to mark it posted.`)
      return
    }
    setSaving(postId)
    if (rule.kind === 'webhook' && rule.action) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(APPROVAL_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ post_id: postId, action: rule.action, ...(feedback ? { feedback } : {}) }),
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

  const scoped = useMemo(
    () => posts.filter(post => matchesReviewFilters(post, filters, campaignFilter, campaignsById)),
    [posts, filters, campaignFilter, campaignsById],
  )
  const filtered = useMemo(() => scoped.filter(p => tabFor(p) === activeTab), [scoped, activeTab])

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = scoped.filter(p => tabFor(p) === tab).length
    return acc
  }, {} as Record<StatusTab, number>)
  const reviewMetrics = useMemo(() => ({
    total: scoped.length,
    drafts: scoped.filter(p => tabFor(p) === 'Draft').length,
    pending: scoped.filter(p => tabFor(p) === 'Pending Review').length,
    changes: scoped.filter(p => tabFor(p) === 'Changes Requested').length,
    approved: scoped.filter(p => tabFor(p) === 'Approved').length,
    scheduled: scoped.filter(p => tabFor(p) === 'Scheduled').length,
    needsDate: scoped.filter(p => tabFor(p) === 'Approved' && !targetDate(p)).length,
    posted: scoped.filter(p => tabFor(p) === 'Posted').length,
    rejected: scoped.filter(p => tabFor(p) === 'Rejected').length,
  }), [scoped])
  const platformOptions = useMemo(() => uniqueValues(posts.map(platformValue)), [posts])
  const ownerOptions = useMemo(() => uniqueValues(posts.map(postOwner)), [posts])
  const mediaOptions = useMemo(() => uniqueValues(posts.map(mediaKind)), [posts])
  const activeFilterCount = useMemo(() => (
    Object.values(filters).filter(value => value !== 'all' && value !== '').length + (campaignFilter !== 'all' ? 1 : 0)
  ), [filters, campaignFilter])
  const selectedCount = selectedIds.size
  const postReviewPath = (postId: string) => activeProject?.slug ? `/p/${activeProject.slug}/review/${postId}` : `/review/${postId}`
  const calendarPath = activeProject?.slug ? `/p/${activeProject.slug}/calendar` : '/calendar'

  useRightRail(
    <ReviewRightRail
      post={selected}
      saving={saving}
      onClose={() => setSelected(null)}
      onMove={moveToTab}
      onRequestChanges={requestChanges}
      detailPath={selected ? postReviewPath(selected.id) : null}
      calendarPath={calendarPath}
      businessContext={businessContext}
      pendingCount={tabCounts['Pending Review']}
      changesCount={tabCounts['Changes Requested']}
    />,
    [selected, saving, businessContext, tabCounts['Pending Review'], tabCounts['Changes Requested'], calendarPath],
    '380px',
  )

  useEffect(() => {
    const visibleIds = new Set(scoped.map(post => post.id))
    setSelectedIds(prev => {
      let changed = false
      const next = new Set<string>()
      prev.forEach(id => {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [scoped])

  function updateFilter(key: keyof ReviewFilters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  function resetFilters() {
    setFilters(DEFAULT_REVIEW_FILTERS)
    setCampaignFilter('all')
  }

  function toggleSelected(postId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function requestChanges(postId: string) {
    const feedback = window.prompt('What needs to change?')
    if (!feedback?.trim()) return
    await moveToTab(postId, 'Changes Requested', feedback.trim())
  }

  async function bulkMove(targetTab: StatusTab) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (targetTab === 'Rejected' && !window.confirm('Reject selected posts?')) return
    setBulkSaving(true)
    try {
      for (const id of ids) {
        await moveToTab(id, targetTab)
      }
      clearSelection()
    } finally {
      setBulkSaving(false)
    }
  }

  async function bulkRequestChanges() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const feedback = window.prompt('What should change on the selected posts?')
    if (!feedback?.trim()) return
    setBulkSaving(true)
    try {
      for (const id of ids) {
        await moveToTab(id, 'Changes Requested', feedback.trim())
      }
      clearSelection()
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div className="p-6 h-full min-h-0 min-w-0 overflow-hidden flex flex-col">
      {/* Page header */}
      <div className="flex items-end justify-between mb-5 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-[28px] leading-tight tracking-tight font-semibold" style={{ color: 'var(--ink)' }}>
            Review queue
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ghost)' }}>
            {scoped.length} of {posts.length} posts, {tabCounts['Pending Review']} pending review, {tabCounts['Changes Requested']} changes requested
          </p>
        </div>
      </div>

      <ProductionCockpit
        metrics={reviewMetrics}
        projectName={activeProject?.name ?? 'this space'}
        currentView={view}
        onViewChange={setView}
        allowCalendar={initialView === 'calendar'}
        onOpenCalendar={() => navigate(calendarPath)}
      />
      <ReviewMetrics metrics={reviewMetrics} />
      <ReviewToolbar
        filters={filters}
        campaigns={campaigns}
        campaignFilter={campaignFilter}
        platformOptions={platformOptions}
        ownerOptions={ownerOptions}
        mediaOptions={mediaOptions}
        activeFilterCount={activeFilterCount}
        onCampaignChange={setCampaignFilter}
        onFilterChange={updateFilter}
        onReset={resetFilters}
      />
      <BulkActionBar
        selectedCount={selectedCount}
        bulkSaving={bulkSaving}
        onClear={clearSelection}
        onMoveToReview={() => bulkMove('Pending Review')}
        onApprove={() => bulkMove('Approved')}
        onRequestChanges={bulkRequestChanges}
        onReject={() => bulkMove('Rejected')}
      />

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
          onRequestChanges={requestChanges}
          campaignsById={campaignsById}
          postReviewPath={postReviewPath}
          calendarPath={calendarPath}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          activeFilterCount={activeFilterCount}
          onResetFilters={resetFilters}
          businessContext={businessContext}
        />
      )}
      {view === 'calendar' && (
        <CalendarView
          posts={scoped}
          loading={loading}
          onOpen={(p) => setSelected(p)}
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
          onRequestChanges={requestChanges}
          onOpen={(p) => setSelected(p)}
          postReviewPath={postReviewPath}
          calendarPath={calendarPath}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          businessContext={businessContext}
        />
      )}
    </div>
  )
}

function ProductionCockpit({
  metrics,
  projectName,
  currentView,
  allowCalendar,
  onViewChange,
  onOpenCalendar,
}: {
  metrics: ReviewMetricSummary
  projectName: string
  currentView: View
  allowCalendar: boolean
  onViewChange: (view: View) => void
  onOpenCalendar: () => void
}) {
  const blockers = metrics.changes + metrics.needsDate + metrics.rejected
  const readyToPublish = metrics.scheduled + metrics.approved
  const recommendation = metrics.changes > 0
    ? {
      label: 'Resolve feedback',
      title: `${metrics.changes} post${metrics.changes === 1 ? '' : 's'} need edits before they can move forward.`,
      body: 'Start with requested changes, then return approved work to the calendar.',
      tone: 'warning' as const,
    }
    : metrics.pending > 0
      ? {
        label: 'Review next',
        title: `${metrics.pending} post${metrics.pending === 1 ? '' : 's'} are waiting for a decision.`,
        body: 'Approve, request changes, or reject before the production queue expands.',
        tone: 'info' as const,
      }
      : metrics.needsDate > 0
        ? {
          label: 'Schedule approved work',
          title: `${metrics.needsDate} approved post${metrics.needsDate === 1 ? '' : 's'} need a publish date.`,
          body: 'Use Calendar to place them into the channel plan.',
          tone: 'danger' as const,
        }
        : {
          label: 'Queue healthy',
          title: metrics.total ? 'Production is moving without obvious blockers.' : 'No production items are visible yet.',
          body: metrics.total ? 'Keep an eye on scheduled work and learning signals after posts go live.' : 'Ask VERA to draft a campaign or import existing posts to start the loop.',
          tone: 'success' as const,
        }
  const toneColor = recommendation.tone === 'warning'
    ? 'var(--warn)'
    : recommendation.tone === 'danger'
      ? 'var(--danger)'
      : recommendation.tone === 'success'
        ? 'var(--success)'
        : 'var(--info)'
  return (
    <section
      className="mb-3 p-4 flex-shrink-0"
      style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--accent)' }}>
            <Target size={14} />
            <span className="text-[11px] uppercase font-semibold">Publishing workflow</span>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[18px] leading-snug font-semibold" style={{ color: 'var(--ink)' }}>
                {projectName}
              </h2>
            </div>
            <div className="inline-flex p-0.5" style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}>
              <PipelineViewButton active={currentView === 'list'} icon={<LayoutList size={13} />} label="List" onClick={() => onViewChange('list')} />
              <PipelineViewButton active={currentView === 'board'} icon={<LayoutGrid size={13} />} label="Board" onClick={() => onViewChange('board')} />
              {allowCalendar && (
                <PipelineViewButton active={currentView === 'calendar'} icon={<CalendarIcon size={13} />} label="Calendar" onClick={() => onViewChange('calendar')} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <PipelineStage label="Draft" value={metrics.drafts} detail="creation" tone="neutral" />
            <PipelineStage label="Review" value={metrics.pending + metrics.changes} detail={`${metrics.changes} changes`} tone={metrics.changes ? 'warning' : 'info'} />
            <PipelineStage label="Ready" value={readyToPublish} detail={`${metrics.needsDate} need date`} tone={metrics.needsDate ? 'danger' : 'success'} />
            <PipelineStage label="Live" value={metrics.posted} detail={`${metrics.scheduled} scheduled`} tone="success" />
          </div>
        </div>

        <aside style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
          <div className="flex items-center gap-2 text-[11px] uppercase font-semibold mb-2" style={{ color: toneColor }}>
            <Sparkles size={13} />
            {recommendation.label}
          </div>
          <div className="text-[13px] leading-snug font-semibold" style={{ color: 'var(--ink)' }}>
            {recommendation.title}
          </div>
          <p className="text-[12px] leading-relaxed mt-2" style={{ color: 'var(--ink-quiet)' }}>
            {recommendation.body}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: blockers ? 'var(--warn)' : 'var(--success)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: blockers ? 'var(--warn)' : 'var(--success)' }} />
              {blockers} blockers
            </span>
            <button
              type="button"
              onClick={onOpenCalendar}
              className="inline-flex items-center gap-1.5 ml-auto text-[12px] font-medium"
              style={{ color: 'var(--ink)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <CalendarPlus size={13} />
              Calendar
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function PipelineViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px]"
      style={{
        background: active ? 'var(--paper-warm)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ghost)',
        border: 'none',
        borderRadius: '7px',
        fontWeight: active ? 600 : 450,
        cursor: 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function PipelineStage({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number
  detail: string
  tone: 'neutral' | 'warning' | 'success' | 'info' | 'danger'
}) {
  const dot =
    tone === 'warning' ? 'var(--warn)'
    : tone === 'success' ? 'var(--success)'
    : tone === 'info' ? 'var(--info)'
    : tone === 'danger' ? 'var(--danger)'
    : 'var(--ghost)'
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-md)', padding: '10px' }}>
      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ghost)' }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, flexShrink: 0 }} />
        {label}
      </div>
      <div className="text-[20px] leading-tight font-semibold mt-1" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--ghost)' }}>{detail}</div>
    </div>
  )
}

function ReviewMetrics({ metrics }: { metrics: ReviewMetricSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mb-3 flex-shrink-0">
      <MetricPill label="Visible" value={metrics.total} tone="neutral" />
      <MetricPill label="Review" value={metrics.pending} tone="warning" />
      <MetricPill label="Changes" value={metrics.changes} tone="warning" />
      <MetricPill label="Approved" value={metrics.approved} tone="success" />
      <MetricPill label="Scheduled" value={metrics.scheduled} tone="info" />
      <MetricPill label="Needs date" value={metrics.needsDate} tone="danger" icon={<AlertTriangle size={13} />} />
      <MetricPill label="Posted" value={metrics.posted} tone="success" />
      <MetricPill label="Parked" value={metrics.rejected} tone="muted" />
    </div>
  )
}

function MetricPill({
  label, value, tone, icon,
}: {
  label: string
  value: number
  tone: 'neutral' | 'warning' | 'success' | 'info' | 'danger' | 'muted'
  icon?: React.ReactNode
}) {
  const color =
    tone === 'warning' ? 'var(--warn)'
    : tone === 'success' ? 'var(--success)'
    : tone === 'info' ? 'var(--info)'
    : tone === 'danger' ? 'var(--danger)'
    : tone === 'muted' ? 'var(--ghost)'
    : 'var(--ink)'
  return (
    <div
      className="min-w-0 px-3 py-2"
      style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-md)' }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color }}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-[20px] leading-tight font-semibold mt-1" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

function ReviewToolbar({
  filters,
  campaigns,
  campaignFilter,
  platformOptions,
  ownerOptions,
  mediaOptions,
  activeFilterCount,
  onCampaignChange,
  onFilterChange,
  onReset,
}: {
  filters: ReviewFilters
  campaigns: Campaign[]
  campaignFilter: string
  platformOptions: string[]
  ownerOptions: string[]
  mediaOptions: string[]
  activeFilterCount: number
  onCampaignChange: (value: string) => void
  onFilterChange: (key: keyof ReviewFilters, value: string) => void
  onReset: () => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-3 p-2 flex-shrink-0"
      style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-md)' }}
    >
      <div
        className="flex items-center gap-2 min-w-[220px] flex-1 px-3 py-2"
        style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}
      >
        <Search size={14} style={{ color: 'var(--ghost)' }} />
        <input
          value={filters.search}
          onChange={e => onFilterChange('search', e.target.value)}
          placeholder="Search posts, copy, feedback"
          className="w-full text-[13px] outline-none"
          style={{ background: 'transparent', color: 'var(--ink)' }}
        />
      </div>
      <FilterSelect
        icon={<Layers size={13} />}
        label="Campaign"
        value={campaignFilter}
        onChange={onCampaignChange}
        options={[
          { value: 'all', label: 'All campaigns' },
          { value: 'adhoc', label: 'Ad-hoc only' },
          ...campaigns.map(campaign => ({
            value: campaign.id,
            label: `${campaign.is_pinned ? '★ ' : ''}${campaign.name}${campaign.status !== 'active' ? `, ${campaign.status}` : ''}`,
          })),
        ]}
      />
      <FilterSelect
        icon={<Filter size={13} />}
        label="Platform"
        value={filters.platform}
        onChange={value => onFilterChange('platform', value)}
        options={[{ value: 'all', label: 'All platforms' }, ...platformOptions.map(option => ({ value: option, label: option }))]}
      />
      <FilterSelect
        label="Media"
        value={filters.media}
        onChange={value => onFilterChange('media', value)}
        options={[{ value: 'all', label: 'All media' }, ...mediaOptions.map(option => ({ value: option, label: mediaKindLabel(option) }))]}
      />
      <FilterSelect
        label="Owner"
        value={filters.owner}
        onChange={value => onFilterChange('owner', value)}
        options={[{ value: 'all', label: 'All owners' }, ...ownerOptions.map(option => ({ value: option, label: option }))]}
      />
      <FilterSelect
        label="Date"
        value={filters.date}
        onChange={value => onFilterChange('date', value)}
        options={[
          { value: 'all', label: 'Any date' },
          { value: 'this_week', label: 'This week' },
          { value: 'unscheduled', label: 'Unscheduled' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'posted', label: 'Posted' },
        ]}
      />
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] transition-colors"
          style={{ color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '8px', background: 'var(--paper)' }}
        >
          <X size={13} /> Clear {activeFilterCount}
        </button>
      )}
    </div>
  )
}

function FilterSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label
      className="inline-flex items-center gap-1.5 px-2.5 py-2 text-[12px]"
      style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '8px', color: 'var(--ghost)' }}
    >
      {icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="outline-none cursor-pointer max-w-[180px]"
        style={{ background: 'transparent', color: 'var(--ink)', border: 'none', fontFamily: 'var(--font-body)' }}
        aria-label={label}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function BulkActionBar({
  selectedCount,
  bulkSaving,
  onClear,
  onMoveToReview,
  onApprove,
  onRequestChanges,
  onReject,
}: {
  selectedCount: number
  bulkSaving: boolean
  onClear: () => void
  onMoveToReview: () => void
  onApprove: () => void
  onRequestChanges: () => void
  onReject: () => void
}) {
  if (selectedCount === 0) return null
  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 flex-shrink-0"
      style={{ background: 'var(--accent-tint)', border: '1px solid var(--accent-rule)', borderRadius: 'var(--radius-md)' }}
    >
      <span className="text-[12px] font-medium mr-1" style={{ color: 'var(--ink)' }}>
        {selectedCount} selected
      </span>
      <BulkButton icon={<Send size={13} />} label="Send to review" onClick={onMoveToReview} disabled={bulkSaving} />
      <BulkButton icon={<Check size={13} />} label="Approve" onClick={onApprove} disabled={bulkSaving} />
      <BulkButton icon={<MessageSquare size={13} />} label="Request changes" onClick={onRequestChanges} disabled={bulkSaving} />
      <BulkButton icon={<X size={13} />} label="Reject" onClick={onReject} disabled={bulkSaving} danger />
      <button
        type="button"
        onClick={onClear}
        disabled={bulkSaving}
        className="ml-auto text-[12px] px-2 py-1.5 disabled:opacity-50"
        style={{ color: 'var(--ghost)' }}
      >
        Clear selection
      </button>
    </div>
  )
}

function BulkButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
      style={{
        background: 'var(--paper)',
        color: danger ? 'var(--danger)' : 'var(--ink)',
        border: '1px solid var(--paper-edge)',
        borderRadius: '8px',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── List view (existing UX, refactored) ─────────────────────────────────
function ListView({
  loading, activeTab, setActiveTab, tabCounts, filtered, selected, setSelected, saving, moveToTab, onRequestChanges, campaignsById, postReviewPath, calendarPath, selectedIds, onToggleSelected, activeFilterCount, onResetFilters, businessContext,
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
  moveToTab: (postId: string, target: StatusTab, feedback?: string) => void | Promise<void>
  onRequestChanges: (postId: string) => void | Promise<void>
  campaignsById: Map<string, Campaign>
  postReviewPath: (postId: string) => string
  calendarPath: string
  selectedIds: Set<string>
  onToggleSelected: (postId: string) => void
  activeFilterCount: number
  onResetFilters: () => void
  businessContext: BusinessContext
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-0.5 overflow-x-auto" style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 min-w-[112px] px-3 py-1.5 text-[12px] transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
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

        <div className="flex-1 min-h-0 overflow-auto space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--ghost)' }}>Loading posts…</div>
          ) : filtered.length === 0 ? (
            <EmptyLaneState tab={activeTab} filtersActive={activeFilterCount > 0} onResetFilters={onResetFilters} />
          ) : filtered.map(post => {
            const campaign = post.campaign_id ? campaignsById.get(post.campaign_id) : null
            const currentTab = tabFor(post)
            const isSelected = selectedIds.has(post.id)
            const approvalRoute = approvalRouteForPost(post, businessContext)
            return (
              <div
                key={post.id}
                onClick={() => setSelected(post)}
                className="cursor-pointer p-4 transition-all relative"
                style={{
                  background: 'var(--paper)',
                  border: `1px solid ${selected?.id === post.id || isSelected ? 'var(--oxblood)' : 'var(--paper-edge)'}`,
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: selected?.id === post.id || isSelected ? '0 1px 3px rgba(37,99,235,0.16)' : 'none',
                }}
              >
                {/* Campaign tint, left edge bar */}
                {campaign && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[2px]"
                    style={{ background: 'var(--ink)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
                    title={`Campaign: ${campaign.name}`}
                  />
                )}
                <div className="flex items-start justify-between gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    aria-label={`Select ${post.title || 'post'}`}
                    onClick={e => e.stopPropagation()}
                    onChange={() => onToggleSelected(post.id)}
                    className="mt-1 h-4 w-4 flex-shrink-0"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 min-w-0">
                      <PlatformChip channel={post.channel} />
                      <StatusChip status={lifecycleLabel(post)} />
                      {campaign && (
                        <span className="text-[12px] truncate" style={{ color: 'var(--ghost)' }} title={campaign.theme || campaign.name}>
                          {campaign.name}
                        </span>
                      )}
                      <span className="text-[12px] ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
                    </div>
                    <p className="font-display text-[15px] leading-snug truncate" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>{post.title || 'Untitled post'}</p>
                    <p className="text-[12px] mt-1 line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>{post.copy}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px]" style={{ color: 'var(--ghost)' }}>
                      <span>{postMeta(post, campaign ?? null)}</span>
                      <span>Media: {mediaKindLabel(mediaKind(post))}</span>
                      <span>Owner: {postOwner(post)}</span>
                      <ApprovalRouteChip route={approvalRoute} />
                      {currentTab === 'Posted' && post.posted_url && (
                        <a
                          href={post.posted_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 underline"
                          style={{ color: 'var(--ink-quiet)' }}
                        >
                          <ExternalLink size={11} /> Destination
                        </a>
                      )}
                    </div>
                    {currentTab === 'Changes Requested' && post.feedback && (
                      <p
                        className="mt-2 text-[12px] line-clamp-2"
                        style={{ color: 'var(--warn)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: '8px', padding: '6px 8px' }}
                      >
                        {post.feedback}
                      </p>
                    )}
                    {currentTab === 'Rejected' && post.feedback && (
                      <p
                        className="mt-2 text-[12px] line-clamp-2"
                        style={{ color: 'var(--ghost)', background: 'var(--fog)', border: '1px solid var(--paper-edge)', borderRadius: '8px', padding: '6px 8px' }}
                      >
                        {post.feedback}
                      </p>
                    )}
                    <PostQuickActions
                      post={post}
                      saving={saving === post.id}
                      onMove={moveToTab}
                      onRequestChanges={onRequestChanges}
                      detailPath={postReviewPath(post.id)}
                      calendarPath={calendarPath}
                    />
                  </div>
                  <PostMediaThumb post={post} className="w-24 h-24 flex-shrink-0" />
                </div>
              </div>
            )
          })}
        </div>
    </div>
  )
}

function postMediaFrames(post: Post): MediaFrame[] {
  const frames = post.media_metadata?.frames
  if (!Array.isArray(frames)) return []
  return frames.filter((frame): frame is MediaFrame => (
    !!frame &&
    typeof frame === 'object' &&
    typeof (frame as { url?: unknown }).url === 'string' &&
    (frame as { url: string }).url.length > 0
  ))
}

function PostMediaThumb({ post, className = '' }: { post: Post; className?: string }) {
  const frames = postMediaFrames(post)
  const firstFrame = frames[0]
  const label = post.media_type === 'carousel' && frames.length > 0
    ? `${frames.length} frames`
    : post.media_type === 'video' && post.media_url
      ? 'Video'
      : null

  if (!firstFrame && !post.media_url) return null

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--paper-edge)', background: 'var(--fog)' }}
    >
      {post.media_type === 'video' && post.media_url ? (
        <video src={post.media_url} muted playsInline preload="metadata" className="w-full h-full object-cover block" />
      ) : (
        <img src={firstFrame?.url ?? post.media_url} alt="" className="w-full h-full object-cover block" />
      )}
      {label && (
        <span
          className="absolute right-1.5 top-1.5 text-[10px] font-medium"
          style={{ background: 'rgba(14,14,15,0.72)', color: '#fff', padding: '2px 6px', borderRadius: '2px' }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

// ─── Board view (lifecycle columns with HTML5 drag/drop) ───────────
function BoardView({
  posts, loading, tabCounts, dragOverTab, setDragOverTab, onMove, onRequestChanges, onOpen, campaignsById, postReviewPath, calendarPath, selectedIds, onToggleSelected, businessContext,
}: {
  posts: Post[]
  loading: boolean
  tabCounts: Record<StatusTab, number>
  dragOverTab: StatusTab | null
  setDragOverTab: React.Dispatch<React.SetStateAction<StatusTab | null>>
  onMove: (postId: string, target: StatusTab, feedback?: string) => void | Promise<void>
  onRequestChanges: (postId: string) => void | Promise<void>
  onOpen: (p: Post) => void
  campaignsById: Map<string, Campaign>
  postReviewPath: (postId: string) => string
  calendarPath: string
  selectedIds: Set<string>
  onToggleSelected: (postId: string) => void
  businessContext: BusinessContext
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
    <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden pb-2">
      <div className="grid grid-cols-7 gap-3 h-full min-w-[1540px]">
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
              className="flex flex-col min-w-0 min-h-0"
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
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                {columnPosts.length === 0 ? (
                  <EmptyLaneState tab={tab} compact />
                ) : columnPosts.map(post => (
                  <BoardCard
                    key={post.id}
                    post={post}
                    campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                    onOpen={() => onOpen(post)}
                    onMove={onMove}
                    onRequestChanges={onRequestChanges}
                    detailPath={postReviewPath(post.id)}
                    calendarPath={calendarPath}
                    selected={selectedIds.has(post.id)}
                    onToggleSelected={() => onToggleSelected(post.id)}
                    draggable={!isPosted(post)}
                    businessContext={businessContext}
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

function BoardCard({
  post,
  campaign,
  onOpen,
  onMove,
  onRequestChanges,
  detailPath,
  calendarPath,
  selected,
  onToggleSelected,
  draggable,
  businessContext,
}: {
  post: Post
  campaign: Campaign | null
  onOpen: () => void
  onMove: (postId: string, target: StatusTab, feedback?: string) => void | Promise<void>
  onRequestChanges: (postId: string) => void | Promise<void>
  detailPath: string
  calendarPath: string
  selected: boolean
  onToggleSelected: () => void
  draggable: boolean
  businessContext: BusinessContext
}) {
  const [isDragging, setIsDragging] = useState(false)
  const currentTab = tabFor(post)
  const approvalRoute = approvalRouteForPost(post, businessContext)
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
        border: `1px solid ${selected ? 'var(--oxblood)' : 'var(--paper-edge)'}`,
        borderRadius: '3px',
        opacity: isDragging ? 0.4 : 1,
        cursor: draggable ? 'grab' : 'pointer',
        boxShadow: selected ? '0 1px 3px rgba(37,99,235,0.14)' : 'none',
      }}
    >
      {/* Campaign tint, left edge bar */}
      {campaign && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px]"
          style={{ background: 'var(--ink)', opacity: 0.6, borderRadius: '0 1px 1px 0' }}
          title={`Campaign: ${campaign.name}`}
        />
      )}
      <div className="flex items-start gap-2 mb-2">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${post.title || 'post'}`}
          onClick={e => e.stopPropagation()}
          onChange={onToggleSelected}
          className="mt-0.5 h-4 w-4 flex-shrink-0"
          style={{ accentColor: 'var(--accent)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <PlatformChip channel={post.channel} size="sm" />
            {campaign && (
              <span className="text-[11px] truncate max-w-[120px]" style={{ color: 'var(--ghost)' }} title={campaign.name}>
                {campaign.name.replace(/^[A-Z][a-z]+ \d+ - /, '')}
              </span>
            )}
            <span className="text-[11px] ml-auto" style={{ color: 'var(--mist)' }}>{relativeTime(post.created_at)}</span>
          </div>
        </div>
      </div>
      <PostMediaThumb post={post} className="w-full h-24 mb-2" />
      <p className="text-[14px] font-medium leading-snug line-clamp-2 mb-1" style={{ color: 'var(--ink)' }}>
        {post.title || 'Untitled post'}
      </p>
      <p className="text-[13px] line-clamp-2" style={{ color: 'var(--ink-quiet)' }}>
        {post.copy?.replace(/^Subject:.+\n+/, '')}
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ghost)' }}>
        {currentTab === 'Approved' && !targetDate(post) && <AlertTriangle size={12} style={{ color: 'var(--danger)' }} />}
        <span className="line-clamp-2">{postMeta(post, campaign)}</span>
      </div>
      <div className="mt-2">
        <ApprovalRouteChip route={approvalRoute} compact />
      </div>
      {currentTab === 'Changes Requested' && post.feedback && (
        <p
          className="mt-2 text-[11px] line-clamp-2"
          style={{ color: 'var(--warn)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: '8px', padding: '5px 7px' }}
        >
          {post.feedback}
        </p>
      )}
      {isPosted(post) && post.posted_url && (
        <a
          href={post.posted_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex max-w-full items-center gap-1 mt-2 text-[10px] font-mono truncate underline"
          style={{ color: 'var(--ink-quiet)' }}
        >
          <ExternalLink size={10} />
          <span className="truncate">Destination</span>
        </a>
      )}
      <PostQuickActions
        post={post}
        saving={false}
        onMove={onMove}
        onRequestChanges={onRequestChanges}
        detailPath={detailPath}
        calendarPath={calendarPath}
        compact
      />
    </div>
  )
}

function EmptyLaneState({
  tab,
  filtersActive = false,
  onResetFilters,
  compact = false,
}: {
  tab: StatusTab
  filtersActive?: boolean
  onResetFilters?: () => void
  compact?: boolean
}) {
  const emptyCopy: Record<StatusTab, string> = {
    'Draft': 'No drafts are waiting here',
    'Pending Review': 'No posts need review',
    'Changes Requested': 'No posts are waiting on edits',
    'Approved': 'No approved posts are waiting',
    'Scheduled': 'No posts are scheduled',
    'Posted': 'No posts are marked posted',
    'Rejected': 'No posts are parked',
  }
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? 'min-h-[96px] px-3 py-4' : 'h-48 px-6'}`}
      style={{ color: 'var(--ghost)' }}
    >
      <span className="text-[12px] font-medium" style={{ color: 'var(--ink-quiet)' }}>
        {filtersActive ? 'No matching posts' : emptyCopy[tab]}
      </span>
      <p className="text-[11px] mt-1 max-w-[240px]" style={{ color: 'var(--ghost)' }}>
        {filtersActive ? 'Try clearing filters or switching status.' : 'This lane is clear.'}
      </p>
      {filtersActive && onResetFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-3 text-[12px] px-3 py-1.5"
          style={{ color: 'var(--ink)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', borderRadius: '8px' }}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function PostQuickActions({
  post,
  saving,
  onMove,
  onRequestChanges,
  detailPath,
  calendarPath,
  compact = false,
}: {
  post: Post
  saving: boolean
  onMove: (postId: string, target: StatusTab, feedback?: string) => void | Promise<void>
  onRequestChanges: (postId: string) => void | Promise<void>
  detailPath: string
  calendarPath: string
  compact?: boolean
}) {
  const currentTab = tabFor(post)
  const canApprove = isActionableReview(post.status) && !isPosted(post)
  const canRequestChanges = ['Pending Review', 'Approved'].includes(currentTab)
  const canReturnToReview = currentTab === 'Draft' || currentTab === 'Changes Requested'
  const canReject = !['Rejected', 'Posted'].includes(currentTab)
  return (
    <div className={`flex items-center gap-1.5 ${compact ? 'mt-2' : 'mt-3'}`}>
      {canReturnToReview && (
        <IconActionButton
          title={currentTab === 'Draft' ? 'Send to review' : 'Return to review'}
          icon={<Send size={13} />}
          onClick={() => onMove(post.id, 'Pending Review')}
          disabled={saving}
        />
      )}
      {canApprove && (
        <IconActionButton title="Approve" icon={<Check size={13} />} onClick={() => onMove(post.id, 'Approved')} disabled={saving} />
      )}
      {canRequestChanges && (
        <IconActionButton title="Request changes" icon={<MessageSquare size={13} />} onClick={() => onRequestChanges(post.id)} disabled={saving} />
      )}
      {currentTab === 'Approved' && !targetDate(post) && (
        <IconActionLink href={calendarPath} title="Schedule in calendar" icon={<CalendarPlus size={13} />} tone="danger" />
      )}
      {currentTab === 'Scheduled' && (
        <IconActionLink href={calendarPath} title="Open in calendar" icon={<CalendarIcon size={13} />} />
      )}
      {currentTab === 'Posted' && post.posted_url && (
        <IconActionLink href={post.posted_url} title="Open destination" icon={<ExternalLink size={13} />} external />
      )}
      {canReject && (
        <IconActionButton title="Reject" icon={<X size={13} />} onClick={() => onMove(post.id, 'Rejected')} disabled={saving} danger />
      )}
      <IconActionLink href={detailPath} title="Open detail" icon={<ExternalLink size={13} />} />
    </div>
  )
}

function IconActionButton({
  title,
  icon,
  onClick,
  disabled,
  danger,
}: {
  title: string
  icon: React.ReactNode
  onClick: () => void
  disabled: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center transition-colors disabled:opacity-40"
      style={{
        color: danger ? 'var(--danger)' : 'var(--ink-quiet)',
        background: 'var(--paper-warm)',
        border: '1px solid var(--paper-edge)',
        borderRadius: '8px',
      }}
    >
      {icon}
    </button>
  )
}

function IconActionLink({
  href,
  title,
  icon,
  external,
  tone,
}: {
  href: string
  title: string
  icon: React.ReactNode
  external?: boolean
  tone?: 'danger'
}) {
  return (
    <a
      href={href}
      title={title}
      aria-label={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      onClick={event => event.stopPropagation()}
      className="inline-flex h-7 w-7 items-center justify-center transition-colors"
      style={{
        color: tone === 'danger' ? 'var(--danger)' : 'var(--ink-quiet)',
        background: 'var(--paper-warm)',
        border: '1px solid var(--paper-edge)',
        borderRadius: '8px',
      }}
    >
      {icon}
    </a>
  )
}

// ─── Right rail: Sprout-style selected message review ───────────────────
function ReviewRightRail({
  post, onClose, saving, onMove, onRequestChanges, detailPath, calendarPath, businessContext, pendingCount, changesCount,
}: {
  post: Post | null
  onClose: () => void
  saving: string | null
  onMove: (postId: string, target: StatusTab, feedback?: string) => void | Promise<void>
  onRequestChanges: (postId: string) => void | Promise<void>
  detailPath: string | null
  calendarPath: string
  businessContext: BusinessContext
  pendingCount: number
  changesCount: number
}) {
  if (!post) {
    return (
      <div className="p-4 h-full flex flex-col gap-4">
        <section
          className="p-5"
          style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
        >
          <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--ghost)' }}>Approval workspace</div>
          <h2 className="text-[17px] leading-snug font-semibold" style={{ color: 'var(--ink)' }}>Select a message</h2>
        </section>
        <section
          className="p-4"
          style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
        >
          <div className="text-[11px] uppercase font-semibold mb-3" style={{ color: 'var(--ghost)' }}>Approval inbox</div>
          <div className="flex flex-col gap-3">
            <RailStat label="Pending review" value={pendingCount} tone="warning" />
            <RailStat label="Changes requested" value={changesCount} tone="warning" />
            <RailStat label="External reviewers" value="Ready" tone="neutral" />
          </div>
        </section>
      </div>
    )
  }
  const currentTab = tabFor(post)
  const isDateScheduled = !!(post.scheduled_at || post.publish_date)
  const canApprove = isActionableReview(post.status) && !isPosted(post)
  const canReject = !['Rejected', 'Posted'].includes(currentTab)
  const canRequestChanges = ['Pending Review', 'Approved'].includes(currentTab)
  const canReturnToReview = currentTab === 'Draft' || currentTab === 'Changes Requested'
  const approvalRoute = approvalRouteForPost(post, businessContext)
  return (
    <div className="p-4 flex flex-col gap-4">
      <section
        className="p-4"
        style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--ghost)' }}>Selected post</div>
            <div className="flex flex-wrap items-center gap-2">
              <PlatformChip channel={post.channel} />
              <StatusChip status={currentTab} />
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[var(--fog)] transition-colors" style={{ color: 'var(--ghost)', borderRadius: 'var(--radius-sm)' }}>
            <X size={14} />
          </button>
        </div>
        <h3 className="text-[16px] font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
          {post.title || 'Untitled'}
        </h3>
        <div className="text-[11px] mt-2" style={{ color: 'var(--ghost)' }}>
          {postOwner(post)} / {mediaKindLabel(mediaKind(post))} / {postMeta(post, null)}
        </div>
      </section>

      <PlatformPostPreview post={post} density="compact" autoplayMedia={false} />

      <section
        className="p-4"
        style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
      >
        <div className="text-[11px] uppercase font-semibold mb-3" style={{ color: 'var(--ghost)' }}>Approval workflow</div>
        <ApprovalRouteSection route={approvalRoute} dense />
        <div className="grid grid-cols-3 gap-2 mt-3">
          <RailStat label="Status" value={currentTab} tone="neutral" compact />
          <RailStat label="Reviewer" value={approvalRoute.label} tone="neutral" compact />
          <RailStat label="Due" value={isDateScheduled ? formatDateOnly(post.scheduled_at || post.publish_date) : 'No date'} tone={isDateScheduled ? 'neutral' : 'warning'} compact />
        </div>
      </section>

      {(post.feedback || currentTab === 'Changes Requested') && (
        <section
          className="p-4"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 'var(--radius-lg)' }}
        >
          <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--warn)' }}>Feedback</div>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-quiet)' }}>
            {post.feedback || 'No written feedback yet.'}
          </p>
        </section>
      )}

      {isPosted(post) && (
        <section
          className="p-4 text-[12px]"
          style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}
        >
          <div className="font-medium mb-1" style={{ color: 'var(--ink-quiet)' }}>Posted to {post.channel}</div>
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
        </section>
      )}

      <div className="flex flex-col gap-2">
        {canReturnToReview && (
          <button onClick={() => onMove(post.id, 'Pending Review')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ background: currentTab === 'Draft' ? 'var(--ink)' : 'var(--paper-warm)', color: currentTab === 'Draft' ? 'var(--paper)' : 'var(--ink)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}>
            {saving === post.id ? 'Saving...' : currentTab === 'Draft' ? 'Send to review' : 'Return to review'}
          </button>
        )}
        {canApprove && (
          <button onClick={() => onMove(post.id, 'Approved')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '8px' }}>
            {saving === post.id ? 'Saving...' : 'Approve'}
          </button>
        )}
        {canRequestChanges && (
          <button onClick={() => onRequestChanges(post.id)} disabled={saving === post.id}
            className="w-full py-2 text-[13px] transition-colors disabled:opacity-50"
            style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}>
            Request changes
          </button>
        )}
        {currentTab === 'Approved' && !isDateScheduled && (
          <a href={calendarPath}
            className="w-full py-2 text-[13px] font-medium text-center transition-colors"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '8px' }}>
            Schedule in calendar
          </a>
        )}
        {currentTab === 'Scheduled' && (
          <a href={calendarPath}
            className="w-full py-2 text-[13px] font-medium text-center transition-colors"
            style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '8px' }}>
            Open in calendar
          </a>
        )}
        {canReject && (
          <button onClick={() => onMove(post.id, 'Rejected')} disabled={saving === post.id}
            className="w-full py-2 text-[13px] transition-colors disabled:opacity-50"
            style={{ background: 'var(--paper-warm)', color: 'var(--danger)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}>
            Reject
          </button>
        )}
        {detailPath && (
          <a href={detailPath}
            className="w-full py-2 text-[13px] text-center transition-colors"
            style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}>
            Open detail
          </a>
        )}
      </div>
    </div>
  )
}

function RailStat({ label, value, tone, compact = false }: { label: string; value: React.ReactNode; tone: 'neutral' | 'warning'; compact?: boolean }) {
  return (
    <div
      className={compact ? 'p-2' : 'p-3'}
      style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '8px' }}
    >
      <div className="text-[10px] uppercase font-semibold" style={{ color: tone === 'warning' ? 'var(--warn)' : 'var(--ghost)' }}>{label}</div>
      <div className={`${compact ? 'text-[11px]' : 'text-[15px]'} font-semibold mt-1 truncate`} style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

// ─── Calendar view ──────────────────────────────────────────────────────
// Week grid (Mon-Sun) showing posts on their target date. A post's date is:
//   posted_at  > scheduled_at > publish_date
// Drafts without a target date are EXCLUDED, they don't belong to a day
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

  // Open on the week of the next upcoming scheduled post (content is usually
  // planned ahead, so the current week is often empty). Once, after posts load,
  // and never fighting subsequent user navigation.
  const jumpedRef = useRef(false)
  useEffect(() => {
    if (jumpedRef.current || posts.length === 0) return
    jumpedRef.current = true
    const todayKey = isoDay(new Date())
    const upcoming = posts
      .map(p => p.scheduled_at || p.publish_date || p.posted_at)
      .filter((d): d is string => !!d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()) && isoDay(d) >= todayKey)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    if (upcoming) setWeekStart(mondayOf(upcoming))
  }, [posts])

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

  const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${
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
