// Measure — outcomes for one client (/p/:slug/measure).
//
// Production rollup (what's been made/approved/scheduled/published for this
// client, from content_posts + campaigns) + the competitor Intel timeline.
// Engagement analytics (reach, likes, CTR) need per-post metrics captured at
// publish time — a distribution-side pipeline (SAM's lane) — so they're called
// out as not-yet rather than faked.

import { useState, useEffect, useMemo } from 'react'
import { FileText, CheckCircle2, CalendarClock, Send, Megaphone, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post, Campaign } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import Intel from './Intel'
import { PageHeader, SectionLabel, color, space, type as t, radius } from '../design'

export default function Measure() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const [posts, setPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  useEffect(() => {
    if (!activeProject?.id) { setPosts([]); setCampaigns([]); return }
    let cancelled = false
    Promise.all([
      supabase.from('content_posts').select('id, status, scheduled_at, posted_at, created_at, channel, campaign_id').eq('project_id', activeProject.id),
      supabase.from('campaigns').select('id, name, status, post_count').eq('project_id', activeProject.id),
    ]).then(([p, c]) => {
      if (cancelled) return
      setPosts((p.data ?? []) as Post[])
      setCampaigns((c.data ?? []) as Campaign[])
    })
    return () => { cancelled = true }
  }, [activeProject?.id])

  const stats = useMemo(() => {
    const now = Date.now()
    const norm = (s?: string) => (s ?? '').toLowerCase()
    const isPosted = (p: Post) => !!p.posted_at || norm(p.status).includes('post') || norm(p.status).includes('publish')
    const pending = posts.filter(p => { const s = norm(p.status); return s.includes('pending') || s === 'draft' || s.includes('changes') }).length
    const approved = posts.filter(p => norm(p.status).includes('approv')).length
    const scheduledAhead = posts.filter(p => p.scheduled_at && new Date(p.scheduled_at).getTime() > now && !isPosted(p)).length
    const posted = posts.filter(isPosted).length
    const fourWeeksAgo = now - 28 * 86400000
    const recent = posts.filter(p => p.created_at && new Date(p.created_at).getTime() >= fourWeeksAgo).length
    return { total: posts.length, pending, approved, scheduledAhead, posted, campaigns: campaigns.length, perWeek: (recent / 4).toFixed(1) }
  }, [posts, campaigns])

  const channelMix = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of posts) { const ch = (p.channel || 'Unknown').trim() || 'Unknown'; m.set(ch, (m.get(ch) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [posts])

  const campaignRollup = useMemo(
    () => campaigns.map(c => ({ id: c.id, name: c.name, status: c.status, count: posts.filter(p => p.campaign_id === c.id).length }))
      .sort((a, b) => b.count - a.count),
    [campaigns, posts],
  )

  const tiles = [
    { label: 'Total posts', value: stats.total, icon: FileText, tone: color.ink },
    { label: 'Pending review', value: stats.pending, icon: Clock, tone: color.accent },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, tone: color.success },
    { label: 'Scheduled ahead', value: stats.scheduledAhead, icon: CalendarClock, tone: color.ink },
    { label: 'Published', value: stats.posted, icon: Send, tone: color.success },
    { label: 'Campaigns', value: stats.campaigns, icon: Megaphone, tone: color.accent },
  ]

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1100 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? activeOrg?.name ?? 'Workspace'}
        title="Measure"
        subtitle="What this client's content engine is producing — and what competitors are doing. Engagement analytics (reach, likes, CTR) arrive once publishing captures per-post metrics."
      />

      <SectionLabel style={{ marginBottom: space[3] }}>Production</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: space[3], marginBottom: space[3] }}>
        {tiles.map(ti => {
          const Icon = ti.icon
          return (
            <div key={ti.label} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[4] }}>
              <Icon size={16} style={{ color: ti.tone }} />
              <div style={{ fontSize: 28, fontWeight: t.weight.semibold, color: color.ink, lineHeight: 1.1, marginTop: space[2] }}>{ti.value}</div>
              <div style={{ fontSize: t.size.micro, color: color.ghost, marginTop: 2 }}>{ti.label}</div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: t.size.micro, color: color.ghost, marginBottom: space[8] }}>
        ≈ {stats.perWeek} posts/week created over the last 4 weeks. Engagement (reach, likes, CTR) appears here once publishing captures per-post metrics.
      </p>

      {channelMix.length > 0 && (
        <>
          <SectionLabel style={{ marginBottom: space[3] }}>Channel mix</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], marginBottom: space[8], maxWidth: 520 }}>
            {channelMix.map(([ch, n]) => (
              <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
                <span style={{ width: 96, fontSize: t.size.cap, color: color.ink2, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch}</span>
                <div style={{ flex: 1, height: 8, background: color.paper2, borderRadius: radius.pill, overflow: 'hidden' }}>
                  <div style={{ width: `${(n / (channelMix[0][1] || 1)) * 100}%`, height: '100%', background: color.accent, borderRadius: radius.pill }} />
                </div>
                <span style={{ width: 26, fontSize: t.size.cap, color: color.ink, fontWeight: t.weight.semibold, textAlign: 'right' }}>{n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {campaignRollup.length > 0 && (
        <>
          <SectionLabel style={{ marginBottom: space[3] }}>Campaigns</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], marginBottom: space[8], maxWidth: 640 }}>
            {campaignRollup.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                <span style={{ flex: 1, fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                <span style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.04em', color: color.ghost }}>{c.status}</span>
                <span style={{ fontSize: t.size.cap, color: color.ink, fontWeight: t.weight.semibold }}>{c.count} posts</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel style={{ marginBottom: space[3] }}>Competitor intel</SectionLabel>
      <div style={{ margin: `0 -${space[8]}` }}>
        <Intel />
      </div>
    </div>
  )
}
