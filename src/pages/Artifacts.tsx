// Artifacts — the client's library (/p/:slug/artifacts).
//
// Everything tangible VERA has produced for this client, browsable in one
// place: Campaigns, Posts, Images, Videos. Distinct from Review (the pending
// approval inbox) and Calendar (the forward schedule) — Artifacts is the
// archive: browse, reuse, open.
//
// Phase 1: generated outputs (from `campaigns` + `content_posts`). Phase 2
// adds the Brand kit (logos / guidelines / briefings), reusing Knowledge's
// existing asset store.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, FileText, Image as ImageIcon, Clapperboard, LayoutGrid, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post, Campaign } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { PageHeader, EmptyState, color, space, type as t, radius } from '../design'

type Cat = 'all' | 'campaigns' | 'posts' | 'images' | 'videos'

function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusColor(status?: string): string {
  const s = (status ?? '').toLowerCase()
  if (s.includes('approv')) return color.success
  if (s.includes('post') || s.includes('publish')) return color.success
  if (s.includes('reject')) return color.danger
  return color.accent // pending / draft
}

export default function Artifacts() {
  const { activeProject } = useProject()
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<Cat>('all')

  // Full canvas — no right rail on this surface.
  useRightRail(null, [])

  useEffect(() => {
    if (!activeProject?.id) { setPosts([]); setCampaigns([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('content_posts').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
      supabase.from('campaigns').select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false }),
    ]).then(([p, c]) => {
      if (cancelled) return
      setPosts((p.data ?? []) as Post[])
      setCampaigns((c.data ?? []) as Campaign[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeProject?.id])

  const images = useMemo(() => posts.filter(p => p.media_url && (p.media_type ?? 'image') !== 'video'), [posts])
  const videos = useMemo(() => posts.filter(p => p.media_url && p.media_type === 'video'), [posts])

  const open = (postId: string) => activeProject && navigate(`/p/${activeProject.slug}/review/${postId}`)

  const cats: Array<{ key: Cat; label: string; icon: React.ElementType; count: number }> = [
    { key: 'all', label: 'All', icon: LayoutGrid, count: campaigns.length + posts.length },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone, count: campaigns.length },
    { key: 'posts', label: 'Posts', icon: FileText, count: posts.length },
    { key: 'images', label: 'Images', icon: ImageIcon, count: images.length },
    { key: 'videos', label: 'Videos', icon: Clapperboard, count: videos.length },
  ]

  const showCampaigns = cat === 'all' || cat === 'campaigns'
  const showPosts = cat === 'all' || cat === 'posts'
  const empty = !loading && campaigns.length === 0 && posts.length === 0

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1180 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? 'Workspace'}
        title="Artifacts"
        subtitle="Everything VERA has made for this client — campaigns, posts, and media. Browse, reuse, open. (Brand kit — logos, guidelines, briefings — coming next.)"
      />

      {/* category filter bar */}
      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', margin: `${space[2]} 0 ${space[6]}` }}>
        {cats.map(c => {
          const active = cat === c.key
          const Icon = c.icon
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px',
                fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer',
                color: active ? '#fff' : color.ink2,
                background: active ? color.accent : color.surface,
                border: `1px solid ${active ? color.accent : color.line}`,
                borderRadius: radius.pill,
                boxShadow: active ? 'var(--shadow-glow)' : 'none',
              }}>
              <Icon size={14} /> {c.label}
              <span style={{ fontSize: t.size.micro, opacity: 0.75, fontWeight: t.weight.semibold }}>{c.count}</span>
            </button>
          )
        })}
      </div>

      {loading && <div style={{ color: color.ghost, fontSize: t.size.cap, padding: space[6] }}>Loading the library…</div>}

      {empty && (
        <EmptyState
          icon={<LayoutGrid size={22} strokeWidth={1.5} />}
          title="Nothing here yet"
          body="Brief a post or plan a campaign in Vera — everything VERA makes for this client lands here automatically."
        />
      )}

      {/* CAMPAIGNS */}
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

      {/* POSTS */}
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
                  </div>
                  <div style={{ fontSize: t.size.micro, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.copy}</div>
                </div>
                <span style={{ fontSize: t.size.micro, color: color.faint, flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtDate(p.scheduled_at || p.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* IMAGES */}
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

      {/* VIDEOS */}
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
