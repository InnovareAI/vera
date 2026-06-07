// VERA chat — bottom dock. Chat is the primary control surface; everything
// else is context above it.
//
// Three modes (cycle via header buttons or ⌘\):
//   - minimized  → 64px composer-only strip
//   - default    → ~60vh, canvas visible above
//   - fullscreen → takes the entire canvas area
//
// Backend: SSE stream from /functions/v1/vera-chat, persisted to
// chat_messages keyed on the active workspace.

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ArrowUp, ChevronDown, ChevronUp, Maximize2, Minimize2, Square,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useAuth } from '../lib/auth'

interface ToolEvent {
  id?: string
  tool: string
  status: 'running' | 'done'
  message?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  images?: string[]      // image URLs surfaced via tool calls
  tools?: ToolEvent[]    // inline tool-call status lines
}

type Mode = 'minimized' | 'default' | 'fullscreen'

const HISTORY_LIMIT = 50
const MODE_HEIGHTS: Record<Mode, string> = {
  minimized: '64px',
  default: '60vh',
  fullscreen: '100%',
}

interface PendingImage {
  id: string
  media_type: string
  data: string         // base64
  preview_url: string  // object URL for <img> preview before send
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [streaming, setStreaming] = useState(false)
  // Default to 'minimized' (64px composer-only strip) so the canvas owns
  // the screen and the chat is reachable as a thin strip at the bottom.
  // ⌘J expands to 'default' (60vh) when the operator wants to converse;
  // ⌘\ cycles all three modes (minimized → default → fullscreen).
  //
  // The earlier 'default' default ate ~60% of vertical real-estate on every
  // page — canvas got squeezed even when the operator wasn't actively
  // chatting. Light rails + minimized chat strip together let pages breathe.
  const [mode, setMode] = useState<Mode>('minimized')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const location = useLocation()
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const { user, session } = useAuth()

  // Load thread on workspace + project switch. Each project keeps its own
  // chat history — switching projects swaps the thread (per the user's
  // call: "chat scoped to a project"). Workspace-level chats (project_id
  // null) load when no project is active.
  useEffect(() => {
    if (!activeOrg?.id) {
      setMessages([])
      setHistoryLoaded(true)
      return
    }
    let cancelled = false
    setHistoryLoaded(false)
    let q = supabase
      .from('chat_messages')
      .select('id, role, content, attachments')
      .eq('org_id', activeOrg.id)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (activeProject?.id) {
      q = q.eq('project_id', activeProject.id)
    } else {
      // No project active — show workspace-level (null project_id) thread.
      q = q.is('project_id', null)
    }
    q.then(({ data }) => {
        if (cancelled) return
        type Row = { id: string; role: 'user' | 'assistant'; content: string; attachments: Array<{ kind: string; url: string }> | null }
        const rows = (data ?? []) as Row[]
        setMessages(rows.reverse().map(r => ({
          id: r.id,
          role: r.role,
          content: r.content,
          images: (r.attachments ?? []).filter(a => a.kind === 'image').map(a => a.url),
        })))
        setHistoryLoaded(true)
      })
    return () => { cancelled = true }
  }, [activeOrg?.id, activeProject?.id])

  // Auto-scroll
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // ⌘J focuses composer; ⌘\ cycles mode
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'j') {
        e.preventDefault()
        if (mode === 'minimized') setMode('default')
        setTimeout(() => textareaRef.current?.focus(), 50)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setMode(m => m === 'minimized' ? 'default' : m === 'default' ? 'fullscreen' : 'minimized')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Auto-grow textarea — clamp between 4 lines (default) and ~10 lines (cap)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 240)}px`
  }, [input])

  // Convert a File or Blob to a base64 PendingImage
  async function attachImage(file: File | Blob) {
    if (!file.type.startsWith('image/')) return
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    // chunk-encode to avoid stack overflow on large images
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    }
    const data = btoa(bin)
    const preview_url = URL.createObjectURL(file)
    setPendingImages(prev => [...prev, {
      id: crypto.randomUUID(),
      media_type: file.type,
      data,
      preview_url,
    }])
  }

  // Paste handler — image data in the clipboard becomes a pending attachment
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const items = Array.from(e.clipboardData.items)
      const imgItem = items.find(it => it.type.startsWith('image/'))
      if (imgItem) {
        const file = imgItem.getAsFile()
        if (file) {
          e.preventDefault()
          attachImage(file)
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Drop handler on the panel
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) attachImage(f)
  }
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  const send = useCallback(async () => {
    const text = input.trim()
    if ((!text && pendingImages.length === 0) || streaming || !activeOrg?.id) return

    // Build the user message content — string for text-only, array for vision
    const userContent: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> =
      pendingImages.length === 0
        ? text
        : [
            ...(text ? [{ type: 'text', text }] : []),
            ...pendingImages.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: img.media_type, data: img.data },
            })),
          ]

    const userPreviewImages = pendingImages.map(p => p.preview_url)
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      images: userPreviewImages.length ? userPreviewImages : undefined,
    }
    const assistantId = crypto.randomUUID()
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', pending: true }

    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, placeholder])
    setInput('')
    setPendingImages([])
    setStreaming(true)
    if (mode === 'minimized') setMode('default')  // surface the reply

    // Build the wire-format messages array: existing turns use plain string
    // content, but the LATEST user turn uses array content when images are
    // present so Anthropic sees them via vision.
    const wireMessages = [
      ...nextMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userContent },
    ]

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      const token = session?.access_token
      if (!token) throw new Error('Sign in again before using Vera.')
      const res = await fetch(`${supabaseUrl}/functions/v1/vera-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          messages: wireMessages,
          org_id: activeOrg.id,
          user_id: user?.id ?? null,
          project_id: activeProject?.id ?? null,
          route: location.pathname,
        }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'delta' && typeof event.text === 'string') {
              accumulated += event.text
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: accumulated } : m,
              ))
            } else if (event.type === 'tool_start') {
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, tools: [...(m.tools ?? []), { id: event.id, tool: event.tool, status: 'running' }] }
                : m,
              ))
            } else if (event.type === 'tool_progress') {
              setMessages(prev => prev.map(m => m.id === assistantId
                ? {
                    ...m,
                    tools: (m.tools ?? []).map(t =>
                      t.tool === event.tool && t.status === 'running' ? { ...t, message: event.status } : t,
                    ),
                  }
                : m,
              ))
            } else if (event.type === 'tool_end') {
              setMessages(prev => prev.map(m => m.id === assistantId
                ? {
                    ...m,
                    tools: (m.tools ?? []).map(t =>
                      t.id === event.id ? { ...t, status: 'done', message: event.result } : t,
                    ),
                  }
                : m,
              ))
            } else if (event.type === 'image' && typeof event.url === 'string') {
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, images: [...(m.images ?? []), event.url] }
                : m,
              ))
            } else if (event.type === 'error') {
              throw new Error(event.message ?? 'stream error')
            }
          } catch (parseErr) {
            console.warn('vera-chat: bad SSE frame', line, parseErr)
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, pending: false } : m,
      ))
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, pending: false } : m,
        ))
      } else {
        console.error('vera-chat failed', err)
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, pending: false, content: m.content || `⚠ ${(err as Error).message}` }
            : m,
        ))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, pendingImages, streaming, activeOrg?.id, activeProject?.id, messages, user?.id, session?.access_token, location.pathname, mode])

  function stop() {
    abortRef.current?.abort()
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
  }

  const isMin = mode === 'minimized'
  const isFull = mode === 'fullscreen'

  return (
    <section
      className="flex-shrink-0 flex flex-col"
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        height: MODE_HEIGHTS[mode],
        minHeight: MODE_HEIGHTS[mode],
        maxHeight: MODE_HEIGHTS[mode],
        background: 'var(--paper-warm)',
        borderTop: '1px solid var(--paper-edge)',
        transition: 'height 200ms ease, min-height 200ms ease, max-height 200ms ease',
      }}
    >
      {/* Header — workspace + mode toggle. Hidden in minimized mode (composer is the only thing visible). */}
      {!isMin && (
        <div
          className="px-5 py-2.5 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--paper-edge)' }}
        >
          <div
            className="w-6 h-6 flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper-warm)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            V
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium leading-tight" style={{ color: 'var(--ink)' }}>
              VERA
            </div>
            <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ghost)' }}>
              {activeOrg?.name ? `${activeOrg.name} · your creative partner` : 'Pick a workspace to start'}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ModeButton
              icon={ChevronDown}
              title="Minimize (⌘\\)"
              onClick={() => setMode('minimized')}
            />
            <ModeButton
              icon={isFull ? Minimize2 : Maximize2}
              title={isFull ? 'Default size (⌘\\)' : 'Fullscreen (⌘\\)'}
              onClick={() => setMode(isFull ? 'default' : 'fullscreen')}
            />
          </div>
        </div>
      )}

      {/* Messages — hidden in minimized mode */}
      {!isMin && (
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5">
          {!historyLoaded ? (
            <div className="h-full flex items-center justify-center text-[12px]" style={{ color: 'var(--mist)' }}>
              Loading thread…
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-4xl mx-auto space-y-5">
              {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            </div>
          )}
        </div>
      )}

      {/* Composer — always visible, the constant. Spans the full canvas width. */}
      <div
        className="px-5 py-3 flex-shrink-0"
        style={!isMin ? { borderTop: '1px solid var(--paper-edge)' } : {}}
      >
        <div className="w-full">
          {/* Pending image attachments — preview thumbnails above composer */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingImages.map(img => (
                <div
                  key={img.id}
                  className="relative group"
                  style={{
                    width: 64, height: 64,
                    background: 'var(--paper)',
                    border: '1px solid var(--paper-edge)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                  }}
                >
                  <img src={img.preview_url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter(p => p.id !== img.id))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: '50%' }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className="flex items-end gap-3 px-4 py-3"
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--paper-edge)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: isMin ? '0 -2px 12px -8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {isMin && (
              <button
                onClick={() => setMode('default')}
                className="w-7 h-7 flex items-center justify-center flex-shrink-0 hover:bg-[var(--fog)] transition-colors"
                style={{ borderRadius: 'var(--radius-sm)', color: 'var(--ghost)' }}
                title="Open VERA (⌘J)"
              >
                <ChevronUp size={15} strokeWidth={1.75} />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onComposerKey}
              rows={4}
              placeholder={
                activeOrg
                  ? 'Tell VERA what to do — draft a post, summarize the queue, run an audit…'
                  : 'Pick a workspace to start'
              }
              disabled={!activeOrg}
              className="flex-1 resize-none outline-none bg-transparent text-[14.5px] leading-relaxed disabled:opacity-50 py-1"
              style={{ color: 'var(--ink)', minHeight: 96, maxHeight: 240 }}
            />
            {streaming ? (
              <button
                onClick={stop}
                className="w-9 h-9 flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-90"
                style={{
                  background: 'var(--ink)',
                  color: 'var(--paper-warm)',
                  borderRadius: '50%',
                }}
                title="Stop"
              >
                <Square size={12} strokeWidth={2.5} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim() || !activeOrg}
                className="w-9 h-9 flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-30 hover:opacity-90"
                style={{
                  background: 'var(--ink)',
                  color: 'var(--paper-warm)',
                  borderRadius: '50%',
                }}
                title="Send (⌘↩)"
              >
                <ArrowUp size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
          <div className="mt-1 px-1 text-[10.5px] text-right" style={{ color: 'var(--mist)' }}>
            ⌘↩ send · ⌘\ resize
          </div>
        </div>
      </div>
    </section>
  )
}

function ModeButton({
  icon: Icon, title, onClick,
}: { icon: React.ElementType; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 flex items-center justify-center hover:bg-[var(--fog)] transition-colors"
      style={{ borderRadius: 'var(--radius-sm)', color: 'var(--ghost)' }}
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  )
}

// ─── Empty state — quiet center, one line, nothing competing ───────────────
function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div
        className="w-10 h-10 flex items-center justify-center text-[15px] font-semibold mb-4"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper-warm)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        V
      </div>
      <p className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        What should we work on?
      </p>
    </div>
  )
}

// ─── Message bubble — wider now that chat is the canvas ────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[75%] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap"
          style={{
            background: 'var(--fog)',
            color: 'var(--ink)',
            borderRadius: 'var(--radius-lg)',
            borderTopRightRadius: 'var(--radius-sm)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div
        className="w-7 h-7 flex items-center justify-center text-[12px] font-semibold flex-shrink-0 mt-0.5"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper-warm)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        V
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {/* Inline tool status lines — running → done */}
        {message.tools?.map((t, i) => (
          <ToolStatusLine key={`${t.id ?? t.tool}-${i}`} tool={t} />
        ))}
        {/* Generated images, full-width in the bubble */}
        {message.images?.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden hover:opacity-95 transition-opacity"
            style={{
              border: '1px solid var(--paper-edge)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--paper)',
            }}
          >
            <img src={url} alt="Generated by VERA" className="w-full h-auto block" />
          </a>
        ))}
        {/* Assistant text */}
        {(message.content || message.pending) && (
          <div
            className="text-[14.5px] leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--ink)' }}
          >
            {message.content || (message.pending && <PendingDots />)}
            {message.content && message.pending && <Caret />}
          </div>
        )}
      </div>
    </div>
  )
}

// Inline tool-status line — shows running spinner OR done checkmark.
function ToolStatusLine({ tool }: { tool: ToolEvent }) {
  const isRunning = tool.status === 'running'
  const label = TOOL_LABELS[tool.tool] ?? tool.tool
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]"
      style={{
        background: 'var(--fog)',
        border: '1px solid var(--paper-edge)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--ink-quiet)',
      }}
    >
      {isRunning ? (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{
            background: 'var(--ink-quiet)',
            animation: 'vera-pulse 1.2s ease-in-out infinite',
          }}
        />
      ) : (
        <span
          className="inline-flex items-center justify-center w-3.5 h-3.5 flex-shrink-0"
          style={{ color: 'var(--ink)' }}
        >
          ✓
        </span>
      )}
      <span className="flex-1 min-w-0 truncate">
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{label}</span>
        {tool.message && <span className="ml-1.5" style={{ color: 'var(--ghost)' }}>· {tool.message}</span>}
      </span>
    </div>
  )
}

const TOOL_LABELS: Record<string, string> = {
  generate_infographic: 'Generating infographic',
  generate_image: 'Generating image',
  remember: 'Saving to memory',
}

function PendingDots() {
  return (
    <span className="inline-flex gap-1 items-center">
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </span>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full"
      style={{
        background: 'var(--mist)',
        animation: 'vera-pulse 1.2s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    />
  )
}

function Caret() {
  return (
    <span
      className="inline-block w-[2px] h-[15px] ml-0.5 align-text-bottom"
      style={{
        background: 'var(--ink)',
        animation: 'vera-pulse 0.9s ease-in-out infinite',
      }}
    />
  )
}
