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
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Square, Sparkles, Check, RefreshCw, Pencil, MoreHorizontal, Globe, ThumbsUp, MessageCircle, Repeat2, Send, PenLine, ListChecks, Megaphone, Lightbulb, Target, SquarePen, Clock, ImagePlus, Clapperboard, Shuffle, Zap, CalendarDays, BookPlus, Users, Tag, X } from 'lucide-react'
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
  videoPending?: boolean   // a fal video job is rendering in the background
}

// A campaign = a batch of scheduled posts produced by the agent's plan_campaign
// capability (one ask → the whole arc). Rendered as a calendar in the right rail.
interface CampaignPost {
  id: string
  title: string | null
  copy: string
  channel: string
  status: string
  scheduled_at: string | null
  hashtags?: string[] | null
  image_prompt?: string | null
  campaign_id?: string
  media_url?: string
  media_type?: string
}
interface CampaignData {
  id: string
  name: string
  theme: string | null
  channel: string
  cadence: string
  count: number
  posts: CampaignPost[]
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
  const navigate = useNavigate()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [draft, setDraft] = useState<Post | null>(null)
  const [campaign, setCampaign] = useState<CampaignData | null>(null)
  const [approving, setApproving] = useState(false)
  const [observations, setObservations] = useState<{ id: string; title: string; proposed_action: string | null }[]>([])
  const [stats, setStats] = useState<{ pending: number; campaigns: number }>({ pending: 0, campaigns: 0 })
  const [sessionId, setSessionId] = useState<string>('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState<{ session_id: string; title: string | null; last_at: string; message_count: number }[]>([])
  const [setup, setSetup] = useState<{ audience: boolean; voice: boolean; categories: boolean; knowledge: boolean } | null>(null)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Establish the active chat session per client (persisted in localStorage).
  useEffect(() => {
    if (!activeProject?.id) { setSessionId(''); return }
    const key = `vera-session:${activeProject.id}`
    let sid = localStorage.getItem(key)
    if (!sid) { sid = crypto.randomUUID(); try { localStorage.setItem(key, sid) } catch { /* ignore */ } }
    setSessionId(sid)
  }, [activeProject?.id])

  // Load the current session's messages (re-runs on session switch / New chat).
  useEffect(() => {
    if (!activeProject?.id || !sessionId) { setMessages([]); setHistoryLoaded(!!activeProject?.id); return }
    let cancelled = false
    setHistoryLoaded(false)
    supabase.from('chat_messages')
      .select('id, role, content')
      .eq('project_id', activeProject.id)
      .eq('session_id', sessionId)
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
  }, [activeProject?.id, sessionId])

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
    q.then(({ data }) => {
      // Dedupe by title — duplicate/same-named campaigns can fire the same
      // nudge more than once; show each only once.
      const seen = new Set<string>()
      const deduped = ((data ?? []) as { id: string; title: string; proposed_action: string | null }[])
        .filter(o => (seen.has(o.title) ? false : (seen.add(o.title), true)))
      setObservations(deduped)
    })
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

  // Brain readiness — VERA writes sharper when the client's brain is set up, so
  // when it's thin we make "set up the brain" the obvious first step (the spine
  // starts at the brain, persona-first). Cheap count probes per client; guards
  // on errors so a missing table reads as "not done" rather than crashing idle.
  useEffect(() => {
    if (!activeProject?.id || !activeOrg?.id) { setSetup(null); return }
    let cancelled = false
    const pid = activeProject.id, oid = activeOrg.id
    const instr = (activeProject.instructions ?? '').trim()
    Promise.all([
      supabase.from('audiences').select('id', { count: 'exact', head: true }).eq('org_id', oid),
      supabase.from('brand_voice').select('tone, system_prompt, sample_posts').or(`project_id.eq.${pid},and(project_id.is.null,org_id.eq.${oid})`).limit(6),
      supabase.from('content_categories').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('project_knowledge').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ]).then(([aud, voice, cat, kb]) => {
      if (cancelled) return
      const vr = (voice.data ?? []) as { tone?: string[] | null; system_prompt?: string | null; sample_posts?: string[] | null }[]
      const voiceReady = vr.some(v => (v.tone?.length ?? 0) > 0 || (v.system_prompt ?? '').trim().length > 0 || (v.sample_posts?.length ?? 0) > 0)
      setSetup({
        audience: !aud.error && (aud.count ?? 0) > 0,
        voice: voiceReady,
        categories: !cat.error && (cat.count ?? 0) > 0,
        knowledge: (!kb.error && (kb.count ?? 0) > 0) || instr.length > 0,
      })
    })
    return () => { cancelled = true }
  }, [activeProject?.id, activeOrg?.id, activeProject?.instructions])

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

  // "Go home" — clicking the Vera item in the rail (while already here) returns
  // to the launcher, the way people expect the logo/home to behave. The prior
  // chat is saved (Recents/History). A ref keeps the latest closure so the
  // listener never goes stale.
  const newChatRef = useRef<() => void>(() => {})
  useEffect(() => { newChatRef.current = newChat })
  useEffect(() => {
    const h = () => newChatRef.current()
    window.addEventListener('vera:home', h)
    return () => window.removeEventListener('vera:home', h)
  }, [])

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
    // Keep the open draft in Vera's context — otherwise "tweak the draft" makes
    // the user re-paste it (the draft lives in the right-rail artifact, not
    // necessarily in the message text). Appended to the outgoing turn only; the
    // message shown in the thread stays clean.
    if (draft?.copy && wire.length) {
      const last = wire[wire.length - 1]
      wire[wire.length - 1] = {
        ...last,
        content: `${last.content}\n\n---\n[The draft currently open in the preview${draft.id ? ` (id: ${draft.id})` : ''}. If I ask you to tweak, edit, refine, shorten, or change "the draft/copy/post", revise THIS exact text in place and return the full updated post — do not ask me to paste it again:]\n${draft.copy}`,
      }
    }
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
          session_id: sessionId || null,
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
          } else if (ev.type === 'video_pending' && typeof ev.request_id === 'string') {
            // Video renders for 60-120s — too long to hold this connection open.
            // The backend already submitted the fal job; poll for the result
            // with short requests so nothing times out. Fire-and-forget: this
            // keeps running after the SSE stream below closes.
            setMessages(prev => prev.map(m => m.id === assistantId ? {
              ...m, videoPending: true,
              // Don't let the tool flip to ✓ — it's still rendering. Keep it
              // "running" so the caption + pulse match reality (tester saw a
              // misleading checkmark on a video that couldn't play yet).
              tools: (m.tools ?? []).map(tl => tl.tool === 'generate_video' ? { ...tl, status: 'running' as const } : tl),
            } : m))
            void pollVideo(ev.request_id as string, (ev.slug as string) ?? 'veo-3', assistantId)
          } else if (ev.type === 'draft' && ev.post) {
            setDraft(ev.post as Post)
          } else if (ev.type === 'campaign' && ev.campaign) {
            // The agent ran plan_campaign — a whole batch of scheduled posts.
            // Show the calendar in the rail; clicking a post opens it.
            const meta = ev.campaign as Record<string, unknown>
            const posts = (ev.posts as CampaignPost[]) ?? []
            setDraft(null)
            setCampaign({
              id: meta.id as string,
              name: (meta.name as string) ?? 'Campaign',
              theme: (meta.theme as string) ?? null,
              channel: (meta.channel as string) ?? 'LinkedIn',
              cadence: (meta.cadence as string) ?? 'weekly',
              count: posts.length,
              posts,
            })
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
  }, [input, streaming, activeOrg?.id, activeProject?.id, user?.id, messages, location.pathname, sessionId, draft])

  // Poll a backgrounded fal video job (submitted by vera-chat) until the MP4
  // is ready, then drop it into the chat and the open draft. Short polling
  // requests only — nothing is held open long enough for the gateway to kill
  // it, which is what produced the "network error" at ~47s. Runs after the
  // chat SSE stream has already closed.
  async function pollVideo(requestId: string, slug: string, assistantId: string) {
    const INTERVAL = 5000
    const MAX_TRIES = 72 // 72 × 5s = 6 min ceiling
    for (let i = 0; i < MAX_TRIES; i++) {
      await new Promise(r => setTimeout(r, INTERVAL))
      let data: { status?: string; video_url?: string | null }
      try {
        const res = await fetch(`${SUPA}/functions/v1/generate-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON}`, 'apikey': ANON },
          body: JSON.stringify({ action: 'status', request_id: requestId, slug }),
        })
        if (!res.ok) continue
        data = await res.json()
      } catch { continue } // transient blip — keep polling

      if (data.status === 'COMPLETED' && data.video_url) {
        const vurl = data.video_url
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, videoPending: false, videos: [...(m.videos ?? []), vurl], tools: (m.tools ?? []).map(tl => tl.tool === 'generate_video' ? { ...tl, status: 'done' as const } : tl) } : m))
        setDraft(prev => {
          if (prev?.id) void supabase.from('content_posts').update({ media_url: vurl, media_type: 'video' }).eq('id', prev.id)
          return prev ? { ...prev, media_url: vurl, media_type: 'video' } : prev
        })
        return
      }
      if (data.status === 'FAILED' || data.status === 'CANCELLED' || data.status === 'ERROR') {
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, videoPending: false, content: (m.content ? m.content + '\n\n' : '') + `⚠ Video rendering failed (${(data.status ?? '').toLowerCase()}). Try again or tweak the prompt.` } : m))
        return
      }
      // IN_QUEUE / IN_PROGRESS → keep polling
    }
    setMessages(prev => prev.map(m => m.id === assistantId
      ? { ...m, videoPending: false, content: (m.content ? m.content + '\n\n' : '') + '⚠ Video is taking longer than usual — it may still be rendering. Try again shortly.' } : m))
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // New chat — start a fresh session (new id). The load effect clears the
  // thread; the AI's context resets because we only send this session's msgs.
  function newChat() {
    if (streaming) abortRef.current?.abort()
    const sid = crypto.randomUUID()
    if (activeProject?.id) { try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ } }
    setDraft(null); setCampaign(null); setInput(''); setHistoryOpen(false)
    setMessages([]); setSessionId(sid)
    setTimeout(() => taRef.current?.focus(), 0)
  }

  // History — list this client's past chats; reopen one by switching session.
  async function openHistory() {
    if (!activeProject?.id) return
    setHistoryOpen(o => !o)
    const { data } = await supabase.rpc('list_chat_sessions', { p_project_id: activeProject.id })
    setSessions((data ?? []) as typeof sessions)
  }
  function pickSession(sid: string) {
    if (activeProject?.id) { try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ } }
    setDraft(null); setCampaign(null); setHistoryOpen(false); setSessionId(sid)
  }

  // Dismiss a "VERA wants to" nudge — clears every dupe of it (by title).
  async function dismissObservation(o: { title: string }) {
    setObservations(prev => prev.filter(x => x.title !== o.title))
    if (!activeOrg?.id) return
    let q = supabase.from('agent_observations').update({ status: 'dismissed' })
      .eq('org_id', activeOrg.id).eq('title', o.title)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    await q
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
        onBack={campaign ? () => setDraft(null) : undefined}
      />
    ) : campaign ? (
      <CampaignArtifact campaign={campaign} onOpenPost={p => setDraft(p as unknown as Post)} />
    ) : <ArtifactEmpty />,
    [draft?.id, draft?.media_url, draft?.status, approving, campaign?.id, campaign?.posts?.length],
    // Wide, readable artifact panel — this is the working surface, not a
    // skinny sidebar. ~42vw, clamped so it stays sane on small + huge screens.
    'clamp(420px, 42vw, 660px)',
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: color.paper }}>
      {/* History + New chat — past chats live under the active client. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space[2], padding: `${space[4]} ${space[8]} 0` }}>
        <div style={{ position: 'relative' }}>
          <button onClick={openHistory} title="Chat history"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer' }}>
            <Clock size={13} /> History
          </button>
          {historyOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setHistoryOpen(false)} />
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 40, width: 300, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, boxShadow: 'var(--shadow-pop)', padding: 4, maxHeight: 400, overflowY: 'auto' }}>
                {sessions.length === 0 && <div style={{ padding: '12px', fontSize: t.size.cap, color: color.ghost }}>No past chats for this client yet.</div>}
                {sessions.map(s => (
                  <button key={s.session_id} onClick={() => pickSession(s.session_id)}
                    style={{ width: '100%', textAlign: 'left', display: 'block', padding: '8px 10px', borderRadius: radius.sm, border: 'none', background: s.session_id === sessionId ? 'var(--accent-tint)' : 'transparent', cursor: 'pointer' }}>
                    <span style={{ display: 'block', fontSize: t.size.sm, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: s.session_id === sessionId ? 600 : 400 }}>{(s.title || 'Untitled chat').slice(0, 64)}</span>
                    <span style={{ display: 'block', fontSize: t.size.micro, color: color.faint, marginTop: 1 }}>{relTime(s.last_at)} · {s.message_count} msg{s.message_count === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button onClick={newChat} title="Start a new chat"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer' }}>
          <SquarePen size={13} /> New chat
        </button>
      </div>
      {/* thread (no header bar — SAM-clean; the rail identifies "Vera") */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: `${space[6]} 0 ${space[7]}` }}>
        {!historyLoaded ? (
          <Centered>Loading thread…</Centered>
        ) : messages.length === 0 ? (
          <Idle onRun={pr => send(pr)} observations={observations} actions={buildLaunchActions(stats)} onDismiss={dismissObservation}
            setup={setup} projectName={activeProject?.name ?? 'this client'}
            onOpenBrain={() => { if (activeProject?.slug) navigate(`/p/${activeProject.slug}/brain`) }} />
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
      <span style={{ marginTop: 2, display: 'inline-flex', flexShrink: 0 }}><VeraAvatar size={40} /></span>
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
        {m.videoPending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, padding: '12px 14px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, color: color.ink2, fontSize: t.size.sm }}>
            <Clapperboard size={15} style={{ color: color.accent }} />
            <span>Rendering video… this runs in the background (~1–2 min) and will appear here automatically.</span>
            <span style={{ marginLeft: 'auto', width: 9, height: 9, borderRadius: '50%', background: color.accent, animation: 'vera-pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
          </div>
        )}
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
function DraftArtifact({ draft, approving, onApprove, onTweak, onRegenerate, onBack }: {
  draft: Post; approving: boolean; onApprove: () => void; onTweak: () => void; onRegenerate: () => void; onBack?: () => void
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
        {onBack && (
          <button onClick={onBack} title="Back to the campaign calendar" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer' }}>
            ← Calendar
          </button>
        )}
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

// The campaign calendar — the artifact for a plan_campaign batch. A header
// (name · theme · count) over a dated list of post cards; click one to open it
// in the draft preview for Approve / Tweak / Regenerate.
function CampaignArtifact({ campaign, onOpenPost }: {
  campaign: CampaignData; onOpenPost: (p: CampaignPost) => void
}) {
  const fmt = (iso: string | null) => {
    if (!iso) return { dow: '', md: '' }
    const d = new Date(iso)
    if (isNaN(d.getTime())) return { dow: '', md: '' }
    return {
      dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
      md: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  }
  const posts = [...campaign.posts].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: `${space[5]} ${space[5]} ${space[3]}`, flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent }}>
          <CalendarDays size={13} /> Campaign · {campaign.channel}
        </div>
        <h2 style={{ fontSize: t.size.lg, fontWeight: t.weight.semibold, color: color.ink, margin: `${space[2]} 0 2px`, lineHeight: 1.25 }}>{campaign.name}</h2>
        {campaign.theme && <p style={{ fontSize: t.size.cap, color: color.ink2, margin: 0, lineHeight: 1.45 }}>{campaign.theme}</p>}
        <p style={{ fontSize: t.size.micro, color: color.ghost, margin: `${space[2]} 0 0` }}>{posts.length} posts · {campaign.cadence} · all pending review</p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${space[5]} ${space[5]}`, display: 'flex', flexDirection: 'column', gap: space[2] }}>
        {posts.map((p, i) => {
          const d = fmt(p.scheduled_at)
          return (
            <button key={p.id ?? i} onClick={() => onOpenPost(p)}
              style={{ textAlign: 'left', display: 'flex', gap: space[3], padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, cursor: 'pointer', width: '100%' }}>
              <div style={{ flexShrink: 0, width: 46, textAlign: 'center' }}>
                <div style={{ fontSize: t.size.micro, fontWeight: t.weight.semibold, color: color.accent, lineHeight: 1.2 }}>{d.dow}</div>
                <div style={{ fontSize: t.size.cap, color: color.ink, fontWeight: t.weight.medium }}>{d.md}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: t.size.cap, fontWeight: t.weight.semibold, color: color.ink, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title || `Post ${i + 1}`}</div>
                <div style={{ fontSize: t.size.micro, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.copy}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
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
  a.push({ icon: ImagePlus, title: 'Image Prompt', sub: 'Craft a scroll-stopping visual', prompt: "Help me craft a scroll-stopping image prompt for a post, then generate it. Build it in layers: subject + a clear metaphor, composition/framing, a named style (e.g. editorial photo-illustration, 3D render, flat vector), lighting, an on-brand color palette (lead with coral #EF6A6A plus a neutral), mood, and setting — and end with 'no text, no words, no logos'. Ask me the subject/mood only if you can't infer it from the brand context, then generate the image." })
  a.push({ icon: Clapperboard, title: 'Make a Video', sub: 'Short motion clip for a post', prompt: 'Create a short video clip for a post — ask me the concept and vibe, then generate it.' })
  a.push({ icon: Zap, title: 'Write Hooks', sub: '5 sharp opening lines', prompt: "Write 5 scroll-stopping opening hooks in this brand's voice for a topic I'll give you — punchy, specific, no clichés." })
  if (stats.pending > 0) {
    a.push({ icon: ListChecks, title: 'Review Drafts', sub: `${stats.pending} draft${stats.pending === 1 ? '' : 's'} waiting`, prompt: `Summarize the ${stats.pending} draft${stats.pending === 1 ? '' : 's'} pending review — flag which to publish first and why.` })
  }
  a.push(stats.campaigns > 0
    ? { icon: Megaphone, title: 'Improve Campaign Plan', sub: `${stats.campaigns} campaign${stats.campaigns === 1 ? '' : 's'} in workspace`, prompt: "Review this brand's campaigns and suggest the highest-impact improvement to theme, angle, cadence, or channel mix." }
    : { icon: Megaphone, title: 'Plan a Campaign', sub: 'A drafted, scheduled series', prompt: 'Plan and draft a content campaign for this brand — write all the posts and schedule them across the next few weeks.' })
  a.push({ icon: CalendarDays, title: 'Plan the Month', sub: 'A month of posts, drafted', prompt: "Plan and draft this brand's next month of LinkedIn content — write every post and schedule them weekly." })
  a.push({ icon: Lightbulb, title: 'Content Ideas', sub: 'Fresh angles for this brand', prompt: "Give me 5 content ideas grounded in this brand's voice and recent themes." })
  a.push({ icon: MessageCircle, title: 'Variations', sub: 'Three takes on one idea', prompt: 'Write 3 variations of a post on a topic I give you — each a different angle, in the brand voice.' })
  a.push({ icon: Shuffle, title: 'Repurpose', sub: 'One post → many formats', prompt: 'Take my latest draft (or a topic I give you) and repurpose it into a LinkedIn thread, a carousel outline, and a short email.' })
  a.push({ icon: BookPlus, title: 'Add Brand Knowledge', sub: 'Teach Vera about this brand', prompt: 'I want to add brand knowledge. Ask me what to capture — positioning, proof points, voice, and what to avoid — then save it to the knowledge base.' })
  a.push({ icon: Target, title: 'Strategy Ideas', sub: 'Find the next best move', prompt: "What's the highest-leverage content move for this brand right now? Be specific." })
  return a.slice(0, 12)
}

function Idle({ onRun, observations, actions, onDismiss, setup, projectName, onOpenBrain }: {
  onRun: (prompt: string) => void
  observations: { id: string; title: string; proposed_action: string | null }[]
  actions: LaunchAction[]
  onDismiss: (o: { title: string }) => void
  setup: { audience: boolean; voice: boolean; categories: boolean; knowledge: boolean } | null
  projectName: string
  onOpenBrain: () => void
}) {
  const setupDone = !!setup && setup.audience && setup.voice && setup.categories && setup.knowledge
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: space[8] }}>
      <span style={{ marginBottom: space[5], display: 'inline-flex' }}><VeraAvatar size={56} hero /></span>
      <h1 style={{ fontSize: t.size.h2, fontWeight: t.weight.semibold, color: color.ink, marginBottom: space[2], textAlign: 'center' }}>
        What should we create today?
      </h1>
      <p style={{ fontSize: t.size.body, color: color.ghost, marginBottom: space[7], textAlign: 'center', maxWidth: '44ch' }}>
        Bring Vera a brief, a question, or an idea you want to move forward.
      </p>

      {/* Persona-first setup — when the client's brain is thin, this is the
          obvious step 1 (the spine starts at the brain). Disappears once set. */}
      {setup && !setupDone && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: space[5], background: color.surface, border: `1px solid var(--accent-line)`, borderRadius: radius.lg, overflow: 'hidden' }}>
          <div style={{ padding: `${space[4]} ${space[5]}`, borderBottom: `1px solid ${color.line}` }}>
            <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent, marginBottom: 4 }}>Set up {projectName} first</div>
            <div style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5 }}>Vera writes sharper when it knows who you're talking to and how you sound. Start here — a few minutes now pays off on every post.</div>
          </div>
          <div>
            {([
              { key: 'audience', icon: Users, label: 'Audience', sub: "Who you're talking to" },
              { key: 'voice', icon: Megaphone, label: 'Brand voice', sub: 'How you sound' },
              { key: 'categories', icon: Tag, label: 'Content categories', sub: 'Your reusable buckets' },
              { key: 'knowledge', icon: BookPlus, label: 'Brand knowledge', sub: 'Positioning, proof points' },
            ] as const).map((it, i, arr) => {
              const done = setup?.[it.key] ?? false
              const Icn = it.icon
              return (
                <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: `${space[3]} ${space[5]}`, borderBottom: i < arr.length - 1 ? `1px solid ${color.line}` : 'none' }}>
                  <span style={{ width: 30, height: 30, borderRadius: radius.md, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: done ? 'var(--accent-tint)' : color.paper2, color: done ? color.success : color.ghost }}>
                    {done ? <Check size={15} strokeWidth={2.5} /> : <Icn size={15} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: t.size.sm, fontWeight: t.weight.medium, color: done ? color.ghost : color.ink, textDecoration: done ? 'line-through' : 'none' }}>{it.label}</span>
                    <span style={{ display: 'block', fontSize: t.size.micro, color: color.faint }}>{it.sub}</span>
                  </span>
                  {!done && (
                    <button onClick={onOpenBrain} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 11px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.accent, background: 'var(--accent-tint)', border: 'none', borderRadius: radius.pill, cursor: 'pointer' }}>Add →</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* "VERA wants to" — proactive observations (moved from the old Home). */}
      {observations.length > 0 && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: space[5] }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent, marginBottom: space[3] }}>VERA wants to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {observations.map(o => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'stretch', background: 'var(--accent-tint)', border: `1px solid var(--accent-line)`, borderRadius: radius.md, overflow: 'hidden' }}>
                <button onClick={() => onRun(o.proposed_action || o.title)} title="Ask VERA to handle this"
                  style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: space[3], textAlign: 'left', padding: `${space[3]} ${space[4]}`, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: t.family.sans, color: color.ink, fontSize: t.size.sm }}>
                  <Sparkles size={15} style={{ color: color.accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{o.title}</span>
                  <ArrowUp size={13} style={{ color: color.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
                </button>
                <button onClick={() => onDismiss(o)} title="Dismiss"
                  style={{ flexShrink: 0, padding: `0 ${space[3]}`, background: 'transparent', border: 'none', borderLeft: `1px solid var(--accent-line)`, cursor: 'pointer', color: color.ghost, display: 'flex', alignItems: 'center' }}>
                  <X size={14} />
                </button>
              </div>
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

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.round(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const dd = Math.round(h / 24)
  if (dd < 7) return `${dd}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Vera's face — served from /vera-avatar.png; falls back to the "V" monogram
// if the asset is missing so the UI never shows a broken image. Drop the file
// in content-studio/public/ to give her a face everywhere she appears.
function VeraAvatar({ size, hero = false }: { size: number; hero?: boolean }) {
  const [broken, setBroken] = useState(false)
  const frame: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  if (broken) {
    return (
      <span style={{ ...frame, background: hero ? 'var(--accent-tint)' : color.ink, color: hero ? color.accent : color.surface, fontSize: hero ? 24 : 11, fontWeight: hero ? 700 : 600 }}>V</span>
    )
  }
  return (
    <span style={{ ...frame, background: hero ? 'var(--accent-tint)' : color.paper2 }}>
      <img src="/vera-avatar.png" alt="Vera" onError={() => setBroken(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
    </span>
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
