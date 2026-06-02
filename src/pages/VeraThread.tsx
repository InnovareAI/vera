// VERA — the one DOING surface (/p/:slug/vera). The Claude 3-pane:
// rail (Layout) · conversation (center, here) · draft artifact (right rail).
//
// One composer drives both chat and drafting: vera-chat decides, and when
// the operator briefs a post it calls run_pipeline → the 9-agent pipeline
// streams calm step captions → the finished draft arrives as a `draft`
// event and opens in the right-hand artifact panel with Approve / Tweak /
// Regenerate. Images (generate_image) and videos (generate_video) attach
// to the artifact. This matches SAM's chat+artifact model.

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowUp, Square, Sparkles, Check, RefreshCw, Pencil, MoreHorizontal, Globe, ThumbsUp, MessageCircle, Repeat2, Send, PenLine, ListChecks, Megaphone, Lightbulb, Target, SquarePen } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useAuth } from '../lib/auth'
import { useRightRail } from '../lib/rightRailContext'
import { useToast } from '../design'
import { color, space, type as t, radius } from '../design'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const HISTORY_LIMIT = 40

interface ToolEvent { id?: string; tool: string; status: 'running' | 'done'; message?: string }
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  tools?: ToolEvent[]
  images?: string[]
  videos?: string[]
}

const TOOL_LABEL: Record<string, string> = {
  run_pipeline: 'Drafting with the team',
  generate_image: 'Generating image',
  generate_infographic: 'Generating infographic',
  generate_video: 'Generating video',
  web_search: 'Searching the web',
  kb_search: 'Checking knowledge',
  remember: 'Saving to memory',
}

export default function VeraThread() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const { user } = useAuth()
  const { push } = useToast()
  const location = useLocation()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [draft, setDraft] = useState<Post | null>(null)
  const [approving, setApproving] = useState(false)
  const [observations, setObservations] = useState<{ id: string; title: string; proposed_action: string | null }[]>([])
  const [stats, setStats] = useState<{ pending: number; campaigns: number }>({ pending: 0, campaigns: 0 })

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load this project's thread
  useEffect(() => {
    if (!activeProject?.id) { setMessages([]); setHistoryLoaded(true); return }
    let cancelled = false
    setHistoryLoaded(false)
    // Only load messages from the current chat session. "New chat" stamps a
    // boundary timestamp per client; everything before it is a past chat.
    const since = localStorage.getItem(`vera-chat-since:${activeProject.id}`)
    let query = supabase.from('chat_messages')
      .select('id, role, content')
      .eq('project_id', activeProject.id)
      .in('role', ['user', 'assistant'])
    if (since) query = query.gte('created_at', since)
    query
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as Array<{ id: string; role: 'user' | 'assistant'; content: string }>
        setMessages(rows.reverse().map(r => ({ id: r.id, role: r.role, content: r.content })))
        setHistoryLoaded(true)
      })
    return () => { cancelled = true }
  }, [activeProject?.id])

  // "VERA wants to" — open observations, surfaced in the launcher (moved here
  // from the old Home/Dashboard so nothing is lost when Home goes away).
  useEffect(() => {
    if (!activeOrg?.id) { setObservations([]); return }
    let q = supabase.from('agent_observations')
      .select('id, title, proposed_action')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .neq('kind', 'stale_audit')
      .order('created_at', { ascending: false })
      .limit(4)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ data }) => setObservations((data ?? []) as { id: string; title: string; proposed_action: string | null }[]))
  }, [activeOrg?.id, activeProject?.id])

  // Live counts for the launcher quick-action descriptions (SAM-style).
  useEffect(() => {
    if (!activeOrg?.id) { setStats({ pending: 0, campaigns: 0 }); return }
    let pq = supabase.from('content_posts').select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id).in('status', ['Pending Review', 'pending', 'Draft', 'draft'])
    if (activeProject?.id) pq = pq.eq('project_id', activeProject.id)
    const cq = supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('org_id', activeOrg.id)
    Promise.all([pq, cq]).then(([pr, cr]) =>
      setStats({ pending: pr.error ? 0 : (pr.count ?? 0), campaigns: cr.error ? 0 : (cr.count ?? 0) }))
  }, [activeOrg?.id, activeProject?.id])

  // Auto-scroll
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Auto-grow composer
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 180)}px`
  }, [input])

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim()
    if (!text || streaming || !activeOrg?.id) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', pending: true }
    const next = [...messages, userMsg]
    setMessages([...next, placeholder])
    setInput('')
    setStreaming(true)

    const wire = next.map(m => ({ role: m.role, content: m.content }))
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${SUPA}/functions/v1/vera-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON}`, 'apikey': ANON },
        body: JSON.stringify({
          messages: wire,
          org_id: activeOrg.id,
          user_id: user?.id ?? null,
          project_id: activeProject?.id ?? null,
          route: location.pathname,
        }),
      })
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${err.slice(0, 160)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx); buffer = buffer.slice(idx + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let ev: Record<string, unknown>
          try { ev = JSON.parse(line.slice(6)) } catch { continue }

          if (ev.type === 'delta' && typeof ev.text === 'string') {
            acc += ev.text
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: acc } : m))
          } else if (ev.type === 'tool_start') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: [...(m.tools ?? []), { id: ev.id as string, tool: ev.tool as string, status: 'running' }] } : m))
          } else if (ev.type === 'tool_progress') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: (m.tools ?? []).map(tl => tl.tool === ev.tool && tl.status === 'running' ? { ...tl, message: ev.status as string } : tl) } : m))
          } else if (ev.type === 'tool_end') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: (m.tools ?? []).map(tl => tl.id === ev.id ? { ...tl, status: 'done' } : tl) } : m))
          } else if (ev.type === 'image' && typeof ev.url === 'string') {
            const url = ev.url as string
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, images: [...(m.images ?? []), url] } : m))
            // attach to the open draft if there is one
            setDraft(prev => prev ? { ...prev, media_url: url, media_type: 'image' } : prev)
          } else if (ev.type === 'video' && typeof ev.url === 'string') {
            const vurl = ev.url as string
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, videos: [...(m.videos ?? []), vurl] } : m))
            // attach to the open draft if there is one
            setDraft(prev => prev ? { ...prev, media_url: vurl, media_type: 'video' } : prev)
          } else if (ev.type === 'draft' && ev.post) {
            setDraft(ev.post as Post)
          } else if (ev.type === 'error') {
            throw new Error((ev.message as string) ?? 'stream error')
          }
        }
      }
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, pending: false } : m))
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, pending: false } : m))
      } else {
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, pending: false, content: m.content || `⚠ ${(e as Error).message}` } : m))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, activeOrg?.id, activeProject?.id, user?.id, messages, location.pathname])

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // New chat — stamp a boundary so past messages drop out of this session
  // (and out of the AI's context), clear the canvas, back to the launcher.
  function newChat() {
    if (streaming) abortRef.current?.abort()
    if (activeProject?.id) {
      try { localStorage.setItem(`vera-chat-since:${activeProject.id}`, new Date().toISOString()) } catch { /* ignore */ }
    }
    setMessages([])
    setDraft(null)
    setInput('')
    setTimeout(() => taRef.current?.focus(), 0)
  }

  // ─── Draft actions ──────────────────────────────────────────────
  async function approveDraft() {
    if (!draft?.id) return
    setApproving(true)
    try {
      const res = await fetch(`${SUPA}/functions/v1/approval-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({ post_id: draft.id, action: 'approved' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      push({ kind: 'success', title: 'Approved', body: 'Moved to the review queue as approved.' })
      setDraft(prev => prev ? { ...prev, status: 'Approved' } : prev)
    } catch (e) {
      push({ kind: 'danger', title: 'Approve failed', body: (e as Error).message })
    } finally {
      setApproving(false)
    }
  }
  function tweakDraft() {
    setInput(`Tweak the draft: `)
    setTimeout(() => taRef.current?.focus(), 0)
  }
  function regenerateDraft() {
    setInput('Regenerate that draft — same brief, fresh take.')
    setTimeout(() => taRef.current?.focus(), 0)
  }

  // Push the draft artifact into the right rail
  useRightRail(
    draft ? (
      <DraftArtifact
        draft={draft}
        approving={approving}
        onApprove={approveDraft}
        onTweak={tweakDraft}
        onRegenerate={regenerateDraft}
      />
    ) : <ArtifactEmpty />,
    [draft?.id, draft?.media_url, draft?.status, approving],
    // Wide, readable artifact panel — this is the working surface, not a
    // skinny sidebar. ~42vw, clamped so it stays sane on small + huge screens.
    'clamp(420px, 42vw, 660px)',
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: color.paper }}>
      {/* New chat — only once a conversation exists (launcher is already fresh) */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: `${space[4]} ${space[8]} 0` }}>
          <button onClick={newChat} title="Start a new chat"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer' }}>
            <SquarePen size={13} /> New chat
          </button>
        </div>
      )}
      {/* thread (no header bar — SAM-clean; the rail identifies "Vera") */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: `${space[6]} 0 ${space[7]}` }}>
        {!historyLoaded ? (
          <Centered>Loading thread…</Centered>
        ) : messages.length === 0 ? (
          <Idle onRun={pr => send(pr)} observations={observations} actions={buildLaunchActions(stats)} />
        ) : (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: `0 ${space[8]}`, display: 'flex', flexDirection: 'column', gap: space[7] }}>
            {messages.map(m => <Bubble key={m.id} m={m} />)}
          </div>
        )}
      </div>

      {/* composer */}
      <div style={{ padding: `${space[5]} ${space[8]} ${space[7]}` }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: space[3], padding: `${space[3]} ${space[4]}`, background: color.surface, border: `1px solid ${color.line2}`, borderRadius: radius.lg, boxShadow: 'var(--shadow-pop)' }}>
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Ask Vera anything…"
              disabled={!activeProject}
              style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: t.family.sans, fontSize: t.size.lg, lineHeight: 1.5, color: color.ink, minHeight: 52, maxHeight: 180, paddingTop: 6 }}
            />
            {streaming ? (
              <button onClick={() => abortRef.current?.abort()} title="Stop"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: color.ink, color: color.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim() || !activeProject} title="Send"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed', background: input.trim() ? color.accent : color.ink, color: '#fff', opacity: input.trim() ? 1 : 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: input.trim() ? 'var(--shadow-glow)' : 'none', transition: 'background 120ms, box-shadow 120ms' }}>
                <ArrowUp size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── message bubble ─────────────────────────────────────────────────
function Bubble({ m }: { m: Message }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '78%', padding: `10px 15px`, background: color.paper2, borderRadius: 14, borderTopRightRadius: radius.sm, fontSize: t.size.lg, lineHeight: 1.5, color: color.ink, whiteSpace: 'pre-wrap' }}>
          {m.content}
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: space[3] }}>
      <span style={{ width: 26, height: 26, borderRadius: radius.md, background: color.ink, color: color.surface, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>V</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: space[3] }}>
        {m.tools?.map((tl, i) => (
          <div key={`${tl.id ?? tl.tool}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: `5px 11px`, background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, fontSize: t.size.cap, color: color.ink2, alignSelf: 'flex-start' }}>
            {tl.status === 'running'
              ? <span style={{ width: 9, height: 9, borderRadius: '50%', background: color.accent, animation: 'vera-pulse 1.2s ease-in-out infinite' }} />
              : <Check size={12} style={{ color: color.accent }} />}
            <span style={{ color: color.ink, fontWeight: 500 }}>{TOOL_LABEL[tl.tool] ?? tl.tool}</span>
            {tl.message && <span style={{ color: color.ghost }}>· {tl.message}</span>}
          </div>
        ))}
        {m.images?.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', maxWidth: 320, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
            <img src={url} alt="" style={{ width: '100%', display: 'block' }} />
          </a>
        ))}
        {m.videos?.map((url, i) => (
          <video key={i} src={url} controls autoPlay muted loop playsInline style={{ display: 'block', maxWidth: 320, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }} />
        ))}
        {(m.content || m.pending) && (
          <div style={{ fontSize: t.size.lg, lineHeight: 1.62, color: color.ink, whiteSpace: 'pre-wrap' }}>
            {m.content || <Dots />}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── right rail: a FULL preview of the post, as it will appear once live ──
// A realistic LinkedIn-style card (author, body, media, reaction bar) so the
// operator sees the actual post — plus the approve / tweak / regenerate bar.
function DraftArtifact({ draft, approving, onApprove, onTweak, onRegenerate }: {
  draft: Post; approving: boolean; onApprove: () => void; onTweak: () => void; onRegenerate: () => void
}) {
  const d = draft as unknown as Record<string, unknown>
  const isApproved = (draft.status ?? '').toLowerCase() === 'approved'
  const channel = (draft.channel ?? 'LinkedIn') as string
  const author = ((d.profile_name as string) || 'InnovareAI').trim()
  const headline = ((d.profile_title as string) || 'Sponsored · Draft preview').trim()
  const aInitials = author.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'IN'
  const tags = Array.isArray(draft.hashtags) ? draft.hashtags.filter(Boolean) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar — label + the decision actions, always in reach. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], padding: `${space[5]} ${space[5]} ${space[3]}`, flexShrink: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: isApproved ? color.success : color.accent }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isApproved ? color.success : color.accent }} />
          {isApproved ? 'Approved' : 'Preview'} · {channel}
        </span>
        <div style={{ flex: 1 }} />
        {!isApproved && (
          <button onClick={onApprove} disabled={approving} style={{ ...btn(color.accent, '#fff', approving), boxShadow: approving ? 'none' : 'var(--shadow-glow)' }}>
            {approving ? '…' : <><Check size={13} strokeWidth={2.25} /> Send to review</>}
          </button>
        )}
      </div>

      {/* The post preview card. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${space[5]} ${space[5]}` }}>
        <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden', boxShadow: 'var(--shadow-pop)' }}>
          {/* author header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${space[5]} ${space[5]} ${space[3]}` }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-tint)', color: color.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{aInitials}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: color.ink, lineHeight: 1.2 }}>{author}</div>
              <div style={{ fontSize: 12, color: color.ghost, lineHeight: 1.3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headline}</div>
              <div style={{ fontSize: 11.5, color: color.faint, display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>now · <Globe size={11} /></div>
            </div>
            <MoreHorizontal size={18} style={{ color: color.faint, flexShrink: 0 }} />
          </div>

          {/* body copy + hashtags */}
          <div style={{ padding: `0 ${space[5]} ${space[4]}` }}>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: color.ink, whiteSpace: 'pre-wrap', margin: 0 }}>{draft.copy}</p>
            {tags.length > 0 && (
              <p style={{ fontSize: 14, color: color.accent, marginTop: space[3], marginBottom: 0, fontWeight: 500 }}>
                {tags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
              </p>
            )}
          </div>

          {/* media — edge to edge, like a real post */}
          {draft.media_url && draft.media_type === 'video'
            ? <video src={draft.media_url} autoPlay muted loop playsInline style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}` }} />
            : draft.media_url && (
              <img src={draft.media_url} alt="" style={{ width: '100%', display: 'block', borderTop: `1px solid ${color.line}` }} />
            )}

          {/* reaction bar — static, for realism */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: `${space[2]} ${space[3]}`, borderTop: `1px solid ${color.line}` }}>
            {[[ThumbsUp, 'Like'], [MessageCircle, 'Comment'], [Repeat2, 'Repost'], [Send, 'Send']].map(([Ic, lbl], i) => {
              const Icn = Ic as React.ElementType
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: color.ghost, padding: '6px 8px' }}>
                  <Icn size={16} strokeWidth={1.75} /> {lbl as string}
                </span>
              )
            })}
          </div>
        </div>

        {/* secondary actions under the preview */}
        <div style={{ display: 'flex', gap: space[2], marginTop: space[4] }}>
          <button onClick={onTweak} style={{ ...btn(color.paper2, color.ink, false), flex: 1, justifyContent: 'center', border: `1px solid ${color.line}` }}><Pencil size={12} /> Tweak</button>
          <button onClick={onRegenerate} style={{ ...btn(color.paper2, color.ink, false), flex: 1, justifyContent: 'center', border: `1px solid ${color.line}` }}><RefreshCw size={12} /> Regenerate</button>
        </div>
      </div>
    </div>
  )
}

function btn(bg: string, fg: string, busy: boolean): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: t.size.cap, fontWeight: t.weight.medium, borderRadius: radius.sm, border: 'none', cursor: busy ? 'default' : 'pointer', background: bg, color: fg, opacity: busy ? 0.6 : 1 }
}

function ArtifactEmpty() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: space[7], gap: space[3] }}>
      <Sparkles size={20} strokeWidth={1.5} style={{ color: color.faint }} />
      <p style={{ fontSize: t.size.cap, color: color.ghost, lineHeight: 1.5, maxWidth: '26ch' }}>
        Brief a post in the thread. The draft — copy, image, or video — opens here, ready to approve.
      </p>
    </div>
  )
}

// ─── launcher quick actions (SAM-style) — dynamic, count-aware, send-on-click ──
// Mirrors SAM's welcome actions: each is a complete prompt that RUNS on click
// (not a fill-the-box starter), and descriptions carry live workspace counts.
type LaunchAction = { icon: React.ElementType; title: string; sub: string; prompt: string }
function buildLaunchActions(stats: { pending: number; campaigns: number }): LaunchAction[] {
  const a: LaunchAction[] = []
  a.push({ icon: PenLine, title: 'Draft a Post', sub: 'Copy + a matching image', prompt: 'Draft a punchy LinkedIn post for this brand — one sharp hook, three crisp points, a soft CTA, and a matching image.' })
  if (stats.pending > 0) {
    a.push({ icon: ListChecks, title: 'Review Drafts', sub: `${stats.pending} draft${stats.pending === 1 ? '' : 's'} waiting`, prompt: `Summarize the ${stats.pending} draft${stats.pending === 1 ? '' : 's'} pending review — flag which to publish first and why.` })
  }
  a.push(stats.campaigns > 0
    ? { icon: Megaphone, title: 'Improve Campaign Plan', sub: `${stats.campaigns} campaign${stats.campaigns === 1 ? '' : 's'} in workspace`, prompt: "Review this brand's campaigns and suggest the highest-impact improvement to theme, angle, cadence, or channel mix." }
    : { icon: Megaphone, title: 'Plan a Campaign', sub: 'Map a content series', prompt: 'Help me plan a 4-post content campaign for this brand — themes, angles, and a posting cadence.' })
  a.push({ icon: MessageCircle, title: 'Create Messaging', sub: 'Draft campaign-ready copy', prompt: 'Draft 3 message variations for our latest offer, each with a different angle.' })
  a.push({ icon: Lightbulb, title: 'Content Ideas', sub: 'Fresh angles for this brand', prompt: "Give me 5 content ideas grounded in this brand's voice and recent themes." })
  a.push({ icon: Target, title: 'Strategy Ideas', sub: 'Find the next best move', prompt: "What's the highest-leverage content move for this brand right now? Be specific." })
  return a.slice(0, 6)
}

function Idle({ onRun, observations, actions }: {
  onRun: (prompt: string) => void
  observations: { id: string; title: string; proposed_action: string | null }[]
  actions: LaunchAction[]
}) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: space[8] }}>
      <span style={{ width: 56, height: 56, borderRadius: radius.lg, background: 'var(--accent-tint)', color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, marginBottom: space[5] }}>V</span>
      <h1 style={{ fontSize: t.size.h2, fontWeight: t.weight.semibold, color: color.ink, marginBottom: space[2], textAlign: 'center' }}>
        What should we create today?
      </h1>
      <p style={{ fontSize: t.size.body, color: color.ghost, marginBottom: space[7], textAlign: 'center', maxWidth: '44ch' }}>
        Bring Vera a brief, a question, or an idea you want to move forward.
      </p>

      {/* "VERA wants to" — proactive observations (moved from the old Home). */}
      {observations.length > 0 && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: space[5] }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent, marginBottom: space[3] }}>VERA wants to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {observations.map(o => (
              <button key={o.id} onClick={() => onRun(o.proposed_action || o.title)}
                style={{ display: 'flex', alignItems: 'center', gap: space[3], textAlign: 'left', padding: `${space[3]} ${space[4]}`, background: 'var(--accent-tint)', border: `1px solid var(--accent-line)`, borderRadius: radius.md, cursor: 'pointer', fontFamily: t.family.sans, color: color.ink, fontSize: t.size.sm }}>
                <Sparkles size={15} style={{ color: color.accent, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{o.title}</span>
                <ArrowUp size={13} style={{ color: color.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[3], width: '100%', maxWidth: 640 }}>
        {actions.map(c => {
          const Icn = c.icon
          return (
            <button key={c.title} onClick={() => onRun(c.prompt)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: space[4], textAlign: 'left', padding: `${space[4]} ${space[5]}`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, cursor: 'pointer', fontFamily: t.family.sans, transition: 'border-color 120ms, box-shadow 120ms' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.boxShadow = 'var(--shadow-pop)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none' }}>
              <span style={{ width: 36, height: 36, borderRadius: radius.md, background: 'var(--accent-tint)', color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icn size={18} strokeWidth={1.9} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>{c.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.cap, color: color.faint }}>{children}</div>
}
function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {[0, 150, 300].map(d => <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: color.faint, animation: `vera-pulse 1.2s ease-in-out ${d}ms infinite` }} />)}
    </span>
  )
}
