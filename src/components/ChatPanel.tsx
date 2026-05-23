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
import { useAuth } from '../lib/auth'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

type Mode = 'minimized' | 'default' | 'fullscreen'

const HISTORY_LIMIT = 50
const MODE_HEIGHTS: Record<Mode, string> = {
  minimized: '64px',
  default: '60vh',
  fullscreen: '100%',
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [mode, setMode] = useState<Mode>('fullscreen')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const location = useLocation()
  const { activeOrg } = useOrg()
  const { user } = useAuth()

  // Load thread on workspace switch
  useEffect(() => {
    if (!activeOrg?.id) {
      setMessages([])
      setHistoryLoaded(true)
      return
    }
    let cancelled = false
    setHistoryLoaded(false)
    supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('org_id', activeOrg.id)
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
  }, [activeOrg?.id])

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

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !activeOrg?.id) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', pending: true }

    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, placeholder])
    setInput('')
    setStreaming(true)
    if (mode === 'minimized') setMode('default')  // surface the reply

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      const res = await fetch(`${supabaseUrl}/functions/v1/vera-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          org_id: activeOrg.id,
          user_id: user?.id ?? null,
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
  }, [input, streaming, activeOrg?.id, messages, user?.id, location.pathname, mode])

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
            <EmptyState onSuggest={s => { setInput(s); textareaRef.current?.focus() }} />
          ) : (
            <div className="max-w-4xl mx-auto space-y-5">
              {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            </div>
          )}
        </div>
      )}

      {/* Composer — always visible, the constant. Larger when chat is big. */}
      <div
        className="px-5 py-3 flex-shrink-0"
        style={!isMin ? { borderTop: '1px solid var(--paper-edge)' } : {}}
      >
        <div className="max-w-4xl mx-auto">
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
function EmptyState({ onSuggest: _onSuggest }: { onSuggest: (text: string) => void }) {
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
      <div
        className="flex-1 min-w-0 text-[14.5px] leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--ink)' }}
      >
        {message.content || (message.pending && <PendingDots />)}
        {message.content && message.pending && <Caret />}
      </div>
    </div>
  )
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
