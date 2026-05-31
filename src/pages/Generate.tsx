import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Send, Sparkles, Loader2, Check, RefreshCw, Pencil, ChevronDown, ChevronRight, ExternalLink, X,
} from 'lucide-react'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { supabase } from '../lib/supabase'
import type { Audience, Post } from '../lib/supabase'

interface Campaign {
  id: string
  name: string
  theme: string | null
  status: string
  is_pinned: boolean
  start_date: string | null
  end_date: string | null
}

const ORCHESTRATOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vera-orchestrator`
const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

type AgentName =
  | 'VERA' | 'Strategist' | 'Researcher' | 'Writer' | 'SEO Agent'
  | 'Persona Adapter' | 'Brand Guard' | 'Compliance' | 'Publisher'

// The pipeline runs 8 specialist agents. The user shouldn't have to think
// about any of them — so each maps to a single plain-language line we show
// in the calm "working" state. The raw agent output is still available
// behind the "Show VERA's thinking" reveal for anyone who wants it.
const STEP_CAPTION: Record<AgentName, string> = {
  VERA: 'Getting started…',
  Strategist: 'Planning the angle',
  Researcher: 'Gathering supporting facts',
  Writer: 'Writing the draft',
  'SEO Agent': 'Tuning for search',
  'Persona Adapter': 'Tailoring it to your audience',
  'Brand Guard': 'Checking it against your brand voice',
  Compliance: 'Reviewing for compliance',
  Publisher: 'Finishing up',
}

type Phase = 'idle' | 'working' | 'result' | 'error'

// ─── Pipeline runner — unchanged transport, just hands chunks to a callback ──
async function runAgentPipeline(
  prompt: string,
  orgId: string | undefined,
  campaignId: string | null,
  audienceId: string | null,
  onChunk: (agent: AgentName, chunk: string, done: boolean) => void,
) {
  const response = await fetch(ORCHESTRATOR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ prompt, org_id: orgId, campaign_id: campaignId, audience_id: audienceId }),
  })
  if (!response.ok) throw new Error(`Orchestrator error: ${response.status} ${response.statusText}`)

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
        if (event.error) throw new Error(event.error)
        if (event.agent && event.chunk !== undefined) {
          onChunk(event.agent as AgentName, event.chunk, event.done ?? false)
        }
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes('JSON')) throw e
        // ignore malformed SSE lines
      }
    }
  }
}

export default function Generate() {
  const { activeOrg } = useOrg()
  const { activeProject, projects, switchProject } = useProject()
  const [searchParams] = useSearchParams()

  const [phase, setPhase] = useState<Phase>('idle')
  const [input, setInput] = useState('')
  const [submittedBrief, setSubmittedBrief] = useState('')
  const [currentStep, setCurrentStep] = useState<AgentName>('VERA')
  const [agentLog, setAgentLog] = useState<Partial<Record<AgentName, string>>>({})
  const [showThinking, setShowThinking] = useState(false)
  const [result, setResult] = useState<Post | null>(null)
  const [draftCopy, setDraftCopy] = useState('')   // live writer text, shown before the saved post resolves
  const [errorMsg, setErrorMsg] = useState('')

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Deep-link from /intel — pre-fill the brief with a counter-positioning prompt.
  useEffect(() => {
    const intelId = searchParams.get('intel')
    if (!intelId) return
    supabase.from('competitor_events')
      .select(`kind, source_url, title, summary, detected_at, competitor:competitor_id ( name, website_url )`)
      .eq('id', intelId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const ev = data as Record<string, unknown>
        const competitor = ev.competitor as { name?: string; website_url?: string } | null
        const lines = [
          `Competitor intel — react to this ${(ev.kind as string)?.replace('_', ' ')}.`,
          ``,
          `Competitor: ${competitor?.name ?? 'unknown'} (${competitor?.website_url ?? ''})`,
          `URL: ${ev.source_url}`,
          ev.title ? `Title: ${ev.title}` : null,
          ev.summary ? `Summary: ${ev.summary}` : null,
          ``,
          `Write a post that calls out the weakest claim in their pitch and reinforces our differentiator. Don't mention them by name — just sharpen the contrast.`,
        ].filter(Boolean).join('\n')
        setInput(lines)
      })
  }, [searchParams])

  // Context loads quietly in the background. The user never has to touch it —
  // VERA picks sensible defaults (pinned active campaign, primary audience)
  // inside the load callback, so the default-pick rides along with the data
  // instead of in a second self-referential effect.
  useEffect(() => {
    if (!activeOrg?.id) return   // org→org switch refreshes via .then; org→null unmounts the page
    supabase.from('campaigns')
      .select('id, name, theme, status, is_pinned, start_date, end_date')
      .eq('org_id', activeOrg.id)
      .in('status', ['active', 'draft', 'planned'])
      .order('is_pinned', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        const list = (data as Campaign[]) ?? []
        setCampaigns(list)
        // Default to the pinned active campaign — but never override a
        // choice the user has already made (prev !== null).
        setSelectedCampaignId(prev => prev ?? (list.find(c => c.is_pinned && c.status === 'active')?.id ?? null))
      })
  }, [activeOrg?.id])

  useEffect(() => {
    if (!activeOrg?.id) return   // see campaigns effect — no synchronous clear needed
    supabase.from('audiences').select('*')
      .eq('org_id', activeOrg.id)
      .order('is_primary', { ascending: false })
      .order('kind', { ascending: true })
      .then(({ data }) => {
        const list = (data as Audience[]) ?? []
        setAudiences(list)
        // Primary buyer persona is the most specific reader; fall back to any
        // primary, then the first audience. Don't override an explicit pick.
        const primaryBuyer = list.find(a => a.kind === 'buyer_persona' && a.is_primary)
        const fallback = list.find(a => a.is_primary) ?? list[0]
        const def = primaryBuyer?.id ?? fallback?.id ?? null
        setSelectedAudienceId(prev => prev ?? def)
      })
  }, [activeOrg?.id])

  const campaignName = campaigns.find(c => c.id === selectedCampaignId)?.name ?? null
  const audienceName = audiences.find(a => a.id === selectedAudienceId)?.name ?? null

  async function generate(brief: string) {
    setPhase('working')
    setSubmittedBrief(brief)
    setAgentLog({})
    setShowThinking(false)
    setResult(null)
    setDraftCopy('')
    setCurrentStep('VERA')
    setErrorMsg('')

    try {
      await runAgentPipeline(brief, activeOrg?.id, selectedCampaignId, selectedAudienceId, (agent, chunk) => {
        setCurrentStep(agent)
        setAgentLog(prev => ({ ...prev, [agent]: chunk }))
        if (agent === 'Writer') setDraftCopy(chunk)
      })

      // The orchestrator just saved the post as 'pending'. Fetch the freshly
      // created record so the result card has a real id (needed to approve)
      // plus the canonical copy, image, hashtags, and channel.
      let saved: Post | null = null
      if (activeOrg?.id) {
        const { data } = await supabase
          .from('content_posts').select('*')
          .eq('org_id', activeOrg.id)
          .order('created_at', { ascending: false })
          .limit(1)
        saved = (data?.[0] as Post) ?? null
      }
      setResult(saved)
      setPhase('result')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || phase === 'working') return
    generate(input.trim())
  }

  function reset() {
    setPhase('idle')
    setInput('')
    setResult(null)
    setDraftCopy('')
    setAgentLog({})
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  useRightRail(
    <GenerateRail
      phase={phase}
      currentStep={currentStep}
      projectName={activeProject?.name ?? null}
      campaignName={campaignName}
      audienceName={audienceName}
    />,
    [phase, currentStep, activeProject?.id, campaignName, audienceName],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header — quiet, single line. No agent roster on display. */}
      <div className="px-8 py-5 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--paper-edge)', background: 'var(--paper-warm)' }}>
        <div className="w-7 h-7 flex items-center justify-center"
          style={{ background: 'var(--fog)', borderRadius: 'var(--radius-md)' }}>
          <Sparkles size={14} style={{ color: 'var(--ink-quiet)' }} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Create</h1>
          <p className="text-[12px]" style={{ color: 'var(--ghost)' }}>
            Tell VERA what you need. She drafts it, checks it, and brings it back for your approval.
          </p>
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {phase === 'idle' && <IdleHint onPick={(s) => { setInput(s); inputRef.current?.focus() }} />}

          {phase !== 'idle' && (
            <div className="mb-6">
              <p className="text-[11px] font-medium uppercase mb-2" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
                Your brief
              </p>
              <div className="px-4 py-3 text-[14px] whitespace-pre-wrap"
                style={{ background: 'var(--fog)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-md)' }}>
                {submittedBrief}
              </div>
            </div>
          )}

          {phase === 'working' && (
            <WorkingState
              currentStep={currentStep}
              draftCopy={draftCopy}
              showThinking={showThinking}
              setShowThinking={setShowThinking}
              agentLog={agentLog}
            />
          )}

          {phase === 'result' && (
            <ResultCard
              result={result}
              draftCopy={draftCopy}
              agentLog={agentLog}
              showThinking={showThinking}
              setShowThinking={setShowThinking}
              onRegenerate={() => generate(submittedBrief)}
              onUpdateCopy={(copy) => setResult(prev => prev ? { ...prev, copy } : prev)}
              onApproved={(post) => setResult(post)}
              onReset={reset}
            />
          )}

          {phase === 'error' && (
            <div className="px-4 py-4 text-[14px]"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 'var(--radius-md)' }}>
              <p className="font-medium mb-1">Something went wrong.</p>
              <p className="text-[13px] mb-3" style={{ opacity: 0.85 }}>{errorMsg}</p>
              <button onClick={() => generate(submittedBrief)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
                style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
                <RefreshCw size={12} /> Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Composer — only the input matters. Context is one quiet line below it. */}
      <div className="px-8 py-5" style={{ borderTop: '1px solid var(--paper-edge)', background: 'var(--paper)' }}>
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div className="relative" style={{
            background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '4px',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 200) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim() && phase !== 'working') handleSubmit(e as unknown as React.FormEvent)
                }
              }}
              rows={2}
              placeholder="What should VERA create? e.g. “a LinkedIn post about why most onboarding flows lose users in week one”"
              disabled={phase === 'working'}
              className="w-full px-5 py-4 text-[15px] leading-relaxed outline-none disabled:opacity-50 resize-none"
              style={{
                background: 'transparent', color: 'var(--ink)', fontFamily: 'var(--font-body)',
                minHeight: '68px', maxHeight: '200px',
              }}
            />
            <div className="flex items-center justify-between gap-3 px-4 py-2.5"
              style={{ borderTop: '1px solid var(--paper-edge)' }}>
              <ContextBar
                projects={projects}
                activeProjectSlug={activeProject?.slug ?? null}
                onSwitchProject={switchProject}
                campaigns={campaigns}
                selectedCampaignId={selectedCampaignId}
                setSelectedCampaignId={setSelectedCampaignId}
                audiences={audiences}
                selectedAudienceId={selectedAudienceId}
                setSelectedAudienceId={setSelectedAudienceId}
                disabled={phase === 'working'}
              />
              <button type="submit" disabled={!input.trim() || phase === 'working'}
                title="Send to VERA — Enter (Shift+Enter for a new line)"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium transition-all disabled:opacity-40 flex-shrink-0"
                style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
                {phase === 'working' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {phase === 'working' ? 'Working' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Idle hint — what to do, plus a few starting points ───────────────────
function IdleHint({ onPick }: { onPick: (s: string) => void }) {
  const examples = [
    'A LinkedIn post on a lesson we learned shipping fast',
    'A short newsletter intro about our new feature',
    'A contrarian take on a trend in our industry',
  ]
  return (
    <div className="text-center py-10">
      <div className="w-12 h-12 mx-auto flex items-center justify-center mb-4"
        style={{ background: 'var(--fog)', borderRadius: 'var(--radius-lg)' }}>
        <Sparkles size={20} style={{ color: 'var(--ink-quiet)' }} strokeWidth={1.5} />
      </div>
      <h2 className="text-[18px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
        What should we make?
      </h2>
      <p className="text-[13.5px] mb-6 max-w-md mx-auto" style={{ color: 'var(--ghost)' }}>
        Describe it in a sentence. VERA figures out the platform, angle, and format for you —
        you just approve the result.
      </p>
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        {examples.map(ex => (
          <button key={ex} onClick={() => onPick(ex)}
            className="text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-[var(--fog)]"
            style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-md)' }}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Working state — one calm line, not eight streaming bubbles ────────────
function WorkingState({
  currentStep, draftCopy, showThinking, setShowThinking, agentLog,
}: {
  currentStep: AgentName
  draftCopy: string
  showThinking: boolean
  setShowThinking: (v: boolean) => void
  agentLog: Partial<Record<AgentName, string>>
}) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-4"
        style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}>
        <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color: 'var(--ink-quiet)' }} />
        <div className="flex-1">
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>VERA is on it</p>
          <p className="text-[12.5px]" style={{ color: 'var(--ghost)' }}>{STEP_CAPTION[currentStep] ?? 'Working…'}</p>
        </div>
      </div>

      {/* As soon as the Writer starts, show the draft taking shape — that's
          the part the user actually cares about. */}
      {draftCopy && (
        <div className="mt-4 px-5 py-4 text-[14px] leading-relaxed whitespace-pre-wrap"
          style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-lg)' }}>
          {draftCopy}
          <span className="inline-block w-1 h-4 ml-0.5 animate-pulse rounded align-middle" style={{ background: 'var(--mist)' }} />
        </div>
      )}

      <ThinkingReveal show={showThinking} setShow={setShowThinking} agentLog={agentLog} />
    </div>
  )
}

// ─── Result — see it, tweak it, approve it. All in one place. ──────────────
function ResultCard({
  result, draftCopy, agentLog, showThinking, setShowThinking, onRegenerate, onUpdateCopy, onApproved, onReset,
}: {
  result: Post | null
  draftCopy: string
  agentLog: Partial<Record<AgentName, string>>
  showThinking: boolean
  setShowThinking: (v: boolean) => void
  onRegenerate: () => void
  onUpdateCopy: (copy: string) => void
  onApproved: (post: Post) => void
  onReset: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editCopy, setEditCopy] = useState('')
  const [busy, setBusy] = useState<'approve' | 'save' | null>(null)

  const copy = result?.copy ?? draftCopy
  const channel = result?.channel ?? null
  const format = result?.format ?? null
  const hashtags = result?.hashtags ?? []
  const mediaUrl = result?.media_url ?? null
  const approved = result?.status === 'approved' || result?.status === 'Approved'

  async function approve() {
    if (!result?.id) return
    setBusy('approve')
    try {
      const res = await fetch(APPROVAL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ post_id: result.id, action: 'approved' }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.post) onApproved(data.post as Post)
      else onApproved({ ...result, status: 'approved' })
    } catch {
      onApproved({ ...result, status: 'approved' })
    }
    setBusy(null)
  }

  async function saveEdit() {
    if (!result?.id) { onUpdateCopy(editCopy); setEditing(false); return }
    setBusy('save')
    const { error } = await supabase.from('content_posts').update({ copy: editCopy }).eq('id', result.id)
    if (!error) onUpdateCopy(editCopy)
    setBusy(null)
    setEditing(false)
  }

  return (
    <div>
      {/* Meta line */}
      <div className="flex items-center gap-2 mb-3">
        {channel && (
          <span className="text-[11px] font-medium px-2 py-0.5" style={{ background: 'var(--fog)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-sm)' }}>
            {channel}
          </span>
        )}
        {format && (
          <span className="text-[11px] px-2 py-0.5" style={{ background: 'var(--fog)', color: 'var(--ghost)', borderRadius: 'var(--radius-sm)' }}>
            {format}
          </span>
        )}
        {approved && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5"
            style={{ background: 'var(--fog)', color: 'var(--ink)', borderRadius: 'var(--radius-sm)' }}>
            <Check size={11} /> Approved · queued for Review
          </span>
        )}
      </div>

      <div className="overflow-hidden"
        style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)' }}>
        {mediaUrl && (
          <img src={mediaUrl} alt="" className="w-full object-cover max-h-72" />
        )}
        <div className="p-5">
          {editing ? (
            <textarea
              autoFocus
              value={editCopy}
              onChange={e => setEditCopy(e.target.value)}
              className="w-full text-[14px] leading-relaxed outline-none resize-none"
              style={{ background: 'transparent', color: 'var(--ink)', minHeight: 220, fontFamily: 'var(--font-body)' }}
            />
          ) : (
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>{copy}</p>
          )}
          {hashtags.length > 0 && !editing && (
            <p className="text-[12px] mt-3 font-mono" style={{ color: 'var(--oxblood-soft, var(--ghost))' }}>{hashtags.join(' ')}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        {editing ? (
          <>
            <button onClick={saveEdit} disabled={busy === 'save'}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium disabled:opacity-50"
              style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
              {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save changes
            </button>
            <button onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
              style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
              <X size={13} /> Cancel
            </button>
          </>
        ) : (
          <>
            {!approved && (
              <button onClick={approve} disabled={busy === 'approve' || !result?.id}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: '3px' }}>
                {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
              </button>
            )}
            <button onClick={() => { setEditCopy(copy); setEditing(true) }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
              style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
              <Pencil size={13} /> Tweak
            </button>
            <button onClick={onRegenerate}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
              style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
              <RefreshCw size={13} /> Regenerate
            </button>
            <button onClick={onReset}
              className="px-4 py-2 text-[13px] ml-auto"
              style={{ color: 'var(--ghost)' }}>
              Start another
            </button>
          </>
        )}
      </div>

      {result?.id && (
        <a href={`/review/${result.id}`}
          className="inline-flex items-center gap-1 text-[12px] mt-3 hover:underline"
          style={{ color: 'var(--ghost)' }}>
          Open in Review <ExternalLink size={11} />
        </a>
      )}

      <ThinkingReveal show={showThinking} setShow={setShowThinking} agentLog={agentLog} />
    </div>
  )
}

// ─── "Show VERA's thinking" — the 8-agent stream, hidden by default ────────
function ThinkingReveal({
  show, setShow, agentLog,
}: {
  show: boolean
  setShow: (v: boolean) => void
  agentLog: Partial<Record<AgentName, string>>
}) {
  const entries = (Object.keys(STEP_CAPTION) as AgentName[]).filter(a => agentLog[a])
  if (entries.length === 0) return null
  return (
    <div className="mt-5">
      <button onClick={() => setShow(!show)}
        className="inline-flex items-center gap-1 text-[12px] transition-colors hover:text-[var(--ink-quiet)]"
        style={{ color: 'var(--ghost)' }}>
        {show ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {show ? 'Hide' : 'Show'} VERA’s thinking
      </button>
      {show && (
        <div className="mt-3 flex flex-col gap-3">
          {entries.map(agent => (
            <div key={agent}>
              <p className="text-[11px] font-medium uppercase mb-1" style={{ color: 'var(--ghost)', letterSpacing: '0.05em' }}>{agent}</p>
              <div className="px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-md)' }}>
                {agentLog[agent]}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Context bar — one quiet, collapsed line. Defaults already chosen. ─────
// Collapsed by default to a muted summary. "Change" reveals inline selects
// for power users; the everyday flow never has to touch it.
function ContextBar({
  projects, activeProjectSlug, onSwitchProject,
  campaigns, selectedCampaignId, setSelectedCampaignId,
  audiences, selectedAudienceId, setSelectedAudienceId, disabled,
}: {
  projects: { id: string; slug: string; name: string; is_starred?: boolean }[]
  activeProjectSlug: string | null
  onSwitchProject: (slug: string) => void
  campaigns: Campaign[]
  selectedCampaignId: string | null
  setSelectedCampaignId: (v: string | null) => void
  audiences: Audience[]
  selectedAudienceId: string | null
  setSelectedAudienceId: (v: string | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const campaignName = campaigns.find(c => c.id === selectedCampaignId)?.name
  const audienceName = audiences.find(a => a.id === selectedAudienceId)?.name

  if (!open) {
    const summary = [campaignName ?? 'your strategy', audienceName].filter(Boolean).join(' · ')
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={disabled}
        className="inline-flex items-center gap-1.5 text-[12px] transition-colors hover:text-[var(--ink-quiet)] disabled:opacity-50 min-w-0"
        style={{ color: 'var(--ghost)' }}>
        <span className="truncate">Using <span style={{ color: 'var(--ink-quiet)' }}>{summary}</span></span>
        <ChevronDown size={12} className="flex-shrink-0" />
      </button>
    )
  }

  const selectStyle: React.CSSProperties = {
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    background: 'transparent', border: 'none', outline: 'none', font: 'inherit',
    fontWeight: 500, color: 'var(--ink)', padding: '2px 6px', borderRadius: '4px',
    maxWidth: 200, textOverflow: 'ellipsis',
  }

  return (
    <div className="flex items-center gap-1 text-[12px] flex-wrap min-w-0" style={{ color: 'var(--ghost)' }}>
      <span className="mr-0.5">Using</span>
      {projects.length > 0 && activeProjectSlug && (
        <>
          <select value={activeProjectSlug} onChange={e => onSwitchProject(e.target.value)} disabled={disabled}
            className="cursor-pointer hover:bg-[var(--fog)] rounded" style={selectStyle}>
            {projects.map(p => <option key={p.id} value={p.slug}>{p.is_starred ? '★ ' : ''}{p.name}</option>)}
          </select>
          <span style={{ color: 'var(--mist)' }}>·</span>
        </>
      )}
      <select value={selectedCampaignId ?? ''} onChange={e => setSelectedCampaignId(e.target.value || null)} disabled={disabled}
        className="cursor-pointer hover:bg-[var(--fog)] rounded" style={selectStyle}>
        <option value="">No campaign</option>
        {campaigns.map(c => (
          <option key={c.id} value={c.id}>{c.is_pinned ? '★ ' : ''}{c.name}{c.status !== 'active' ? ` · ${c.status}` : ''}</option>
        ))}
      </select>
      {audiences.length > 0 && (
        <>
          <span style={{ color: 'var(--mist)' }}>·</span>
          <select value={selectedAudienceId ?? ''} onChange={e => setSelectedAudienceId(e.target.value || null)} disabled={disabled}
            className="cursor-pointer hover:bg-[var(--fog)] rounded" style={selectStyle}>
            <option value="">No audience</option>
            {audiences.filter(a => a.kind === 'icp').map(icp => (
              <optgroup key={icp.id} label={`ICP — ${icp.name}`}>
                <option value={icp.id}>{icp.is_primary ? '★ ' : ''}{icp.name}</option>
                {audiences.filter(p => p.parent_id === icp.id).map(p => (
                  <option key={p.id} value={p.id}>{p.is_primary ? '   ★ ' : '   · '}{p.name}</option>
                ))}
              </optgroup>
            ))}
            {audiences.filter(a => a.kind !== 'icp' && !a.parent_id).length > 0 && (
              <optgroup label="Standalone">
                {audiences.filter(a => a.kind !== 'icp' && !a.parent_id).map(a => (
                  <option key={a.id} value={a.id}>{a.is_primary ? '★ ' : ''}{a.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </>
      )}
      <button type="button" onClick={() => setOpen(false)} className="ml-1 p-0.5 hover:bg-[var(--fog)] rounded" style={{ color: 'var(--ghost)' }}>
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Right rail — quiet status, not a control panel ────────────────────────
function GenerateRail({
  phase, currentStep, projectName, campaignName, audienceName,
}: {
  phase: Phase
  currentStep: AgentName
  projectName: string | null
  campaignName: string | null
  audienceName: string | null
}) {
  const steps = Object.keys(STEP_CAPTION) as AgentName[]
  const currentIdx = steps.indexOf(currentStep)

  return (
    <div className="flex flex-col gap-6 py-6 pr-5 pl-1">
      {phase === 'working' ? (
        <section>
          <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
            VERA is working
          </p>
          <div className="flex flex-col text-[12.5px]" style={{ color: 'var(--ink-quiet)' }}>
            {steps.slice(1).map((agent) => {
              const idx = steps.indexOf(agent)
              const done = idx < currentIdx
              const active = idx === currentIdx
              return (
                <div key={agent} className="flex items-center gap-2 py-1.5">
                  {done ? <Check size={12} style={{ color: 'var(--ink)' }} />
                    : active ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--ink-quiet)' }} />
                    : <span className="w-1.5 h-1.5 rounded-full inline-block ml-[2px]" style={{ background: 'var(--mist)' }} />}
                  <span style={{ color: done ? 'var(--ink)' : active ? 'var(--ink-quiet)' : 'var(--ghost)' }}>
                    {STEP_CAPTION[agent]}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <>
          <section>
            <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
              How it works
            </p>
            <ol className="flex flex-col gap-3 text-[12.5px]" style={{ color: 'var(--ink-quiet)' }}>
              {['Describe what you need', 'VERA drafts & checks it', 'Approve, tweak, or regenerate'].map((s, i) => (
                <li key={s} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[10px] font-semibold rounded-full"
                    style={{ background: 'var(--fog)', color: 'var(--ink-quiet)' }}>{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
              Context
            </p>
            <div className="text-[12.5px] flex flex-col gap-1.5" style={{ color: 'var(--ink-quiet)' }}>
              <div>Project · <b style={{ color: 'var(--ink)' }}>{projectName ?? '—'}</b></div>
              <div>Campaign · <b style={{ color: 'var(--ink)' }}>{campaignName ?? 'None'}</b></div>
              <div>Audience · <b style={{ color: 'var(--ink)' }}>{audienceName ?? 'None'}</b></div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
