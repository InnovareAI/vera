// Artifacts — the client's library (/p/:slug/artifacts).
//
// Everything tangible for this client in one place:
//   · Made by VERA — Campaigns, Posts, Images, Videos (from campaigns + content_posts)
//   · Brand kit    — Logos, Guidelines, Briefings (uploaded to the project-assets
//                    bucket via project-ingest; docs are also text-ingested into
//                    the knowledge base, so uploading a guideline "teaches" VERA)
//
// Distinct from Review (pending inbox) and Calendar (schedule): Artifacts is the
// archive — browse, reuse, open, upload.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Megaphone, FileText, Image as ImageIcon, Clapperboard, LayoutGrid, Globe,
  ImagePlus, BookMarked, ClipboardList, Upload, Download, Trash2, Loader2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post, Campaign } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { PageHeader, EmptyState, color, space, type as t, radius } from '../design'

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-ingest`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Cat = 'all' | 'campaigns' | 'posts' | 'images' | 'videos' | 'logos' | 'guidelines' | 'briefings'

// brand-kit cat → the value we tag in project_assets.metadata.category
const BRAND_CAT: Record<string, string> = { logos: 'logo', guidelines: 'guideline', briefings: 'briefing' }

interface ProjectAsset {
  id: string
  project_id: string
  name: string
  kind: string
  mime_type: string
  storage_path: string
  file_size: number
  metadata: { category?: string } | null
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
  if (s.includes('reject')) return color.danger
  return color.accent
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
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useRightRail(null, []) // full canvas

  const load = useCallback(async () => {
    if (!activeProject?.id) { setPosts([]); setCampaigns([]); setAssets([]); setLoading(false); return }
    setLoading(true)
    const [p, c, a, cat] = await Promise.all([
      supabase.from('content_posts').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
      supabase.from('campaigns').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
      supabase.from('project_assets').select('id, project_id, name, kind, mime_type, storage_path, file_size, metadata, created_at').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
      supabase.from('content_categories').select('name, color').eq('project_id', activeProject.id).order('sort_order'),
    ])
    setPosts((p.data ?? []) as Post[])
    setCampaigns((c.data ?? []) as Campaign[])
    setContentCats((cat.data ?? []) as { name: string; color: string | null }[])
    const aRows = (a.data ?? []) as ProjectAsset[]
    setAssets(aRows)
    setLoading(false)
    // batch signed URLs for the private bucket (logos/guideline previews, downloads)
    const paths = aRows.map(r => r.storage_path)
    if (paths.length) {
      const { data: urls } = await supabase.storage.from('project-assets').createSignedUrls(paths, 3600)
      if (urls) {
        const map: Record<string, string> = {}
        for (const u of urls) if (u.path && u.signedUrl) map[u.path] = u.signedUrl
        setSigned(map)
      }
    }
  }, [activeProject?.id])

  useEffect(() => { void load() }, [load])

  const images = useMemo(() => posts.filter(p => p.media_url && (p.media_type ?? 'image') !== 'video'), [posts])
  const videos = useMemo(() => posts.filter(p => p.media_url && p.media_type === 'video'), [posts])
  const catColor = useMemo(() => { const m = new Map<string, string>(); for (const c of contentCats) if (c.color) m.set(c.name, c.color); return m }, [contentCats])
  const brandAssets = useCallback((c: Cat) => assets.filter(a => a.metadata?.category === BRAND_CAT[c]), [assets])

  const open = (postId: string) => activeProject && navigate(`/p/${activeProject.slug}/review/${postId}`)

  async function onFiles(files: FileList | null) {
    if (!files || !activeProject?.id || uploading) return
    const arr = Array.from(files)
    if (!arr.length) return
    const category = BRAND_CAT[cat]
    if (!category) return
    setUploading(true)
    for (const file of arr) {
      try {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
        const storagePath = `${activeProject.id}/${crypto.randomUUID()}${ext}`
        const { error: upErr } = await supabase.storage.from('project-assets').upload(storagePath, file, { cacheControl: '3600', upsert: false })
        if (upErr) continue
        // project-ingest creates the project_assets row (+ text-extracts docs into KB)
        const res = await fetch(INGEST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
          body: JSON.stringify({
            kind: 'file', project_id: activeProject.id, storage_path: storagePath,
            file_name: file.name, mime_type: file.type || 'application/octet-stream',
            file_size: file.size, asset_kind: assetKind(file.type || '', cat),
          }),
        })
        const out = await res.json().catch(() => ({})) as { asset_id?: string }
        // tag the brand-kit category in metadata so we can filter by it
        if (out.asset_id) {
          await supabase.from('project_assets').update({ metadata: { category } }).eq('id', out.asset_id)
        }
      } catch { /* skip this file, continue */ }
    }
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ''
    void load()
  }

  async function deleteAsset(a: ProjectAsset) {
    if (!confirm(`Delete "${a.name}"? This removes the file too.`)) return
    await supabase.storage.from('project-assets').remove([a.storage_path])
    await supabase.from('project_assets').delete().eq('id', a.id)
    void load()
  }

  const cats: Array<{ key: Cat; label: string; icon: React.ElementType; count: number; group: 'made' | 'kit' }> = [
    { key: 'all', label: 'All', icon: LayoutGrid, count: campaigns.length + posts.length, group: 'made' },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone, count: campaigns.length, group: 'made' },
    { key: 'posts', label: 'Posts', icon: FileText, count: posts.length, group: 'made' },
    { key: 'images', label: 'Images', icon: ImageIcon, count: images.length, group: 'made' },
    { key: 'videos', label: 'Videos', icon: Clapperboard, count: videos.length, group: 'made' },
    { key: 'logos', label: 'Logos', icon: ImagePlus, count: brandAssets('logos').length, group: 'kit' },
    { key: 'guidelines', label: 'Guidelines', icon: BookMarked, count: brandAssets('guidelines').length, group: 'kit' },
    { key: 'briefings', label: 'Briefings', icon: ClipboardList, count: brandAssets('briefings').length, group: 'kit' },
  ]

  const showCampaigns = cat === 'all' || cat === 'campaigns'
  const showPosts = cat === 'all' || cat === 'posts'
  const isBrandKit = cat === 'logos' || cat === 'guidelines' || cat === 'briefings'
  const empty = !loading && campaigns.length === 0 && posts.length === 0 && assets.length === 0

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1180 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? 'Workspace'}
        title="Artifacts"
        subtitle="Everything for this client in one place — what VERA made (campaigns, posts, media) and the brand kit (logos, guidelines, briefings). Upload a guideline or brief and VERA reads it too."
      />

      {/* category filter bar */}
      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', alignItems: 'center', margin: `${space[2]} 0 ${space[6]}` }}>
        {cats.map((c, i) => {
          const active = cat === c.key
          const Icon = c.icon
          const firstKit = c.group === 'kit' && cats[i - 1]?.group === 'made'
          return (
            <span key={c.key} style={{ display: 'contents' }}>
              {firstKit && <span style={{ width: 1, height: 22, background: color.line, margin: `0 ${space[1]}` }} />}
              <button onClick={() => setCat(c.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px',
                  fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer',
                  color: active ? '#fff' : color.ink2,
                  background: active ? color.accent : color.surface,
                  border: `1px solid ${active ? color.accent : color.line}`,
                  borderRadius: radius.pill, boxShadow: active ? 'var(--shadow-glow)' : 'none',
                }}>
                <Icon size={14} /> {c.label}
                <span style={{ fontSize: t.size.micro, opacity: 0.75, fontWeight: t.weight.semibold }}>{c.count}</span>
              </button>
            </span>
          )
        })}
      </div>

      {loading && <div style={{ color: color.ghost, fontSize: t.size.cap, padding: space[6] }}>Loading the library…</div>}

      {empty && (
        <EmptyState
          icon={<LayoutGrid size={22} strokeWidth={1.5} />}
          title="Nothing here yet"
          body="Brief a post or plan a campaign in Vera — and upload your brand kit (logos, guidelines) here. Everything for this client lives in one place."
        />
      )}

      {/* ── BRAND KIT (upload + assets) ── */}
      {isBrandKit && (
        <section>
          <input ref={fileInput} type="file" multiple hidden onChange={e => onFiles(e.target.files)}
            accept={cat === 'logos' ? 'image/*,.svg' : '.pdf,.doc,.docx,.txt,.md,image/*'} />
          <button onClick={() => fileInput.current?.click()} disabled={uploading}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: space[7], marginBottom: space[5], cursor: uploading ? 'wait' : 'pointer',
              background: color.paper2, border: `1.5px dashed ${color.line2}`, borderRadius: radius.lg, color: color.ink2,
            }}>
            {uploading ? <Loader2 size={20} className="vera-spin" /> : <Upload size={20} style={{ color: color.accent }} />}
            <span style={{ fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink }}>
              {uploading ? 'Uploading…' : `Upload ${cat === 'logos' ? 'logos' : cat === 'guidelines' ? 'guideline docs' : 'briefs'}`}
            </span>
            <span style={{ fontSize: t.size.micro, color: color.ghost }}>
              {cat === 'logos' ? 'PNG, SVG, JPG — drop your brand marks' : 'PDF, DOCX, TXT, MD — VERA reads these into its knowledge'}
            </span>
          </button>

          {brandAssets(cat).length === 0 ? (
            <div style={{ fontSize: t.size.cap, color: color.ghost, textAlign: 'center', padding: space[4] }}>No {cat} yet.</div>
          ) : cat === 'logos' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: space[3] }}>
              {brandAssets(cat).map(a => (
                <div key={a.id} style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', background: color.surface, position: 'relative' }}>
                  <div style={{ aspectRatio: '1 / 1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[3] }}>
                    {signed[a.storage_path]
                      ? <img src={signed[a.storage_path]} alt={a.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <ImagePlus size={20} style={{ color: color.faint }} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `6px ${space[2]}`, borderTop: `1px solid ${color.line}` }}>
                    <span style={{ fontSize: t.size.micro, color: color.ink2, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    <button onClick={() => deleteAsset(a)} title="Delete" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.faint, display: 'flex' }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
              {brandAssets(cat).map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                  <FileText size={18} style={{ color: color.accent, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                    <div style={{ fontSize: t.size.micro, color: color.ghost }}>{a.kind.toUpperCase()} · {fmtSize(a.file_size)} · {fmtDate(a.created_at)}</div>
                  </div>
                  {signed[a.storage_path] && (
                    <a href={signed[a.storage_path]} target="_blank" rel="noreferrer" title="Download" style={{ color: color.ink2, display: 'flex' }}><Download size={15} /></a>
                  )}
                  <button onClick={() => deleteAsset(a)} title="Delete" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.faint, display: 'flex' }}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── CAMPAIGNS ── */}
      {showCampaigns && campaigns.length > 0 && (
        <section style={{ marginBottom: space[8] }}>
          {cat === 'all' && <SectionTitle icon={Megaphone} label="Campaigns" count={campaigns.length} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space[3] }}>
            {campaigns.map(c => (
              <div key={c.id} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[4] }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: t.weight.semibold, color: color.accent }}>
                  <Megaphone size={12} /> Campaign
                </div>
                <div style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink, margin: '6px 0 2px', lineHeight: 1.3 }}>{c.name}</div>
                {c.theme && <div style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.45, marginBottom: space[2] }}>{c.theme}</div>}
                <div style={{ fontSize: t.size.micro, color: color.ghost }}>
                  {(c.post_count ?? 0)} posts{c.start_date ? ` · ${fmtDate(c.start_date)}${c.end_date ? ` → ${fmtDate(c.end_date)}` : ''}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── POSTS ── */}
      {showPosts && posts.length > 0 && (
        <section style={{ marginBottom: space[8] }}>
          {cat === 'all' && <SectionTitle icon={FileText} label="Posts" count={posts.length} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {posts.map(p => (
              <button key={p.id} onClick={() => open(p.id)}
                style={{ textAlign: 'left', display: 'flex', gap: space[3], alignItems: 'flex-start', width: '100%', padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, cursor: 'pointer' }}>
                {p.media_url && (p.media_type === 'video'
                  ? <video src={p.media_url} muted style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: radius.sm, flexShrink: 0 }} />
                  : <img src={p.media_url} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: radius.sm, flexShrink: 0 }} />)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: 3 }}>
                    <span style={{ fontSize: t.size.cap, fontWeight: t.weight.semibold, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{p.title || 'Untitled'}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.size.micro, color: color.ghost }}><Globe size={10} /> {p.channel}</span>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: t.weight.semibold, color: statusColor(p.status), border: `1px solid ${statusColor(p.status)}`, borderRadius: radius.pill, padding: '1px 7px' }}>{p.status}</span>
                    {p.category && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.size.micro, color: color.ink2, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: catColor.get(p.category) ?? color.ghost, flexShrink: 0 }} />
                        {p.category}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: t.size.micro, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.copy}</div>
                </div>
                <span style={{ fontSize: t.size.micro, color: color.faint, flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtDate(p.scheduled_at || p.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── IMAGES ── */}
      {cat === 'images' && (
        images.length === 0 ? <EmptyState icon={<ImageIcon size={22} strokeWidth={1.5} />} title="No images yet" body="Images VERA generates for this client's posts show up here." />
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: space[3] }}>
            {images.map(p => (
              <button key={p.id} onClick={() => open(p.id)} title={p.title ?? ''} style={{ padding: 0, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', cursor: 'pointer', background: color.surface, aspectRatio: '1 / 1' }}>
                <img src={p.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
      )}

      {/* ── VIDEOS ── */}
      {cat === 'videos' && (
        videos.length === 0 ? <EmptyState icon={<Clapperboard size={22} strokeWidth={1.5} />} title="No videos yet" body="Clips VERA renders for this client show up here." />
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: space[3] }}>
            {videos.map(p => (
              <video key={p.id} src={p.media_url} controls muted playsInline onClick={() => open(p.id)} style={{ width: '100%', border: `1px solid ${color.line}`, borderRadius: radius.md, background: '#000', cursor: 'pointer' }} />
            ))}
          </div>
      )}

      <div style={{ height: space[8] }} />
    </div>
  )
}

function SectionTitle({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: space[3] }}>
      <Icon size={15} style={{ color: color.ink2 }} />
      <span style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{label}</span>
      <span style={{ fontSize: t.size.micro, color: color.ghost, fontWeight: t.weight.medium }}>{count}</span>
    </div>
  )
}
