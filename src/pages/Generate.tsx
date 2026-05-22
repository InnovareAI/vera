import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { useOrg } from '../lib/orgContext'

const ORCHESTRATOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kai-orchestrator`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

type AgentName =
  | 'Strategist'
  | 'Researcher'
  | 'Writer'
  | 'SEO Agent'
  | 'Persona Adapter'
  | 'Brand Guard'
  | 'Compliance'
  | 'Publisher'

interface Message {
  id: string
  role: 'user' | 'agent'
  agent?: AgentName
  content: string
  isStreaming?: boolean
}

const agentColors: Record<AgentName, string> = {
  Strategist: 'bg-violet-100 text-violet-700',
  Researcher: 'bg-sky-100 text-sky-700',
  Writer: 'bg-blue-100 text-blue-700',
  'SEO Agent': 'bg-indigo-100 text-indigo-700',
  'Persona Adapter': 'bg-pink-100 text-pink-700',
  'Brand Guard': 'bg-amber-100 text-amber-700',
  Compliance: 'bg-red-100 text-red-700',
  Publisher: 'bg-emerald-100 text-emerald-700',
}

const agentAvatars: Record<AgentName, string> = {
  Strategist: 'ST',
  Researcher: 'RS',
  Writer: 'WR',
  'SEO Agent': 'SE',
  'Persona Adapter': 'PA',
  'Brand Guard': 'BG',
  Compliance: 'CO',
  Publisher: 'PB',
}

// The always-visible pipeline agents — optional ones appear dynamically
const CORE_AGENTS: AgentName[] = ['Strategist', 'Writer', 'Brand Guard', 'Compliance', 'Publisher']

function parsePublisherMessage(content: string): {
  meta: Record<string, string>
  status: string
  postId: string | null
} {
  const lines = content.split('\n')
  const meta: Record<string, string> = {}
  let status = ''
  let postId: string | null = null

  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const val = line.slice(colonIdx + 1).trim()
      if (['Platform', 'Format', 'Hashtags', 'Suggested schedule'].some(k => key.includes(k))) {
        meta[key] = val
      }
    }
    if (line.includes('✅ Saved')) {
      const idMatch = line.match(/ID: ([a-f0-9-]+)/i)
      if (idMatch) postId = idMatch[1]
    }
    if (line.includes('⚠️') || line.includes('All checks passed')) {
      status += (status ? '\n' : '') + line.trim()
    }
  }
  return { meta, status, postId }
}

function PublisherBubble({ message }: { message: Message }) {
  if (message.isStreaming) {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-emerald-100 text-emerald-700">PB</div>
        <div className="flex-1 max-w-2xl">
          <p className="text-[11px] font-semibold mb-1 text-emerald-700">Publisher</p>
          <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700 shadow-sm whitespace-pre-wrap">
            <span>{message.content}<span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse rounded" /></span>
          </div>
        </div>
      </div>
    )
  }

  const { meta, status, postId } = parsePublisherMessage(message.content)
  const hasIssues = status.includes('⚠️')

  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-emerald-100 text-emerald-700">PB</div>
      <div className="flex-1 max-w-2xl">
        <p className="text-[11px] font-semibold mb-1 text-emerald-700">Publisher</p>
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
          <div className="px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {Object.entries(meta).map(([k, v]) => (
                <div key={k}>
                  <span className="text-gray-400">{k}: </span>
                  <span className="text-gray-700 font-medium">{v}</span>
                </div>
              ))}
            </div>
            {status && (
              <div className={`text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-pre-wrap ${hasIssues ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {status}
              </div>
            )}
            {postId && (
              <p className="text-[11px] text-gray-400">
                Post ID: {postId} · <a href={`/review/${postId}`} className="text-violet-500 hover:underline">Go to Review →</a>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentBubble({ message }: { message: Message }) {
  const agent = message.agent as AgentName
  if (agent === 'Publisher') return <PublisherBubble message={message} />

  const colors = agentColors[agent] ?? 'bg-gray-100 text-gray-600'
  const avatar = agentAvatars[agent] ?? agent.slice(0, 2).toUpperCase()
  const textColor = colors.split(' ')[1]

  return (
    <div className="flex gap-3 items-start">
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${colors}`}>
        {avatar}
      </div>
      <div className="flex-1 max-w-2xl">
        <p className={`text-[11px] font-semibold mb-1 ${textColor}`}>{agent}</p>
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700 leading-relaxed shadow-sm whitespace-pre-wrap">
          {message.isStreaming ? (
            <span>{message.content}<span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse rounded" /></span>
          ) : message.content}
        </div>
      </div>
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-xl bg-gray-900 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed">
        {content}
      </div>
    </div>
  )
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'agent',
  agent: 'Strategist',
  content: "Hi! I'm your content team. Tell me what you need — a post, a thread, a Quora answer — and we'll create it together. Just describe what you want and I'll brief the team.",
}

async function runAgentPipeline(
  prompt: string,
  orgId: string | undefined,
  onChunk: (agent: AgentName, chunk: string, done: boolean) => void
) {
  const response = await fetch(ORCHESTRATOR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ prompt, org_id: orgId }),
  })

  if (!response.ok) {
    throw new Error(`Orchestrator error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw) continue

      try {
        const event = JSON.parse(raw)
        if (event.error) {
          console.error('Pipeline error:', event.error)
          onChunk('Strategist', `Error: ${event.error}`, true)
          return
        }
        if (event.agent && event.chunk !== undefined) {
          onChunk(event.agent as AgentName, event.chunk, event.done ?? false)
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

export default function Generate() {
  const { activeOrg } = useOrg()
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [activeAgents, setActiveAgents] = useState<AgentName[]>(CORE_AGENTS)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isRunning) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsRunning(true)
    setActiveAgents(CORE_AGENTS)

    let currentAgent: AgentName | null = null
    let currentId: string | null = null

    try {
      await runAgentPipeline(input, activeOrg?.id, (agent, chunk, done) => {
        // Reveal optional agents as they appear
        if (!CORE_AGENTS.includes(agent)) {
          setActiveAgents(prev => prev.includes(agent) ? prev : [...prev, agent])
        }

        if (agent !== currentAgent) {
          currentAgent = agent
          currentId = Date.now().toString() + agent
          setMessages(prev => [...prev, {
            id: currentId!,
            role: 'agent',
            agent,
            content: chunk,
            isStreaming: !done,
          }])
        } else {
          setMessages(prev => prev.map(m =>
            m.id === currentId ? { ...m, content: chunk, isStreaming: !done } : m
          ))
        }
      })
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'agent',
        agent: 'Strategist',
        content: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
        isStreaming: false,
      }])
    }

    setIsRunning(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white flex items-center gap-3">
        <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
          <Sparkles size={14} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Generate</h1>
          <p className="text-xs text-gray-400">Your AI content team — Strategist · Researcher · Writer · SEO · Persona · Brand Guard · Compliance · Publisher</p>
        </div>
      </div>

      {/* Agent team pills — show core + any active optional agents */}
      <div className="px-8 py-3 border-b border-gray-100 bg-white flex gap-2 flex-wrap">
        {activeAgents.map(a => (
          <span key={a} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${agentColors[a]}`}>{a}</span>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.map(msg =>
          msg.role === 'user'
            ? <UserBubble key={msg.id} content={msg.content} />
            : <AgentBubble key={msg.id} message={msg} />
        )}
        {isRunning && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 items-center">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
              <Loader2 size={12} className="text-violet-600 animate-spin" />
            </div>
            <span className="text-sm text-gray-400">Team is working...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-gray-100 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Tell the team what to create… e.g. 'LinkedIn post about SAM's HITL feature for VP of Sales'"
            disabled={isRunning}
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent disabled:opacity-50 bg-gray-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isRunning}
            className="bg-gray-900 text-white rounded-xl px-4 py-3 hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            <Send size={15} />
          </button>
        </form>
        <p className="text-[11px] text-gray-400 mt-2 text-center">Generated content is saved as pending and routed to Review for approval.</p>
      </div>
    </div>
  )
}
