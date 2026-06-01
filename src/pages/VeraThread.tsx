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
import { ArrowUp, Square, Sparkles, Check, RefreshCw, Pencil } from 'lucide-react'
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

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load this project's thread
  useEffect(() => {
    if (!activeProject?.id) { setMessages([]); setHistoryLoaded(true); return }
    let cancelled = false
    setHistoryLoaded(false)
    supabase.from('chat_messages')
      .select('id, role, content')
      .eq('project_id', activeProject.id)
      .in('role', ['user', 'assistant'])
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

  const send = useCallback(async () => {
    const text = input.trim()
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
      {/* header */}
      <div style={{ padding: `${space[4]} ${space[8]}`, borderBottom: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', gap: space[3] }}>
        <span style={{ width: 24, height: 24, borderRadius: radius.md, background: color.ink, color: color.surface, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>V</span>
        <div>
          <div style={{ fontSize: t.size.body, fontWeight: t.weight.semibold, color: color.ink }}>VERA</div>
          <div style={{ fontSize: t.size.cap, color: color.ghost }}>
            {activeProject?.name ?? activeOrg?.name ?? 'Workspace'} · your creative partner
          </div>
        </div>
      </div>

      {/* thread */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: `${space[7]} 0` }}>
        {!historyLoaded ? (
          <Centered>Loading thread…</Centered>
        ) : messages.length === 0 ? (
          <Idle onPick={s => { setInput(s); taRef.current?.focus() }} project={activeProject?.name ?? null} />
        ) : (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: `0 ${space[8]}`, display: 'flex', flexDirection: 'column', gap: space[7] }}>
            {messages.map(m => <Bubble key={m.id} m={m} />)}
          </div>
        )}
      </div>

      {/* composer */}
      <div style={{ padding: `${space[5]} ${space[8]} ${space[7]}` }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          {activeProject && (
            <div style={{ display: 'flex', gap: space[2], marginBottom: space[3], fontSize: t.size.cap, color: color.ghost, alignItems: 'center' }}>
              <span style={{ background: color.paper2, padding: '2px 8px', borderRadius: radius.sm, color: color.ink2, fontWeight: t.weight.medium }}>
                {activeProject.name}
              </span>
              <span>· VERA drafts in this client's voice</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: space[3], padding: `${space[3]} ${space[4]}`, background: color.surface, border: `1px solid ${color.line2}`, borderRadius: radius.lg, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Brief a post, ask VERA anything, or paste a source…"
              disabled={!activeProject}
              style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: t.family.sans, fontSize: t.size.lg, lineHeight: 1.5, color: color.ink, minHeight: 52, maxHeight: 180, paddingTop: 6 }}
            />
            {streaming ? (
              <button onClick={() => abortRef.current?.abort()} title="Stop"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: color.ink, color: color.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button onClick={send} disabled={!input.trim() || !activeProject} title="Send"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed', background: color.ink, color: color.surface, opacity: input.trim() ? 1 : 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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

// ─── right-rail artifact: the draft being assembled ────────────────
function DraftArtifact({ draft, approving, onApprove, onTweak, onRegenerate }: {
  draft: Post; approving: boolean; onApprove: () => void; onTweak: () => void; onRegenerate: () => void
}) {
  const isApproved = (draft.status ?? '').toLowerCase() === 'approved'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: `${space[6]} ${space[5]} ${space[5]}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: isApproved ? color.success : color.accent, marginBottom: space[4] }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: isApproved ? color.success : color.accent }} />
        {isApproved ? 'Approved' : 'Draft'} · {(draft.channel ?? 'post')}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {draft.media_url && draft.media_type === 'image' && (
          <img src={draft.media_url} alt="" style={{ width: '100%', borderRadius: radius.md, marginBottom: space[4], border: `1px solid ${color.line}` }} />
        )}
        {draft.media_url && draft.media_type === 'video' && (
          <video src={draft.media_url} autoPlay muted loop playsInline style={{ width: '100%', borderRadius: radius.md, marginBottom: space[4], border: `1px solid ${color.line}` }} />
        )}
        {draft.title && (
          <p style={{ fontSize: t.size.lg, fontWeight: t.weight.semibold, color: color.ink, margin: 0, marginBottom: space[3] }}>{draft.title}</p>
        )}
        <p style={{ fontSize: t.size.body, lineHeight: 1.7, color: color.ink, whiteSpace: 'pre-wrap', margin: 0, maxWidth: '64ch' }}>{draft.copy}</p>
        {Array.isArray(draft.hashtags) && draft.hashtags.length > 0 && (
          <p style={{ fontSize: t.size.cap, color: color.info, marginTop: space[3] }}>
            {draft.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], paddingTop: space[4], borderTop: `1px solid ${color.line}`, marginTop: space[4] }}>
        {!isApproved && (
          <button onClick={onApprove} disabled={approving}
            style={btn(color.accent, '#fff', approving)}>
            {approving ? '…' : <><Check size={13} strokeWidth={2.25} /> Send to review</>}
          </button>
        )}
        <button onClick={onTweak} style={btn(color.paper2, color.ink, false)}><Pencil size={12} /> Tweak</button>
        <button onClick={onRegenerate} style={btn(color.paper2, color.ink, false)}><RefreshCw size={12} /> Regenerate</button>
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

// ─── idle / helpers ─────────────────────────────────────────────────
function Idle({ onPick, project }: { onPick: (s: string) => void; project: string | null }) {
  const examples = [
    'Draft a LinkedIn post on why most AI pilots stall at week six.',
    'Write 3 hooks for our hero product, lead with the feeling.',
    'Turn our latest case study into a short post + a hero image.',
  ]
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: space[8] }}>
      <span style={{ width: 40, height: 40, borderRadius: radius.lg, background: color.ink, color: color.surface, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, marginBottom: space[5] }}>V</span>
      <p style={{ fontSize: t.size.h3, fontWeight: t.weight.semibold, color: color.ink, marginBottom: space[2] }}>
        What should we make{project ? ` for ${project}` : ''}?
      </p>
      <p style={{ fontSize: t.size.cap, color: color.ghost, marginBottom: space[6] }}>Brief it in a line — VERA's team drafts it, you steer.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], width: '100%', maxWidth: 440 }}>
        {examples.map(ex => (
          <button key={ex} onClick={() => onPick(ex)}
            style={{ textAlign: 'left', padding: `10px 14px`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, fontSize: t.size.sm, color: color.ink2, cursor: 'pointer', fontFamily: t.family.sans }}>
            {ex}
          </button>
        ))}
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
