// Across Clients — the SHELF (workspace altitude). The "/" landing.
//
// Per the UX blueprint, the operator's day starts here: every client
// project on one shelf, each with its open-observation count, ranked so
// the loudest client surfaces first. Clicking a client drops into its
// desk (/p/:slug).
//
// Phase 0 scope: render the real project shelf with per-project open
// observation counts. The full ranked cross-client agenda (one-click
// Approve/Dismiss per row) lands in Phase 4 — this is the honest stub
// that already does the navigation job.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Star, FolderOpen, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import {
  PageHeader, SectionLabel, EmptyState, Button,
  color, space, type as t, radius,
} from '../design'

export default function AcrossClients() {
  const navigate = useNavigate()
  const { activeOrg } = useOrg()
  const { projects, starredProjects, recentProjects, switchProject, loading } = useProject()
  const [obsByProject, setObsByProject] = useState<Record<string, number>>({})

  // Per-project open-observation counts — the "loudness" signal. One
  // grouped query across the org; vera-notice already writes these rows
  // with a (org_id, project_id) index.
  useEffect(() => {
    if (!activeOrg?.id) { setObsByProject({}); return }
    let cancelled = false
    supabase
      .from('agent_observations')
      .select('project_id')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .then(({ data }) => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const row of (data ?? []) as Array<{ project_id: string | null }>) {
          if (row.project_id) counts[row.project_id] = (counts[row.project_id] ?? 0) + 1
        }
        setObsByProject(counts)
      })
    return () => { cancelled = true }
  }, [activeOrg?.id])

  // Shelf order: starred first, then recent, each carrying its obs count.
  const shelf = [...starredProjects, ...recentProjects]

  if (!loading && projects.length === 0) {
    return (
      <div style={{ padding: space[8], maxWidth: 920 }}>
        <EmptyState
          icon={<FolderOpen size={22} strokeWidth={1.5} />}
          title="No clients yet"
          body="Each client is a project — its own brand voice, knowledge, and content loop. Add your first to begin."
          actions={<Button variant="primary" onClick={() => navigate('/onboarding')}>Add a client</Button>}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: space[8], maxWidth: 920 }}>
      <PageHeader
        eyebrow={activeOrg?.name ?? 'Workspace'}
        title="Across clients"
        subtitle="Every client on one shelf. The loudest — most open proposals from VERA — surface first. Open a client to step into its loop."
        size="lg"
      />

      <SectionLabel count={shelf.length} style={{ marginBottom: space[4] }}>Clients</SectionLabel>
      <div style={{ borderTop: `1px solid ${color.line}` }}>
        {shelf.map(p => {
          const open = obsByProject[p.id] ?? 0
          return (
            <button
              key={p.id}
              onClick={() => { switchProject(p.slug); navigate(`/p/${p.slug}/dashboard`) }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: space[4],
                padding: `${space[4]} ${space[2]}`,
                borderBottom: `1px solid ${color.line}`,
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
                fontFamily: t.family.sans,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = color.paper2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                width: 22, height: 22, borderRadius: radius.xs, flexShrink: 0,
                background: p.is_starred ? color.ink : color.paper2,
                color: p.is_starred ? color.surface : color.ink2,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: t.size.cap, fontWeight: t.weight.semibold,
              }}>
                {p.is_starred ? <Star size={11} fill="currentColor" /> : p.name.slice(0, 1).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: t.size.body, fontWeight: t.weight.medium, color: color.ink }}>
                  {p.name}
                </div>
                {p.description && (
                  <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.description}
                  </div>
                )}
              </div>
              {open > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: t.size.cap, color: color.accent, fontWeight: t.weight.medium,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: color.accent }} />
                  {open} {open === 1 ? 'proposal' : 'proposals'}
                </span>
              )}
              <ArrowRight size={14} strokeWidth={1.5} style={{ color: color.faint, flexShrink: 0 }} />
            </button>
          )
        })}
      </div>

      <p style={{ marginTop: space[6], fontSize: t.size.cap, color: color.faint }}>
        The ranked cross-client agenda — VERA's proposals across the whole book, one-click Approve/Dismiss — lands in a later phase. For now, open counts mark where attention is needed.
      </p>
    </div>
  )
}
