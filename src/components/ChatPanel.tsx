// VERA permanent chat — right rail across the entire app.
//
// Layout: 380px expanded / 48px collapsed. Always visible on authenticated
// pages. ⌘J focuses composer from anywhere.
//
// Backend: streams from /functions/v1/vera-chat (SSE). History is persisted
// to chat_messages, loaded on mount for the active workspace. The frontend
// owns the in-flight buffer; the edge function writes user+assistant turns
// to disk as they happen so refreshes don't lose anything.

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowUp, PanelRightClose, PanelRightOpen, Sparkles, Square } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useAuth } from '../lib/auth'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean  // true while streaming
}

const HISTORY_LIMIT = 50

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const location = useLocation()
  const { activeOrg } = useOrg()
  const { user } = useAuth()

  // Load thread history when the workspace changes. Newest messages on the
  // bottom, so we order ascending after fetching the latest N descending.
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

  // Auto-scroll on new content
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // ⌘J / Ctrl+J focuses composer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setCollapsed(false)
        setTimeout(() => textareaRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-grow textarea
  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
  }, [input])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !activeOrg?.id) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', pending: true }

    // Optimistic append — both user turn and an empty assistant bubble that
    // will fill in as SSE chunks arrive.
    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, placeholder])
    setInput('')
    setStreaming(true)

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

        // SSE frames: lines starting with `data: ` separated by blank lines.
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
            // `done` is a signal, no extra payload needed for UI
          } catch (parseErr) {
            console.warn('vera-chat: bad SSE frame', line, parseErr)
          }
        }
      }

      // Flush final state — strip the pending flag
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, pending: false } : m,
      ))
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User-initiated cancel — keep whatever streamed
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
  }, [input, streaming, activeOrg?.id, messages, user?.id, location.pathname])

  function stop() {
    abortRef.current?.abort()
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
  }

  // ─── Collapsed (48px rail) ────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex-shrink-0 flex flex-col items-center py-3 gap-3"
        style={{
          width: 48,
          background: 'var(--paper-warm)',
          borderLeft: '1px solid var(--paper-edge)',
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--fog)] transition-colors"
          style={{ borderRadius: 'var(--radius-md)', color: 'var(--ink-quiet)' }}
          title="Open VERA (⌘J)"
        >
          <PanelRightOpen size={15} strokeWidth={1.75} />
        </button>
        <div
          className="w-7 h-7 flex items-center justify-center text-[12px] font-semibold"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper-warm)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          V
        </div>
      </aside>
    )
  }

  // ─── Expanded panel (380px) ───────────────────────────────────────────────
  return (
    <aside
      className="flex-shrink-0 flex flex-col"
      style={{
        width: 380,
        background: 'var(--paper-warm)',
        borderLeft: '1px solid var(--paper-edge)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-2.5"
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
            {activeOrg?.name ? `${activeOrg.name} · ⌘J` : 'Pick a workspace · ⌘J'}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="w-7 h-7 flex items-center justify-center hover:bg-[var(--fog)] transition-colors"
          style={{ borderRadius: 'var(--radius-sm)', color: 'var(--ghost)' }}
          title="Collapse"
        >
          <PanelRightClose size={14} strokeWidth={1.75} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!historyLoaded ? (
          <div className="h-full flex items-center justify-center text-[12px]" style={{ color: 'var(--mist)' }}>
            Loading thread…
          </div>
        ) : messages.length === 0 ? (
          <EmptyState onSuggest={s => { setInput(s); textareaRef.current?.focus() }} />
        ) : (
          <div className="space-y-4">
            {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--paper-edge)' }}>
        <div
          className="flex items-end gap-2 px-3 py-2"
          style={{
            background: 'var(--paper)',
            border: '1px solid var(--paper-edge)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onComposerKey}
            rows={1}
            placeholder={activeOrg ? 'Ask VERA anything…' : 'Pick a workspace to start'}
            disabled={!activeOrg}
            className="flex-1 resize-none outline-none bg-transparent text-[13.5px] leading-relaxed disabled:opacity-50"
            style={{ color: 'var(--ink)', maxHeight: 200 }}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="w-7 h-7 flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-90"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper-warm)',
                borderRadius: '50%',
              }}
              title="Stop"
            >
              <Square size={11} strokeWidth={2.5} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() || !activeOrg}
              className="w-7 h-7 flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-30 hover:opacity-90"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper-warm)',
                borderRadius: '50%',
              }}
              title="Send (⌘↩)"
            >
              <ArrowUp size={14} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[10.5px]" style={{ color: 'var(--mist)' }}>
          ⌘↩ to send · ↩ for newline
        </div>
      </div>
    </aside>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────────
function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  const suggestions = [
    "What's pending review?",
    'Summarize this week',
    'Draft a LinkedIn post about agentic AI',
  ]
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
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
      <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
        Hi, I'm VERA.
      </p>
      <p className="text-[12.5px] leading-relaxed mb-5 max-w-[260px]" style={{ color: 'var(--ghost)' }}>
        Your creative partner. Ask me anything about what's in the queue, what
        to write next, or just bounce ideas.
      </p>
      <div className="w-full space-y-1.5">
        {suggestions.map(s => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-[var(--fog)] transition-colors"
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--paper-edge)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--ink-quiet)',
            }}
          >
            <Sparkles size={12} strokeWidth={1.75} style={{ color: 'var(--mist)' }} />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap"
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
    <div className="flex gap-2.5">
      <div
        className="w-6 h-6 flex items-center justify-center text-[11px] font-semibold flex-shrink-0 mt-0.5"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper-warm)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        V
      </div>
      <div
        className="flex-1 text-[13.5px] leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--ink)' }}
      >
        {message.content || (message.pending && <PendingDots />)}
        {message.content && message.pending && <Caret />}
      </div>
    </div>
  )
}

// Three pulsing dots while waiting for the first token
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
      className="inline-block w-1 h-1 rounded-full"
      style={{
        background: 'var(--mist)',
        animation: 'vera-pulse 1.2s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    />
  )
}

// Blinking caret tail while still streaming
function Caret() {
  return (
    <span
      className="inline-block w-[2px] h-[14px] ml-0.5 align-text-bottom"
      style={{
        background: 'var(--ink)',
        animation: 'vera-pulse 0.9s ease-in-out infinite',
      }}
    />
  )
}
