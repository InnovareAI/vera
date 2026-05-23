// VERA permanent chat — right rail across the entire app.
//
// v1: UI shell only. Stub responder so we can iterate on the spatial
// design before committing backend architecture. Real `vera-chat` edge
// function + chat_messages table land in the next pass.
//
// Behavior:
//   - 380px fixed right rail, paper-warm background
//   - Always visible (Claude.ai pattern); can be collapsed to 48px
//   - Knows the current route via useLocation; future hook for context-
//     aware prompts ("you're on /review — want me to pull the queue?")
//   - ⌘J / Ctrl+J focuses the composer from anywhere
//   - ⌘↩ sends; ↩ inserts newline (standard chat convention)

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowUp, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  // Future: tool_calls, route_context, attachments
}

// Stubbed responder. Returns a canned line based on intent so we can
// evaluate the chat layout without a backend. Replaced by SSE call to
// vera-chat in the next pass.
function stubRespond(input: string, route: string): string {
  const lower = input.toLowerCase().trim()
  if (/^(hi|hey|hello|yo)\b/.test(lower)) {
    return "Hi. What are you working on?"
  }
  if (lower.includes('pending') || lower.includes('review queue')) {
    return "You have 4 posts pending review — oldest is 3 days old. Want me to pull them up?"
  }
  if (lower.includes('audit') || lower.includes('score')) {
    return "Last brew360 ran Sunday — score 76 (B). Profile score: 81. Want me to walk through what shifted?"
  }
  if (lower.includes('draft') || lower.includes('write') || lower.includes('post')) {
    return "Happy to. Want me to open the full brief workshop on /generate, or sketch a quick draft right here?"
  }
  return `(stub) Heard. I'm a UI shell right now — real brain lands once the chat panel is wired to the vera-chat edge function. You're on ${route}.`
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const location = useLocation()

  // Auto-scroll to bottom whenever a new message lands
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  // ⌘J / Ctrl+J focuses the composer from anywhere
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

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || thinking) return
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setInput('')
    setThinking(true)
    // Stub latency to feel realistic; replace with SSE stream from
    // vera-chat in v2.
    setTimeout(() => {
      const reply: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: stubRespond(text, location.pathname),
      }
      setMessages(m => [...m, reply])
      setThinking(false)
    }, 450 + Math.random() * 350)
  }, [input, thinking, location.pathname])

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
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ghost)' }}>
            Always here · ⌘J
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
        {messages.length === 0 ? (
          <EmptyState onSuggest={s => { setInput(s); textareaRef.current?.focus() }} />
        ) : (
          <div className="space-y-4">
            {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            {thinking && <ThinkingBubble />}
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
            placeholder="Ask VERA anything…"
            className="flex-1 resize-none outline-none bg-transparent text-[13.5px] leading-relaxed"
            style={{ color: 'var(--ink)', maxHeight: 200 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking}
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
          className="max-w-[85%] px-3 py-2 text-[13.5px] leading-relaxed"
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
        {message.content}
      </div>
    </div>
  )
}

// ─── Thinking indicator ─────────────────────────────────────────────────────
function ThinkingBubble() {
  return (
    <div className="flex gap-2.5 items-center">
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
      <div className="flex gap-1 items-center" style={{ color: 'var(--mist)' }}>
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
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
