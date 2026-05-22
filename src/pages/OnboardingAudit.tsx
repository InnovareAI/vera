import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Loader2, Check, AlertCircle, Sparkles } from 'lucide-react'

const AUDIT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-audit`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

interface FetchedEvent { channel: string; ok: boolean; reason?: string; item_count: number }
interface ChannelsLoaded { channels: Array<{ channel: string; url: string }> }
interface DoneEvent {
  audit_id: string
  proposal: {
    brand_voice: { tone?: string[]; writing_rules?: string[]; forbidden_phrases?: string[]; required_phrases?: string[]; system_prompt?: string }
    personas: Array<{ name?: string; title?: string; pain_points?: string[]; goals?: string[]; is_primary?: boolean }>
    skills: Array<{ type?: string; name?: string; description?: string; prompt_module?: string; injected_into?: string }>
  }
}

type Phase = 'connecting' | 'fetching' | 'synthesising' | 'done' | 'error'

export default function OnboardingAudit() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('connecting')
  const [channels, setChannels] = useState<ChannelsLoaded['channels']>([])
  const [fetched, setFetched] = useState<Record<string, FetchedEvent>>({})
  const [synthesisText, setSynthesisText] = useState('')
  const [result, setResult] = useState<DoneEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!orgId || startedRef.current) return
    startedRef.current = true

    async function run() {
      try {
        const res = await fetch(AUDIT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ org_id: orgId }),
        })
        if (!res.body) throw new Error('No response body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const json = line.slice(6).trim()
            if (!json) continue
            try {
              const ev = JSON.parse(json)
              handleEvent(ev)
            } catch { /* ignore parse errors */ }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    }

    function handleEvent(ev: { event: string; [k: string]: unknown }) {
      switch (ev.event) {
        case 'started':
          setPhase('fetching')
          break
        case 'channels_loaded':
          setChannels(ev.channels as ChannelsLoaded['channels'])
          break
        case 'fetching':
          // no-op, we already show the channel list
          break
        case 'fetched':
          setFetched(prev => ({ ...prev, [ev.channel as string]: ev as unknown as FetchedEvent }))
          break
        case 'synthesising':
          setPhase('synthesising')
          break
        case 'synthesis_chunk':
          setSynthesisText(t => t + (ev.text as string))
          break
        case 'done':
          setResult(ev as unknown as DoneEvent)
          setPhase('done')
          break
        case 'error':
          setError((ev.message as string) ?? 'Unknown error')
          setPhase('error')
          break
      }
    }

    run()
  }, [orgId])

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-violet-600" />
          </div>
          <span className="text-xs uppercase tracking-wider font-semibold text-gray-500">Auditor</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Analysing your content</h1>
        <p className="text-sm text-gray-500 mt-1">
          {phase === 'connecting' && 'Connecting…'}
          {phase === 'fetching'    && 'Pulling content from each channel.'}
          {phase === 'synthesising' && 'Extracting voice, audience, and patterns.'}
          {phase === 'done'        && 'Done. Review the proposal below.'}
          {phase === 'error'       && 'Hit an error.'}
        </p>
      </div>

      {/* Channel status list */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Channels
        </div>
        <div className="divide-y divide-gray-100">
          {channels.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Looking up channels…
            </div>
          )}
          {channels.map(c => {
            const f = fetched[c.channel]
            return (
              <div key={c.channel} className="flex items-center gap-3 px-4 py-3 text-sm">
                <ChannelIcon ok={f?.ok} pending={!f} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{channelLabel(c.channel)}</div>
                  <div className="text-xs text-gray-500 truncate">{c.url}</div>
                  {f && !f.ok && (
                    <div className="text-xs text-amber-700 mt-0.5">{f.reason}</div>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {!f && <span>fetching…</span>}
                  {f && f.ok && <span>{f.item_count} item{f.item_count === 1 ? '' : 's'}</span>}
                  {f && !f.ok && <span>skipped</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Synthesis */}
      {(phase === 'synthesising' || (phase === 'done' && !result)) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
            <span className="text-sm font-semibold text-gray-900">Synthesising voice profile…</span>
          </div>
          <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono max-h-64 overflow-auto bg-gray-50 p-3 rounded">
            {synthesisText.slice(-2000)}
          </pre>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <BrandVoiceCard bv={result.proposal.brand_voice} />
          <PersonasCard personas={result.proposal.personas} />
          <SkillsCard skills={result.proposal.skills} />

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
            <div className="font-semibold mb-1">Prototype: this proposal isn't applied yet.</div>
            Audit ID <code className="text-[11px]">{result.audit_id}</code>. The Apply step (copy proposed_* into the live brand_voice / personas / skills tables) is the next build.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link to="/dashboard"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold">
              <Check className="w-4 h-4" /> Continue to dashboard
            </Link>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700 mb-1">Audit failed</p>
              <p className="text-sm text-red-700">{error}</p>
              <button onClick={() => navigate('/dashboard')}
                className="mt-3 text-sm text-red-700 underline hover:no-underline">
                Continue to dashboard anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChannelIcon({ ok, pending }: { ok?: boolean; pending: boolean }) {
  if (pending) return <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
  if (ok) return <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold">✓</span>
  return <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold">–</span>
}

function channelLabel(c: string): string {
  return ({
    linkedin_personal:   'LinkedIn — personal',
    linkedin_company:    'LinkedIn — company',
    linkedin_newsletter: 'LinkedIn newsletter',
    blog:                'Website blog',
    medium:              'Medium',
    youtube:             'YouTube',
    twitter:             'X / Twitter',
  } as Record<string, string>)[c] ?? c
}

function BrandVoiceCard({ bv }: { bv: DoneEvent['proposal']['brand_voice'] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-bold text-gray-900 mb-3">Brand voice</h2>
      <Field label="Tone"               items={bv.tone} />
      <Field label="Writing rules"      items={bv.writing_rules} />
      <Field label="Forbidden phrases"  items={bv.forbidden_phrases} />
      <Field label="Required phrases"   items={bv.required_phrases} />
      {bv.system_prompt && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-500 mb-1">Writer system prompt</div>
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{bv.system_prompt}</div>
        </div>
      )}
    </div>
  )
}

function PersonasCard({ personas }: { personas: DoneEvent['proposal']['personas'] }) {
  if (!personas?.length) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-bold text-gray-900 mb-3">Target personas ({personas.length})</h2>
      <div className="space-y-3">
        {personas.map((p, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-semibold text-gray-900">{p.name ?? 'Persona'}</span>
              {p.title && <span className="text-xs text-gray-500">{p.title}</span>}
              {p.is_primary && <span className="text-[10px] uppercase font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">Primary</span>}
            </div>
            {p.pain_points && p.pain_points.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-semibold text-gray-500 mb-0.5">Pain points</div>
                <ul className="text-sm text-gray-700 list-disc list-inside">{p.pain_points.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            )}
            {p.goals && p.goals.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-semibold text-gray-500 mb-0.5">Goals</div>
                <ul className="text-sm text-gray-700 list-disc list-inside">{p.goals.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SkillsCard({ skills }: { skills: DoneEvent['proposal']['skills'] }) {
  if (!skills?.length) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-bold text-gray-900 mb-3">Proposed skills ({skills.length})</h2>
      <div className="space-y-3">
        {skills.map((s, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-semibold text-gray-900">{s.name ?? 'Skill'}</span>
              {s.type && <span className="text-[10px] uppercase font-semibold text-gray-500">{s.type}</span>}
              {s.injected_into && <span className="text-[10px] font-medium text-gray-500">→ {s.injected_into}</span>}
            </div>
            {s.description && <p className="text-sm text-gray-700 mb-2">{s.description}</p>}
            {s.prompt_module && (
              <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap font-mono max-h-32 overflow-auto">{s.prompt_module}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div className="mb-2">
      <span className="text-xs font-semibold text-gray-500">{label}: </span>
      <span className="text-sm text-gray-700">{items.join(' · ')}</span>
    </div>
  )
}
