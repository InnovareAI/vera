import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Gauge,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Campaign, ClientIntegration, ContentMetricSnapshot, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { Button, PageHeader, SectionLabel, color, radius, space, type as t } from '../design'
import Markdown from '../components/Markdown'
import { DEMAND_CONTENT_METRIC_PROVIDERS, DEMAND_PROVIDER_READINESS } from '../lib/demandModel'

type RedditListen = {
  id: string
  topic: string
  synthesis: string
  sources: Array<{ title: string; url: string }>
  model?: string | null
  created_at: string
}

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

type MeasurePost = Post
type DateRange = '7d' | '30d' | '90d' | 'all'
type SortKey = 'date' | 'views' | 'engagements' | 'engagementRate' | 'comments' | 'status'
type SortDirection = 'asc' | 'desc'

type PostRowData = {
  post: MeasurePost
  title: string
  provider: string
  campaignId: string | null
  campaignName: string
  status: string
  rawStatus: string
  date: string | null
  isPosted: boolean
  measured: boolean
  views: number
  reach: number
  engagements: number
  engagementRate: number | null
  comments: number
  shares: number
  saves: number
  clicks: number
  qualifiedTraffic: number
  buyerQuestions: number
  meetingRequests: number
  pulledAt: string | null
  url: string | null
}

type PlatformPerformance = {
  provider: string
  posts: number
  measured: number
  views: number
  engagements: number
  engagementRate: number | null
}

type CampaignPerformance = {
  id: string
  name: string
  status: string
  posts: number
  measured: number
  views: number
  engagements: number
  engagementRate: number | null
}

type ProviderReadiness = {
  provider: string
  label: string
  status: string
  healthStatus: string
  detail: string
  lastSync: string | null
}

type TrendPoint = {
  label: string
  views: number
  engagements: number
}

type SyncReport = {
  ok?: boolean
  checked_posts?: number
  synced_posts?: number
  metric_count?: number
  integration_health?: Array<{
    integration_id: string
    provider: string
    status: 'healthy' | 'stale' | 'error' | 'unchanged'
    detail?: string
    observation?: 'opened' | 'already_open' | 'resolved'
  }>
  error?: string
}

type ManualMetricKey =
  | 'views'
  | 'reach'
  | 'reactions'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'clicks'
  | 'qualified_traffic'
  | 'buyer_questions'
  | 'meeting_requests'

type ManualMetricDraft = {
  postId: string
  provider: string
  liveUrl: string
  metricDate: string
  values: Record<ManualMetricKey, string>
}

type ManualMetricMessage = { tone: 'danger' | 'success'; text: string } | null

const MANUAL_METRIC_FIELDS: Array<{ key: ManualMetricKey; label: string; helper: string }> = [
  { key: 'views', label: 'Views', helper: 'Impressions, views, or reads' },
  { key: 'reach', label: 'Reach', helper: 'Unique audience where known' },
  { key: 'reactions', label: 'Reactions', helper: 'Likes or reactions' },
  { key: 'comments', label: 'Comments', helper: 'Replies and discussion' },
  { key: 'shares', label: 'Shares', helper: 'Reposts and shares' },
  { key: 'saves', label: 'Saves', helper: 'Bookmarks or saves' },
  { key: 'clicks', label: 'Clicks', helper: 'Traffic-driving clicks' },
  { key: 'qualified_traffic', label: 'Qualified traffic', helper: 'Useful visits or sessions' },
  { key: 'buyer_questions', label: 'Buyer questions', helper: 'Commercial questions' },
  { key: 'meeting_requests', label: 'Meeting requests', helper: 'Demo or call requests' },
]

const EMPTY_MANUAL_VALUES: Record<ManualMetricKey, string> = Object.fromEntries(
  MANUAL_METRIC_FIELDS.map(field => [field.key, '']),
) as Record<ManualMetricKey, string>

export default function Measure() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const [posts, setPosts] = useState<MeasurePost[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [integrations, setIntegrations] = useState<ClientIntegration[]>([])
  const [snapshots, setSnapshots] = useState<ContentMetricSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>('30d')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showIntegrations, setShowIntegrations] = useState(false)
  // Reddit listening (read-only market intel via the reddit-listen edge fn).
  const [listens, setListens] = useState<RedditListen[]>([])
  const [listenTopic, setListenTopic] = useState('')
  const [listening, setListening] = useState(false)
  const [listenError, setListenError] = useState<string | null>(null)
  const [manualDraft, setManualDraft] = useState<ManualMetricDraft>(() => emptyManualMetricDraft())
  const [manualSaving, setManualSaving] = useState(false)
  const [manualMessage, setManualMessage] = useState<ManualMetricMessage>(null)

  const loadData = useCallback(async (projectId?: string | null) => {
    if (!projectId) {
      setPosts([])
      setCampaigns([])
      setIntegrations([])
      setSnapshots([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const [postRes, campaignRes, integrationRes, metricRes] = await Promise.all([
      supabase
        .from('content_posts')
        .select('id, org_id, project_id, campaign_id, title, copy, format, channel, status, publish_date, scheduled_at, published_at, posted_at, posted_url, provider, provider_account_id, provider_post_id, provider_page_id, provider_media_id, provider_permalink, last_metric_sync_at, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('campaigns')
        .select('id, org_id, project_id, name, status, post_count, created_at, updated_at')
        .eq('project_id', projectId),
      supabase
        .from('client_integrations')
        .select('id, org_id, project_id, provider, category, display_name, status, connection_kind, config, capabilities, scopes, credential_ref, external_ref, health_status, health_detail, last_sync_at, last_health_check, created_at, updated_at')
        .eq('project_id', projectId)
        .order('display_name'),
      supabase
        .from('content_metric_snapshots')
        .select('id, org_id, project_id, post_id, provider, provider_account_id, provider_object_id, object_type, metric_name, metric_value, metric_period, metric_time, pulled_at, raw, created_at')
        .eq('project_id', projectId)
        .order('pulled_at', { ascending: false })
        .limit(1500),
    ])

    const firstError = postRes.error ?? campaignRes.error ?? integrationRes.error ?? metricRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setPosts((postRes.data ?? []) as MeasurePost[])
    setCampaigns((campaignRes.data ?? []) as Campaign[])
    setIntegrations((integrationRes.data ?? []) as ClientIntegration[])
    setSnapshots(normalizeSnapshots((metricRes.data ?? []) as ContentMetricSnapshot[]))
    setLoading(false)
  }, [])

  useEffect(() => {
    const projectId = activeProject?.id ?? null
    const task = window.setTimeout(() => { void loadData(projectId) }, 0)
    return () => window.clearTimeout(task)
  }, [activeProject?.id, loadData])

  // Past Reddit listens for this client (newest first).
  useEffect(() => {
    const projectId = activeProject?.id
    if (!projectId) { setListens([]); return }
    let cancelled = false
    supabase
      .from('reddit_listens')
      .select('id, topic, synthesis, sources, model, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (!cancelled) setListens((data ?? []) as RedditListen[]) })
    return () => { cancelled = true }
  }, [activeProject?.id])

  async function runListen() {
    const projectId = activeProject?.id
    const topic = listenTopic.trim()
    if (!projectId || !topic || listening) return
    setListening(true)
    setListenError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setListenError('Sign in to run Reddit listening.'); setListening(false); return }
      const response = await fetch(FN_URL('reddit-listen'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, topic }),
      })
      const json = await response.json() as { ok?: boolean; listen?: RedditListen; error?: string }
      if (!response.ok || json.error || !json.listen) {
        setListenError(json.error ?? `Reddit listening failed with HTTP ${response.status}`)
      } else {
        setListens(prev => [json.listen as RedditListen, ...prev])
        setListenTopic('')
      }
    } catch (listenErr) {
      setListenError(listenErr instanceof Error ? listenErr.message : 'Reddit listening failed.')
    }
    setListening(false)
  }

  async function syncMetrics() {
    if (!activeProject?.id) return
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        setError('Sign in before running provider metric sync.')
        setSyncing(false)
        return
      }
      const response = await fetch(FN_URL('sync-content-metrics'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ project_id: activeProject.id, limit: 150 }),
      })
      const report = await response.json() as SyncReport
      if (!response.ok || report.error) {
        setError(report.error ?? `Metric sync failed with HTTP ${response.status}`)
      } else {
        const issueCount = (report.integration_health ?? []).filter(item => item.status === 'stale' || item.status === 'error').length
        const resolvedCount = (report.integration_health ?? []).filter(item => item.observation === 'resolved').length
        const healthSuffix = issueCount > 0
          ? ` ${issueCount} integration issue${issueCount === 1 ? '' : 's'} surfaced.`
          : resolvedCount > 0
            ? ` ${resolvedCount} integration warning${resolvedCount === 1 ? '' : 's'} resolved.`
            : ''
        setSyncMessage(`Synced ${report.synced_posts ?? 0} posts and ${report.metric_count ?? 0} metrics from ${report.checked_posts ?? 0} checked posts.${healthSuffix}`)
        await loadData(activeProject.id)
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Metric sync failed.')
    }
    setSyncing(false)
  }

  const campaignById = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign])), [campaigns])
  const rows = useMemo(() => buildPostRows(posts, snapshots, campaignById), [posts, snapshots, campaignById])
  const manualMetricRows = useMemo(() => rows.slice(0, 150), [rows])
  const selectedManualRow = useMemo(
    () => manualMetricRows.find(row => row.post.id === manualDraft.postId) ?? manualMetricRows[0] ?? null,
    [manualMetricRows, manualDraft.postId],
  )
  const providerReadiness = useMemo(() => buildProviderReadiness(integrations), [integrations])
  const currentWindow = useMemo(() => rangeWindow(dateRange, 0), [dateRange])
  const previousWindow = useMemo(() => rangeWindow(dateRange, 1), [dateRange])

  useEffect(() => {
    if (!manualMetricRows.length) {
      setManualDraft(emptyManualMetricDraft())
      return
    }
    if (manualMetricRows.some(row => row.post.id === manualDraft.postId)) return
    setManualDraft(prev => manualDraftForRow(manualMetricRows[0], prev))
  }, [manualMetricRows, manualDraft.postId])

  const filteredRows = useMemo(() => {
    return sortRows(
      rows.filter(row => rowMatchesFilters(row, currentWindow, platformFilter, campaignFilter, statusFilter, query)),
      sortKey,
      sortDirection,
    )
  }, [rows, currentWindow, platformFilter, campaignFilter, statusFilter, query, sortKey, sortDirection])

  const previousRows = useMemo(() => {
    if (!previousWindow) return []
    return rows.filter(row => rowMatchesFilters(row, previousWindow, platformFilter, campaignFilter, statusFilter, query))
  }, [rows, previousWindow, platformFilter, campaignFilter, statusFilter, query])

  const stats = useMemo(() => buildStats(filteredRows), [filteredRows])
  const previousStats = useMemo(() => buildStats(previousRows), [previousRows])
  const statusCounts = useMemo(() => buildStatusCounts(filteredRows), [filteredRows])
  const platformPerformance = useMemo(() => buildPlatformPerformance(filteredRows), [filteredRows])
  const campaignPerformance = useMemo(() => buildCampaignPerformance(campaigns, filteredRows), [campaigns, filteredRows])
  const topRows = useMemo(() => filteredRows.filter(row => row.measured).sort(sortByImpact).slice(0, 5), [filteredRows])
  const attentionRows = useMemo(() => buildNeedsAttention(filteredRows).slice(0, 5), [filteredRows])
  const trendPoints = useMemo(() => buildTrendPoints(snapshots, filteredRows, currentWindow), [snapshots, filteredRows, currentWindow])
  const insights = useMemo(() => buildInsights({
    rows: filteredRows,
    stats,
    statusCounts,
    providerReadiness,
    projectSlug: activeProject?.slug ?? '',
  }), [filteredRows, stats, statusCounts, providerReadiness, activeProject?.slug])
  const options = useMemo(() => buildFilterOptions(rows, campaigns), [rows, campaigns])
  const integrationSummary = useMemo(() => buildIntegrationSummary(providerReadiness), [providerReadiness])

  function selectManualMetricPost(postId: string) {
    const row = manualMetricRows.find(item => item.post.id === postId)
    if (!row) return
    setManualDraft(prev => manualMetricForSelectedRow(row, prev))
    setManualMessage(null)
  }

  async function saveManualMetrics() {
    if (!activeProject?.id || !selectedManualRow || manualSaving) return
    const metrics = Object.fromEntries(
      MANUAL_METRIC_FIELDS
        .map(field => [field.key, metricInputNumber(manualDraft.values[field.key])] as const)
        .filter((entry): entry is [ManualMetricKey, number] => entry[1] !== null),
    )
    if (Object.keys(metrics).length === 0) {
      setManualMessage({ tone: 'danger', text: 'Enter at least one metric value.' })
      return
    }

    setManualSaving(true)
    setManualMessage(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in before saving manual metrics.')
      const response = await fetch(FN_URL('manual-content-metrics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project_id: activeProject.id,
          post_id: selectedManualRow.post.id,
          provider: manualDraft.provider,
          live_url: manualDraft.liveUrl || undefined,
          metric_time: manualDraft.metricDate || undefined,
          metrics,
        }),
      })
      const json = await response.json().catch(() => ({})) as { error?: string; metric_count?: number }
      if (!response.ok || json.error) throw new Error(json.error ?? `Manual metrics failed with HTTP ${response.status}`)
      setManualMessage({ tone: 'success', text: `Saved ${json.metric_count ?? Object.keys(metrics).length} metrics for "${selectedManualRow.title}".` })
      setManualDraft(prev => ({ ...prev, values: { ...EMPTY_MANUAL_VALUES } }))
      await loadData(activeProject.id)
    } catch (manualError) {
      setManualMessage({ tone: 'danger', text: manualError instanceof Error ? manualError.message : 'Manual metrics failed.' })
    }
    setManualSaving(false)
  }

  const kpis = [
    {
      label: 'Published',
      value: stats.published,
      previous: previousStats.published,
      icon: Send,
      tone: color.success,
      helper: `${stats.pending} waiting on review`,
    },
    {
      label: 'Views',
      value: formatNumber(stats.views),
      previous: previousStats.views,
      rawValue: stats.views,
      icon: Eye,
      tone: color.info,
      helper: `${stats.measured}/${stats.published} posts measured`,
    },
    {
      label: 'Engagements',
      value: formatNumber(stats.engagements),
      previous: previousStats.engagements,
      rawValue: stats.engagements,
      icon: TrendingUp,
      tone: color.success,
      helper: `${formatNumber(stats.comments)} comments`,
    },
    {
      label: 'Engagement rate',
      value: formatRate(stats.engagementRate),
      previous: previousStats.engagementRate,
      rawValue: stats.engagementRate,
      icon: Gauge,
      tone: color.accent,
      helper: 'Weighted by views or reach',
      rate: true,
    },
    {
      label: 'Traffic',
      value: formatNumber(stats.clicks + stats.qualifiedTraffic),
      previous: previousStats.clicks + previousStats.qualifiedTraffic,
      rawValue: stats.clicks + stats.qualifiedTraffic,
      icon: Zap,
      tone: color.info,
      helper: `${formatNumber(stats.buyerQuestions)} buyer questions, ${formatNumber(stats.meetingRequests)} meeting requests`,
    },
    {
      label: 'Metric coverage',
      value: `${stats.measured}/${stats.published}`,
      previous: previousStats.measured,
      rawValue: stats.measured,
      icon: Activity,
      tone: stats.published && stats.measured === 0 ? color.warn : color.ink,
      helper: latestSyncLabel(rows),
    },
  ]

  return (
    <div style={{ padding: `${space[8]} ${space[8]} ${space[10]}`, maxWidth: 1320 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? activeOrg?.name ?? 'Workspace'}
        title="Demand Performance"
        subtitle="A working dashboard for output, bottlenecks, post results, engagement signals, traffic, and the next actions Vera should take."
        actions={(
          <Button
            variant="secondary"
            leading={syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            onClick={syncMetrics}
            disabled={!activeProject?.id || syncing}
          >
            {syncing ? 'Syncing' : 'Sync metrics'}
          </Button>
        )}
      />

      {error && <Notice tone="danger" text={error} />}
      {syncMessage && <Notice tone="success" text={syncMessage} />}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], color: color.ghost, fontSize: t.size.sm }}>
          <Loader2 size={15} className="animate-spin" /> Loading Performance
        </div>
      ) : (
        <>
          <DashboardControls
            dateRange={dateRange}
            onDateRange={setDateRange}
            platformFilter={platformFilter}
            onPlatformFilter={setPlatformFilter}
            campaignFilter={campaignFilter}
            onCampaignFilter={setCampaignFilter}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            query={query}
            onQuery={setQuery}
            options={options}
          />

          <KpiGrid>
            {kpis.map(kpi => (
              <KpiTile
                key={kpi.label}
                {...kpi}
                previousLabel={dateRange === 'all' ? null : 'vs previous period'}
              />
            ))}
          </KpiGrid>

          <IntegrationStrip
            summary={integrationSummary}
            open={showIntegrations}
            onToggle={() => setShowIntegrations(value => !value)}
          />

          {showIntegrations && (
            <IntegrationHealthPanel providers={providerReadiness} />
          )}

          <section style={{ marginTop: space[8] }}>
            <SectionLabel style={{ marginBottom: space[3] }} action="Manual channels and API fallback">
              Manual metrics
            </SectionLabel>
            <ManualMetricsPanel
              rows={manualMetricRows}
              draft={manualDraft}
              saving={manualSaving}
              message={manualMessage}
              disabled={!activeProject?.id}
              onPostChange={selectManualMetricPost}
              onDraftChange={patch => {
                setManualDraft(prev => ({ ...prev, ...patch }))
                setManualMessage(null)
              }}
              onMetricChange={(key, value) => {
                setManualDraft(prev => ({ ...prev, values: { ...prev.values, [key]: value } }))
                setManualMessage(null)
              }}
              onSave={saveManualMetrics}
            />
          </section>

          <section style={{ marginTop: space[8] }}>
            <SectionLabel style={{ marginBottom: space[3] }} action="Read-only · we never post to Reddit">
              Reddit listening
            </SectionLabel>
            <RedditListeningPanel
              topic={listenTopic}
              onTopic={setListenTopic}
              listening={listening}
              error={listenError}
              onRun={runListen}
              listens={listens}
              disabled={!activeProject?.id}
            />
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.45fr)', gap: space[6], alignItems: 'start', marginTop: space[8] }}>
            <section>
              <SectionLabel style={{ marginBottom: space[3] }}>Vera insights</SectionLabel>
              <InsightGrid insights={insights} />
            </section>
            <section>
              <SectionLabel style={{ marginBottom: space[3] }}>Review funnel</SectionLabel>
              <FunnelPanel counts={statusCounts} total={filteredRows.length} />
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.45fr)', gap: space[6], alignItems: 'start', marginTop: space[8] }}>
            <section>
              <SectionLabel style={{ marginBottom: space[3] }}>Performance trend</SectionLabel>
              <TrendPanel points={trendPoints} />
            </section>
            <section>
              <SectionLabel style={{ marginBottom: space[3] }}>Platform comparison</SectionLabel>
              <PlatformList items={platformPerformance} />
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.45fr)', gap: space[6], alignItems: 'start', marginTop: space[8] }}>
            <section>
              <SectionLabel style={{ marginBottom: space[3] }}>Top posts</SectionLabel>
              <PostCardList rows={topRows} empty="No provider metrics synced yet." />
            </section>
            <section>
              <SectionLabel tone={attentionRows.length ? 'accent' : 'default'} style={{ marginBottom: space[3] }}>Needs attention</SectionLabel>
              <PostCardList rows={attentionRows} empty="No active bottlenecks for the selected filters." mode="attention" />
            </section>
          </div>

          <section style={{ marginTop: space[8] }}>
            <SectionLabel style={{ marginBottom: space[3] }}>Campaign leaderboard</SectionLabel>
            <CampaignList items={campaignPerformance} />
          </section>

          <section style={{ marginTop: space[8] }}>
            <SectionLabel
              style={{ marginBottom: space[3] }}
              action={`${filteredRows.length} visible posts`}
            >
              Post table
            </SectionLabel>
            <PostTable
              rows={filteredRows}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key) => {
                if (key === sortKey) {
                  setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')
                } else {
                  setSortKey(key)
                  setSortDirection(key === 'status' ? 'asc' : 'desc')
                }
              }}
            />
          </section>
        </>
      )}
    </div>
  )
}

function DashboardControls({
  dateRange,
  onDateRange,
  platformFilter,
  onPlatformFilter,
  campaignFilter,
  onCampaignFilter,
  statusFilter,
  onStatusFilter,
  query,
  onQuery,
  options,
}: {
  dateRange: DateRange
  onDateRange: (value: DateRange) => void
  platformFilter: string
  onPlatformFilter: (value: string) => void
  campaignFilter: string
  onCampaignFilter: (value: string) => void
  statusFilter: string
  onStatusFilter: (value: string) => void
  query: string
  onQuery: (value: string) => void
  options: ReturnType<typeof buildFilterOptions>
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(240px, 1fr) auto auto auto',
      gap: space[3],
      alignItems: 'center',
      marginBottom: space[6],
    }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: color.ghost }} />
        <input
          value={query}
          onChange={event => onQuery(event.target.value)}
          placeholder="Search posts, campaigns, platforms"
          style={{
            width: '100%',
            height: 36,
            padding: '0 12px 0 36px',
            border: `1px solid ${color.line}`,
            borderRadius: radius.sm,
            background: color.surface,
            color: color.ink,
            fontSize: t.size.sm,
            outline: 'none',
          }}
        />
      </div>
      <SegmentedControl
        value={dateRange}
        options={[
          { value: '7d', label: '7d' },
          { value: '30d', label: '30d' },
          { value: '90d', label: '90d' },
          { value: 'all', label: 'All' },
        ]}
        onChange={value => onDateRange(value as DateRange)}
      />
      <FilterSelect label="Platform" value={platformFilter} onChange={onPlatformFilter} options={options.platforms} />
      <FilterSelect label="Campaign" value={campaignFilter} onChange={onCampaignFilter} options={options.campaigns} />
      <FilterSelect label="Status" value={statusFilter} onChange={onStatusFilter} options={options.statuses} />
    </div>
  )
}

function SegmentedControl({ value, options, onChange }: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div style={{ display: 'inline-flex', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.sm, padding: 3, height: 36 }}>
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              height: 28,
              minWidth: 42,
              padding: '0 10px',
              border: 'none',
              borderRadius: radius.xs,
              background: active ? color.surface : 'transparent',
              color: active ? color.ink : color.ghost,
              fontSize: t.size.cap,
              fontWeight: active ? t.weight.semibold : t.weight.medium,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: space[2], height: 36, padding: '0 10px', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: color.surface }}>
      <SlidersHorizontal size={13} style={{ color: color.ghost }} />
      <span style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        style={{ border: 'none', outline: 'none', background: 'transparent', color: color.ink, fontSize: t.size.cap, fontFamily: t.family.sans, cursor: 'pointer', maxWidth: 170 }}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: space[3] }}>
      {children}
    </div>
  )
}

function KpiTile({
  label,
  value,
  rawValue,
  previous,
  previousLabel,
  icon: Icon,
  tone,
  helper,
  rate,
}: {
  label: string
  value: string | number
  rawValue?: number | null
  previous?: number | null
  previousLabel: string | null
  icon: ElementType
  tone: string
  helper: string
  rate?: boolean
}) {
  const delta = previousLabel ? formatDelta(rawValue ?? (typeof value === 'number' ? value : null), previous, rate) : null
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5], minHeight: 132 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <Icon size={16} style={{ color: tone }} />
        {delta && (
          <span style={{ fontSize: t.size.micro, color: delta.tone, fontWeight: t.weight.medium }}>
            {delta.label}
          </span>
        )}
      </div>
      <div style={{ fontSize: t.size.h2, fontWeight: t.weight.semibold, color: color.ink, lineHeight: 1.1, marginTop: space[3] }}>{value}</div>
      <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: space[2] }}>{label}</div>
      <p style={{ fontSize: t.size.micro, color: color.ghost, margin: `${space[4]} 0 0`, lineHeight: 1.4 }}>
        {helper}{previousLabel && delta ? ` - ${previousLabel}` : ''}
      </p>
    </div>
  )
}

function IntegrationStrip({ summary, open, onToggle }: {
  summary: { connected: number; total: number; planned: number; issues: number; lastSync: string | null }
  open: boolean
  onToggle: () => void
}) {
  const issueTone = summary.issues > 0 ? color.warn : color.success
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[4], marginTop: space[4], padding: `${space[4]} ${space[5]}`, border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[5], minWidth: 0, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium }}>
          <Settings2 size={14} style={{ color: color.ghost }} />
          Integration health
        </span>
        <StatusPill dot={color.success}>{summary.connected}/{summary.total} connected</StatusPill>
        {summary.planned > 0 && <StatusPill dot={color.ghost}>{summary.planned} planned</StatusPill>}
        <StatusPill dot={issueTone}>{summary.issues} need attention</StatusPill>
        <span style={{ color: color.ghost, fontSize: t.size.cap }}>Last metric sync: {summary.lastSync ? relativeDate(summary.lastSync) : 'none yet'}</span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        style={{ border: 'none', background: 'transparent', color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        {open ? 'Hide details' : 'View details'}
      </button>
    </div>
  )
}

function IntegrationHealthPanel({ providers }: { providers: ProviderReadiness[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: space[3], marginTop: space[3] }}>
      {providers.map(provider => {
        const connected = provider.status === 'connected'
        const issue = providerHasIssue(provider)
        const dot = connected ? (issue ? color.warn : color.success) : issue ? color.warn : color.ghost
        return (
          <div key={provider.provider} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
              <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{provider.label}</p>
              <StatusPill dot={dot}>{provider.status}</StatusPill>
            </div>
            <p style={{ margin: `${space[3]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{provider.detail}</p>
            <p style={{ margin: `${space[3]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>
              Last sync: {provider.lastSync ? relativeDate(provider.lastSync) : 'none yet'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function InsightGrid({ insights }: { insights: ReturnType<typeof buildInsights> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: space[3] }}>
      {insights.map(insight => (
        <InsightCard key={insight.title} {...insight} />
      ))}
    </div>
  )
}

function InsightCard({ title, body, tone, icon: Icon, actionLabel, actionHref }: {
  title: string
  body: string
  tone: string
  icon: ElementType
  actionLabel?: string
  actionHref?: string
}) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5], minHeight: 148 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
        <Icon size={16} style={{ color: tone }} />
        <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{title}</p>
      </div>
      <p style={{ margin: `${space[4]} 0 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>{body}</p>
      {actionLabel && actionHref && (
        <a href={actionHref} style={{ display: 'inline-flex', marginTop: space[4], color: color.accent, fontSize: t.size.cap, fontWeight: t.weight.medium, textDecoration: 'none' }}>
          {actionLabel}
        </a>
      )}
    </div>
  )
}

function FunnelPanel({ counts, total }: { counts: ReturnType<typeof buildStatusCounts>; total: number }) {
  const stages = [
    { label: 'Review', value: counts.pending, tone: color.warn },
    { label: 'Approved', value: counts.approved, tone: color.success },
    { label: 'Scheduled', value: counts.scheduled, tone: color.info },
    { label: 'Published', value: counts.posted, tone: color.success },
    { label: 'Parked', value: counts.rejected, tone: color.ghost },
  ]
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
        {stages.map(stage => (
          <div key={stage.label}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
              <span style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.medium }}>{stage.label}</span>
              <span style={{ color: color.ghost, fontSize: t.size.cap }}>{stage.value}</span>
            </div>
            <div style={{ height: 8, background: color.paper2, borderRadius: radius.pill, overflow: 'hidden', marginTop: space[2] }}>
              <div style={{ width: `${total ? Math.max(3, (stage.value / total) * 100) : 0}%`, height: '100%', background: stage.tone, borderRadius: radius.pill }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrendPanel({ points }: { points: TrendPoint[] }) {
  if (!points.length) {
    return <EmptyPanel icon={BarChart3} text="No time-series metrics yet. Once provider IDs are saved and sync runs, views and engagement trend here." />
  }
  const max = Math.max(1, ...points.map(point => Math.max(point.views, point.engagements)))
  const width = 640
  const height = 220
  const pad = 28
  const x = (index: number) => points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2)
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2)
  const viewPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.views)}`).join(' ')
  const engagementPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.engagements)}`).join(' ')

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5], overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Views and engagements trend" style={{ width: '100%', height: 240, display: 'block' }}>
        {[0.25, 0.5, 0.75].map(mark => (
          <line key={mark} x1={pad} x2={width - pad} y1={pad + mark * (height - pad * 2)} y2={pad + mark * (height - pad * 2)} stroke="var(--line)" strokeWidth="1" />
        ))}
        <path d={viewPath} fill="none" stroke="var(--info)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={engagementPath} fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={x(index)} cy={y(point.views)} r="3" fill="var(--info)" />
            <circle cx={x(index)} cy={y(point.engagements)} r="3" fill="var(--success)" />
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: space[3], color: color.ghost, fontSize: t.size.micro }}>
        <span>{points[0]?.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[4] }}>
          <span><Dot colorValue={color.info} /> Views</span>
          <span><Dot colorValue={color.success} /> Engagements</span>
        </span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  )
}

function PlatformList({ items }: { items: PlatformPerformance[] }) {
  if (!items.length) return <EmptyPanel icon={Activity} text="Publish and sync posts to compare platforms." />
  return (
    <ProgressList
      items={items.map(item => ({
        key: item.provider,
        label: providerLabel(item.provider),
        meta: `${item.measured}/${item.posts} measured - ${formatRate(item.engagementRate)}`,
        value: item.engagements,
        detail: `${formatNumber(item.views)} views`,
      }))}
    />
  )
}

function CampaignList({ items }: { items: CampaignPerformance[] }) {
  if (!items.length) return <EmptyPanel icon={Megaphone} text="Campaign performance appears once posts are assigned and synced." />
  return (
    <ProgressList
      items={items.map(item => ({
        key: item.id,
        label: item.name,
        meta: `${item.measured}/${item.posts} measured - ${item.status}`,
        value: item.engagements,
        detail: formatRate(item.engagementRate),
      }))}
    />
  )
}

function ProgressList({ items }: {
  items: Array<{ key: string; label: string; meta: string; value: number; detail: string }>
}) {
  const max = Math.max(1, ...items.map(item => item.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {items.map(item => (
        <div key={item.key} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3] }}>
            <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</p>
            <p style={{ margin: 0, color: color.ghost, fontSize: t.size.cap }}>{item.detail}</p>
          </div>
          <div style={{ height: 7, background: color.paper2, borderRadius: radius.pill, overflow: 'hidden', marginTop: space[3] }}>
            <div style={{ width: `${Math.max(4, Math.min(100, (item.value / max) * 100))}%`, height: '100%', background: color.accent, borderRadius: radius.pill }} />
          </div>
          <p style={{ margin: `${space[2]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>{item.meta}</p>
        </div>
      ))}
    </div>
  )
}

function PostCardList({ rows, empty, mode = 'top' }: { rows: PostRowData[]; empty: string; mode?: 'top' | 'attention' }) {
  if (!rows.length) return <EmptyPanel icon={FileText} text={empty} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {rows.map(row => (
        <PostCard key={row.post.id} row={row} mode={mode} />
      ))}
    </div>
  )
}

function PostCard({ row, mode }: { row: PostRowData; mode: 'top' | 'attention' }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space[4], alignItems: 'center', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</p>
        <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.cap }}>
          {providerLabel(row.provider)} - {row.pulledAt ? `synced ${relativeDate(row.pulledAt)}` : row.isPosted ? 'not synced' : row.status}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[5], color: color.ink2, fontSize: t.size.cap }}>
        <span>{formatNumber(row.views || row.reach)} views</span>
        <span>{formatNumber(row.engagements)} eng.</span>
        <span style={{ color: mode === 'attention' ? color.warn : color.success, fontWeight: t.weight.semibold }}>{formatRate(row.engagementRate)}</span>
      </div>
    </div>
  )
}

function formatListenDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function RedditListeningPanel({ topic, onTopic, listening, error, onRun, listens, disabled }: {
  topic: string
  onTopic: (v: string) => void
  listening: boolean
  error: string | null
  onRun: () => void
  listens: RedditListen[]
  disabled: boolean
}) {
  const card: CSSProperties = {
    background: color.surface,
    border: `1px solid ${color.line}`,
    borderRadius: radius.lg,
    padding: space[5],
  }
  return (
    <div style={card}>
      <p style={{ fontSize: t.size.cap, color: color.ghost, margin: `0 0 ${space[3]}`, lineHeight: 1.5 }}>
        Pull what buyers are actually saying on Reddit about a topic. VERA reads and summarizes, it never posts. Use the pain points and phrasing to sharpen LinkedIn, cold email, and landing pages.
      </p>
      <div style={{ display: 'flex', gap: space[2], alignItems: 'flex-start' }}>
        <input
          value={topic}
          onChange={e => onTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onRun() } }}
          placeholder="e.g. cold email deliverability for B2B SaaS"
          disabled={disabled || listening}
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: t.size.sm,
            border: `1px solid ${color.line}`,
            borderRadius: radius.md,
            background: color.paper,
            color: color.ink,
            outline: 'none',
          }}
        />
        <Button
          variant="primary"
          leading={listening ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          onClick={onRun}
          disabled={disabled || listening || !topic.trim()}
        >
          {listening ? 'Listening' : 'Listen'}
        </Button>
      </div>
      {disabled && (
        <p style={{ fontSize: t.size.micro, color: color.faint, marginTop: space[2] }}>Pick a client to run Reddit listening.</p>
      )}
      {error && <div style={{ marginTop: space[3] }}><Notice tone="danger" text={error} /></div>}

      <div style={{ marginTop: space[5], display: 'flex', flexDirection: 'column', gap: space[4] }}>
        {listens.length === 0 ? (
          <p style={{ fontSize: t.size.cap, color: color.faint, margin: 0 }}>No listens yet. Enter a topic above to pull the first one.</p>
        ) : listens.map(listen => (
          <article key={listen.id} style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4], background: color.paper }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3], marginBottom: space[2] }}>
              <span style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{listen.topic}</span>
              <span style={{ fontSize: t.size.micro, color: color.faint, whiteSpace: 'nowrap' }}>{formatListenDate(listen.created_at)}</span>
            </div>
            <div style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.55 }}>
              <Markdown content={listen.synthesis} />
            </div>
            {listen.sources?.length > 0 && (
              <div style={{ marginTop: space[3], borderTop: `1px solid ${color.line}`, paddingTop: space[3] }}>
                <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.06em', color: color.ghost, marginBottom: space[2] }}>
                  Source threads ({listen.sources.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {listen.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: t.size.cap, color: color.accent, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title || s.url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function ManualMetricsPanel({
  rows,
  draft,
  saving,
  message,
  disabled,
  onPostChange,
  onDraftChange,
  onMetricChange,
  onSave,
}: {
  rows: PostRowData[]
  draft: ManualMetricDraft
  saving: boolean
  message: ManualMetricMessage
  disabled: boolean
  onPostChange: (postId: string) => void
  onDraftChange: (patch: Partial<ManualMetricDraft>) => void
  onMetricChange: (key: ManualMetricKey, value: string) => void
  onSave: () => void
}) {
  const selected = rows.find(row => row.post.id === draft.postId) ?? null
  if (!rows.length) {
    return <EmptyPanel icon={Activity} text="No posts are available for manual metric entry yet." />
  }

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.2fr) minmax(160px, 0.5fr) minmax(220px, 0.9fr) minmax(150px, 0.45fr)', gap: space[3], alignItems: 'end' }}>
        <FieldStack label="Post">
          <select
            value={draft.postId}
            onChange={event => onPostChange(event.target.value)}
            disabled={disabled || saving}
            style={manualInputStyle}
          >
            {rows.map(row => (
              <option key={row.post.id} value={row.post.id}>
                {providerLabel(row.provider)}: {row.title}
              </option>
            ))}
          </select>
        </FieldStack>
        <FieldStack label="Platform">
          <select
            value={draft.provider}
            onChange={event => onDraftChange({ provider: event.target.value })}
            disabled={disabled || saving}
            style={manualInputStyle}
          >
            {DEMAND_CONTENT_METRIC_PROVIDERS.map(provider => (
              <option key={provider} value={provider}>{providerLabel(provider)}</option>
            ))}
          </select>
        </FieldStack>
        <FieldStack label="Live URL">
          <input
            value={draft.liveUrl}
            onChange={event => onDraftChange({ liveUrl: event.target.value })}
            disabled={disabled || saving}
            placeholder="https://..."
            style={manualInputStyle}
          />
        </FieldStack>
        <FieldStack label="Metric date">
          <input
            type="date"
            value={draft.metricDate}
            onChange={event => onDraftChange({ metricDate: event.target.value })}
            disabled={disabled || saving}
            style={manualInputStyle}
          />
        </FieldStack>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: space[3], marginTop: space[5] }}>
        {MANUAL_METRIC_FIELDS.map(field => (
          <FieldStack key={field.key} label={field.label} helper={field.helper}>
            <input
              type="number"
              min="0"
              step="1"
              value={draft.values[field.key]}
              onChange={event => onMetricChange(field.key, event.target.value)}
              disabled={disabled || saving}
              placeholder="0"
              style={manualInputStyle}
            />
          </FieldStack>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[4], marginTop: space[5], flexWrap: 'wrap' }}>
        <p style={{ margin: 0, color: color.ghost, fontSize: t.size.cap, lineHeight: 1.45 }}>
          {selected
            ? `Latest source: ${selected.pulledAt ? relativeDate(selected.pulledAt) : 'not measured yet'}. Manual entries create a new lifetime snapshot.`
            : 'Manual entries create lifetime snapshots for the active client space.'}
        </p>
        <Button
          variant="primary"
          leading={saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          onClick={onSave}
          disabled={disabled || saving || !draft.postId}
        >
          {saving ? 'Saving' : 'Save metrics'}
        </Button>
      </div>

      {message && (
        <div style={{ marginTop: space[4] }}>
          <Notice tone={message.tone} text={message.text} />
        </div>
      )}
    </div>
  )
}

function FieldStack({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ color: color.ink2, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>
        {label}
      </span>
      {children}
      {helper && <span style={{ color: color.ghost, fontSize: t.size.micro, lineHeight: 1.35 }}>{helper}</span>}
    </label>
  )
}

const manualInputStyle: CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 11px',
  border: `1px solid ${color.line}`,
  borderRadius: radius.sm,
  background: color.paper,
  color: color.ink,
  fontSize: t.size.sm,
  outline: 'none',
  minWidth: 0,
}

function PostTable({ rows, sortKey, sortDirection, onSort }: {
  rows: PostRowData[]
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
}) {
  if (!rows.length) return <EmptyPanel icon={Table2} text="No posts match the active filters." />
  return (
    <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', background: color.surface }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead>
            <tr style={{ background: color.paper2 }}>
              <SortableTh label="Post" sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={onSort} align="left" />
              <th style={thStyle}>Platform</th>
              <th style={thStyle}>Campaign</th>
              <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableTh label="Views" sortKey="views" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableTh label="Engagements" sortKey="engagements" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableTh label="Rate" sortKey="engagementRate" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableTh label="Comments" sortKey="comments" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
              <th style={thStyle}>Live</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.post.id} style={{ borderTop: `1px solid ${color.line}` }}>
                <td style={{ ...tdStyle, textAlign: 'left', minWidth: 260 }}>
                  <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{row.title}</p>
                  <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>{row.date ? formatDate(row.date) : 'No date'}</p>
                </td>
                <td style={tdStyle}><StatusPill dot={providerDot(row.provider)}>{providerLabel(row.provider)}</StatusPill></td>
                <td style={{ ...tdStyle, color: color.ink2, maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.campaignName}</td>
                <td style={tdStyle}><StatusPill dot={statusColor(row.status)}>{statusLabel(row.status)}</StatusPill></td>
                <td style={tdStyle}>{formatNumber(row.views || row.reach)}</td>
                <td style={tdStyle}>{formatNumber(row.engagements)}</td>
                <td style={tdStyle}>{formatRate(row.engagementRate)}</td>
                <td style={tdStyle}>{formatNumber(row.comments)}</td>
                <td style={tdStyle}>
                  {row.url ? (
                    <a href={row.url} target="_blank" rel="noreferrer" style={{ color: color.accent, textDecoration: 'none', fontWeight: t.weight.medium }}>Open</a>
                  ) : (
                    <span style={{ color: color.ghost }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const thStyle: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'right',
  color: color.ghost,
  fontSize: t.size.micro,
  fontWeight: t.weight.medium,
  textTransform: 'uppercase',
  letterSpacing: t.letterSpacing.wide,
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '12px',
  textAlign: 'right',
  color: color.ink,
  fontSize: t.size.cap,
  verticalAlign: 'middle',
}

function SortableTh({ label, sortKey: key, activeKey, direction, onSort, align = 'right' }: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = activeKey === key
  return (
    <th style={{ ...thStyle, textAlign: align }}>
      <button
        type="button"
        onClick={() => onSort(key)}
        style={{ border: 'none', background: 'transparent', color: active ? color.ink : color.ghost, font: 'inherit', cursor: 'pointer', padding: 0 }}
      >
        {label}{active ? direction === 'asc' ? ' up' : ' down' : ''}
      </button>
    </th>
  )
}

function EmptyPanel({ text, icon: Icon = FileText }: { text: string; icon?: ElementType }) {
  return (
    <div style={{ border: `1px dashed ${color.line2}`, borderRadius: radius.md, padding: space[6], color: color.ghost, fontSize: t.size.sm, background: color.paper2, display: 'flex', alignItems: 'center', gap: space[3] }}>
      <Icon size={16} style={{ color: color.ghost, flexShrink: 0 }} />
      {text}
    </div>
  )
}

function Notice({ tone, text }: { tone: 'danger' | 'success'; text: string }) {
  const isDanger = tone === 'danger'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[3],
      marginBottom: space[5],
      padding: space[4],
      borderRadius: radius.md,
      border: `1px solid ${isDanger ? 'rgba(185,28,28,0.28)' : 'rgba(45,122,59,0.26)'}`,
      background: isDanger ? 'rgba(185,28,28,0.07)' : 'rgba(45,122,59,0.07)',
      color: isDanger ? color.danger : color.success,
      fontSize: t.size.sm,
    }}>
      {isDanger ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
      {text}
    </div>
  )
}

function StatusPill({ children, dot }: { children: ReactNode; dot: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.xs, color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.medium, whiteSpace: 'nowrap' }}>
      <Dot colorValue={dot} />
      {children}
    </span>
  )
}

function Dot({ colorValue }: { colorValue: string }) {
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: radius.pill, background: colorValue, verticalAlign: 'middle', marginRight: 4 }} />
}

function emptyManualMetricDraft(): ManualMetricDraft {
  return {
    postId: '',
    provider: 'linkedin',
    liveUrl: '',
    metricDate: todayInputValue(),
    values: { ...EMPTY_MANUAL_VALUES },
  }
}

function manualMetricForSelectedRow(row: PostRowData, current: ManualMetricDraft): ManualMetricDraft {
  return {
    ...current,
    postId: row.post.id,
    provider: row.provider || current.provider || 'linkedin',
    liveUrl: row.url ?? current.liveUrl,
    metricDate: current.metricDate || todayInputValue(),
  }
}

function manualDraftForRow(row: PostRowData, current: ManualMetricDraft): ManualMetricDraft {
  return {
    ...emptyManualMetricDraft(),
    values: current.values,
    postId: row.post.id,
    provider: row.provider || 'linkedin',
    liveUrl: row.url ?? '',
    metricDate: current.metricDate || todayInputValue(),
  }
}

function metricInputNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildPostRows(posts: MeasurePost[], snapshots: ContentMetricSnapshot[], campaigns: Map<string, Campaign>): PostRowData[] {
  const latest = latestMetricMap(snapshots)
  return posts.map(post => {
    const provider = detectProvider(post)
    const metric = (name: string) => latest.get(`${post.id}:${name}`)?.metric_value ?? 0
    const latestPulledAt = latestDate([...latest.values()].filter(snapshot => snapshot.post_id === post.id).map(snapshot => snapshot.pulled_at))
    const views = metric('views') || metric('impressions')
    const reach = metric('reach')
    const reactions = metric('reactions') + metric('likes')
    const comments = metric('comments')
    const shares = metric('shares')
    const saves = metric('saves')
    const clicks = metric('clicks')
    const qualifiedTraffic = metric('qualified_traffic')
    const buyerQuestions = metric('buyer_questions')
    const meetingRequests = metric('meeting_requests')
    const explicitEngagements = metric('engagements')
    const engagements = explicitEngagements || reactions + comments + shares + saves + clicks
    const explicitRate = latest.get(`${post.id}:engagement_rate`)?.metric_value
    const denominator = views || reach
    const engagementRate = explicitRate != null ? explicitRate : denominator > 0 ? engagements / denominator : null
    const measured = [...latest.keys()].some(key => key.startsWith(`${post.id}:`))
    const campaign = post.campaign_id ? campaigns.get(post.campaign_id) : null
    return {
      post,
      title: post.title || post.copy?.slice(0, 90) || 'Untitled post',
      provider,
      campaignId: post.campaign_id ?? null,
      campaignName: campaign?.name ?? 'No campaign',
      status: postLifecycleStatus(post),
      rawStatus: post.status ?? 'Unknown',
      date: effectiveDate(post),
      isPosted: isPosted(post),
      measured,
      views,
      reach,
      engagements,
      engagementRate,
      comments,
      shares,
      saves,
      clicks,
      qualifiedTraffic,
      buyerQuestions,
      meetingRequests,
      pulledAt: latestPulledAt,
      url: post.provider_permalink ?? post.posted_url ?? null,
    }
  })
}

function buildStats(rows: PostRowData[]) {
  const publishedRows = rows.filter(row => row.isPosted)
  const measuredRows = publishedRows.filter(row => row.measured)
  const views = measuredRows.reduce((sum, row) => sum + row.views, 0)
  const reach = measuredRows.reduce((sum, row) => sum + row.reach, 0)
  const engagements = measuredRows.reduce((sum, row) => sum + row.engagements, 0)
  const comments = measuredRows.reduce((sum, row) => sum + row.comments, 0)
  const clicks = measuredRows.reduce((sum, row) => sum + row.clicks, 0)
  const qualifiedTraffic = measuredRows.reduce((sum, row) => sum + row.qualifiedTraffic, 0)
  const buyerQuestions = measuredRows.reduce((sum, row) => sum + row.buyerQuestions, 0)
  const meetingRequests = measuredRows.reduce((sum, row) => sum + row.meetingRequests, 0)
  const denominator = measuredRows.reduce((sum, row) => sum + (row.views || row.reach), 0)
  return {
    total: rows.length,
    pending: rows.filter(row => statusKind(row.status) === 'pending').length,
    approved: rows.filter(row => statusKind(row.status) === 'approved').length,
    scheduled: rows.filter(row => statusKind(row.status) === 'scheduled').length,
    published: publishedRows.length,
    measured: measuredRows.length,
    views: views || reach,
    engagements,
    comments,
    clicks,
    qualifiedTraffic,
    buyerQuestions,
    meetingRequests,
    engagementRate: denominator > 0 ? engagements / denominator : null,
  }
}

function buildStatusCounts(rows: PostRowData[]) {
  return {
    pending: rows.filter(row => statusKind(row.status) === 'pending').length,
    approved: rows.filter(row => statusKind(row.status) === 'approved').length,
    scheduled: rows.filter(row => statusKind(row.status) === 'scheduled').length,
    posted: rows.filter(row => row.isPosted).length,
    rejected: rows.filter(row => statusKind(row.status) === 'rejected').length,
  }
}

function buildPlatformPerformance(rows: PostRowData[]): PlatformPerformance[] {
  const map = new Map<string, PostRowData[]>()
  for (const row of rows.filter(item => item.isPosted)) {
    const list = map.get(row.provider) ?? []
    list.push(row)
    map.set(row.provider, list)
  }
  return [...map.entries()].map(([provider, list]) => {
    const measured = list.filter(row => row.measured)
    const views = measured.reduce((sum, row) => sum + row.views, 0)
    const reach = measured.reduce((sum, row) => sum + row.reach, 0)
    const engagements = measured.reduce((sum, row) => sum + row.engagements, 0)
    const denominator = measured.reduce((sum, row) => sum + (row.views || row.reach), 0)
    return {
      provider,
      posts: list.length,
      measured: measured.length,
      views: views || reach,
      engagements,
      engagementRate: denominator > 0 ? engagements / denominator : null,
    }
  }).sort((a, b) => b.engagements - a.engagements || b.posts - a.posts)
}

function buildCampaignPerformance(campaigns: Campaign[], rows: PostRowData[]): CampaignPerformance[] {
  return campaigns.map(campaign => {
    const campaignRows = rows.filter(row => row.campaignId === campaign.id)
    const measured = campaignRows.filter(row => row.measured)
    const views = measured.reduce((sum, row) => sum + row.views, 0)
    const engagements = measured.reduce((sum, row) => sum + row.engagements, 0)
    const denominator = measured.reduce((sum, row) => sum + (row.views || row.reach), 0)
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      posts: campaignRows.length,
      measured: measured.length,
      views,
      engagements,
      engagementRate: denominator > 0 ? engagements / denominator : null,
    }
  }).filter(item => item.posts > 0).sort((a, b) => b.engagements - a.engagements || b.posts - a.posts)
}

function buildNeedsAttention(rows: PostRowData[]) {
  return rows
    .filter(row => {
      if (row.isPosted && !row.measured) return true
      if (row.engagementRate != null && row.engagementRate < 0.01 && (row.views || row.reach) >= 50) return true
      if (statusKind(row.status) === 'pending') return true
      return false
    })
    .sort((a, b) => {
      const aPending = statusKind(a.status) === 'pending' ? 0 : 1
      const bPending = statusKind(b.status) === 'pending' ? 0 : 1
      return aPending - bPending || Number(a.measured) - Number(b.measured) || (a.engagementRate ?? 0) - (b.engagementRate ?? 0)
    })
}

function buildInsights(input: {
  rows: PostRowData[]
  stats: ReturnType<typeof buildStats>
  statusCounts: ReturnType<typeof buildStatusCounts>
  providerReadiness: ProviderReadiness[]
  projectSlug: string
}) {
  const insights: Array<{
    title: string
    body: string
    tone: string
    icon: ElementType
    actionLabel?: string
    actionHref?: string
  }> = []

  if (input.stats.pending > 0) {
    insights.push({
      title: 'Review is the bottleneck',
      body: `${input.stats.pending} posts are waiting on review. Publishing volume and metrics will stay flat until that queue moves.`,
      tone: color.warn,
      icon: Clock,
      actionLabel: 'Open review queue',
      actionHref: input.projectSlug ? `/p/${input.projectSlug}/review` : undefined,
    })
  }

  if (input.stats.published === 0) {
    insights.push({
      title: 'No live output in range',
      body: 'The selected period has no published posts. Use this view as a production cockpit until enough data exists.',
      tone: color.warn,
      icon: Send,
      actionLabel: 'Open calendar',
      actionHref: input.projectSlug ? `/p/${input.projectSlug}/calendar` : undefined,
    })
  } else if (input.stats.measured === 0) {
    insights.push({
      title: 'Metrics need provider IDs',
      body: 'Published posts exist, but Vera has no usable provider snapshots yet. Save provider IDs at publish time before sync can become reliable.',
      tone: color.warn,
      icon: Activity,
    })
  }

  const providerIssues = input.providerReadiness.filter(provider =>
    providerHasIssue(provider),
  )
  if (providerIssues.length > 0) {
    insights.push({
      title: 'Integration health affects data',
      body: `${providerIssues.length} provider connections need review. Keep this secondary, but fix it before relying on external metrics.`,
      tone: color.info,
      icon: Settings2,
      actionLabel: 'Open settings',
      actionHref: '/settings?tab=integrations',
    })
  }

  const top = input.rows.filter(row => row.measured).sort(sortByImpact)[0]
  if (top) {
    insights.push({
      title: 'Best current post',
      body: `${top.title} is leading the selected range with ${formatNumber(top.engagements)} engagements and ${formatRate(top.engagementRate)} engagement rate.`,
      tone: color.success,
      icon: TrendingUp,
    })
  }

  if (!insights.length) {
    insights.push({
      title: 'Ready for performance data',
      body: 'The dashboard is prepared. Once provider snapshots land, Vera can compare platforms, campaigns, and post formats.',
      tone: color.success,
      icon: Zap,
    })
  }

  return insights.slice(0, 4)
}

function buildTrendPoints(snapshots: ContentMetricSnapshot[], rows: PostRowData[], windowValue: ReturnType<typeof rangeWindow>): TrendPoint[] {
  const postIds = new Set(rows.map(row => row.post.id))
  const grouped = new Map<string, { views: number; engagements: number }>()
  for (const snapshot of snapshots) {
    if (!snapshot.post_id || !postIds.has(snapshot.post_id)) continue
    const time = new Date(snapshot.pulled_at).getTime()
    if (windowValue.start && time < windowValue.start.getTime()) continue
    if (windowValue.end && time > windowValue.end.getTime()) continue
    const key = new Date(snapshot.pulled_at).toISOString().slice(0, 10)
    const group = grouped.get(key) ?? { views: 0, engagements: 0 }
    if (['views', 'impressions', 'reach'].includes(snapshot.metric_name)) group.views += snapshot.metric_value
    if (['engagements', 'reactions', 'likes', 'comments', 'shares', 'saves', 'clicks'].includes(snapshot.metric_name)) group.engagements += snapshot.metric_value
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({
      label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      views: values.views,
      engagements: values.engagements,
    }))
}

function buildProviderReadiness(integrations: ClientIntegration[]): ProviderReadiness[] {
  const byProvider = new Map<string, ClientIntegration>(integrations.map(row => [row.provider, row]))
  return DEMAND_PROVIDER_READINESS.map(item => {
    const row = byProvider.get(item.provider)
    return {
      provider: item.provider,
      label: item.label,
      status: row?.status ?? 'planned',
      healthStatus: row?.health_status ?? 'unknown',
      detail: friendlyIntegrationDetail(row?.health_detail, item.detail),
      lastSync: row?.last_sync_at ?? null,
    }
  })
}

function buildIntegrationSummary(providers: ProviderReadiness[]) {
  const connected = providers.filter(provider => provider.status === 'connected').length
  const planned = providers.filter(provider => provider.status === 'planned' || provider.status === 'not_connected').length
  const issues = providers.filter(providerHasIssue).length
  return {
    connected,
    total: providers.length,
    planned,
    issues,
    lastSync: latestDate(providers.map(provider => provider.lastSync)),
  }
}

function buildFilterOptions(rows: PostRowData[], campaigns: Campaign[]) {
  const platformSet = new Set(rows.map(row => row.provider).filter(Boolean))
  const statusSet = new Set(rows.map(row => statusKind(row.status)).filter(Boolean))
  const platformOptions = [...new Set([...DEMAND_CONTENT_METRIC_PROVIDERS, ...platformSet])]
  return {
    platforms: [
      { value: 'all', label: 'All platforms' },
      ...platformOptions.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b))).map(provider => ({ value: provider, label: providerLabel(provider) })),
    ],
    campaigns: [
      { value: 'all', label: 'All campaigns' },
      { value: 'none', label: 'No campaign' },
      ...campaigns.map(campaign => ({ value: campaign.id, label: campaign.name })),
    ],
    statuses: [
      { value: 'all', label: 'All statuses' },
      ...[...statusSet].sort().map(status => ({ value: status, label: statusLabel(status) })),
    ],
  }
}

function providerHasIssue(provider: ProviderReadiness) {
  if (provider.status === 'pending' || provider.status === 'error' || provider.status === 'revoked') return true
  if (provider.healthStatus === 'stale' || provider.healthStatus === 'error') return true
  return provider.detail.includes('Needs review')
}

function rowMatchesFilters(
  row: PostRowData,
  windowValue: ReturnType<typeof rangeWindow>,
  platform: string,
  campaign: string,
  status: string,
  query: string,
) {
  const time = row.date ? new Date(row.date).getTime() : null
  if (windowValue.start && time && time < windowValue.start.getTime()) return false
  if (windowValue.end && time && time > windowValue.end.getTime()) return false
  if (windowValue.start && !time) return false
  if (platform !== 'all' && row.provider !== platform) return false
  if (campaign === 'none' && row.campaignId) return false
  if (campaign !== 'all' && campaign !== 'none' && row.campaignId !== campaign) return false
  if (status !== 'all' && statusKind(row.status) !== status) return false
  const needle = query.trim().toLowerCase()
  if (needle) {
    const haystack = `${row.title} ${row.campaignName} ${row.provider} ${row.status} ${row.rawStatus}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

function sortRows(rows: PostRowData[], key: SortKey, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const result = compareRows(a, b, key)
    return result * multiplier
  })
}

function compareRows(a: PostRowData, b: PostRowData, key: SortKey) {
  if (key === 'date') return dateValue(a.date) - dateValue(b.date)
  if (key === 'views') return (a.views || a.reach) - (b.views || b.reach)
  if (key === 'engagements') return a.engagements - b.engagements
  if (key === 'engagementRate') return (a.engagementRate ?? -1) - (b.engagementRate ?? -1)
  if (key === 'comments') return a.comments - b.comments
  return statusLabel(a.status).localeCompare(statusLabel(b.status))
}

function sortByImpact(a: PostRowData, b: PostRowData) {
  return b.engagements - a.engagements || (b.engagementRate ?? 0) - (a.engagementRate ?? 0) || (b.views || b.reach) - (a.views || a.reach)
}

function latestMetricMap(snapshots: ContentMetricSnapshot[]) {
  const map = new Map<string, ContentMetricSnapshot>()
  for (const snapshot of snapshots) {
    if (!snapshot.post_id) continue
    const key = `${snapshot.post_id}:${snapshot.metric_name}`
    const current = map.get(key)
    if (!current || new Date(snapshot.pulled_at).getTime() > new Date(current.pulled_at).getTime()) {
      map.set(key, snapshot)
    }
  }
  return map
}

function normalizeSnapshots(rows: ContentMetricSnapshot[]) {
  return rows.map(row => ({
    ...row,
    metric_value: typeof row.metric_value === 'number' ? row.metric_value : Number(row.metric_value) || 0,
  }))
}

function rangeWindow(range: DateRange, offset: 0 | 1) {
  if (range === 'all') return { start: null, end: null }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  if (offset === 1) end.setDate(end.getDate() - days)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function effectiveDate(post: MeasurePost) {
  return post.posted_at ?? post.published_at ?? post.scheduled_at ?? post.created_at ?? null
}

function isPosted(post: MeasurePost) {
  const status = (post.status ?? '').toLowerCase()
  return !!post.posted_at || !!post.posted_url || status.includes('post') || status.includes('publish')
}

function postLifecycleStatus(post: MeasurePost) {
  const value = statusKind(post.status ?? '')
  if (isPosted(post)) return 'posted'
  if ((post.scheduled_at || post.publish_date) && value === 'approved') return 'scheduled'
  return value
}

function detectProvider(post: MeasurePost) {
  if (post.provider) return post.provider
  const value = `${post.channel ?? ''} ${post.posted_url ?? ''}`.toLowerCase()
  if (value.includes('linkedin')) return 'linkedin'
  if (value.includes('instagram')) return 'meta_instagram'
  if (value.includes('facebook') || value.includes('fb.watch')) return 'meta_facebook_pages'
  if (value === 'x' || value.includes('twitter') || value.includes('x.com')) return 'x'
  if (value.includes('youtube') || value.includes('youtu.be')) return 'youtube'
  if (value.includes('medium')) return 'medium'
  if (value.includes('quora')) return 'quora'
  if (value.includes('reddit')) return 'reddit'
  if (value.includes('wordpress')) return 'wordpress'
  if (value.includes('blog')) return 'blog'
  return post.channel || 'unknown'
}

function statusKind(status: string) {
  const value = (status ?? '').toLowerCase()
  if (value.includes('post') || value.includes('publish')) return 'posted'
  if (value.includes('sched')) return 'scheduled'
  if (value.includes('approv')) return 'approved'
  if (value.includes('reject') || value.includes('park')) return 'rejected'
  if (value.includes('change') || value.includes('pending') || value === 'draft') return 'pending'
  return value || 'unknown'
}

function statusLabel(status: string) {
  const value = statusKind(status)
  const labels: Record<string, string> = {
    pending: 'Pending review',
    approved: 'Approved',
    scheduled: 'Scheduled',
    posted: 'Posted',
    rejected: 'Parked',
    unknown: 'Unknown',
  }
  return labels[value] ?? status
}

function statusColor(status: string) {
  const value = statusKind(status)
  if (value === 'posted' || value === 'approved') return color.success
  if (value === 'scheduled') return color.info
  if (value === 'pending') return color.warn
  if (value === 'rejected') return color.ghost
  return color.faint
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    linkedin: 'LinkedIn',
    meta_facebook_pages: 'Facebook',
    meta_instagram: 'Instagram',
    google_search_console: 'Search Console',
    google_analytics_4: 'GA4',
    youtube: 'YouTube',
    x: 'X',
    medium: 'Medium',
    quora: 'Quora',
    reddit: 'Reddit',
    wordpress: 'WordPress',
    tiktok: 'TikTok',
    pinterest: 'Pinterest',
    bluesky: 'Bluesky',
    blog: 'Blog',
    unknown: 'Unknown',
  }
  return labels[provider] ?? provider.replaceAll('_', ' ')
}

function providerDot(provider: string) {
  if (provider === 'linkedin') return color.dotBlue
  if (provider === 'meta_instagram') return color.dotPink
  if (provider === 'meta_facebook_pages') return '#6366F1'
  if (provider === 'youtube') return color.danger
  if (provider === 'x') return color.dotSky
  if (provider === 'medium') return color.dotViolet
  if (provider === 'quora') return '#b92b27'
  if (provider === 'reddit') return '#ea580c'
  if (provider === 'wordpress') return '#7c3aed'
  if (provider === 'blog') return color.dotGreen
  return color.ghost
}

function friendlyIntegrationDetail(detail: string | null | undefined, fallback: string) {
  if (!detail) return fallback
  if (detail.includes('(#') || detail.toLowerCase().includes('tried accessing')) {
    return 'Needs review in Settings. The provider connection is present, but the app is requesting a field Meta does not return.'
  }
  return detail
}

function latestSyncLabel(rows: PostRowData[]) {
  const latest = latestDate(rows.map(row => row.pulledAt))
  return latest ? `Last sync ${relativeDate(latest)}` : 'No provider snapshots yet'
}

function latestDate(values: Array<string | null | undefined>) {
  const timestamps = values
    .filter((value): value is string => !!value)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite)
  if (!timestamps.length) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function dateValue(value: string | null) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: value >= 10000 ? 1 : 0 }).format(value)
}

function formatRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'No data'
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}

function formatDelta(current: number | null | undefined, previous: number | null | undefined, rate?: boolean) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0 && current === 0) return null
  if (previous === 0) return { label: rate ? '+100%' : '+new', tone: color.success }
  const change = (current - previous) / Math.abs(previous)
  if (Math.abs(change) < 0.01) return { label: 'flat', tone: color.ghost }
  return {
    label: `${change > 0 ? '+' : ''}${(change * 100).toFixed(0)}%`,
    tone: change > 0 ? color.success : color.danger,
  }
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
