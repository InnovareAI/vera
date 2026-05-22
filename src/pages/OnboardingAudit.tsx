import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Loader2, Check, AlertCircle, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'

const AUDIT_URL   = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-audit`
const CONNECT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/unipile-connect`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const LINKEDIN_CHANNELS = ['linkedin_personal', 'linkedin_company', 'linkedin_newsletter'] as const

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

type Phase = 'preflight' | 'awaiting_unipile' | 'connecting_unipile' | 'connecting' | 'fetching' | 'synthesising' | 'done' | 'error'

export default function OnboardingAudit() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('preflight')
  const [channels, setChannels] = useState<ChannelsLoaded['channels']>([])
  const [unipileConnected, setUnipileConnected] = useState(false)
  const [fetched, setFetched] = useState<Record<string, FetchedEvent>>({})
  const [synthesisText, setSynthesisText] = useState('')
  const [result, setResult] = useState<DoneEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const startedRef = useRef(false)

  // Preflight: resolve callback params if we just came back from Unipile, load channels & org.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false

    async function preflight() {
      // 1. If callback from Unipile, persist the account_id and route to the
      //    mandatory LinkedIn-score step before the voice audit.
      const unipileStatus = searchParams.get('unipile_status')
      const accountId = searchParams.get('account_id')
      if (unipileStatus === 'success' && accountId) {
        await supabase.from('organisations')
          .update({ unipile_account_id: accountId, unipile_connected_at: new Date().toISOString() })
          .eq('id', orgId)
        navigate(`/linkedin-score/${orgId}`, { replace: true })
        return
      }
      if (unipileStatus === 'error') {
        if (!cancelled) setError('LinkedIn connection was cancelled or failed.')
      }

      // 2. Load org + channels
      const [{ data: org }, { data: chs }] = await Promise.all([
        supabase.from('organisations').select('unipile_account_id').eq('id', orgId).maybeSingle(),
        supabase.from('channel_profiles').select('channel, url').eq('org_id', orgId).eq('is_active', true),
      ])
      if (cancelled) return
      const connected = !!org?.unipile_account_id
      setUnipileConnected(connected)
      setChannels((chs ?? []) as ChannelsLoaded['channels'])

      const hasLinkedIn = (chs ?? []).some(c => (LINKEDIN_CHANNELS as readonly string[]).includes(c.channel))
      if (hasLinkedIn && !connected) {
        setPhase('awaiting_unipile')
      } else {
        runAudit()
      }
    }

    preflight()
    return () => { cancelled = true }
  }, [orgId])

  async function startUnipileConnect() {
    if (!orgId) return
    setPhase('connecting_unipile')
    try {
      const return_url = `${window.location.origin}/onboarding/audit/${orgId}`
      const res = await fetch(CONNECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ org_id: orgId, return_url }),
      })
      if (!res.ok) throw new Error(`Connect failed: HTTP ${res.status}`)
      const { auth_url } = await res.json()
      if (!auth_url) throw new Error('No auth_url returned')
      window.location.href = auth_url
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  function skipUnipileAndAudit() {
    runAudit()
  }

  async function applyAudit() {
    if (!result || !orgId) return
    setApplying(true)
    setApplyError(null)
    try {
      const proposal = result.proposal
      const now = new Date().toISOString()

      // 1) brand_voice — one row per org. Upsert.
      const { data: existingBV } = await supabase.from('brand_voice').select('id').eq('org_id', orgId).maybeSingle()
      const bvPayload = {
        org_id: orgId,
        tone:              proposal.brand_voice.tone              ?? null,
        writing_rules:     proposal.brand_voice.writing_rules     ?? null,
        forbidden_phrases: proposal.brand_voice.forbidden_phrases ?? null,
        required_phrases:  proposal.brand_voice.required_phrases  ?? null,
        system_prompt:     proposal.brand_voice.system_prompt     ?? null,
        updated_at: now,
      }
      const bvResult = existingBV
        ? await supabase.from('brand_voice').update(bvPayload).eq('id', existingBV.id)
        : await supabase.from('brand_voice').insert(bvPayload)
      if (bvResult.error) throw new Error(`brand_voice: ${bvResult.error.message}`)

      // 2) personas — insert new rows
      if (Array.isArray(proposal.personas) && proposal.personas.length) {
        const personaRows = proposal.personas.map((p) => ({
          org_id: orgId,
          name:        (p.name as string) ?? 'Persona',
          title:       (p.title as string) ?? null,
          pain_points: (p.pain_points as string[]) ?? null,
          goals:       (p.goals as string[]) ?? null,
          is_primary:  !!(p.is_primary as boolean),
        }))
        const personaResult = await supabase.from('personas').insert(personaRows)
        if (personaResult.error) throw new Error(`personas: ${personaResult.error.message}`)
      }

      // 3) skills — insert org-scoped rows
      if (Array.isArray(proposal.skills) && proposal.skills.length) {
        const skillRows = proposal.skills.map((s, i) => ({
          org_id: orgId,
          name:          (s.name as string) ?? `Skill ${i + 1}`,
          description:   (s.description as string) ?? null,
          type:          (s.type as string) ?? 'writing_rule',
          prompt_module: (s.prompt_module as string) ?? null,
          injected_into: (s.injected_into as string) ?? 'writer',
          is_active: true,
          sort_order: i,
        }))
        const skillResult = await supabase.from('skills').insert(skillRows)
        if (skillResult.error) throw new Error(`skills: ${skillResult.error.message}`)
      }

      // 4) Mark audit_runs as applied
      await supabase.from('audit_runs').update({ applied_at: now }).eq('id', result.audit_id)

      setAppliedAt(now)
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  function runAudit() {
    if (startedRef.current || !orgId) return
    startedRef.current = true
    setPhase('connecting')

    function handleEvent(ev: { event: string; [k: string]: unknown }) {
      switch (ev.event) {
        case 'started':         setPhase('fetching'); break
        case 'channels_loaded': setChannels(ev.channels as ChannelsLoaded['channels']); break
        case 'fetching':        /* no-op */ break
        case 'fetched':         setFetched(prev => ({ ...prev, [ev.channel as string]: ev as unknown as FetchedEvent })); break
        case 'synthesising':    setPhase('synthesising'); break
        case 'synthesis_chunk': setSynthesisText(t => t + (ev.text as string)); break
        case 'done':            setResult(ev as unknown as DoneEvent); setPhase('done'); break
        case 'error':           setError((ev.message as string) ?? 'Unknown error'); setPhase('error'); break
      }
    }

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
            try { handleEvent(JSON.parse(json)) } catch { /* ignore parse errors */ }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    }

    run()
  }

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
          {phase === 'preflight'         && 'Loading…'}
          {phase === 'awaiting_unipile'  && 'Connect LinkedIn first — that’s where most of your voice lives.'}
          {phase === 'connecting_unipile'&& 'Opening LinkedIn authentication…'}
          {phase === 'connecting'        && 'Starting audit…'}
          {phase === 'fetching'          && 'Pulling content from each channel.'}
          {phase === 'synthesising'      && 'Extracting voice, audience, and patterns.'}
          {phase === 'done'              && 'Done. Review the proposal below.'}
          {phase === 'error'             && 'Hit an error.'}
        </p>
      </div>

      {/* Connect LinkedIn step */}
      {phase === 'awaiting_unipile' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-600 font-bold text-sm">in</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect your LinkedIn</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Unipile's hosted wizard handles the login. Once connected, KAI can read your posts and engagement
                data to extract your voice — far richer signal than public scraping.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={startUnipileConnect}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
              Connect LinkedIn →
            </button>
            <button onClick={skipUnipileAndAudit}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900">
              Skip for now (audit blog only)
            </button>
          </div>
        </div>
      )}

      {phase === 'connecting_unipile' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-700">Opening LinkedIn authentication…</span>
        </div>
      )}

      {unipileConnected && phase !== 'awaiting_unipile' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 mb-4 inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> LinkedIn connected
        </div>
      )}

      {/* Channel status list — only shown once audit is running or done */}
      {phase !== 'awaiting_unipile' && phase !== 'connecting_unipile' && (
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
      )}

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

          {appliedAt ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
              <div className="font-semibold mb-1 inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Applied</div>
              Brand voice, personas, and skills are now live for this org. The next post you generate will use them.
              <div className="text-[11px] text-emerald-700/70 mt-1">Audit ID <code>{result.audit_id}</code></div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
              <div className="font-semibold mb-1">Review the proposal above.</div>
              When you hit Apply, the brand voice, personas, and skills above get written to the live tables so the writer agent uses them on every generate.
              <div className="text-[11px] mt-1">Audit ID <code>{result.audit_id}</code></div>
            </div>
          )}

          {applyError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{applyError}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {appliedAt ? (
              <Link to="/dashboard"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold">
                <Check className="w-4 h-4" /> Continue to dashboard
              </Link>
            ) : (
              <button onClick={applyAudit} disabled={applying}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {applying ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</> : <><Check className="w-4 h-4" /> Apply audit</>}
              </button>
            )}
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
