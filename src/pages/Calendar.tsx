import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CalendarDays, CalendarPlus, ChartGantt, Check, ChevronLeft, ChevronRight, Clock, Columns3, Filter, Inbox, KanbanSquare, ListChecks, MapPin, Plus, RotateCcw, Share2, Target, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Campaign, Post } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { parseProjectInstructions, type BusinessContext } from '../lib/businessContext'
import { approvalRouteForPost, type ApprovalRoute } from '../lib/approvalRouting'
import { PlatformChip, StatusChip } from '../components/Chip'
import { color, radius, type as t } from '../design'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
type CalendarGridMode = 'day' | 'week' | 'month'
type CalendarMode = 'calendar' | 'agenda' | 'gantt' | 'kanban' | 'platform' | 'workload' | 'planner'
type FilterState = {
  platform: string
  status: string
  campaign: string
  owner: string
}
type DatedPost = { post: Post; date: Date }
type GanttRow = {
  id: string
  name: string
  status: string
  color?: string | null
  start: Date
  end: Date
  posts: DatedPost[]
}

const VIEW_MODES = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'agenda', label: 'Agenda', icon: ListChecks },
  { id: 'gantt', label: 'Gantt', icon: ChartGantt },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'platform', label: 'Platform', icon: Share2 },
  { id: 'workload', label: 'Workload', icon: BarChart3 },
  { id: 'planner', label: 'Planner', icon: Target },
] as const

const CALENDAR_GRID_MODES: Array<{ id: CalendarGridMode; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const KANBAN_COLUMNS = [
  { id: 'draft', label: 'Draft', dot: color.dotAmber },
  { id: 'review', label: 'Review', dot: color.dotViolet },
  { id: 'approved', label: 'Approved', dot: color.dotGreen },
  { id: 'scheduled', label: 'Scheduled', dot: color.dotBlue },
  { id: 'posted', label: 'Posted', dot: color.dotGreen },
] as const

const PLATFORM_LANES = [
  { id: 'linkedin', label: 'LinkedIn', dot: color.dotBlue },
  { id: 'youtube', label: 'YouTube', dot: color.danger },
  { id: 'medium', label: 'Medium', dot: color.dotViolet },
  { id: 'quora', label: 'Quora', dot: '#b92b27' },
  { id: 'reddit', label: 'Reddit', dot: '#ea580c' },
  { id: 'x', label: 'X', dot: color.dotSky },
  { id: 'instagram', label: 'Instagram', dot: color.dotPink },
  { id: 'facebook', label: 'Facebook', dot: '#6366F1' },
  { id: 'blog', label: 'Blog', dot: color.dotAmber },
  { id: 'email', label: 'Email', dot: color.dotGreen },
  { id: 'other', label: 'Other', dot: color.ghost },
] as const

const DAILY_POST_CAPACITY = 4
const DAILY_REVIEW_CAPACITY = 3
const DRAG_POST_MIME = 'application/x-vera-post-id'
const DANGER_TINT = 'color-mix(in srgb, var(--danger) 10%, var(--surface))'
const DANGER_LINE = 'color-mix(in srgb, var(--danger) 42%, var(--line))'
const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const DEFAULT_FILTERS: FilterState = {
  platform: 'all',
  status: 'all',
  campaign: 'all',
  owner: 'all',
}
type KanbanStatus = (typeof KANBAN_COLUMNS)[number]['id']
type PlatformLaneId = (typeof PLATFORM_LANES)[number]['id']

export default function Calendar() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const navigate = useNavigate()
  const today = useMemo(() => new Date(), [])
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [posts, setPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>(() => isoDay(today))
  const [viewMode, setViewMode] = useState<CalendarMode>('calendar')
  const [calendarGridMode, setCalendarGridMode] = useState<CalendarGridMode>('month')
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [savingPostId, setSavingPostId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [dayDrawerOpen, setDayDrawerOpen] = useState(true)
  const calendarPreferenceKey = `vera-calendar-view:${activeProject?.id ?? activeOrg?.id ?? 'global'}`
  const businessContext = useMemo(
    () => parseProjectInstructions(activeProject?.instructions).businessContext,
    [activeProject?.instructions],
  )

  useEffect(() => {
    if (!activeOrg?.id) {
      setPosts([])
      setCampaigns([])
      setLoading(false)
      return
    }

    setLoading(true)
    let postQuery = supabase
      .from('content_posts')
      .select('*')
      .eq('org_id', activeOrg.id)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('publish_date', { ascending: true, nullsFirst: false })
      .limit(250)

    let campaignQuery = supabase
      .from('campaigns')
      .select('id, name, status, is_pinned, color, theme, description, goal, platforms, post_count, start_date, end_date, project_id')
      .eq('org_id', activeOrg.id)
      .order('start_date', { ascending: true, nullsFirst: false })

    if (activeProject?.id) {
      postQuery = postQuery.eq('project_id', activeProject.id)
      campaignQuery = campaignQuery.eq('project_id', activeProject.id)
    }

    Promise.all([postQuery, campaignQuery])
      .then(([postResult, campaignResult]) => {
        setPosts((postResult.data as Post[]) ?? [])
        setCampaigns((campaignResult.data as Campaign[]) ?? [])
      })
      .finally(() => setLoading(false))
  }, [activeOrg?.id, activeProject?.id])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(calendarPreferenceKey)
      if (!saved) return
      const parsed = JSON.parse(saved) as { viewMode?: CalendarMode; calendarGridMode?: CalendarGridMode }
      if (parsed.viewMode && VIEW_MODES.some(mode => mode.id === parsed.viewMode)) setViewMode(parsed.viewMode)
      if (parsed.calendarGridMode && CALENDAR_GRID_MODES.some(mode => mode.id === parsed.calendarGridMode)) setCalendarGridMode(parsed.calendarGridMode)
    } catch {
      // Ignore stale preference payloads.
    }
  }, [calendarPreferenceKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(calendarPreferenceKey, JSON.stringify({ viewMode, calendarGridMode }))
    } catch {
      // Preferences are optional.
    }
  }, [calendarPreferenceKey, viewMode, calendarGridMode])

  const month = viewDate.getMonth()
  const year = viewDate.getFullYear()
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const campaignsById = new Map(campaigns.map(campaign => [campaign.id, campaign]))
  const cells = monthCells(year, month)
  const platformOptions = uniqueValues(posts.map(post => platformBucket(post.channel)))
  const ownerOptions = uniqueValues(posts.map(postOwner))
  const filteredPosts = posts.filter(post => {
    if (filters.platform !== 'all' && platformBucket(post.channel) !== filters.platform) return false
    if (filters.status !== 'all' && postStatusBucket(post) !== filters.status) return false
    if (filters.campaign === 'none' && post.campaign_id) return false
    if (filters.campaign !== 'all' && filters.campaign !== 'none' && post.campaign_id !== filters.campaign) return false
    if (filters.owner !== 'all' && postOwner(post) !== filters.owner) return false
    return true
  })

  const datedPosts = filteredPosts
    .map(post => ({ post, date: targetDate(post) }))
    .filter((item): item is DatedPost => !!item.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const postsByDay = new Map<string, Post[]>()
  for (const item of datedPosts) {
    const key = isoDay(item.date)
    if (!postsByDay.has(key)) postsByDay.set(key, [])
    postsByDay.get(key)!.push(item.post)
  }

  const monthPostCount = datedPosts.filter(item => item.date.getFullYear() === year && item.date.getMonth() === month).length
  const unscheduledPosts = filteredPosts.filter(post => !targetDate(post))
  const readyToSchedule = unscheduledPosts.filter(post => isApproved(post))
  const selectedPosts = postsByDay.get(selectedDate) ?? []
  const selectedDayCapacity = selectedPosts.length
  const overCapacityDays = Array.from(postsByDay.entries()).filter(([day, dayPosts]) => {
    const date = parseIsoDay(day)
    return date.getFullYear() === year && date.getMonth() === month && dayPosts.length > DAILY_POST_CAPACITY
  })
  const reviewQueueCount = filteredPosts.filter(post => postStatusBucket(post) === 'review').length
  const policySummary = policySummaryForPosts(filteredPosts, businessContext)
  const activeFilterCount = Object.values(filters).filter(value => value !== 'all').length
  const selectedDateObject = parseIsoDay(selectedDate)
  const weekStart = mondayOf(selectedDateObject)
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart)
    day.setDate(weekStart.getDate() + index)
    return day
  })
  const agendaPosts = datedPosts.filter(item => item.date.getFullYear() === year && item.date.getMonth() === month)
  const periodLabel = viewMode === 'calendar' && calendarGridMode === 'day'
    ? selectedDateObject.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : viewMode === 'calendar' && calendarGridMode === 'week'
      ? `${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${weekDays[6].toLocaleDateString(undefined, { month: weekDays[0].getMonth() === weekDays[6].getMonth() ? undefined : 'short', day: 'numeric' })}`
    : viewMode === 'calendar'
        ? monthLabel
      : `${monthLabel} ${modeLabel(viewMode).toLowerCase()}`

  function movePeriod(delta: number) {
    if (viewMode === 'calendar' && calendarGridMode === 'day') {
      const next = parseIsoDay(selectedDate)
      next.setDate(next.getDate() + delta)
      setSelectedDate(isoDay(next))
      setViewDate(new Date(next.getFullYear(), next.getMonth(), 1))
      return
    }
    if (viewMode === 'calendar' && calendarGridMode === 'week') {
      const next = parseIsoDay(selectedDate)
      next.setDate(next.getDate() + (delta * 7))
      setSelectedDate(isoDay(next))
      setViewDate(new Date(next.getFullYear(), next.getMonth(), 1))
      return
    }
    setViewDate(current => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  function jumpToday() {
    const now = new Date()
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDate(isoDay(now))
  }

  function openPost(post: Post) {
    if (activeProject?.slug) navigate(`/p/${activeProject.slug}/review/${post.id}`)
    else navigate(`/review/${post.id}`)
  }

  function createNewPost() {
    if (activeProject?.slug) navigate(`/p/${activeProject.slug}/vera`)
    else navigate('/vera')
  }

  function selectDate(date: string) {
    setSelectedDate(date)
    setDayDrawerOpen(true)
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS)
  }

  function draggedPostId(event: React.DragEvent) {
    return event.dataTransfer.getData(DRAG_POST_MIME) || event.dataTransfer.getData('text/plain')
  }

  async function schedulePost(postId: string, day: string, hour = 9) {
    const scheduledAt = scheduledIsoForDay(day, hour)
    setSavingPostId(postId)
    setScheduleError(null)
    try {
      const { data, error } = await supabase
        .from('content_posts')
        .update({ scheduled_at: scheduledAt, publish_date: day })
        .eq('id', postId)
        .select()
        .single()

      if (error) throw error
      if (!data) throw new Error('No post was updated. Check access for this client space.')

      setPosts(prev => prev.map(post => post.id === postId ? data as Post : post))
      setSelectedDate(day)
      setDayDrawerOpen(true)
    } catch (error) {
      setScheduleError(`Could not schedule post: ${errorMessage(error, 'Unknown scheduling error')}`)
    } finally {
      setSavingPostId(null)
    }
  }

  async function unschedulePost(postId: string) {
    setSavingPostId(postId)
    setScheduleError(null)
    try {
      const { data, error } = await supabase
        .from('content_posts')
        .update({ scheduled_at: null, publish_date: null })
        .eq('id', postId)
        .select()
        .single()

      if (error) throw error
      if (!data) throw new Error('No post was updated. Check access for this client space.')

      setPosts(prev => prev.map(post => post.id === postId ? data as Post : post))
    } catch (error) {
      setScheduleError(`Could not unschedule post: ${errorMessage(error, 'Unknown scheduling error')}`)
    } finally {
      setSavingPostId(null)
    }
  }

  async function updatePostStatus(postId: string, status: string) {
    setSavingPostId(postId)
    setScheduleError(null)
    try {
      if (status === 'approved' || status === 'rejected' || status === 'changes_requested') {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(APPROVAL_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ post_id: postId, action: status }),
        })
        const payload = await res.json().catch(() => null) as { post?: Post; error?: string } | null
        if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`)
        if (!payload?.post) throw new Error('No post was updated. Check access for this client space.')
        setPosts(prev => prev.map(post => post.id === postId ? payload.post as Post : post))
        return
      }

      const { data, error } = await supabase
        .from('content_posts')
        .update({ status })
        .eq('id', postId)
        .select()
        .single()
      if (error) throw error
      if (!data) throw new Error('No post was updated. Check access for this client space.')

      setPosts(prev => prev.map(post => post.id === postId ? data as Post : post))
    } catch (error) {
      setScheduleError(`Could not update status: ${errorMessage(error, 'Unknown status error')}`)
    } finally {
      setSavingPostId(null)
    }
  }

  function postCardActions(post: Post) {
    const bucket = postStatusBucket(post)
    const disabled = savingPostId === post.id
    return (
      <>
        {bucket === 'review' && (
          <CardActionButton disabled={disabled} icon={<Check size={12} />} label="Approve" onClick={() => updatePostStatus(post.id, 'approved')} />
        )}
        {bucket === 'approved' && !targetDate(post) && (
          <CardActionButton disabled={disabled} icon={<CalendarPlus size={12} />} label="Schedule" onClick={() => schedulePost(post.id, selectedDate)} />
        )}
        {targetDate(post) && bucket !== 'posted' && (
          <CardActionButton disabled={disabled} icon={<RotateCcw size={12} />} label="Unschedule" onClick={() => unschedulePost(post.id)} />
        )}
      </>
    )
  }

  function handleDropOnDay(event: React.DragEvent, day: string, hour = 9) {
    event.preventDefault()
    const postId = draggedPostId(event)
    if (postId) void schedulePost(postId, day, hour)
  }

  return (
    <div className="p-6 h-full flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-5 mb-5">
        <div>
          <h1 className="text-[28px] leading-tight tracking-tight font-semibold" style={{ color: color.ink }}>
            Content calendar
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[13px]" style={{ color: color.ghost }}>
            <span>{monthPostCount} dated posts this month</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-medium" style={{ color: color.danger, background: DANGER_TINT, border: `1px solid ${DANGER_LINE}`, borderRadius: radius.pill }}>
              <AlertTriangle size={12} />
              {unscheduledPosts.length} unscheduled
            </span>
            {policySummary.guarded > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-medium" style={{ color: policySummary.highCare > 0 ? color.danger : color.warn, background: policySummary.highCare > 0 ? DANGER_TINT : color.paper2, border: `1px solid ${policySummary.highCare > 0 ? DANGER_LINE : color.line}`, borderRadius: radius.pill }}>
                <AlertTriangle size={12} />
                {policySummary.guarded} policy checks
              </span>
            )}
            <span>{filteredPosts.length} visible</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button onClick={createNewPost} className="h-9 px-3 text-[13px] font-medium inline-flex items-center gap-2 transition-colors hover:bg-[var(--fog)]" style={buttonStyle}>
              <Plus size={14} />
              New post
            </button>
            <button onClick={() => movePeriod(-1)} title="Previous period" className="w-9 h-9 inline-flex items-center justify-center transition-colors hover:bg-[var(--fog)]" style={iconButtonStyle}>
              <ChevronLeft size={16} />
            </button>
            <button onClick={jumpToday} className="h-9 px-3 text-[13px] font-medium transition-colors hover:bg-[var(--fog)]" style={buttonStyle}>
              Today
            </button>
            <button onClick={() => movePeriod(1)} title="Next period" className="w-9 h-9 inline-flex items-center justify-center transition-colors hover:bg-[var(--fog)]" style={iconButtonStyle}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <CalendarFilters
        filters={filters}
        campaigns={campaigns}
        platformOptions={platformOptions}
        ownerOptions={ownerOptions}
        activeFilterCount={activeFilterCount}
        onChange={setFilters}
        onReset={resetFilters}
      />

      <CalendarWarnings
        scheduleError={scheduleError}
        overCapacityDays={overCapacityDays}
        reviewQueueCount={reviewQueueCount}
        filteredTotal={filteredPosts.length}
        total={posts.length}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5 min-h-0 flex-1">
        <section className="min-h-0 flex flex-col" style={panelStyle}>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${color.line}` }}>
            <div className="inline-flex items-center gap-2 min-w-0">
              <CalendarDays size={15} style={{ color: color.ghost }} />
              <h2 className="text-[15px] font-semibold truncate" style={{ color: color.ink }}>{periodLabel}</h2>
            </div>
            <div className="inline-flex justify-self-center p-0.5" style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
              {VIEW_MODES.map(({ id: mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  aria-label={label}
                  title={label}
                  className="w-9 h-8 inline-flex items-center justify-center transition-colors"
                  style={{
                    border: 'none',
                    borderRadius: radius.sm,
                    background: viewMode === mode ? color.ink : 'transparent',
                    color: viewMode === mode ? color.surface : color.ink2,
                  }}
                >
                  <Icon size={15} strokeWidth={1.8} />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              {viewMode === 'calendar' && (
                <div className="inline-flex p-0.5" style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                  {CALENDAR_GRID_MODES.map(({ id: mode, label }) => (
                    <button
                      key={mode}
                      onClick={() => setCalendarGridMode(mode)}
                      className="h-8 px-3 text-[12px] transition-colors"
                      style={{
                        border: 'none',
                        borderRadius: radius.sm,
                        background: calendarGridMode === mode ? color.ink : 'transparent',
                        color: calendarGridMode === mode ? color.surface : color.ink2,
                        fontWeight: calendarGridMode === mode ? t.weight.semibold : t.weight.medium,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {loading && <span className="text-[12px]" style={{ color: color.ghost }}>Loading...</span>}
            </div>
          </div>

          {viewMode === 'calendar' && calendarGridMode === 'month' && (
            <MonthGrid
              cells={cells}
              postsByDay={postsByDay}
              today={today}
              selectedDate={selectedDate}
              businessContext={businessContext}
              onSelectDate={selectDate}
              onDropPost={handleDropOnDay}
            />
          )}
          {viewMode === 'calendar' && calendarGridMode === 'day' && (
            <DayView
              date={selectedDateObject}
              posts={selectedPosts}
              campaignsById={campaignsById}
              businessContext={businessContext}
              onOpen={openPost}
              onDropPost={handleDropOnDay}
              renderActions={postCardActions}
            />
          )}
          {viewMode === 'calendar' && calendarGridMode === 'week' && (
            <WeekGrid
              days={weekDays}
              postsByDay={postsByDay}
              campaignsById={campaignsById}
              today={today}
              selectedDate={selectedDate}
              businessContext={businessContext}
              onSelectDate={selectDate}
              onOpen={openPost}
              onDropPost={handleDropOnDay}
              renderActions={postCardActions}
            />
          )}
          {viewMode === 'agenda' && (
            <AgendaView
              items={agendaPosts}
              campaignsById={campaignsById}
              businessContext={businessContext}
              onOpen={openPost}
            />
          )}
          {viewMode === 'gantt' && (
            <GanttView
              year={year}
              month={month}
              campaigns={campaigns}
              datedPosts={agendaPosts}
              campaignsById={campaignsById}
              businessContext={businessContext}
              onOpen={openPost}
            />
          )}
          {viewMode === 'kanban' && (
            <KanbanView
              posts={filteredPosts}
              campaignsById={campaignsById}
              businessContext={businessContext}
              onOpen={openPost}
              renderActions={postCardActions}
            />
          )}
          {viewMode === 'platform' && (
            <PlatformView
              posts={filteredPosts}
              campaignsById={campaignsById}
              businessContext={businessContext}
              onOpen={openPost}
              renderActions={postCardActions}
            />
          )}
          {viewMode === 'workload' && (
            <WorkloadView
              year={year}
              month={month}
              postsByDay={postsByDay}
              posts={filteredPosts}
              businessContext={businessContext}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
            />
          )}
          {viewMode === 'planner' && (
            <CampaignPlannerView
              campaigns={campaigns}
              posts={filteredPosts}
              datedPosts={datedPosts}
            />
          )}
        </section>

        <aside className="min-h-0 flex flex-col gap-4">
          {dayDrawerOpen && (
            <DayDrawer
              date={selectedDateObject}
              posts={selectedPosts}
              campaignsById={campaignsById}
              capacity={selectedDayCapacity}
              businessContext={businessContext}
              onClose={() => setDayDrawerOpen(false)}
              onOpen={openPost}
              onDropPost={handleDropOnDay}
              renderActions={postCardActions}
            />
          )}

          <UnscheduledTray
            posts={unscheduledPosts}
            readyCount={readyToSchedule.length}
            campaignsById={campaignsById}
            businessContext={businessContext}
            onOpen={openPost}
            onDragStart={(event, post) => {
              event.dataTransfer.setData(DRAG_POST_MIME, post.id)
              event.dataTransfer.setData('text/plain', post.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            renderActions={postCardActions}
            onCreate={createNewPost}
          />

          <CampaignLegend campaigns={campaigns} />
        </aside>
      </div>
    </div>
  )
}

function MonthGrid({
  cells,
  postsByDay,
  today,
  selectedDate,
  businessContext,
  onSelectDate,
  onDropPost,
}: {
  cells: Array<Date | null>
  postsByDay: Map<string, Post[]>
  today: Date
  selectedDate: string
  businessContext: BusinessContext
  onSelectDate: (date: string) => void
  onDropPost: (event: React.DragEvent, day: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-7" style={{ borderBottom: `1px solid ${color.line}` }}>
        {DAYS.map(day => (
          <div key={day} className="px-3 py-2 text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide }}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr min-h-0 flex-1">
        {cells.map((cell, index) => {
          if (!cell) return <div key={`empty-${index}`} style={emptyCellStyle} />
          const key = isoDay(cell)
          const dayPosts = postsByDay.get(key) ?? []
          const isToday = key === isoDay(today)
          const isSelected = key === selectedDate
          return (
            <button
              key={key}
              onClick={() => onSelectDate(key)}
              onDragOver={event => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={event => onDropPost(event, key)}
              className="min-h-[132px] p-2 text-left transition-colors hover:bg-[var(--paper-2)]"
              style={{
                ...dayCellStyle,
                background: isSelected ? 'var(--accent-tint)' : color.surface,
                boxShadow: isSelected ? `inset 0 0 0 1px ${color.accentLine}` : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="inline-flex items-center justify-center text-[12px] font-semibold"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: radius.pill,
                    background: isToday ? color.ink : 'transparent',
                    color: isToday ? color.surface : color.ink,
                  }}
                >
                  {cell.getDate()}
                </span>
                {dayPosts.length > 0 && (
                  <span className="text-[11px]" style={{ color: isSelected ? color.ink : color.ghost }}>
                    {dayPosts.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {dayPosts.slice(0, 3).map(post => (
                  <CalendarPill key={post.id} post={post} businessContext={businessContext} />
                ))}
                {dayPosts.length > 3 && (
                  <span className="text-[11px]" style={{ color: color.ghost }}>+{dayPosts.length - 3} more</span>
                )}
                {dayPosts.length > DAILY_POST_CAPACITY && (
                  <span className="text-[10px] inline-flex items-center gap-1 mt-1" style={{ color: color.warn }}>
                    <AlertTriangle size={10} /> Heavy day
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

function DayView({
  date,
  posts,
  campaignsById,
  businessContext,
  onOpen,
  onDropPost,
  renderActions,
}: {
  date: Date
  posts: Post[]
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
  onDropPost: (event: React.DragEvent, day: string, hour?: number) => void
  renderActions: (post: Post) => React.ReactNode
}) {
  const timedPosts = posts
    .map(post => ({ post, date: targetDate(post) }))
    .filter((item): item is DatedPost => !!item.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const allDayPosts = timedPosts.filter(item => {
    const hour = item.date.getHours()
    const minute = item.date.getMinutes()
    return hour === 0 && minute === 0
  })
  const hourlyPosts = timedPosts.filter(item => !allDayPosts.some(allDay => allDay.post.id === item.post.id))
  const hours = Array.from({ length: 24 }, (_, index) => index)

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: color.surface, borderBottom: `1px solid ${color.line}` }}>
        <div className="text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide }}>
          {date.toLocaleDateString(undefined, { weekday: 'long' })}
        </div>
        <div className="text-[22px] font-semibold mt-1" style={{ color: color.ink }}>
          {date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div className="p-4">
        {timedPosts.length === 0 ? (
          <div
            onDragOver={event => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={event => onDropPost(event, isoDay(date))}
            className="min-h-[420px] flex items-center justify-center"
          >
            <EmptyCalendarState icon={<Inbox size={20} />} text="No dated posts on this day." />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {allDayPosts.length > 0 && (
              <section style={columnPanelStyle}>
                <div className="px-3 py-2 text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide, borderBottom: `1px solid ${color.line}` }}>
                  All day
                </div>
                <div className="p-2 grid grid-cols-2 gap-2">
                  {allDayPosts.map(item => (
                    <CalendarPostCard
                      key={item.post.id}
                      post={item.post}
                      campaign={item.post.campaign_id ? campaignsById.get(item.post.campaign_id) ?? null : null}
                      businessContext={businessContext}
                      onOpen={() => onOpen(item.post)}
                      actions={renderActions(item.post)}
                    />
                  ))}
                </div>
              </section>
            )}

            <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden' }}>
              {hours.map(hour => {
                const postsInHour = hourlyPosts.filter(item => item.date.getHours() === hour)
                return (
                  <div key={hour} className="grid grid-cols-[82px_minmax(0,1fr)] min-h-[74px]" style={{ borderBottom: `1px solid ${color.line}`, background: color.surface }}>
                    <div className="px-3 py-3 text-[11px] text-right" style={{ color: color.ghost, background: color.paper2, borderRight: `1px solid ${color.line}` }}>
                      {formatHour(hour)}
                    </div>
                    <div
                      onDragOver={event => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={event => onDropPost(event, isoDay(date), hour)}
                      className="p-2 flex flex-col gap-2"
                    >
                      {postsInHour.length === 0 ? (
                        <span className="text-[11px] py-1" style={{ color: color.faint }}>Open</span>
                      ) : postsInHour.map(item => (
                        <CalendarPostCard
                          key={item.post.id}
                          post={item.post}
                          campaign={item.post.campaign_id ? campaignsById.get(item.post.campaign_id) ?? null : null}
                          businessContext={businessContext}
                          onOpen={() => onOpen(item.post)}
                          actions={renderActions(item.post)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WeekGrid({
  days,
  postsByDay,
  campaignsById,
  today,
  selectedDate,
  businessContext,
  onSelectDate,
  onOpen,
  onDropPost,
  renderActions,
}: {
  days: Date[]
  postsByDay: Map<string, Post[]>
  campaignsById: Map<string, Campaign>
  today: Date
  selectedDate: string
  businessContext: BusinessContext
  onSelectDate: (date: string) => void
  onOpen: (post: Post) => void
  onDropPost: (event: React.DragEvent, day: string) => void
  renderActions: (post: Post) => React.ReactNode
}) {
  return (
    <div className="grid grid-cols-7 min-h-0 flex-1">
      {days.map(day => {
        const key = isoDay(day)
        const dayPosts = postsByDay.get(key) ?? []
        const isToday = key === isoDay(today)
        const isSelected = key === selectedDate
        return (
          <div
            key={key}
            onDragOver={event => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={event => onDropPost(event, key)}
            className="min-h-0 flex flex-col"
            style={{ ...dayCellStyle, background: isSelected ? 'var(--accent-tint)' : color.surface }}
          >
            <button onClick={() => onSelectDate(key)} className="text-left px-3 py-3 transition-colors hover:bg-[var(--paper-2)]" style={{ borderBottom: `1px solid ${color.line}` }}>
              <div className="text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide }}>
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div className="mt-1 inline-flex items-center justify-center text-[16px] font-semibold" style={{ width: 30, height: 30, borderRadius: radius.pill, background: isToday ? color.ink : 'transparent', color: isToday ? color.surface : color.ink }}>
                {day.getDate()}
              </div>
            </button>
            <div className="p-2 flex flex-col gap-2 overflow-auto">
              {dayPosts.length === 0 ? (
                <span className="text-[12px] py-2" style={{ color: color.ghost }}>No posts</span>
              ) : dayPosts.map(post => (
                <CalendarPostCard
                  key={post.id}
                  post={post}
                  campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                  businessContext={businessContext}
                  onOpen={() => onOpen(post)}
                  actions={renderActions(post)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AgendaView({
  items,
  campaignsById,
  businessContext,
  onOpen,
}: {
  items: DatedPost[]
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
}) {
  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyCalendarState icon={<Inbox size={20} />} text="No dated posts in this month." />
      </div>
    )
  }

  let lastDay = ''
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        {items.map(item => {
          const day = isoDay(item.date)
          const showDate = day !== lastDay
          lastDay = day
          return (
            <div key={item.post.id}>
              {showDate && (
                <div className="sticky top-0 z-10 py-2 text-[12px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide, background: color.surface }}>
                  {item.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
              )}
              <CalendarPostCard
                post={item.post}
                campaign={item.post.campaign_id ? campaignsById.get(item.post.campaign_id) ?? null : null}
                businessContext={businessContext}
                onOpen={() => onOpen(item.post)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GanttView({
  year,
  month,
  campaigns,
  datedPosts,
  campaignsById,
  businessContext,
  onOpen,
}: {
  year: number
  month: number
  campaigns: Campaign[]
  datedPosts: DatedPost[]
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
}) {
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const days = Array.from({ length: monthEnd.getDate() }, (_, index) => new Date(year, month, index + 1))
  const rows = buildGanttRows(campaigns, datedPosts, campaignsById, monthStart, monthEnd)
  const gridTemplateColumns = `repeat(${days.length}, minmax(30px, 1fr))`
  const todayKey = isoDay(new Date())

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyCalendarState icon={<Inbox size={20} />} text="No campaign timeline for this month." />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="min-w-[1040px]">
        <div className="sticky top-0 z-20 grid grid-cols-[230px_minmax(0,1fr)]" style={{ background: color.surface, borderBottom: `1px solid ${color.line}` }}>
          <div className="px-4 py-3 text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide, borderRight: `1px solid ${color.line}` }}>
            Campaign
          </div>
          <div className="grid" style={{ gridTemplateColumns }}>
            {days.map(day => {
              const key = isoDay(day)
              const isToday = key === todayKey
              return (
                <div
                  key={key}
                  className="px-1 py-2 text-center"
                  style={{
                    color: isToday ? color.ink : color.ghost,
                    background: isToday ? 'var(--accent-tint)' : color.surface,
                    borderRight: `1px solid ${color.line}`,
                  }}
                >
                  <div className="text-[10px] uppercase font-semibold" style={{ letterSpacing: t.letterSpacing.wide }}>
                    {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}
                  </div>
                  <div className="text-[12px] font-semibold mt-0.5">{day.getDate()}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          {rows.map(row => {
            const accent = campaignAccent(row.color)
            const bar = ganttBarPosition(row.start, row.end, monthStart, monthEnd)
            return (
              <div key={row.id} className="grid grid-cols-[230px_minmax(0,1fr)]" style={{ borderBottom: `1px solid ${color.line}` }}>
                <div className="px-4 py-4 min-h-[86px]" style={{ background: color.surface, borderRight: `1px solid ${color.line}` }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                    <span className="text-[13px] font-semibold truncate" style={{ color: color.ink }}>{row.name}</span>
                  </div>
                  <div className="text-[11px] mt-1 capitalize" style={{ color: color.ghost }}>
                    {row.status} · {row.posts.length} posts
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: color.ghost }}>
                    {row.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to {row.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </div>

                <div className="relative min-h-[86px] grid" style={{ gridTemplateColumns, background: color.surface }}>
                  {days.map(day => {
                    const key = isoDay(day)
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6
                    const isToday = key === todayKey
                    return (
                      <div
                        key={key}
                        style={{
                          minHeight: 86,
                          borderRight: `1px solid ${color.line}`,
                          background: isToday ? 'var(--accent-tint)' : isWeekend ? color.paper2 : color.surface,
                        }}
                      />
                    )
                  })}

                  <div
                    style={{
                      position: 'absolute',
                      left: `${bar.left}%`,
                      width: `${bar.width}%`,
                      top: 22,
                      height: 18,
                      borderRadius: radius.pill,
                      background: accent,
                      opacity: 0.22,
                      border: `1px solid ${accent}`,
                    }}
                  />

                  {row.posts.map((item, index) => {
                    const left = ganttPointPosition(item.date, monthStart, monthEnd)
                    const route = approvalRouteForPost(item.post, businessContext)
                    const hasPolicySignal = shouldShowPolicySignal(route)
                    return (
                      <button
                        key={item.post.id}
                        onClick={() => onOpen(item.post)}
                        title={`${item.post.title || 'Untitled post'} · ${item.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${hasPolicySignal ? `\n${policyTitle(route)}` : ''}`}
                        className="absolute flex items-center gap-1.5 max-w-[150px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--paper-2)]"
                        style={{
                          left: `${left}%`,
                          top: 44 + ((index % 2) * 20),
                          transform: 'translateX(-8px)',
                          border: `1px solid ${color.line}`,
                          borderRadius: radius.sm,
                          background: color.surface,
                          color: color.ink,
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: channelColor(item.post.channel), flexShrink: 0 }} />
                        {hasPolicySignal && <AlertTriangle size={10} style={{ color: route.risk === 'high' ? color.danger : color.warn, flexShrink: 0 }} />}
                        <span className="text-[11px] font-medium truncate">{item.post.title || item.post.channel || 'Post'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function KanbanView({
  posts,
  campaignsById,
  businessContext,
  onOpen,
  renderActions,
}: {
  posts: Post[]
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
  renderActions: (post: Post) => React.ReactNode
}) {
  const columns = KANBAN_COLUMNS.map(column => ({
    ...column,
    posts: posts.filter(post => postStatusBucket(post) === column.id),
  }))

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="grid gap-3 min-w-[1120px]" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(210px, 1fr))` }}>
        {columns.map(column => (
          <section key={column.id} className="min-h-[520px] flex flex-col" style={columnPanelStyle}>
            <div className="px-3 py-3" style={{ borderBottom: `1px solid ${color.line}` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 min-w-0">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: column.dot, flexShrink: 0 }} />
                  <span className="text-[13px] font-semibold truncate" style={{ color: color.ink }}>{column.label}</span>
                </div>
                <span className="text-[11px] font-semibold" style={{ color: color.ghost }}>{column.posts.length}</span>
              </div>
            </div>
            <div className="p-2 flex flex-col gap-2 min-h-0 overflow-auto">
              {column.posts.length === 0 ? (
                <MiniEmpty text="No posts" />
              ) : column.posts.map(post => (
                <CalendarPostCard
                  key={post.id}
                  post={post}
                  campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                  businessContext={businessContext}
                  onOpen={() => onOpen(post)}
                  actions={renderActions(post)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function PlatformView({
  posts,
  campaignsById,
  businessContext,
  onOpen,
  renderActions,
}: {
  posts: Post[]
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
  renderActions: (post: Post) => React.ReactNode
}) {
  const lanes = PLATFORM_LANES.map(lane => ({
    ...lane,
    posts: posts.filter(post => platformBucket(post.channel) === lane.id),
  }))

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="grid gap-3 min-w-[1180px]" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(190px, 1fr))` }}>
        {lanes.map(lane => (
          <section key={lane.id} className="min-h-[520px] flex flex-col" style={columnPanelStyle}>
            <div className="px-3 py-3" style={{ borderBottom: `1px solid ${color.line}` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 min-w-0">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: lane.dot, flexShrink: 0 }} />
                  <span className="text-[13px] font-semibold truncate" style={{ color: color.ink }}>{lane.label}</span>
                </div>
                <span className="text-[11px] font-semibold" style={{ color: color.ghost }}>{lane.posts.length}</span>
              </div>
            </div>
            <div className="p-2 flex flex-col gap-2 min-h-0 overflow-auto">
              {lane.posts.length === 0 ? (
                <MiniEmpty text="No posts" />
              ) : lane.posts.map(post => (
                <CalendarPostCard
                  key={post.id}
                  post={post}
                  campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                  businessContext={businessContext}
                  onOpen={() => onOpen(post)}
                  actions={renderActions(post)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function WorkloadView({
  year,
  month,
  postsByDay,
  posts,
  businessContext,
  selectedDate,
  onSelectDate,
}: {
  year: number
  month: number
  postsByDay: Map<string, Post[]>
  posts: Post[]
  businessContext: BusinessContext
  selectedDate: string
  onSelectDate: (date: string) => void
}) {
  const days = Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => new Date(year, month, index + 1))
  const monthPostTotal = days.reduce((total, day) => total + (postsByDay.get(isoDay(day))?.length ?? 0), 0)
  const reviewQueue = posts.filter(post => postStatusBucket(post) === 'review')
  const heavyDays = days.filter(day => (postsByDay.get(isoDay(day))?.length ?? 0) > DAILY_POST_CAPACITY)
  const policySummary = policySummaryForPosts(posts, businessContext)

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="grid grid-cols-4 gap-3 mb-4">
        <WorkloadMetric icon={<BarChart3 size={16} />} label="Posts this month" value={String(monthPostTotal)} />
        <WorkloadMetric icon={<Columns3 size={16} />} label="Review queue" value={String(reviewQueue.length)} />
        <WorkloadMetric icon={<Target size={16} />} label="Heavy days" value={String(heavyDays.length)} />
        <WorkloadMetric icon={<AlertTriangle size={16} />} label="Policy checks" value={String(policySummary.guarded)} />
      </div>

      <div className="flex flex-col gap-2">
        {days.map(day => {
          const key = isoDay(day)
          const dayPosts = postsByDay.get(key) ?? []
          const reviewCount = dayPosts.filter(post => postStatusBucket(post) === 'review').length
          const highCareCount = dayPosts.filter(post => approvalRouteForPost(post, businessContext).risk === 'high').length
          const volumeRatio = Math.min(dayPosts.length / DAILY_POST_CAPACITY, 1)
          const reviewRatio = Math.min(reviewCount / DAILY_REVIEW_CAPACITY, 1)
          const isSelected = key === selectedDate
          const capacityLabel = reviewCount === 0 ? 'Open' : reviewCount >= DAILY_REVIEW_CAPACITY ? 'Full' : 'Available'

          return (
            <button
              key={key}
              onClick={() => onSelectDate(key)}
              className="grid grid-cols-[110px_minmax(0,1fr)_120px] gap-4 items-center text-left p-3 transition-colors hover:bg-[var(--paper-2)]"
              style={{
                background: isSelected ? 'var(--accent-tint)' : color.surface,
                border: `1px solid ${isSelected ? color.accentLine : color.line}`,
                borderRadius: radius.md,
                color: color.ink,
              }}
            >
              <div>
                <div className="text-[13px] font-semibold">{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>
                <div className="text-[11px]" style={{ color: color.ghost }}>{day.toLocaleDateString(undefined, { month: 'short' })}</div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-[12px]" style={{ color: color.ink2 }}>{dayPosts.length} posts</span>
                  <span className="text-[11px]" style={{ color: color.ghost }}>Capacity {DAILY_POST_CAPACITY}</span>
                </div>
                <div style={{ height: 6, borderRadius: radius.pill, background: color.paper2, overflow: 'hidden' }}>
                  <div style={{ width: `${volumeRatio * 100}%`, height: '100%', background: dayPosts.length > DAILY_POST_CAPACITY ? color.warn : color.accent }} />
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <span className="text-[11px]" style={{ color: highCareCount > 0 ? color.danger : color.ghost }}>
                    {reviewCount} review{highCareCount > 0 ? ` · ${highCareCount} high-care` : ''}
                  </span>
                  <span className="text-[11px]" style={{ color: color.ghost }}>Reviewer {DAILY_REVIEW_CAPACITY}</span>
                </div>
                <div style={{ height: 4, borderRadius: radius.pill, background: color.paper2, overflow: 'hidden' }}>
                  <div style={{ width: `${reviewRatio * 100}%`, height: '100%', background: reviewCount >= DAILY_REVIEW_CAPACITY ? color.warn : color.dotGreen }} />
                </div>
              </div>
              <div className="text-[12px] font-semibold text-right" style={{ color: capacityLabel === 'Full' ? color.warn : color.ghost }}>
                {capacityLabel}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CampaignPlannerView({
  campaigns,
  posts,
  datedPosts,
}: {
  campaigns: Campaign[]
  posts: Post[]
  datedPosts: DatedPost[]
}) {
  const rows = campaigns.map(campaign => {
    const campaignPosts = posts.filter(post => post.campaign_id === campaign.id)
    const datedCampaignPosts = datedPosts.filter(item => item.post.campaign_id === campaign.id)
    const start = parseDateValue(campaign.start_date) ?? datedCampaignPosts[0]?.date ?? null
    const end = parseDateValue(campaign.end_date) ?? datedCampaignPosts[datedCampaignPosts.length - 1]?.date ?? null
    const assets = campaignPosts.filter(hasMedia).length
    const owners = uniqueValues(campaignPosts.map(postOwner)).slice(0, 2)
    return { campaign, campaignPosts, start, end, assets, owners }
  })

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyCalendarState icon={<Target size={20} />} text="No campaigns in this client space." />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="min-w-[920px]" style={{ border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <div className="grid grid-cols-[1.2fr_1.5fr_130px_130px_150px] px-4 py-3 text-[11px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide, background: color.paper2, borderBottom: `1px solid ${color.line}` }}>
          <div>Campaign</div>
          <div>Goal</div>
          <div>Deadline</div>
          <div>Assets</div>
          <div>Owners</div>
        </div>
        {rows.map(row => {
          const accent = campaignAccent(row.campaign.color)
          const goal = row.campaign.goal || row.campaign.theme || row.campaign.description || 'No goal set'
          return (
            <div key={row.campaign.id} className="grid grid-cols-[1.2fr_1.5fr_130px_130px_150px] px-4 py-4 items-start gap-4" style={{ background: color.surface, borderBottom: `1px solid ${color.line}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                  <span className="text-[13px] font-semibold truncate" style={{ color: color.ink }}>{row.campaign.name}</span>
                </div>
                <div className="text-[11px] mt-1 capitalize" style={{ color: color.ghost }}>{row.campaign.status}</div>
                <div className="text-[11px] mt-1" style={{ color: color.ghost }}>{formatDateRange(row.start, row.end)}</div>
              </div>
              <div className="text-[12px] leading-snug line-clamp-3" style={{ color: color.ink2 }}>{goal}</div>
              <div className="text-[12px]" style={{ color: color.ink2 }}>{row.end ? row.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No deadline'}</div>
              <div className="text-[12px]" style={{ color: color.ink2 }}>
                {row.assets} media
                <div className="text-[11px] mt-1" style={{ color: color.ghost }}>{row.campaignPosts.length} posts</div>
              </div>
              <div className="text-[12px]" style={{ color: color.ink2 }}>
                {row.owners.length > 0 ? row.owners.join(', ') : 'Unassigned'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PolicyBadge({ route }: { route: ApprovalRoute }) {
  if (!shouldShowPolicySignal(route)) return null
  const isHighCare = route.risk === 'high'
  return (
    <span
      title={policyTitle(route)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold truncate"
      style={{
        maxWidth: 128,
        color: isHighCare ? color.danger : color.warn,
        background: isHighCare ? DANGER_TINT : color.paper2,
        border: `1px solid ${isHighCare ? DANGER_LINE : color.line}`,
        borderRadius: radius.pill,
      }}
    >
      {isHighCare && <AlertTriangle size={10} style={{ flexShrink: 0 }} />}
      <span className="truncate">{route.label}</span>
    </span>
  )
}

function shouldShowPolicySignal(route: ApprovalRoute) {
  return route.risk !== 'low'
    || !!route.publishGuard
    || !!route.samTrigger
    || !!route.policyApprovalMode
    || !!route.policySpeakerMode
}

function policyTitle(route: ApprovalRoute) {
  return [
    route.label,
    route.reason,
    route.policyApprovalMode ? `Approval: ${route.policyApprovalMode}` : '',
    route.policySpeakerMode ? `Speaker: ${route.policySpeakerMode}` : '',
    route.publishGuard ? `Guard: ${route.publishGuard}` : '',
    route.samTrigger ? `Follow-up: ${route.samTrigger}` : '',
  ].filter(Boolean).join('\n')
}

function policySummaryForPosts(posts: Post[], businessContext: BusinessContext) {
  return posts.reduce(
    (summary, post) => {
      const route = approvalRouteForPost(post, businessContext)
      if (shouldShowPolicySignal(route)) summary.guarded += 1
      if (route.risk === 'high') summary.highCare += 1
      return summary
    },
    { guarded: 0, highCare: 0 },
  )
}

function CalendarPill({ post, businessContext }: { post: Post; businessContext: BusinessContext }) {
  const status = displayStatus(post)
  const route = approvalRouteForPost(post, businessContext)
  const hasPolicySignal = shouldShowPolicySignal(route)
  return (
    <div className="rounded px-2 py-1" title={hasPolicySignal ? policyTitle(route) : undefined} style={{ background: color.paper, border: `1px solid ${hasPolicySignal && route.risk === 'high' ? DANGER_LINE : color.line}` }}>
      <div className="flex items-center gap-1.5">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: channelColor(post.channel), flexShrink: 0 }} />
        {hasPolicySignal && <AlertTriangle size={10} style={{ color: route.risk === 'high' ? color.danger : color.warn, flexShrink: 0 }} />}
        <span className="text-[11px] font-medium truncate" style={{ color: color.ink }}>
          {post.title || 'Untitled'}
        </span>
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: color.ghost }}>
        {timeLabel(post)} · {status}
      </div>
    </div>
  )
}

function CalendarPostCard({
  post,
  campaign,
  businessContext,
  onOpen,
  actions,
  draggable,
  onDragStart,
}: {
  post: Post
  campaign: Campaign | null
  businessContext: BusinessContext
  onOpen: () => void
  actions?: React.ReactNode
  draggable?: boolean
  onDragStart?: (event: React.DragEvent) => void
}) {
  const date = targetDate(post)
  const isUnscheduled = !date
  const isUnscheduledWarning = isUnscheduled && postStatusBucket(post) !== 'approved'
  const route = approvalRouteForPost(post, businessContext)
  const hasPolicySignal = shouldShowPolicySignal(route)
  const policyColor = route.risk === 'high' ? color.danger : color.warn

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className="w-full p-3 transition-colors hover:bg-[var(--paper-2)]"
      style={{
        background: isUnscheduledWarning ? DANGER_TINT : color.surface,
        border: `1px solid ${isUnscheduledWarning ? DANGER_LINE : color.line}`,
        borderLeft: isUnscheduledWarning ? `3px solid ${color.danger}` : `1px solid ${color.line}`,
        borderRadius: radius.md,
        cursor: draggable ? 'grab' : 'default',
      }}
    >
      <button onClick={onOpen} className="w-full text-left" style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}>
        <div className="flex items-center gap-2 mb-2">
          <PlatformChip channel={post.channel} />
          <StatusChip status={displayStatus(post)} />
          <PolicyBadge route={route} />
        </div>
        <div className="text-[13px] font-semibold leading-snug" style={{ color: color.ink }}>
          {post.title || 'Untitled post'}
        </div>
        <div className="text-[12px] mt-1 line-clamp-2" style={{ color: color.ink2 }}>
          {post.copy}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: isUnscheduledWarning ? color.danger : color.ghost }}>
          {isUnscheduledWarning ? <AlertTriangle size={12} /> : <Clock size={12} />}
          <span>{date ? timeLabel(post) : 'Unscheduled'}</span>
          {campaign && <span className="truncate">· {campaign.name}</span>}
        </div>
        {hasPolicySignal && (
          <div className="flex items-start gap-1.5 mt-2 text-[11px] leading-snug" style={{ color: policyColor }}>
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span className="line-clamp-2">{route.publishGuard || route.policyApprovalMode || route.reason}</span>
          </div>
        )}
      </button>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {actions}
        </div>
      )}
    </div>
  )
}

function CardActionButton({ disabled, icon, label, onClick }: { disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="h-7 px-2 inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--fog)] disabled:opacity-50"
      style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.sm, color: color.ink2 }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function CalendarFilters({
  filters,
  campaigns,
  platformOptions,
  ownerOptions,
  activeFilterCount,
  onChange,
  onReset,
}: {
  filters: FilterState
  campaigns: Campaign[]
  platformOptions: string[]
  ownerOptions: string[]
  activeFilterCount: number
  onChange: (filters: FilterState) => void
  onReset: () => void
}) {
  function update(key: keyof FilterState, value: string) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 p-3" style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
      <div className="inline-flex items-center gap-2 mr-1" style={{ color: color.ghost }}>
        <Filter size={14} />
        <span className="text-[12px] uppercase font-semibold" style={{ letterSpacing: t.letterSpacing.wide }}>Filters</span>
      </div>
      <FilterSelect label="Platform" value={filters.platform} onChange={value => update('platform', value)}>
        <option value="all">All platforms</option>
        {platformOptions.map(platform => (
          <option key={platform} value={platform}>{platformLabel(platform)}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Status" value={filters.status} onChange={value => update('status', value)}>
        <option value="all">All statuses</option>
        {KANBAN_COLUMNS.map(column => (
          <option key={column.id} value={column.id}>{column.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Campaign" value={filters.campaign} onChange={value => update('campaign', value)}>
        <option value="all">All campaigns</option>
        <option value="none">No campaign</option>
        {campaigns.map(campaign => (
          <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Owner" value={filters.owner} onChange={value => update('owner', value)}>
        <option value="all">All owners</option>
        {ownerOptions.map(owner => (
          <option key={owner} value={owner}>{owner}</option>
        ))}
      </FilterSelect>
      {activeFilterCount > 0 && (
        <button onClick={onReset} className="h-8 px-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--fog)]" style={buttonStyle}>
          <X size={13} />
          Clear {activeFilterCount}
        </button>
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 h-8 px-2.5" style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <span className="text-[11px]" style={{ color: color.ghost }}>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="text-[12px] outline-none cursor-pointer" style={{ background: 'transparent', border: 'none', color: color.ink, fontFamily: 'inherit' }}>
        {children}
      </select>
    </label>
  )
}

function CalendarWarnings({
  scheduleError,
  overCapacityDays,
  reviewQueueCount,
  filteredTotal,
  total,
}: {
  scheduleError: string | null
  overCapacityDays: Array<[string, Post[]]>
  reviewQueueCount: number
  filteredTotal: number
  total: number
}) {
  const warnings: string[] = []
  if (scheduleError) warnings.push(scheduleError)
  if (overCapacityDays.length > 0) warnings.push(`${overCapacityDays.length} heavy days exceed ${DAILY_POST_CAPACITY} posts`)
  if (reviewQueueCount > DAILY_REVIEW_CAPACITY) warnings.push(`${reviewQueueCount} posts are waiting for review`)
  if (filteredTotal < total) warnings.push(`${filteredTotal} of ${total} posts visible`)
  if (warnings.length === 0) return null

  const hasError = !!scheduleError
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 px-3 py-2"
      style={{
        background: hasError ? DANGER_TINT : color.paper2,
        border: `1px solid ${hasError ? DANGER_LINE : color.line}`,
        borderRadius: radius.md,
        color: hasError ? color.danger : color.ink2,
      }}
    >
      <AlertTriangle size={14} style={{ color: hasError ? color.danger : color.warn }} />
      {warnings.map(warning => (
        <span key={warning} className="text-[12px]">{warning}</span>
      ))}
    </div>
  )
}

function DayDrawer({
  date,
  posts,
  campaignsById,
  capacity,
  businessContext,
  onClose,
  onOpen,
  onDropPost,
  renderActions,
}: {
  date: Date
  posts: Post[]
  campaignsById: Map<string, Campaign>
  capacity: number
  businessContext: BusinessContext
  onClose: () => void
  onOpen: (post: Post) => void
  onDropPost: (event: React.DragEvent, day: string) => void
  renderActions: (post: Post) => React.ReactNode
}) {
  const key = isoDay(date)
  const isHeavy = capacity > DAILY_POST_CAPACITY
  const policySummary = policySummaryForPosts(posts, businessContext)

  return (
    <section
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={event => onDropPost(event, key)}
      style={panelStyle}
    >
      <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: `1px solid ${color.line}` }}>
        <div>
          <div className="text-[12px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide }}>Day drawer</div>
          <h3 className="text-[18px] font-semibold mt-1" style={{ color: color.ink }}>
            {date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h3>
          <p className="text-[12px] mt-1" style={{ color: isHeavy ? color.warn : color.ghost }}>
            {capacity} posts scheduled · capacity {DAILY_POST_CAPACITY}{policySummary.guarded > 0 ? ` · ${policySummary.guarded} policy checks` : ''}
          </p>
        </div>
        <button onClick={onClose} title="Close day drawer" className="w-8 h-8 inline-flex items-center justify-center transition-colors hover:bg-[var(--fog)]" style={iconButtonStyle}>
          <X size={14} />
        </button>
      </div>
      <div className="p-3 max-h-[420px] overflow-auto">
        {posts.length === 0 ? (
          <div className="py-8 text-center" style={{ color: color.ghost }}>
            <MapPin size={18} style={{ margin: '0 auto 8px' }} />
            <p className="text-[12px] m-0">Drop an unscheduled post here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {posts.map(post => (
              <CalendarPostCard
                key={post.id}
                post={post}
                campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                businessContext={businessContext}
                onOpen={() => onOpen(post)}
                actions={renderActions(post)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function UnscheduledTray({
  posts,
  readyCount,
  campaignsById,
  businessContext,
  onOpen,
  onDragStart,
  renderActions,
  onCreate,
}: {
  posts: Post[]
  readyCount: number
  campaignsById: Map<string, Campaign>
  businessContext: BusinessContext
  onOpen: (post: Post) => void
  onDragStart: (event: React.DragEvent, post: Post) => void
  renderActions: (post: Post) => React.ReactNode
  onCreate: () => void
}) {
  const warningCount = posts.filter(post => postStatusBucket(post) !== 'approved').length
  const policySummary = policySummaryForPosts(posts, businessContext)
  const hasUnscheduledWarning = warningCount > 0

  return (
    <section style={{ ...panelStyle, borderColor: hasUnscheduledWarning ? DANGER_LINE : color.line }}>
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${hasUnscheduledWarning ? DANGER_LINE : color.line}`, background: hasUnscheduledWarning ? DANGER_TINT : color.surface }}>
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 min-w-0">
            <AlertTriangle size={14} style={{ color: hasUnscheduledWarning ? color.danger : color.ghost }} />
            <div className="text-[12px] uppercase font-semibold" style={{ color: hasUnscheduledWarning ? color.danger : color.ghost, letterSpacing: t.letterSpacing.wide }}>
              Unscheduled
            </div>
          </div>
          <span className="text-[12px] font-semibold" style={{ color: hasUnscheduledWarning ? color.danger : color.ghost }}>
            {posts.length}
          </span>
        </div>
        <p className="text-[12px] mt-1" style={{ color: hasUnscheduledWarning ? color.danger : color.ghost }}>
          {readyCount} approved · {warningCount} need review{policySummary.guarded > 0 ? ` · ${policySummary.guarded} policy checks` : ''} · drag cards onto the calendar.
        </p>
      </div>
      <div className="p-3 max-h-[360px] overflow-auto">
        {posts.length === 0 ? (
          <div className="py-8 text-center" style={{ color: color.ghost }}>
            <Inbox size={18} style={{ margin: '0 auto 8px' }} />
            <p className="text-[12px] m-0 mb-3">No unscheduled posts match the current filters.</p>
            <button onClick={onCreate} className="h-8 px-3 inline-flex items-center gap-2 text-[12px] font-medium transition-colors hover:bg-[var(--fog)]" style={buttonStyle}>
              <Plus size={13} />
              Create post
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {posts.map(post => (
              <CalendarPostCard
                key={post.id}
                post={post}
                campaign={post.campaign_id ? campaignsById.get(post.campaign_id) ?? null : null}
                businessContext={businessContext}
                onOpen={() => onOpen(post)}
                draggable
                onDragStart={event => onDragStart(event, post)}
                actions={renderActions(post)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function CampaignLegend({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) return null
  return (
    <section style={panelStyle}>
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${color.line}` }}>
        <div className="text-[12px] uppercase font-semibold" style={{ color: color.ghost, letterSpacing: t.letterSpacing.wide }}>Campaign legend</div>
      </div>
      <div className="p-3 flex flex-col gap-2 max-h-[220px] overflow-auto">
        {campaigns.map(campaign => (
          <div key={campaign.id} className="flex items-center gap-2 min-w-0 text-[12px]" style={{ color: color.ink2 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: campaignAccent(campaign.color), flexShrink: 0 }} />
            <span className="truncate">{campaign.name}</span>
            <span className="ml-auto capitalize" style={{ color: color.ghost }}>{campaign.status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function EmptyCalendarState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8" style={{ color: color.ghost }}>
      <div className="mb-2">{icon}</div>
      <p className="text-[12px] m-0">{text}</p>
    </div>
  )
}

function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-[12px]" style={{ color: color.ghost }}>
      {text}
    </div>
  )
}

function WorkloadMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-4" style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <div className="flex items-center gap-2" style={{ color: color.ghost }}>
        {icon}
        <span className="text-[11px] uppercase font-semibold" style={{ letterSpacing: t.letterSpacing.wide }}>{label}</span>
      </div>
      <div className="text-[28px] font-semibold mt-2" style={{ color: color.ink }}>{value}</div>
    </div>
  )
}

function modeLabel(mode: CalendarMode) {
  return VIEW_MODES.find(item => item.id === mode)?.label ?? mode
}

function postStatusBucket(post: Post): KanbanStatus {
  const raw = (post.status || '').toLowerCase().replace(/\s+/g, '_')
  if (post.posted_at || post.published_at || raw === 'posted' || raw === 'published') return 'posted'
  if (raw === 'scheduled' || (!!targetDate(post) && raw === 'approved')) return 'scheduled'
  if (raw === 'approved') return 'approved'
  if (raw === 'pending' || raw === 'pending_review' || raw === 'review' || raw === 'changes_requested') return 'review'
  return 'draft'
}

function platformBucket(channel?: string): PlatformLaneId {
  const value = (channel ?? '').toLowerCase()
  if (value.includes('instagram')) return 'instagram'
  if (value.includes('facebook')) return 'facebook'
  if (value.includes('linkedin')) return 'linkedin'
  if (value.includes('youtube') || value.includes('short')) return 'youtube'
  if (value.includes('medium')) return 'medium'
  if (value.includes('quora')) return 'quora'
  if (value.includes('reddit')) return 'reddit'
  if (value === 'x' || value.includes('twitter')) return 'x'
  if (value.includes('email') || value.includes('newsletter')) return 'email'
  if (value.includes('blog') || value.includes('article') || value.includes('substack')) return 'blog'
  return 'other'
}

function hasMedia(post: Post) {
  return !!post.media_url || !!post.media_type || !!post.media_metadata
}

function postOwner(post: Post) {
  return post.author || post.created_by || ''
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function formatDateRange(start: Date | null, end: Date | null) {
  if (start && end) {
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  if (start) return `Starts ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  if (end) return `Due ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  return 'No dates set'
}

function buildGanttRows(
  campaigns: Campaign[],
  datedPosts: DatedPost[],
  campaignsById: Map<string, Campaign>,
  monthStart: Date,
  monthEnd: Date,
): GanttRow[] {
  const postsByCampaign = new Map<string, DatedPost[]>()
  const uncategorized: DatedPost[] = []

  for (const item of datedPosts) {
    const campaignId = item.post.campaign_id
    if (campaignId && campaignsById.has(campaignId)) {
      if (!postsByCampaign.has(campaignId)) postsByCampaign.set(campaignId, [])
      postsByCampaign.get(campaignId)!.push(item)
    } else {
      uncategorized.push(item)
    }
  }

  const rows = campaigns
    .map((campaign): GanttRow | null => {
      const rowPosts = postsByCampaign.get(campaign.id) ?? []
      const postDates = rowPosts.map(item => item.date)
      const earliestPost = postDates[0]
      const latestPost = postDates[postDates.length - 1]
      const start = parseDateValue(campaign.start_date) ?? earliestPost
      const end = parseDateValue(campaign.end_date) ?? latestPost ?? start

      if (!start || !end) return null
      if (!rangesOverlap(start, end, monthStart, monthEnd) && rowPosts.length === 0) return null

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        color: campaign.color,
        start: start <= end ? start : end,
        end: end >= start ? end : start,
        posts: rowPosts,
      }
    })
    .filter((row): row is GanttRow => !!row)

  if (uncategorized.length > 0) {
    rows.push({
      id: 'uncategorized',
      name: 'No campaign',
      status: 'scheduled',
      color: color.dotAmber,
      start: uncategorized[0].date,
      end: uncategorized[uncategorized.length - 1].date,
      posts: uncategorized,
    })
  }

  return rows.sort((a, b) => a.start.getTime() - b.start.getTime())
}

function ganttBarPosition(start: Date, end: Date, monthStart: Date, monthEnd: Date) {
  const totalDays = monthEnd.getDate()
  const clippedStart = clampDate(start, monthStart, monthEnd)
  const clippedEnd = clampDate(end, monthStart, monthEnd)
  const startOffset = clippedStart.getDate() - 1
  const endOffset = clippedEnd.getDate()
  const left = (startOffset / totalDays) * 100
  const width = Math.max(((endOffset - startOffset) / totalDays) * 100, 3)
  return { left, width }
}

function ganttPointPosition(date: Date, monthStart: Date, monthEnd: Date) {
  const totalDays = monthEnd.getDate()
  const clippedDate = clampDate(date, monthStart, monthEnd)
  return ((clippedDate.getDate() - 0.5) / totalDays) * 100
}

function clampDate(date: Date, min: Date, max: Date) {
  if (date < min) return min
  if (date > max) return max
  return date
}

function rangesOverlap(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return start <= rangeEnd && end >= rangeStart
}

function parseDateValue(value?: string | null): Date | null {
  if (!value) return null
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const date = new Date(source)
  return Number.isNaN(date.getTime()) ? null : date
}

function targetDate(post: Post): Date | null {
  return parseDateValue(post.posted_at || post.published_at || post.scheduled_at || post.publish_date)
}

function displayStatus(post: Post) {
  const bucket = postStatusBucket(post)
  if (bucket === 'posted') return 'Posted'
  if (bucket === 'scheduled') return 'Scheduled'
  if (bucket === 'approved') return 'Approved'
  if (bucket === 'review') return 'Pending Review'
  return 'Draft'
}

function isApproved(post: Post) {
  return displayStatus(post) === 'Approved'
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function timeLabel(post: Post) {
  const date = targetDate(post)
  if (!date) return 'Unscheduled'
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatHour(hour: number) {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return date.toLocaleTimeString(undefined, { hour: 'numeric' })
}

function scheduledIsoForDay(day: string, hour: number) {
  const date = parseIsoDay(day)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function platformLabel(platform: string) {
  if (platform === 'x') return 'X'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

function monthCells(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<Date | null> = []
  for (let i = 0; i < mondayOffset; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function mondayOf(date: Date) {
  const copy = new Date(date)
  const day = copy.getDay()
  copy.setDate(copy.getDate() - ((day + 6) % 7))
  copy.setHours(0, 0, 0, 0)
  return copy
}

function isoDay(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseIsoDay(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function channelColor(channel?: string) {
  const value = (channel ?? '').toLowerCase()
  if (value.includes('instagram')) return 'var(--dot-pink)'
  if (value.includes('linkedin')) return 'var(--dot-blue)'
  if (value.includes('twitter') || value === 'x') return 'var(--dot-sky)'
  if (value.includes('facebook')) return 'var(--dot-indigo)'
  if (value.includes('email')) return 'var(--dot-emerald)'
  if (value.includes('blog') || value.includes('medium') || value.includes('substack')) return 'var(--dot-amber)'
  return color.ghost
}

function campaignAccent(value?: string | null) {
  if (!value) return color.accent
  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl') || value.startsWith('var(')) return value
  const accents: Record<string, string> = {
    blue: color.dotBlue,
    sky: color.dotSky,
    pink: color.dotPink,
    amber: color.dotAmber,
    green: color.dotGreen,
    rose: color.dotRose,
    violet: color.dotViolet,
    orange: color.dotOrange,
    oxblood: color.accent,
    accent: color.accent,
  }
  return accents[value.toLowerCase()] ?? color.accent
}

const panelStyle: React.CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.line}`,
  borderRadius: radius.lg,
  overflow: 'hidden',
}

const columnPanelStyle: React.CSSProperties = {
  background: color.paper2,
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  overflow: 'hidden',
}

const buttonStyle: React.CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  color: color.ink,
}

const iconButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  color: color.ink2,
}

const dayCellStyle: React.CSSProperties = {
  borderRight: `1px solid ${color.line}`,
  borderBottom: `1px solid ${color.line}`,
  color: color.ink,
}

const emptyCellStyle: React.CSSProperties = {
  ...dayCellStyle,
  background: color.paper2,
  minHeight: 132,
}
