// Public, no-login review link, scoped by a revocable token.
//
// A reviewer (e.g. the client) opens this URL, sees the asset (copy + image or
// video) on the LEFT, and leaves feedback in a large box on the RIGHT, or
// Approves. It flows into the same approval-webhook the internal Review queue
// uses (which records every action in the append-only post_outcomes trail).
//
// Nothing-is-lost guarantees:
//   1. Typed feedback auto-saves to localStorage on every keystroke, so a
//      refresh / accidental close never loses it. Restored on load.
//   2. On submit, feedback is persisted server-side (post_outcomes, append-only)
//      BEFORE the local draft is cleared. A failed submit keeps the draft.
//
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Post } from '../lib/supabase'
import { color, space, type as t, radius } from '../design'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export default function ReviewLink() {
  const { reviewToken } = useParams()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [feedback, setFeedback] = useState('')
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<'approved' | 'changes_requested' | null>(null)

  const draftKey = `review-feedback:${reviewToken}`
  const nameKey = `review-reviewer:${reviewToken}`

  useEffect(() => {
    if (!reviewToken) { setErr('No review token specified.'); setLoading(false); return }
    let cancelled = false
    // Restore any unsent draft first — never lose typed feedback.
    try {
      const d = localStorage.getItem(draftKey); if (d) { setFeedback(d); setSaved(true) }
      const n = localStorage.getItem(nameKey); if (n) setReviewer(n)
    } catch { /* ignore */ }
    fetch(`${SUPA}/functions/v1/review-link?token=${encodeURIComponent(reviewToken)}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    })
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        return data.post as Post
      })
      .then(data => { if (!cancelled) setPost(data) })
      .catch(() => { if (!cancelled) setErr('This post could not be found, or the link has expired.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reviewToken])  // eslint-disable-line react-hooks/exhaustive-deps

  const onFeedback = (v: string) => {
    setFeedback(v)
    try { localStorage.setItem(draftKey, v); setSaved(true) } catch { /* ignore */ }
  }
  const onName = (v: string) => {
    setReviewer(v)
    try { localStorage.setItem(nameKey, v) } catch { /* ignore */ }
  }

  async function act(action: 'approved' | 'changes_requested') {
    if (!reviewToken || submitting) return
    if (action === 'changes_requested' && !feedback.trim()) { setErr('Add a note before sending feedback.'); return }
    setSubmitting(true); setErr('')
    try {
      const res = await fetch(`${SUPA}/functions/v1/approval-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ review_token: reviewToken, action, feedback: feedback.trim() || undefined, reviewed_by: reviewer.trim() || 'Reviewer (link)' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Saved durably server-side — now it's safe to drop the local draft.
      try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
      setDone(action)
    } catch (e) {
      // Keep the draft on failure so nothing is lost.
      setErr(`Couldn't submit (${(e as Error).message}). Your note is saved on this device — try again.`)
    } finally {
      setSubmitting(false)
    }
  }

  const page: React.CSSProperties = { minHeight: '100vh', background: color.paper, padding: `${space[7]} ${space[5]}` }
  const cardStyle: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden', boxShadow: 'var(--shadow-pop)' }

  if (loading) return <div style={page}><p style={{ color: color.ghost, fontSize: t.size.cap, textAlign: 'center', marginTop: space[8] }}>Loading…</p></div>
  if (err && !post) return <div style={page}><div style={{ ...cardStyle, maxWidth: 480, margin: '0 auto', padding: space[7], textAlign: 'center' }}><p style={{ color: color.ink2, fontSize: t.size.sm }}>{err}</p></div></div>
  if (!post) return null

  if (done) {
    return (
      <div style={page}>
        <div style={{ ...cardStyle, maxWidth: 480, margin: '0 auto', padding: space[8], textAlign: 'center' }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: t.weight.semibold, color: done === 'approved' ? color.success : color.accent, marginBottom: space[3] }}>
            {done === 'approved' ? 'Approved' : 'Feedback sent'}
          </div>
          <p style={{ fontSize: t.size.lg, color: color.ink, margin: 0 }}>
            {done === 'approved' ? 'Thanks — this is approved and queued.' : 'Thanks — your feedback is saved and on its way to the team.'}
          </p>
        </div>
      </div>
    )
  }

  const author = 'Jennifer Fleming'   // synthetic poster persona (preview only)
  const tags = Array.isArray(post.hashtags) ? post.hashtags.filter(Boolean) : []
  const prompt = (post as unknown as { media_metadata?: { prompt?: string } }).media_metadata?.prompt
  const inputStyle: React.CSSProperties = { padding: '9px 12px', fontSize: t.size.sm, border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.surface, color: color.ink, outline: 'none', fontFamily: t.family.sans }

  return (
    <div style={page}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ marginBottom: space[5] }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: t.weight.semibold, color: color.accent }}>Review request</div>
          <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>Take a look, then approve or leave feedback on the right.</div>
        </div>

        <div style={{ display: 'flex', gap: space[5], flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* LEFT — the original prompt */}
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            <div style={cardStyle}>
              <div style={{ padding: `${space[3]} ${space[5]}`, borderBottom: `1px solid ${color.line}`, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.ink2 }}>Original prompt</div>
              <div style={{ padding: space[5], maxHeight: '70vh', overflowY: 'auto', fontSize: t.size.cap, lineHeight: 1.55, color: color.ink2, whiteSpace: 'pre-wrap' }}>{prompt || 'No prompt recorded for this asset.'}</div>
            </div>
          </div>

          {/* CENTER — the output (asset) */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${space[5]} ${space[5]} ${space[3]}` }}>
                <img src="/poster-jennifer.png" alt="Jennifer Fleming" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', display: 'block' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: color.ink, lineHeight: 1.2 }}>{author}</div>
                  <div style={{ fontSize: 12, color: color.ghost, marginTop: 1 }}>Founder &amp; CEO</div>
                </div>
              </div>
              <div style={{ padding: `0 ${space[5]} ${space[4]}` }}>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: color.ink, whiteSpace: 'pre-wrap', margin: 0 }}>{post.copy}</p>
                {tags.length > 0 && <p style={{ fontSize: 14, color: color.accent, marginTop: space[3], marginBottom: 0, fontWeight: 500 }}>{tags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
              </div>
              {(() => {
                const frames = (post as unknown as { media_metadata?: { frames?: Array<{ url: string; text?: string | null }> } }).media_metadata?.frames
                if (post.media_type === 'carousel' && Array.isArray(frames) && frames.length > 0) {
                  return (
                    <div style={{ borderTop: `1px solid ${color.line}` }}>
                      <div style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', gap: 8, padding: 8 }}>
                        {frames.map((f, i) => (
                          <div key={i} style={{ flex: '0 0 88%', scrollSnapAlign: 'center', position: 'relative', borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${color.line}` }}>
                            <img src={f.url} alt={f.text ?? `Frame ${i + 1}`} style={{ width: '100%', display: 'block' }} />
                            <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(20,20,20,0.62)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>{i + 1}/{frames.length}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 0 10px' }}>
                        {frames.map((_, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: color.line }} />)}
                        <span style={{ marginLeft: 8, fontSize: t.size.micro, color: color.ghost }}>{frames.length} frames · swipe</span>
                      </div>
                    </div>
                  )
                }
                if (post.media_url && post.media_type === 'video') return <video src={post.media_url} controls playsInline style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}`, background: '#000' }} />
                if (post.media_url) return <img src={post.media_url} alt="" style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}` }} />
                return null
              })()}
            </div>
          </div>

          {/* RIGHT — feedback */}
          <div style={{ flex: '1 1 300px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: space[3] }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.ink2 }}>Your feedback</span>
              <span style={{ fontSize: t.size.micro, color: saved ? color.success : color.faint }}>{saved ? 'Saved on this device' : 'Auto-saves as you type'}</span>
            </div>
            <textarea value={feedback} onChange={e => onFeedback(e.target.value)} placeholder="What's working, what needs to change, anything to flag…"
              style={{ ...inputStyle, minHeight: 240, lineHeight: 1.5, resize: 'vertical' }} />
            <input value={reviewer} onChange={e => onName(e.target.value)} placeholder="Your name (optional)" style={inputStyle} />
            {err && <span style={{ fontSize: t.size.cap, color: color.danger }}>{err}</span>}
            <div style={{ display: 'flex', gap: space[2] }}>
              <button onClick={() => act('approved')} disabled={submitting}
                style={{ flex: 1, padding: '12px', borderRadius: radius.md, border: 'none', cursor: submitting ? 'default' : 'pointer', background: color.accent, color: '#fff', fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
                {submitting ? '…' : 'Approve'}
              </button>
              <button onClick={() => act('changes_requested')} disabled={submitting || !feedback.trim()}
                style={{ flex: 1, padding: '12px', borderRadius: radius.md, border: `1px solid ${color.line}`, cursor: (submitting || !feedback.trim()) ? 'default' : 'pointer', background: color.surface, color: feedback.trim() ? color.ink : color.ghost, fontSize: t.size.sm, fontWeight: t.weight.medium }}>
                Send feedback
              </button>
            </div>
            <p style={{ fontSize: t.size.micro, color: color.faint, margin: 0, lineHeight: 1.5 }}>Approving with notes sends both. Your draft is kept until it's safely submitted.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
