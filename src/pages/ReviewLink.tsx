// Public, no-login review link — /r/:postId.
//
// A reviewer (e.g. the client) opens this URL, sees the asset (copy + image or
// video), and either Approves or leaves feedback. It flows into the same
// approval-webhook the internal Review queue uses, so the action lands back in
// the workspace (and Slack/n8n). No auth — it's a share link.
//
// Interim: keyed by post id. A secure, revocable per-asset token replaces this
// once the review_token migration lands.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { color, space, type as t, radius } from '../design'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export default function ReviewLink() {
  const { postId } = useParams()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<'approved' | 'changes_requested' | null>(null)

  useEffect(() => {
    if (!postId) { setErr('No post specified.'); setLoading(false); return }
    let cancelled = false
    supabase.from('content_posts').select('*').eq('id', postId).maybeSingle().then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) setErr('This post could not be found, or the link has expired.')
      else setPost(data as Post)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [postId])

  async function act(action: 'approved' | 'changes_requested') {
    if (!postId || submitting) return
    if (action === 'changes_requested' && !feedback.trim()) { setShowFeedback(true); return }
    setSubmitting(true)
    try {
      const res = await fetch(`${SUPA}/functions/v1/approval-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ post_id: postId, action, feedback: feedback.trim() || undefined, reviewed_by: reviewer.trim() || 'Reviewer (link)' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDone(action)
    } catch (e) {
      setErr(`Couldn't submit: ${(e as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: color.paper, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `${space[7]} ${space[5]}` }
  const card: React.CSSProperties = { width: '100%', maxWidth: 560, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden', boxShadow: 'var(--shadow-pop)' }

  if (loading) return <div style={wrap}><p style={{ color: color.ghost, fontSize: t.size.cap, marginTop: space[8] }}>Loading…</p></div>
  if (err && !post) return <div style={wrap}><div style={{ ...card, padding: space[7], textAlign: 'center' }}><p style={{ color: color.ink2, fontSize: t.size.sm }}>{err}</p></div></div>
  if (!post) return null

  const author = (post.profile_name || 'InnovareAI').trim()
  const initials = author.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'IN'
  const tags = Array.isArray(post.hashtags) ? post.hashtags.filter(Boolean) : []

  if (done) {
    return (
      <div style={wrap}>
        <div style={{ ...card, padding: space[8], textAlign: 'center' }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: t.weight.semibold, color: done === 'approved' ? color.success : color.accent, marginBottom: space[3] }}>
            {done === 'approved' ? 'Approved' : 'Feedback sent'}
          </div>
          <p style={{ fontSize: t.size.lg, color: color.ink, margin: 0 }}>
            {done === 'approved' ? 'Thanks — this is approved and queued.' : 'Thanks — your feedback is on its way to the team.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={{ width: '100%', maxWidth: 560, marginBottom: space[4] }}>
        <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: t.weight.semibold, color: color.accent }}>Review request</div>
        <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>Take a look and approve, or tell us what to change.</div>
      </div>

      <div style={card}>
        {/* author header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${space[5]} ${space[5]} ${space[3]}` }}>
          <span style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-tint)', color: color.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{initials}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: color.ink, lineHeight: 1.2 }}>{author}</div>
            <div style={{ fontSize: 12, color: color.ghost, marginTop: 1 }}>{(post.profile_title || `Draft · ${post.channel || 'LinkedIn'}`)}</div>
          </div>
        </div>
        {/* copy */}
        <div style={{ padding: `0 ${space[5]} ${space[4]}` }}>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: color.ink, whiteSpace: 'pre-wrap', margin: 0 }}>{post.copy}</p>
          {tags.length > 0 && <p style={{ fontSize: 14, color: color.accent, marginTop: space[3], marginBottom: 0, fontWeight: 500 }}>{tags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
        </div>
        {/* media */}
        {post.media_url && post.media_type === 'video'
          ? <video src={post.media_url} controls autoPlay muted loop playsInline style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}` }} />
          : post.media_url && <img src={post.media_url} alt="" style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}` }} />}
      </div>

      {/* reviewer + actions */}
      <div style={{ width: '100%', maxWidth: 560, marginTop: space[5], display: 'flex', flexDirection: 'column', gap: space[3] }}>
        <input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Your name (optional)"
          style={{ padding: '9px 12px', fontSize: t.size.sm, border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.surface, color: color.ink, outline: 'none' }} />
        {showFeedback && (
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What needs to change?" rows={3}
            style={{ padding: '10px 12px', fontSize: t.size.sm, border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.surface, color: color.ink, outline: 'none', resize: 'vertical', fontFamily: t.family.sans }} />
        )}
        {err && <span style={{ fontSize: t.size.cap, color: color.danger }}>{err}</span>}
        <div style={{ display: 'flex', gap: space[2] }}>
          <button onClick={() => act('approved')} disabled={submitting}
            style={{ flex: 1, padding: '11px', borderRadius: radius.md, border: 'none', cursor: submitting ? 'default' : 'pointer', background: color.accent, color: '#fff', fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
            {submitting ? '…' : 'Approve'}
          </button>
          <button onClick={() => (showFeedback ? act('changes_requested') : setShowFeedback(true))} disabled={submitting}
            style={{ flex: 1, padding: '11px', borderRadius: radius.md, border: `1px solid ${color.line}`, cursor: 'pointer', background: color.surface, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.medium }}>
            {showFeedback ? 'Send feedback' : 'Request changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
