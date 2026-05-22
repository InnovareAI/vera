import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowLeft, Check, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Wizard step definitions. Two required org fields (name + website) then 7 optional channels.
type IntroStepDef    = { id: 'welcome'; type: 'intro' }
type ReviewStepDef   = { id: 'review';  type: 'review' }
type OrgFieldStepDef = { id: string; type: 'org_field'; field: string; title: string; subtitle: string; placeholder: string; required?: boolean }
type ChannelStepDef  = { id: string; type: 'channel'; channel: string; field: string; title: string; subtitle: string; placeholder: string }
type Step = IntroStepDef | ReviewStepDef | OrgFieldStepDef | ChannelStepDef

const STEPS: Step[] = [
  { id: 'welcome', type: 'intro' },
  { id: 'company',             type: 'org_field', field: 'company_name', title: 'Company name',         subtitle: "What should we call your company?",                                 placeholder: 'Acme Inc.',                              required: true },
  { id: 'website',             type: 'org_field', field: 'website',      title: 'Website',              subtitle: "Your company's main website.",                                      placeholder: 'https://acme.com',                       required: true },
  { id: 'linkedin_personal',   type: 'channel', channel: 'linkedin_personal',   field: 'linkedin_personal',   title: 'LinkedIn — personal',     subtitle: "Your own LinkedIn profile. This is where your personal voice lives — the most valuable signal for the audit.", placeholder: 'https://linkedin.com/in/…' },
  { id: 'linkedin_company',    type: 'channel', channel: 'linkedin_company',    field: 'linkedin_company',    title: 'LinkedIn — company',      subtitle: "Your company page on LinkedIn.",                                            placeholder: 'https://linkedin.com/company/…' },
  { id: 'blog',                type: 'channel', channel: 'blog',                field: 'blog',                title: 'Website blog',            subtitle: 'Your company blog or thought-leadership content.',                          placeholder: 'https://acme.com/blog' },
  { id: 'linkedin_newsletter', type: 'channel', channel: 'linkedin_newsletter', field: 'linkedin_newsletter', title: 'LinkedIn newsletter',     subtitle: 'If you publish a LinkedIn newsletter, paste its URL.',                      placeholder: 'https://linkedin.com/newsletters/…' },
  { id: 'medium',              type: 'channel', channel: 'medium',              field: 'medium',              title: 'Medium',                  subtitle: 'Your Medium profile or publication.',                                       placeholder: '@handle  or  https://medium.com/@handle' },
  { id: 'youtube',             type: 'channel', channel: 'youtube',             field: 'youtube',             title: 'YouTube channel',         subtitle: 'Your YouTube channel — videos, podcast, etc.',                              placeholder: 'https://youtube.com/@channel' },
  { id: 'twitter',             type: 'channel', channel: 'twitter',             field: 'twitter',             title: 'X / Twitter',             subtitle: 'Only fill if you post here weekly or more — otherwise the signal is too thin to be worth fetching.', placeholder: '@handle  or  https://x.com/handle' },
  { id: 'review', type: 'review' },
]

const TOTAL_NON_INTRO = STEPS.filter(s => s.type !== 'intro').length

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [stepIndex, setStepIndex] = useState(0)
  const [collected, setCollected] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resume any in-progress session on mount
  useEffect(() => {
    supabase.from('onboarding_sessions')
      .select('*')
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSessionId(data.id)
          setCollected((data.collected as Record<string, string>) ?? {})
          setStepIndex(data.current_step ?? 0)
        } else {
          // Create a fresh session
          supabase.from('onboarding_sessions').insert({}).select('id').single()
            .then(({ data }) => { if (data) setSessionId(data.id) })
        }
      })
  }, [])

  const step = STEPS[stepIndex]
  const progress = step.type === 'intro' ? 0 : STEPS.slice(0, stepIndex + 1).filter(s => s.type !== 'intro').length
  const progressPct = (progress / TOTAL_NON_INTRO) * 100

  async function persist(nextStep: number, nextCollected: Record<string, string>) {
    if (!sessionId) return
    await supabase.from('onboarding_sessions')
      .update({ current_step: nextStep, collected: nextCollected })
      .eq('id', sessionId)
  }

  function setField(field: string, value: string) {
    setCollected(prev => ({ ...prev, [field]: value }))
  }

  async function goNext() {
    setError(null)
    if (step.type === 'org_field' && step.required) {
      const value = (collected[step.field] ?? '').trim()
      if (!value) { setError(`${step.title} is required.`); return }
    }
    const next = stepIndex + 1
    setStepIndex(next)
    await persist(next, collected)
  }

  async function goBack() {
    if (stepIndex === 0) return
    const prev = stepIndex - 1
    setStepIndex(prev)
    await persist(prev, collected)
  }

  async function skipChannel() {
    if (step.type !== 'channel') return
    const nextCollected = { ...collected }
    delete nextCollected[step.field]
    setCollected(nextCollected)
    const next = stepIndex + 1
    setStepIndex(next)
    await persist(next, nextCollected)
  }

  async function submitWizard() {
    if (!sessionId) return
    setSubmitting(true)
    setError(null)

    const name = (collected.company_name ?? '').trim()
    const website = (collected.website ?? '').trim()
    if (!name || !website) {
      setError('Company name and website are required.')
      setSubmitting(false)
      return
    }

    // 1) Create the org
    const { data: org, error: orgErr } = await supabase
      .from('organisations')
      .insert({ name, slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`, website })
      .select('id')
      .single()

    if (orgErr || !org) {
      setError(`Couldn't create org: ${orgErr?.message ?? 'unknown'}`)
      setSubmitting(false)
      return
    }

    // 2) Insert one channel_profiles row per provided URL
    const channelRows = STEPS
      .filter((s): s is ChannelStepDef => s.type === 'channel')
      .map(s => ({ org_id: org.id, channel: s.channel, url: (collected[s.field] ?? '').trim() }))
      .filter(r => r.url.length > 0)

    if (channelRows.length) {
      const { error: chErr } = await supabase.from('channel_profiles').insert(channelRows)
      if (chErr) {
        setError(`Org created but channels failed: ${chErr.message}`)
        setSubmitting(false)
        return
      }
    }

    // 3) Mark session as completed
    await supabase.from('onboarding_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString(), org_id: org.id, current_step: stepIndex, collected })
      .eq('id', sessionId)

    setSubmitting(false)
    navigate(`/onboarding/audit/${org.id}`)
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Progress bar */}
      {step.type !== 'intro' && (
        <div className="mb-8">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>Step {progress} of {TOTAL_NON_INTRO}</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Step content */}
      {step.type === 'intro' && <IntroStep onStart={goNext} />}

      {(step.type === 'org_field' || step.type === 'channel') && (
        <FieldStep
          title={step.title}
          subtitle={step.subtitle}
          placeholder={step.placeholder}
          value={collected[step.field] ?? ''}
          onChange={v => setField(step.field, v)}
          optional={step.type === 'channel' || !step.required}
        />
      )}

      {step.type === 'review' && (
        <ReviewStep
          collected={collected}
          steps={STEPS}
          onEdit={(idx) => setStepIndex(idx)}
        />
      )}

      {/* Footer actions */}
      {step.type !== 'intro' && (
        <div className="mt-8 flex items-center justify-between">
          <button onClick={goBack} disabled={stepIndex === 0}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <div className="flex items-center gap-3">
            {step.type === 'channel' && (
              <button onClick={skipChannel}
                className="text-sm text-gray-500 hover:text-gray-700">
                Skip
              </button>
            )}
            {step.type === 'review' ? (
              <button onClick={submitWizard} disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Finish setup <Check className="w-4 h-4" /></>}
              </button>
            ) : (
              <button onClick={goNext}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold">
                Next <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
    </div>
  )
}

function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex w-14 h-14 rounded-2xl bg-violet-100 items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-violet-600" />
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Welcome to KAI</h1>
      <p className="text-base text-gray-600 max-w-md mx-auto mb-8">
        We'll ask a few questions about your company and where you publish content. Takes about 2 minutes.
        You can skip anything you don't have.
      </p>
      <button onClick={onStart}
        className="inline-flex items-center gap-1.5 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold">
        Get started <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

function FieldStep({ title, subtitle, placeholder, value, onChange, optional }:
  { title: string; subtitle: string; placeholder: string; value: string; onChange: (v: string) => void; optional: boolean }
) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        {optional && <span className="text-xs text-gray-400 font-medium">optional</span>}
      </div>
      <p className="text-sm text-gray-500 mb-6">{subtitle}</p>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        autoFocus
        className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
    </div>
  )
}

function ReviewStep({ collected, steps, onEdit }:
  { collected: Record<string, string>; steps: Step[]; onEdit: (idx: number) => void }
) {
  const orgFields = steps.map((s, i) => ({ s, i })).filter(x => x.s.type === 'org_field')
  const channels  = steps.map((s, i) => ({ s, i })).filter(x => x.s.type === 'channel')
  const provided  = channels.filter(({ s }) => s.type === 'channel' && (collected[s.field] ?? '').trim())
  const skipped   = channels.filter(({ s }) => s.type === 'channel' && !(collected[s.field] ?? '').trim())

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Review your setup</h2>
      <p className="text-sm text-gray-500 mb-6">Click any row to edit. We'll create your workspace when you finish.</p>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4">
        {orgFields.map(({ s, i }) => s.type !== 'intro' && s.type !== 'review' && (
          <Row key={s.id} label={s.title} value={collected[s.field] ?? '—'} onClick={() => onEdit(i)} />
        ))}
      </div>

      {provided.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Channels to audit ({provided.length})</p>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4">
            {provided.map(({ s, i }) => s.type === 'channel' && (
              <Row key={s.id} label={s.title} value={collected[s.field]} onClick={() => onEdit(i)} />
            ))}
          </div>
        </>
      )}

      {skipped.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Skipped ({skipped.length})</p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl divide-y divide-gray-100">
            {skipped.map(({ s, i }) => s.type === 'channel' && (
              <Row key={s.id} label={s.title} value="Not provided" onClick={() => onEdit(i)} muted />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value, onClick, muted }: { label: string; value: string; onClick: () => void; muted?: boolean }) {
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <span className={`text-sm truncate max-w-[60%] ${muted ? 'text-gray-400' : 'text-gray-600'}`}>{value}</span>
    </button>
  )
}
