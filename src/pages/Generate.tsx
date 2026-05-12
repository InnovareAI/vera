import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { airtableCreate } from '../lib/airtable'

type AgentName = 'Strategist' | 'Writer' | 'Brand Guard' | 'Publisher'

interface Message {
  id: string
  role: 'user' | 'agent'
  agent?: AgentName
  content: string
  isStreaming?: boolean
}

const agentColors: Record<AgentName, string> = {
  Strategist: 'bg-violet-100 text-violet-700',
  Writer: 'bg-blue-100 text-blue-700',
  'Brand Guard': 'bg-amber-100 text-amber-700',
  Publisher: 'bg-emerald-100 text-emerald-700',
}

const agentAvatars: Record<AgentName, string> = {
  Strategist: 'ST',
  Writer: 'WR',
  'Brand Guard': 'BG',
  Publisher: 'PB',
}

function AgentBubble({ message }: { message: Message }) {
  const agent = message.agent as AgentName
  return (
    <div className="flex gap-3 items-start">
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${agentColors[agent]}`}>
        {agentAvatars[agent]}
      </div>
      <div className="flex-1 max-w-2xl">
        <p className={`text-[11px] font-semibold mb-1 ${agentColors[agent].split(' ')[1]}`}>{agent}</p>
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700 leading-relaxed shadow-sm">
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

// Simulate agentic pipeline
async function runAgentPipeline(
  _prompt: string,
  onChunk: (agent: AgentName, chunk: string, done: boolean) => void
) {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  // Strategist
  const strategistText = `Got it. Breaking this down: we're writing for the **Solo Founder Outbounder** persona — someone who's wearing all hats and hasn't hired an SDR yet. Platform: LinkedIn. Angle: "I ran the math on hiring vs. deploying SAM." Handing to Writer.`
  for (let i = 0; i < strategistText.length; i += 3) {
    await delay(25)
    onChunk('Strategist', strategistText.slice(0, i + 3), i + 3 >= strategistText.length)
  }

  await delay(400)

  // Writer
  const writerText = `Here's the draft:\n\n---\nI was about to hire my first SDR.\n\nThen I ran the math.\n\nAn SDR costs €60–80k/year. 3 months to ramp. Another 2 months before they're hitting quota. And you're still spending 10 hours a week managing them.\n\nInstead, I deployed SAM.\n\n12 autonomous agents. Running 24/7. Handling prospecting, outreach, reply classification, and follow-up sequencing — while I focus on closing.\n\nHe doesn't call in sick. He doesn't need onboarding.\nHe doesn't ask for a raise.\n\nFirst week: 340 personalised messages sent. 23 positive replies. 4 demo calls booked.\n\nStop buying tools. Start hiring a manager.\n\nWant to see what a week of SAM looks like? Drop a comment or DM me.\n---`
  for (let i = 0; i < writerText.length; i += 4) {
    await delay(18)
    onChunk('Writer', writerText.slice(0, i + 4), i + 4 >= writerText.length)
  }

  await delay(400)

  // Brand Guard
  const brandText = `Brand check ✓\n\n• SAM referred to as "he" ✓\n• Positioning as "AI Sales Manager" not "AI SDR" ✓\n• "Stop buying tools, start hiring a manager" line used ✓\n• No client names disclosed ✓\n• Tone: direct, no fluff, short paragraphs ✓\n\nOne suggestion: opening line punches harder without the setup. Consider leading with "I ran the math on hiring my first SDR." — but current version is approved.`
  for (let i = 0; i < brandText.length; i += 3) {
    await delay(22)
    onChunk('Brand Guard', brandText.slice(0, i + 3), i + 3 >= brandText.length)
  }

  await delay(400)

  // Publisher
  const publisherText = `Saving to Airtable as a Draft Post linked to the "The Agentic Edge: Q2 Thought Leadership" campaign.\n\n📋 Platform: LinkedIn\n📅 Suggested schedule: Tomorrow morning, 08:00–09:00 CET (peak engagement for B2B)\n#️⃣ Hashtags: #AIinSales #B2BSales #SalesAutomation #AgenticAI\n\nHead to Review to approve and schedule.`
  for (let i = 0; i < publisherText.length; i += 3) {
    await delay(22)
    onChunk('Publisher', publisherText.slice(0, i + 3), i + 3 >= publisherText.length)
  }

  // Save to Airtable
  try {
    await airtableCreate('Posts', {
      'Post Title': 'Stop hiring SDRs. Start hiring a manager.',
      'Platform': 'LinkedIn',
      'Content Type': 'Thought Leadership',
      'Copy': `I was about to hire my first SDR.\n\nThen I ran the math.\n\nAn SDR costs €60–80k/year. 3 months to ramp. Another 2 months before they're hitting quota. And you're still spending 10 hours a week managing them.\n\nInstead, I deployed SAM.\n\n12 autonomous agents. Running 24/7. Handling prospecting, outreach, reply classification, and follow-up sequencing — while I focus on closing.\n\nHe doesn't call in sick. He doesn't need onboarding. He doesn't ask for a raise.\n\nFirst week: 340 personalised messages sent. 23 positive replies. 4 demo calls booked.\n\nStop buying tools. Start hiring a manager.\n\nWant to see what a week of SAM looks like? Drop a comment or DM me.`,
      'Hashtags': '#AIinSales #B2BSales #SalesAutomation #AgenticAI',
      'Status': 'Draft',
    })
  } catch (e) {
    console.warn('Airtable save failed (API key not set):', e)
  }
}

export default function Generate() {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
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

    let currentAgent: AgentName | null = null
    let currentId: string | null = null

    await runAgentPipeline(input, (agent, chunk, done) => {
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
          <p className="text-xs text-gray-400">Your AI content team — Strategist · Writer · Brand Guard · Publisher</p>
        </div>
      </div>

      {/* Agent team pills */}
      <div className="px-8 py-3 border-b border-gray-100 bg-white flex gap-2">
        {(['Strategist', 'Writer', 'Brand Guard', 'Publisher'] as AgentName[]).map(a => (
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
        <p className="text-[11px] text-gray-400 mt-2 text-center">Generated content is saved to Airtable as a Draft and routed to Review for approval.</p>
      </div>
    </div>
  )
}
