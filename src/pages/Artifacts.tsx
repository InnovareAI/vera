// Artifacts is the client library for generated work and brand-kit files.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ElementType } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  BookMarked,
  CalendarDays,
  Clapperboard,
  ClipboardList,
  Download,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Megaphone,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Campaign, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { EmptyState, Input, PageHeader, Select, color, radius, space, type as t } from '../design'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const INGEST_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/project-ingest` : ''
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

type Cat = 'all' | 'campaigns' | 'posts' | 'images' | 'videos' | 'logos' | 'guidelines' | 'briefings'
type BrandKitCat = 'logos' | 'guidelines' | 'briefings'
type SortKey = 'newest' | 'oldest' | 'title' | 'status' | 'channel'

const BRAND_CAT: Record<BrandKitCat, string> = {
  logos: 'logo',
  guidelines: 'guideline',
  briefings: 'briefing',
}

const BRAND_KIT_CATS: BrandKitCat[] = ['logos', 'guidelines', 'briefings']

interface ProjectAsset {
  id: string
  project_id: string
  name: string
  kind: string
  mime_type: string
  storage_path: string
  file_size: number
  metadata: { category?: string; [key: string]: unknown } | null
  created_at: string
}

function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function statusColor(status?: string): string {
  const s = (status ?? '').toLowerCase()
  if (s.includes('approv') || s.includes('post') || s.includes('publish')) return color.success
  if (s.includes('reject') || s.includes('fail')) return color.danger
  if (s.includes('schedule')) return color.info
  if (s.includes('pending') || s.includes('review') || s.includes('draft')) return color.warn
  return color.accent
}

function statusLabel(status?: string): string {
  return (status || 'draft').replace(/_/g, ' ')
}

function assetKind(mime: string, cat: Cat): string {
  if (cat === 'logos') return 'logo'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessing') || mime.includes('msword')) return 'docx'
  if (mime.startsWith('text/') || mime.includes('markdown')) return 'text'
  if (mime.includes('font')) return 'font'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'other'
}

function dateMs(value?: string | null): number {
  if (!value) return 0
  const d = new Date(value)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function postDate(post: Post): string | undefined | null {
  return post.scheduled_at || post.published_at || post.posted_at || post.created_at
}

function campaignDate(campaign: Campaign): string | undefined {
  return campaign.start_date || campaign.created_at
}

function includesQuery(query: string, ...values: Array<unknown>): boolean {
  if (!query) return true
  return values.some(value => String(value ?? '').toLowerCase().includes(query))
}

function assetCategory(asset: ProjectAsset): BrandKitCat | null {
  const category = asset.metadata?.category
  if (!category) return null
  const entry = BRAND_KIT_CATS.find(key => BRAND_CAT[key] === category)
  return entry ?? null
}

function compareText(a: string | undefined | null, b: string | undefined | null): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })
}

function sortPosts(rows: Post[], sort: SortKey): Post[] {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return dateMs(postDate(a)) - dateMs(postDate(b))
    if (sort === 'title') return compareText(a.title || a.copy, b.title || b.copy)
    if (sort === 'status') return compareText(a.status, b.status)
    if (sort === 'channel') return compareText(a.channel, b.channel)
    return dateMs(postDate(b)) - dateMs(postDate(a))
  })
}

function sortCampaigns(rows: Campaign[], sort: SortKey): Campaign[] {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return dateMs(campaignDate(a)) - dateMs(campaignDate(b))
    if (sort === 'status') return compareText(a.status, b.status)
    if (sort === 'channel') return compareText((a.platforms ?? []).join(' '), (b.platforms ?? []).join(' '))
    if (sort === 'title') return compareText(a.name, b.name)
    return dateMs(campaignDate(b)) - dateMs(campaignDate(a))
  })
}

function sortAssets(rows: ProjectAsset[], sort: SortKey): ProjectAsset[] {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return dateMs(a.created_at) - dateMs(b.created_at)
    if (sort === 'title' || sort === 'channel' || sort === 'status') return compareText(a.name, b.name)
    return dateMs(b.created_at) - dateMs(a.created_at)
  })
}

export default function Artifacts() {
  const { activeProject } = useProject()
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [contentCats, setContentCats] = useState<{ name: string; color: string | null }[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<Cat>('all')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('newest')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const uploadCat = useRef<BrandKitCat>('guidelines')

  useRightRail(null, [])

  const load = useCallback(async () => {
    if (!activeProject?.id) {
      setPosts([])
      setCampaigns([])
      setAssets([])
      setSigned({})
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    setSigned({})

    try {
      const [postRes, campaignRes, assetRes, categoryRes] = await Promise.all([
        supabase.from('content_posts').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
        supabase.from('campaigns').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
        supabase.from('project_assets').select('id, project_id, name, kind, mime_type, storage_path, file_size, metadata, created_at').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
        supabase.from('content_categories').select('name, color').eq('project_id', activeProject.id).order('sort_order'),
      ])

      const errors = [postRes.error, campaignRes.error, assetRes.error, categoryRes.error].filter(Boolean)
      if (errors.length) throw new Error(errors.map(error => error?.message).join(' '))

      const assetRows = (assetRes.data ?? []) as ProjectAsset[]
      setPosts((postRes.data ?? []) as Post[])
      setCampaigns((campaignRes.data ?? []) as Campaign[])
      setAssets(assetRows)
      setContentCats((categoryRes.data ?? []) as { name: string; color: string | null }[])

      const paths = assetRows.map(row => row.storage_path).filter(Boolean)
      if (paths.length) {
        const { data: urls, error } = await supabase.storage.from('project-assets').createSignedUrls(paths, 3600)
        if (error) {
          setNotice({ type: 'err', text: `Files loaded, but previews could not be signed: ${error.message}` })
        } else if (urls) {
          const map: Record<string, string> = {}
          for (const u of urls) if (u.path && u.signedUrl) map[u.path] = u.signedUrl
          setSigned(map)
        }
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Artifacts could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [activeProject])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const normalizedQuery = query.trim().toLowerCase()

  const contentCategoryColor = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of contentCats) if (item.color) map.set(item.name, item.color)
    return map
  }, [contentCats])

  const rawImages = useMemo(() => posts.filter(post => post.media_url && (post.media_type ?? 'image') !== 'video'), [posts])
  const rawVideos = useMemo(() => posts.filter(post => post.media_url && post.media_type === 'video'), [posts])

  const filteredCampaigns = useMemo(() => sortCampaigns(
    campaigns.filter(campaign => includesQuery(normalizedQuery, campaign.name, campaign.theme, campaign.description, campaign.goal, campaign.status, (campaign.platforms ?? []).join(' '))),
    sortKey,
  ), [campaigns, normalizedQuery, sortKey])

  const filteredPosts = useMemo(() => sortPosts(
    posts.filter(post => includesQuery(normalizedQuery, post.title, post.copy, post.channel, post.status, post.category, post.format)),
    sortKey,
  ), [posts, normalizedQuery, sortKey])

  const filteredImages = useMemo(() => filteredPosts.filter(post => post.media_url && (post.media_type ?? 'image') !== 'video'), [filteredPosts])
  const filteredVideos = useMemo(() => filteredPosts.filter(post => post.media_url && post.media_type === 'video'), [filteredPosts])

  const filteredBrandAssets = useMemo(() => {
    const grouped: Record<BrandKitCat, ProjectAsset[]> = { logos: [], guidelines: [], briefings: [] }
    for (const asset of assets) {
      const key = assetCategory(asset)
      if (!key) continue
      if (!includesQuery(normalizedQuery, asset.name, asset.kind, asset.mime_type, key)) continue
      grouped[key].push(asset)
    }
    for (const key of BRAND_KIT_CATS) grouped[key] = sortAssets(grouped[key], sortKey)
    return grouped
  }, [assets, normalizedQuery, sortKey])

  const brandAssetCount = useMemo(
    () => assets.filter(asset => Boolean(assetCategory(asset))).length,
    [assets],
  )

  const filteredBrandAssetTotal = BRAND_KIT_CATS.reduce((sum, key) => sum + filteredBrandAssets[key].length, 0)
  const libraryTotal = campaigns.length + posts.length + brandAssetCount

  const cats: Array<{ key: Cat; label: string; icon: ElementType; count: number; group: 'made' | 'kit' }> = [
    { key: 'all', label: 'All', icon: LayoutGrid, count: libraryTotal, group: 'made' },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone, count: campaigns.length, group: 'made' },
    { key: 'posts', label: 'Posts', icon: FileText, count: posts.length, group: 'made' },
    { key: 'images', label: 'Images', icon: ImageIcon, count: rawImages.length, group: 'made' },
    { key: 'videos', label: 'Videos', icon: Clapperboard, count: rawVideos.length, group: 'made' },
    { key: 'logos', label: 'Logos', icon: ImagePlus, count: assets.filter(asset => assetCategory(asset) === 'logos').length, group: 'kit' },
    { key: 'guidelines', label: 'Guidelines', icon: BookMarked, count: assets.filter(asset => assetCategory(asset) === 'guidelines').length, group: 'kit' },
    { key: 'briefings', label: 'Briefings', icon: ClipboardList, count: assets.filter(asset => assetCategory(asset) === 'briefings').length, group: 'kit' },
  ]

  const showCampaigns = cat === 'all' || cat === 'campaigns'
  const showPosts = cat === 'all' || cat === 'posts'
  const isBrandKit = cat === 'logos' || cat === 'guidelines' || cat === 'briefings'
  const empty = !loading && campaigns.length === 0 && posts.length === 0 && brandAssetCount === 0
  const visibleTotal = cat === 'all'
    ? filteredCampaigns.length + filteredPosts.length + filteredBrandAssetTotal
    : cat === 'campaigns'
      ? filteredCampaigns.length
      : cat === 'posts'
        ? filteredPosts.length
        : cat === 'images'
          ? filteredImages.length
          : cat === 'videos'
            ? filteredVideos.length
            : filteredBrandAssets[cat].length

  const open = (postId: string) => {
    if (activeProject) navigate(`/p/${activeProject.slug}/review/${postId}`)
  }

  function requestUpload(kind: BrandKitCat) {
    uploadCat.current = kind
    fileInput.current?.click()
  }

  async function onFiles(files: FileList | null) {
    if (!files || !activeProject?.id || uploading) return
    if (!INGEST_URL || !ANON) {
      setNotice({ type: 'err', text: 'Upload is not configured for this environment.' })
      return
    }

    const list = Array.from(files)
    if (!list.length) return

    const targetCat = uploadCat.current
    const category = BRAND_CAT[targetCat]
    setUploading(true)
    setNotice(null)

    let uploaded = 0
    let failed = 0

    for (const file of list) {
      try {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
        const storagePath = `${activeProject.id}/${crypto.randomUUID()}${ext}`
        const { error: uploadError } = await supabase.storage.from('project-assets').upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        })
        if (uploadError) throw uploadError

        const { data: authData, error: authError } = await supabase.auth.getSession()
        if (authError) throw authError
        const token = authData.session?.access_token
        if (!token) throw new Error('Sign in again before uploading files.')

        const response = await fetch(INGEST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            kind: 'file',
            project_id: activeProject.id,
            storage_path: storagePath,
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            asset_kind: assetKind(file.type || '', targetCat),
          }),
        })

        const out = await response.json().catch(() => ({})) as { asset_id?: string; error?: string }
        if (!response.ok || !out.asset_id) throw new Error(out.error ?? `Ingest returned HTTP ${response.status}`)

        const { error: metadataError } = await supabase
          .from('project_assets')
          .update({ metadata: { category, uploaded_from: 'artifacts' } })
          .eq('id', out.asset_id)
        if (metadataError) throw metadataError

        uploaded += 1
      } catch {
        failed += 1
      }
    }

    setUploading(false)
    if (fileInput.current) fileInput.current.value = ''
    setNotice({
      type: failed ? 'err' : 'ok',
      text: failed
        ? `${uploaded} uploaded, ${failed} failed.`
        : `${uploaded} ${uploaded === 1 ? 'file' : 'files'} uploaded.`,
    })
    void load()
  }

  async function deleteAsset(asset: ProjectAsset) {
    if (!confirm(`Delete "${asset.name}"? This removes the file too.`)) return
    setNotice(null)
    try {
      const { error: storageError } = await supabase.storage.from('project-assets').remove([asset.storage_path])
      if (storageError) throw storageError
      const { error: dbError } = await supabase.from('project_assets').delete().eq('id', asset.id)
      if (dbError) throw dbError
      setNotice({ type: 'ok', text: 'Asset deleted.' })
      void load()
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'Asset could not be deleted.' })
    }
  }

  if (!activeProject) {
    return (
      <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 860 }}>
        <EmptyState
          icon={<FolderOpen size={22} strokeWidth={1.5} />}
          title="No active client"
          body="Pick a client space to see its generated work, media, logos, guidelines, and briefs."
        />
      </div>
    )
  }

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1240 }}>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={event => onFiles(event.target.files)}
        accept="image/*,.svg,.pdf,.doc,.docx,.txt,.md"
      />

      <PageHeader
        eyebrow={activeProject.name}
        title="Studio"
        subtitle="Everything VERA produces or reuses for this client: campaigns, posts, media, logos, guidelines, briefs, and content assets."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: space[3], marginBottom: space[5] }}>
        <MetricCard icon={Megaphone} label="Campaigns" value={campaigns.length} tone={color.dotBlue} />
        <MetricCard icon={FileText} label="Posts" value={posts.length} tone={color.dotGreen} />
        <MetricCard icon={ImageIcon} label="Media" value={rawImages.length + rawVideos.length} tone={color.dotPink} />
        <MetricCard icon={BookMarked} label="Brand kit" value={brandAssetCount} tone={color.dotAmber} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 170px auto', alignItems: 'center', gap: space[3], marginBottom: space[4] }}>
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search artifacts" leading={<Search size={15} />} />
        <Select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} aria-label="Sort artifacts">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title</option>
          <option value="status">Status</option>
          <option value="channel">Platform</option>
        </Select>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: space[2], flexWrap: 'wrap' }}>
          <UploadButton label="Logo" icon={ImagePlus} disabled={uploading} onClick={() => requestUpload('logos')} />
          <UploadButton label="Guideline" icon={BookMarked} disabled={uploading} onClick={() => requestUpload('guidelines')} />
          <UploadButton label="Brief" icon={ClipboardList} disabled={uploading} onClick={() => requestUpload('briefings')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', alignItems: 'center', marginBottom: space[5] }}>
        {cats.map((item, index) => {
          const active = cat === item.key
          const Icon = item.icon
          const firstKit = item.group === 'kit' && cats[index - 1]?.group === 'made'
          return (
            <span key={item.key} style={{ display: 'contents' }}>
              {firstKit && <span style={{ width: 1, height: 24, background: color.line, margin: `0 ${space[1]}` }} />}
              <button
                type="button"
                onClick={() => setCat(item.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 13px',
                  fontSize: t.size.cap,
                  fontWeight: t.weight.medium,
                  cursor: 'pointer',
                  color: active ? '#fff' : color.ink2,
                  background: active ? color.accent : color.surface,
                  border: `1px solid ${active ? color.accent : color.line}`,
                  borderRadius: radius.pill,
                  boxShadow: active ? 'var(--shadow-glow)' : 'none',
                }}
              >
                <Icon size={14} />
                {item.label}
                <span style={{ fontSize: t.size.micro, opacity: 0.75, fontWeight: t.weight.semibold }}>{item.count}</span>
              </button>
            </span>
          )
        })}
      </div>

      {notice && <Notice tone={notice.type} text={notice.text} />}
      {loadError && <Notice tone="err" text={loadError} />}

      {loading && (
        <div style={{ color: color.ghost, fontSize: t.size.cap, padding: space[6], display: 'flex', alignItems: 'center', gap: space[2] }}>
          <Loader2 size={15} className="vera-spin" />
          Loading the library...
        </div>
      )}

      {empty && (
        <EmptyState
          icon={<LayoutGrid size={22} strokeWidth={1.5} />}
          title="Nothing here yet"
          body="Brief a post, plan a campaign, or upload brand-kit files. Everything for this client will live here."
        />
      )}

      {!loading && !empty && visibleTotal === 0 && (
        <EmptyState
          icon={<Search size={22} strokeWidth={1.5} />}
          title="No matching artifacts"
          body="Clear the search or switch filters to see more of this client's library."
        />
      )}

      {showCampaigns && filteredCampaigns.length > 0 && (
        <section style={{ marginBottom: space[8] }}>
          <SectionTitle icon={Megaphone} label="Campaigns" count={filteredCampaigns.length} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space[3] }}>
            {filteredCampaigns.map(campaign => <CampaignCard key={campaign.id} campaign={campaign} />)}
          </div>
        </section>
      )}

      {showPosts && filteredPosts.length > 0 && (
        <section style={{ marginBottom: space[8] }}>
          <SectionTitle icon={FileText} label="Posts" count={filteredPosts.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {filteredPosts.map(post => (
              <PostRow key={post.id} post={post} categoryColor={contentCategoryColor.get(post.category ?? '')} onOpen={() => open(post.id)} />
            ))}
          </div>
        </section>
      )}

      {cat === 'images' && (
        filteredImages.length === 0 ? (
          <EmptyState icon={<ImageIcon size={22} strokeWidth={1.5} />} title="No images yet" body="Images Vera generates for this client's posts show up here." />
        ) : (
          <MediaGrid posts={filteredImages} type="image" onOpen={open} />
        )
      )}

      {cat === 'videos' && (
        filteredVideos.length === 0 ? (
          <EmptyState icon={<Clapperboard size={22} strokeWidth={1.5} />} title="No videos yet" body="Clips Vera renders for this client show up here." />
        ) : (
          <MediaGrid posts={filteredVideos} type="video" onOpen={open} />
        )
      )}

      {cat === 'all' && filteredBrandAssetTotal > 0 && (
        <section style={{ marginBottom: space[8] }}>
          <SectionTitle icon={BookMarked} label="Brand kit" count={filteredBrandAssetTotal} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: space[3] }}>
            {BRAND_KIT_CATS.map(key => (
              <BrandAssetGroup
                key={key}
                cat={key}
                assets={filteredBrandAssets[key]}
                signed={signed}
                onUpload={() => requestUpload(key)}
                onDelete={deleteAsset}
                compact
              />
            ))}
          </div>
        </section>
      )}

      {isBrandKit && (
        <section style={{ marginBottom: space[8] }}>
          <UploadPanel cat={cat} uploading={uploading} onUpload={() => requestUpload(cat)} />
          <BrandAssetGroup
            cat={cat}
            assets={filteredBrandAssets[cat]}
            signed={signed}
            onUpload={() => requestUpload(cat)}
            onDelete={deleteAsset}
          />
        </section>
      )}

      <div style={{ height: space[8] }} />
    </div>
  )
}

function SectionTitle({ icon: Icon, label, count }: { icon: ElementType; label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: space[3] }}>
      <Icon size={15} style={{ color: color.ink2 }} />
      <span style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{label}</span>
      <span style={{ fontSize: t.size.micro, color: color.ghost, fontWeight: t.weight.medium }}>{count}</span>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }: { icon: ElementType; label: string; value: number; tone: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, color: tone, background: color.paper2 }}>
        <Icon size={15} />
      </span>
      <div>
        <div style={{ fontSize: t.size.h4, fontWeight: t.weight.semibold, color: color.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: t.size.micro, color: color.ghost, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

function UploadButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: ElementType; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minHeight: 34,
        padding: '0 12px',
        border: `1px solid ${color.line}`,
        borderRadius: radius.pill,
        background: color.surface,
        color: disabled ? color.faint : color.ink2,
        cursor: disabled ? 'wait' : 'pointer',
        fontSize: t.size.cap,
        fontWeight: t.weight.medium,
      }}
    >
      {disabled ? <Loader2 size={14} className="vera-spin" /> : <Icon size={14} />}
      {label}
    </button>
  )
}

function Notice({ tone, text }: { tone: 'ok' | 'err'; text: string }) {
  const isError = tone === 'err'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      marginBottom: space[4],
      padding: `${space[3]} ${space[4]}`,
      borderRadius: radius.md,
      border: `1px solid ${isError ? color.danger : color.success}`,
      color: isError ? color.danger : color.success,
      background: color.surface,
      fontSize: t.size.sm,
    }}>
      <AlertCircle size={15} />
      {text}
    </div>
  )
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const platforms = campaign.platforms?.filter(Boolean) ?? []
  return (
    <article style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4], minHeight: 176 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: space[3], alignItems: 'flex-start' }}>
        <Badge icon={Megaphone} label="Campaign" tone={color.accent} />
        <StatusBadge label={campaign.status} />
      </div>
      <div style={{ fontSize: t.size.lg, fontWeight: t.weight.semibold, color: color.ink, margin: '8px 0 4px', lineHeight: 1.28 }}>{campaign.name}</div>
      {(campaign.theme || campaign.description || campaign.goal) && (
        <div style={{ fontSize: t.size.sm, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {campaign.theme || campaign.description || campaign.goal}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], alignItems: 'center', marginTop: space[3], fontSize: t.size.micro, color: color.ghost }}>
        <span>{campaign.post_count ?? 0} posts</span>
        {(campaign.start_date || campaign.end_date) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CalendarDays size={11} />
            {fmtDate(campaign.start_date)}{campaign.end_date ? ` to ${fmtDate(campaign.end_date)}` : ''}
          </span>
        )}
        {platforms.slice(0, 3).map(platform => <span key={platform}>{platform}</span>)}
      </div>
    </article>
  )
}

function PostRow({ post, categoryColor, onOpen }: { post: Post; categoryColor?: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: 'left',
        display: 'grid',
        gridTemplateColumns: '56px minmax(0, 1fr) auto',
        gap: space[3],
        alignItems: 'start',
        width: '100%',
        padding: space[3],
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        cursor: 'pointer',
      }}
    >
      <PostThumb post={post} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{post.title || 'Untitled'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.size.micro, color: color.ghost }}>
            <Globe size={10} />
            {post.channel}
          </span>
          <StatusBadge label={post.status} />
          {post.category && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.size.micro, color: color.ink2 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: categoryColor ?? color.ghost, flexShrink: 0 }} />
              {post.category}
            </span>
          )}
        </div>
        <div style={{ fontSize: t.size.sm, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.copy}
        </div>
      </div>
      <span style={{ fontSize: t.size.micro, color: color.faint, flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtDate(postDate(post))}</span>
    </button>
  )
}

function PostThumb({ post }: { post: Post }) {
  const common: CSSProperties = { width: 56, height: 56, objectFit: 'cover', borderRadius: radius.sm, display: 'block', background: color.paper2 }
  if (post.media_url && post.media_type === 'video') return <video src={post.media_url} muted playsInline style={common} />
  if (post.media_url) return <img src={post.media_url} alt="" style={common} />
  return (
    <span style={{ ...common, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: color.faint, border: `1px solid ${color.line}` }}>
      <FileText size={17} />
    </span>
  )
}

function MediaGrid({ posts, type, onOpen }: { posts: Post[]; type: 'image' | 'video'; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${type === 'video' ? 260 : 180}px, 1fr))`, gap: space[3] }}>
      {posts.map(post => (
        <button
          key={post.id}
          type="button"
          onClick={() => onOpen(post.id)}
          title={post.title ?? ''}
          style={{ padding: 0, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', cursor: 'pointer', background: color.surface, textAlign: 'left' }}
        >
          <div style={{ aspectRatio: type === 'video' ? '16 / 9' : '1 / 1', background: type === 'video' ? '#000' : color.paper2 }}>
            {type === 'video'
              ? <video src={post.media_url} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <img src={post.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </div>
          <div style={{ padding: space[3] }}>
            <div style={{ fontSize: t.size.cap, fontWeight: t.weight.semibold, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.title || 'Untitled'}</div>
            <div style={{ fontSize: t.size.micro, color: color.ghost, marginTop: 3 }}>{post.channel} - {fmtDate(postDate(post))}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

function UploadPanel({ cat, uploading, onUpload }: { cat: BrandKitCat; uploading: boolean; onUpload: () => void }) {
  const label = cat === 'logos' ? 'logos' : cat === 'guidelines' ? 'guideline docs' : 'briefs'
  const helper = cat === 'logos' ? 'PNG, SVG, and JPG brand marks.' : 'PDF, DOCX, TXT, MD, and image files that Vera can read or reference.'
  return (
    <button
      type="button"
      onClick={onUpload}
      disabled={uploading}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        padding: space[7],
        marginBottom: space[5],
        cursor: uploading ? 'wait' : 'pointer',
        background: color.paper2,
        border: `1.5px dashed ${color.line2}`,
        borderRadius: radius.lg,
        color: color.ink2,
      }}
    >
      {uploading ? <Loader2 size={20} className="vera-spin" /> : <Upload size={20} style={{ color: color.accent }} />}
      <span style={{ fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink }}>
        {uploading ? 'Uploading...' : `Upload ${label}`}
      </span>
      <span style={{ fontSize: t.size.micro, color: color.ghost }}>{helper}</span>
    </button>
  )
}

function BrandAssetGroup({
  cat,
  assets,
  signed,
  compact,
  onUpload,
  onDelete,
}: {
  cat: BrandKitCat
  assets: ProjectAsset[]
  signed: Record<string, string>
  compact?: boolean
  onUpload: () => void
  onDelete: (asset: ProjectAsset) => void
}) {
  const Icon = cat === 'logos' ? ImagePlus : cat === 'guidelines' ? BookMarked : ClipboardList
  const label = cat === 'logos' ? 'Logos' : cat === 'guidelines' ? 'Guidelines' : 'Briefings'

  if (!assets.length) {
    return (
      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
        <SectionTitle icon={Icon} label={label} count={0} />
        <button
          type="button"
          onClick={onUpload}
          style={{ width: '100%', minHeight: 84, border: `1px dashed ${color.line2}`, borderRadius: radius.md, background: color.paper2, color: color.ink2, cursor: 'pointer', fontSize: t.size.sm }}
        >
          Upload {label.toLowerCase()}
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: compact ? color.surface : 'transparent', border: compact ? `1px solid ${color.line}` : 'none', borderRadius: radius.md, padding: compact ? space[4] : 0 }}>
      <SectionTitle icon={Icon} label={label} count={assets.length} />
      {cat === 'logos' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space[3] }}>
          {assets.map(asset => (
            <div key={asset.id} style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', background: color.surface }}>
              <div style={{ aspectRatio: '1 / 1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[3] }}>
                {signed[asset.storage_path]
                  ? <img src={signed[asset.storage_path]} alt={asset.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <ImagePlus size={20} style={{ color: color.faint }} />}
              </div>
              <AssetActions asset={asset} signedUrl={signed[asset.storage_path]} onDelete={onDelete} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
          {assets.map(asset => (
            <div key={asset.id} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
              <FileText size={18} style={{ color: color.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
                <div style={{ fontSize: t.size.micro, color: color.ghost }}>{asset.kind.toUpperCase()} - {fmtSize(asset.file_size)} - {fmtDate(asset.created_at)}</div>
              </div>
              {signed[asset.storage_path] && (
                <a href={signed[asset.storage_path]} target="_blank" rel="noreferrer" title="Download" style={{ color: color.ink2, display: 'flex' }}>
                  <Download size={15} />
                </a>
              )}
              <button type="button" onClick={() => onDelete(asset)} title="Delete" style={iconButtonStyle}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AssetActions({ asset, signedUrl, onDelete }: { asset: ProjectAsset; signedUrl?: string; onDelete: (asset: ProjectAsset) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `6px ${space[2]}`, borderTop: `1px solid ${color.line}` }}>
      <span style={{ fontSize: t.size.micro, color: color.ink2, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</span>
      {signedUrl && (
        <a href={signedUrl} target="_blank" rel="noreferrer" title="Download" style={{ color: color.ink2, display: 'flex' }}>
          <Download size={13} />
        </a>
      )}
      <button type="button" onClick={() => onDelete(asset)} title="Delete" style={iconButtonStyle}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function Badge({ icon: Icon, label, tone }: { icon: ElementType; label: string; tone: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide, fontWeight: t.weight.semibold, color: tone }}>
      <Icon size={12} />
      {label}
    </span>
  )
}

function StatusBadge({ label }: { label?: string }) {
  const tone = statusColor(label)
  return (
    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: t.weight.semibold, color: tone, border: `1px solid ${tone}`, borderRadius: radius.pill, padding: '1px 7px', whiteSpace: 'nowrap' }}>
      {statusLabel(label)}
    </span>
  )
}

const iconButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: color.faint,
  display: 'flex',
  padding: 2,
}
