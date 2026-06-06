// Authenticated approval index, /approvals/:projectRef.
//
// Lists every post for a client in one place. Public review remains scoped to
// revocable review tokens via /r/:reviewToken.

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { color, space, type as t, radius } from '../design'

type Row = Post & {
  media_metadata?: { frames?: Array<{ url: string; text?: string | null }> } | null
}

export default function ApprovalIndex() {
  const { projectRef } = useParams()
  const { projects, loading: projectsLoading } = useProject()
  const project = projectRef ? projects.find(p => p.slug === projectRef || p.id === projectRef) ?? null : null
  const projectId = project?.id ?? null
  const [state, setState] = useState<{
    posts: Row[]
    loading: boolean
    err: string
  }>({ posts: [], loading: true, err: '' })

  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(async () => {
        if (projectsLoading) {
          if (!cancelled) setState(prev => ({ ...prev, loading: true, err: '' }))
          return null
        }
        if (!projectRef) throw new Error('No client specified.')
        if (!projectId) throw new Error('Client not found in this workspace.')
        if (!cancelled) setState({ posts: [], loading: true, err: '' })
        const { data, error } = await supabase.from('content_posts')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
        if (error) throw new Error(error.message)
        return (data ?? []) as Row[]
      })
      .then(rows => {
        if (cancelled) return
        if (!rows) return
        setState({ posts: rows, loading: false, err: '' })
      })
      .catch(error => {
        if (cancelled) return
        setState({
          posts: [],
          loading: false,
          err: (error as Error).message || 'Could not load approvals.',
        })
      })
    return () => { cancelled = true }
  }, [projectId, projectRef, projectsLoading])

  const { posts, loading, err } = state
  const page: React.CSSProperties = { minHeight: '100vh', background: color.paper, padding: `${space[7]} ${space[5]}` }
  const cardStyle: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }

  if (loading) return <div style={page}><p style={{ color: color.ghost, textAlign: 'center', marginTop: space[8], fontSize: t.size.cap }}>Loading...</p></div>
  if (err) return <div style={page}><p style={{ color: color.danger, textAlign: 'center', marginTop: space[8], fontSize: t.size.sm }}>{err}</p></div>

  const statusLabel = (s?: string) => {
    const v = (s ?? '').toLowerCase()
    if (v === 'approved') return { label: 'Approved', c: color.success }
    if (v === 'rejected') return { label: 'Rejected', c: color.danger }
    if (v === 'changes_requested') return { label: 'Changes requested', c: color.accent }
    return { label: 'Awaiting approval', c: color.accent }
  }

  return (
    <div style={page}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: space[6] }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: t.weight.semibold, color: color.accent }}>Content for review</div>
          <div style={{ fontSize: t.size.h2, color: color.ink, fontWeight: t.weight.semibold, marginTop: 2 }}>{project?.name ?? 'Client'}: {posts.length} {posts.length === 1 ? 'post' : 'posts'}</div>
          <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 4 }}>Open posts with active review links to approve them or leave feedback.</div>
        </div>

        {posts.length === 0 ? (
          <p style={{ color: color.ghost, fontSize: t.size.sm }}>No posts yet for this client.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: space[5] }}>
            {posts.map(p => {
              const frames = p.media_metadata?.frames
              const st = statusLabel(p.status)
              const reviewPath = p.review_token ? `/r/${p.review_token}` : null
              const body = (
                <>
                  <div style={{ background: '#000', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {p.media_type === 'carousel' && frames?.length
                      ? <img src={frames[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : p.media_type === 'video' && p.media_url
                        ? <video src={p.media_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : p.media_url
                          ? <img src={p.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ color: color.faint, fontSize: t.size.cap }}>Text only</span>}
                  </div>
                  <div style={{ padding: space[4], display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: t.weight.semibold, color: st.c }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.c }} />{st.label}
                      {p.media_type === 'carousel' && frames?.length ? ` / ${frames.length} frames` : p.media_type === 'video' ? ' / video' : ''}
                    </span>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: color.ink, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.copy}</p>
                    <span style={{ marginTop: 'auto', fontSize: t.size.cap, color: reviewPath ? color.accent : color.ghost, fontWeight: t.weight.medium }}>
                      {reviewPath ? 'Open review link' : 'No review link yet'}
                    </span>
                  </div>
                </>
              )
              if (!reviewPath) {
                return <article key={p.id} style={{ ...cardStyle, opacity: 0.72 }}>{body}</article>
              }
              return (
                <Link key={p.id} to={reviewPath} style={{ ...cardStyle, textDecoration: 'none', color: 'inherit' }}>
                  {body}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
