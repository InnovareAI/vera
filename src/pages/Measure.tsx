import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Send,
  TrendingUp,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Campaign, ClientIntegration, ContentMetricSnapshot, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { Button, PageHeader, SectionLabel, color, radius, space, type as t } from '../design'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

type MeasurePost = Post

type PostPerformance = {
  post: MeasurePost
  provider: string
  views: number
  reach: number
  engagements: number
  engagementRate: number | null
  comments: number
  shares: number
  saves: number
  clicks: number
  pulledAt: string | null
  measured: boolean
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

type SyncReport = {
  ok?: boolean
  checked_posts?: number
  synced_posts?: number
  metric_count?: number
  error?: string
}

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
        .select('id, org_id, project_id, campaign_id, title, copy, format, channel, status, scheduled_at, posted_at, posted_url, provider, provider_account_id, provider_post_id, provider_page_id, provider_media_id, provider_permalink, last_metric_sync_at, created_at, updated_at')
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
        setSyncMessage(`Synced ${report.synced_posts ?? 0} posts and ${report.metric_count ?? 0} metrics from ${report.checked_posts ?? 0} checked posts.`)
        await loadData(activeProject.id)
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Metric sync failed.')
    }
    setSyncing(false)
  }

  const productionStats = useMemo(() => buildProductionStats(posts, campaigns), [posts, campaigns])
  const performances = useMemo(() => buildPostPerformance(posts, snapshots), [posts, snapshots])
  const performanceStats = useMemo(() => buildPerformanceStats(performances), [performances])
  const platformPerformance = useMemo(() => buildPlatformPerformance(performances), [performances])
  const campaignPerformance = useMemo(() => buildCampaignPerformance(campaigns, posts, performances), [campaigns, posts, performances])
  const topPosts = useMemo(() => performances.filter(item => item.measured).sort(sortByImpact).slice(0, 5), [performances])
  const needsAttention = useMemo(() => buildNeedsAttention(performances), [performances])
  const providerReadiness = useMemo(() => buildProviderReadiness(integrations), [integrations])
  const latestPull = useMemo(() => latestDate(snapshots.map(snapshot => snapshot.pulled_at)), [snapshots])

  const productionTiles = [
    { label: 'Total posts', value: productionStats.total, icon: FileText, tone: color.ink },
    { label: 'Pending review', value: productionStats.pending, icon: Clock, tone: color.warn },
    { label: 'Approved', value: productionStats.approved, icon: CheckCircle2, tone: color.success },
    { label: 'Scheduled ahead', value: productionStats.scheduledAhead, icon: CalendarClock, tone: color.info },
    { label: 'Published', value: productionStats.posted, icon: Send, tone: color.success },
    { label: 'Campaigns', value: productionStats.campaigns, icon: Megaphone, tone: color.accent },
  ]

  const performanceTiles = [
    { label: 'Measured posts', value: `${performanceStats.measuredPosts}/${productionStats.posted}`, icon: Activity, tone: color.accent },
    { label: 'Views', value: formatNumber(performanceStats.views), icon: Eye, tone: color.info },
    { label: 'Engagements', value: formatNumber(performanceStats.engagements), icon: TrendingUp, tone: color.success },
    { label: 'Comments', value: formatNumber(performanceStats.comments), icon: MessageCircle, tone: color.warn },
    { label: 'Avg engagement rate', value: formatRate(performanceStats.engagementRate), icon: BarChart3, tone: color.ink },
    { label: 'Last sync', value: latestPull ? relativeDate(latestPull) : 'No data', icon: RefreshCw, tone: latestPull ? color.success : color.ghost },
  ]

  return (
    <div style={{ padding: `${space[8]} ${space[8]} ${space[10]}`, maxWidth: 1280 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? activeOrg?.name ?? 'Workspace'}
        title="Performance"
        subtitle="Production output, platform performance, campaign signals, and improvement opportunities for this client space."
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
          <SectionLabel style={{ marginBottom: space[3] }}>Production</SectionLabel>
          <TileGrid>
            {productionTiles.map(tile => <MetricTile key={tile.label} {...tile} />)}
          </TileGrid>
          <p style={{ fontSize: t.size.cap, color: color.ghost, marginTop: space[3], marginBottom: space[8] }}>
            {productionStats.perWeek} posts per week created over the last 4 weeks.
          </p>

          <SectionLabel style={{ marginBottom: space[3] }}>Performance</SectionLabel>
          <TileGrid>
            {performanceTiles.map(tile => <MetricTile key={tile.label} {...tile} />)}
          </TileGrid>
          <p style={{ fontSize: t.size.cap, color: color.ghost, marginTop: space[3], marginBottom: space[8] }}>
            Metrics are read from provider snapshots. Unmeasured published posts need a provider ID, a posted URL Vera can resolve, or a live adapter for that platform.
          </p>

          <SectionLabel style={{ marginBottom: space[3] }}>Provider coverage</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: space[3], marginBottom: space[8] }}>
            {providerReadiness.map(provider => (
              <ProviderCard key={provider.provider} {...provider} />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(300px, 0.8fr)', gap: space[6], alignItems: 'start', marginBottom: space[8] }}>
            <div>
              <SectionLabel style={{ marginBottom: space[3] }}>Top posts</SectionLabel>
              <PostList
                posts={topPosts}
                empty="No provider metrics synced yet."
                mode="top"
              />
            </div>
            <div>
              <SectionLabel tone={needsAttention.length ? 'accent' : 'default'} style={{ marginBottom: space[3] }}>Needs attention</SectionLabel>
              <AttentionList items={needsAttention} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: space[6], alignItems: 'start', marginBottom: space[8] }}>
            <div>
              <SectionLabel style={{ marginBottom: space[3] }}>Platform performance</SectionLabel>
              <PlatformList items={platformPerformance} />
            </div>
            <div>
              <SectionLabel style={{ marginBottom: space[3] }}>Campaign performance</SectionLabel>
              <CampaignList items={campaignPerformance} />
            </div>
          </div>

        </>
      )}
    </div>
  )
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: space[3] }}>
      {children}
    </div>
  )
}

function MetricTile({ label, value, icon: Icon, tone }: {
  label: string
  value: string | number
  icon: React.ElementType
  tone: string
}) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
      <Icon size={16} style={{ color: tone }} />
      <div style={{ fontSize: t.size.h3, fontWeight: t.weight.semibold, color: color.ink, lineHeight: 1.1, marginTop: space[3] }}>{value}</div>
      <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: space[2] }}>{label}</div>
    </div>
  )
}

function ProviderCard({ label, provider, status, detail, lastSync }: {
  label: string
  provider: string
  status: string
  detail: string
  lastSync: string | null
}) {
  const connected = status === 'connected'
  const planned = status === 'planned'
  const dot = connected ? color.success : planned ? color.ghost : color.warn
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{label}</p>
          <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>{providerLabel(provider)}</p>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2], color: dot, fontSize: t.size.cap, textTransform: 'capitalize' }}>
          <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: dot }} />
          {status}
        </span>
      </div>
      <p style={{ margin: `${space[4]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{detail}</p>
      <p style={{ margin: `${space[3]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>
        Last sync: {lastSync ? relativeDate(lastSync) : 'none yet'}
      </p>
    </div>
  )
}

function PostList({ posts, empty, mode }: { posts: PostPerformance[]; empty: string; mode: 'top' | 'attention' }) {
  if (!posts.length) return <EmptyPanel text={empty} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {posts.map(item => (
        <PostRow key={item.post.id} item={item} mode={mode} />
      ))}
    </div>
  )
}

function PostRow({ item, mode }: { item: PostPerformance; mode: 'top' | 'attention' }) {
  const title = item.post.title || item.post.copy?.slice(0, 80) || 'Untitled post'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space[4], alignItems: 'center', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
        <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.cap }}>
          {providerLabel(item.provider)} - {item.pulledAt ? `synced ${relativeDate(item.pulledAt)}` : 'not synced'}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[5], color: color.ink2, fontSize: t.size.cap }}>
        <span>{formatNumber(item.views || item.reach)} views</span>
        <span>{formatNumber(item.engagements)} eng.</span>
        <span style={{ color: mode === 'attention' ? color.warn : color.success, fontWeight: t.weight.semibold }}>{formatRate(item.engagementRate)}</span>
      </div>
    </div>
  )
}

function AttentionList({ items }: { items: PostPerformance[] }) {
  if (!items.length) {
    return <EmptyPanel text="No measured posts are underperforming, and no published posts are waiting on IDs." />
  }
  return <PostList posts={items} empty="" mode="attention" />
}

function PlatformList({ items }: { items: PlatformPerformance[] }) {
  if (!items.length) return <EmptyPanel text="Publish and sync posts to compare platforms." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {items.map(item => (
        <ProgressRow
          key={item.provider}
          label={providerLabel(item.provider)}
          meta={`${item.measured}/${item.posts} measured - ${formatRate(item.engagementRate)}`}
          value={item.engagements}
          max={Math.max(1, items[0]?.engagements ?? 1)}
          detail={`${formatNumber(item.views)} views`}
        />
      ))}
    </div>
  )
}

function CampaignList({ items }: { items: CampaignPerformance[] }) {
  if (!items.length) return <EmptyPanel text="Campaign performance appears once posts are assigned and synced." />
  const max = Math.max(1, ...items.map(item => item.engagements))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {items.map(item => (
        <ProgressRow
          key={item.id}
          label={item.name}
          meta={`${item.measured}/${item.posts} measured - ${item.status}`}
          value={item.engagements}
          max={max}
          detail={formatRate(item.engagementRate)}
        />
      ))}
    </div>
  )
}

function ProgressRow({ label, meta, value, max, detail }: {
  label: string
  meta: string
  value: number
  max: number
  detail: string
}) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3] }}>
        <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
        <p style={{ margin: 0, color: color.ghost, fontSize: t.size.cap }}>{detail}</p>
      </div>
      <div style={{ height: 7, background: color.paper2, borderRadius: radius.pill, overflow: 'hidden', marginTop: space[3] }}>
        <div style={{ width: `${Math.max(4, Math.min(100, (value / max) * 100))}%`, height: '100%', background: color.accent, borderRadius: radius.pill }} />
      </div>
      <p style={{ margin: `${space[2]} 0 0`, color: color.ghost, fontSize: t.size.micro }}>{meta}</p>
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div style={{ border: `1px dashed ${color.line2}`, borderRadius: radius.md, padding: space[6], color: color.ghost, fontSize: t.size.sm, background: color.paper2 }}>
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

function buildProductionStats(posts: MeasurePost[], campaigns: Campaign[]) {
  const now = Date.now()
  const status = (post: MeasurePost) => (post.status ?? '').toLowerCase()
  const isPosted = (post: MeasurePost) => !!post.posted_at || !!post.posted_url || status(post).includes('post') || status(post).includes('publish')
  const pending = posts.filter(post => {
    const value = status(post)
    return value.includes('pending') || value === 'draft' || value.includes('changes')
  }).length
  const approved = posts.filter(post => status(post).includes('approv')).length
  const scheduledAhead = posts.filter(post => post.scheduled_at && new Date(post.scheduled_at).getTime() > now && !isPosted(post)).length
  const posted = posts.filter(isPosted).length
  const fourWeeksAgo = now - 28 * 86400000
  const recent = posts.filter(post => post.created_at && new Date(post.created_at).getTime() >= fourWeeksAgo).length
  return {
    total: posts.length,
    pending,
    approved,
    scheduledAhead,
    posted,
    campaigns: campaigns.length,
    perWeek: (recent / 4).toFixed(1),
  }
}

function buildPostPerformance(posts: MeasurePost[], snapshots: ContentMetricSnapshot[]): PostPerformance[] {
  const latest = latestMetricMap(snapshots)
  return posts.filter(isPosted).map(post => {
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
    const explicitEngagements = metric('engagements')
    const engagements = explicitEngagements || reactions + comments + shares + saves + clicks
    const explicitRate = latest.get(`${post.id}:engagement_rate`)?.metric_value
    const denominator = views || reach
    const engagementRate = explicitRate != null ? explicitRate : denominator > 0 ? engagements / denominator : null
    const measured = [...latest.keys()].some(key => key.startsWith(`${post.id}:`))
    return {
      post,
      provider,
      views,
      reach,
      engagements,
      engagementRate,
      comments,
      shares,
      saves,
      clicks,
      pulledAt: latestPulledAt,
      measured,
    }
  })
}

function buildPerformanceStats(items: PostPerformance[]) {
  const measured = items.filter(item => item.measured)
  const views = measured.reduce((sum, item) => sum + item.views, 0)
  const reach = measured.reduce((sum, item) => sum + item.reach, 0)
  const engagements = measured.reduce((sum, item) => sum + item.engagements, 0)
  const comments = measured.reduce((sum, item) => sum + item.comments, 0)
  const denominator = measured.reduce((sum, item) => sum + (item.views || item.reach), 0)
  return {
    measuredPosts: measured.length,
    views,
    reach,
    engagements,
    comments,
    engagementRate: denominator > 0 ? engagements / denominator : null,
  }
}

function buildPlatformPerformance(items: PostPerformance[]): PlatformPerformance[] {
  const map = new Map<string, PostPerformance[]>()
  for (const item of items) {
    const list = map.get(item.provider) ?? []
    list.push(item)
    map.set(item.provider, list)
  }
  return [...map.entries()].map(([provider, list]) => {
    const measured = list.filter(item => item.measured)
    const views = measured.reduce((sum, item) => sum + item.views, 0)
    const reach = measured.reduce((sum, item) => sum + item.reach, 0)
    const engagements = measured.reduce((sum, item) => sum + item.engagements, 0)
    const denominator = measured.reduce((sum, item) => sum + (item.views || item.reach), 0)
    return {
      provider,
      posts: list.length,
      measured: measured.length,
      views: views || reach,
      engagements,
      engagementRate: denominator > 0 ? engagements / denominator : null,
    }
  }).sort((a, b) => b.engagements - a.engagements)
}

function buildCampaignPerformance(campaigns: Campaign[], posts: MeasurePost[], performances: PostPerformance[]): CampaignPerformance[] {
  const performanceByPost = new Map(performances.map(item => [item.post.id, item]))
  return campaigns.map(campaign => {
    const campaignPosts = posts.filter(post => post.campaign_id === campaign.id)
    const campaignPerformanceItems = campaignPosts.map(post => performanceByPost.get(post.id)).filter((item): item is PostPerformance => !!item)
    const measured = campaignPerformanceItems.filter(item => item.measured)
    const views = measured.reduce((sum, item) => sum + item.views, 0)
    const engagements = measured.reduce((sum, item) => sum + item.engagements, 0)
    const denominator = measured.reduce((sum, item) => sum + (item.views || item.reach), 0)
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      posts: campaignPosts.length,
      measured: measured.length,
      views,
      engagements,
      engagementRate: denominator > 0 ? engagements / denominator : null,
    }
  }).filter(item => item.posts > 0).sort((a, b) => b.engagements - a.engagements)
}

function buildNeedsAttention(items: PostPerformance[]) {
  return items
    .filter(item => !item.measured || (item.engagementRate != null && item.engagementRate < 0.01 && (item.views || item.reach) >= 50))
    .sort((a, b) => Number(a.measured) - Number(b.measured) || (a.engagementRate ?? 0) - (b.engagementRate ?? 0))
    .slice(0, 5)
}

function buildProviderReadiness(integrations: ClientIntegration[]) {
  const labels: Array<{ provider: string; label: string; detail: string }> = [
    { provider: 'linkedin', label: 'LinkedIn', detail: 'Unipile post counters, comments, reactions, and publishing IDs.' },
    { provider: 'meta_facebook_pages', label: 'Facebook Pages', detail: 'Page posts, reactions, comments, shares, clicks, reach, and impressions.' },
    { provider: 'meta_instagram', label: 'Instagram Professional', detail: 'Media views, reach, likes, comments, saves, shares, and interactions.' },
    { provider: 'google_search_console', label: 'Google Search Console', detail: 'Query, page, device, country, and search opportunity snapshots.' },
    { provider: 'google_analytics_4', label: 'Google Analytics 4', detail: 'Traffic, sessions, conversions, landing pages, and source performance.' },
    { provider: 'youtube', label: 'YouTube', detail: 'Channel, video, Shorts, view, subscriber, and watch-time analytics.' },
  ]
  const byProvider = new Map<string, ClientIntegration>(integrations.map(row => [row.provider, row]))
  return labels.map(item => {
    const row = byProvider.get(item.provider)
    return {
      provider: item.provider,
      label: item.label,
      status: row?.status ?? 'planned',
      detail: row?.health_detail || item.detail,
      lastSync: row?.last_sync_at ?? null,
    }
  })
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

function isPosted(post: MeasurePost) {
  const status = (post.status ?? '').toLowerCase()
  return !!post.posted_at || !!post.posted_url || status.includes('post') || status.includes('publish')
}

function detectProvider(post: MeasurePost) {
  if (post.provider) return post.provider
  const value = `${post.channel ?? ''} ${post.posted_url ?? ''}`.toLowerCase()
  if (value.includes('linkedin')) return 'linkedin'
  if (value.includes('instagram')) return 'meta_instagram'
  if (value.includes('facebook') || value.includes('fb.watch')) return 'meta_facebook_pages'
  if (value.includes('youtube') || value.includes('youtu.be')) return 'youtube'
  if (value.includes('medium')) return 'medium'
  if (value.includes('blog')) return 'blog'
  return post.channel || 'unknown'
}

function sortByImpact(a: PostPerformance, b: PostPerformance) {
  return b.engagements - a.engagements || (b.engagementRate ?? 0) - (a.engagementRate ?? 0)
}

function latestDate(values: Array<string | null | undefined>) {
  const timestamps = values
    .filter((value): value is string => !!value)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite)
  if (!timestamps.length) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: value >= 10000 ? 1 : 0 }).format(value)
}

function formatRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'No data'
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
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

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    linkedin: 'LinkedIn',
    meta_facebook_pages: 'Facebook',
    meta_instagram: 'Instagram',
    google_search_console: 'Search Console',
    google_analytics_4: 'GA4',
    youtube: 'YouTube',
    medium: 'Medium',
    blog: 'Blog',
    unknown: 'Unknown',
  }
  return labels[provider] ?? provider.replaceAll('_', ' ')
}
