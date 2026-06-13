import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowLeft, Check, Sparkles, Loader2, Globe2, Link2, Target, FileText, Network } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import {
  EMPTY_BUSINESS_CONTEXT,
  compactProjectDescription,
  mergeProjectInstructions,
  type BusinessContext,
} from '../lib/businessContext'
import { applyDemandDefaults } from '../lib/demandModel'

type IntroStepDef = { id: 'welcome'; type: 'intro' }
type WebsiteStepDef = { id: 'website'; type: 'website' }
type EssentialsStepDef = { id: 'essentials'; type: 'essentials' }
type SourcesStepDef = { id: 'sources'; type: 'sources' }
type StrategyStepDef = { id: 'strategy'; type: 'strategy' }
type ReviewStepDef = { id: 'review'; type: 'review' }
type Step = IntroStepDef | WebsiteStepDef | EssentialsStepDef | SourcesStepDef | StrategyStepDef | ReviewStepDef

const STEPS: Step[] = [
  { id: 'welcome', type: 'intro' },
  { id: 'website', type: 'website' },
  { id: 'essentials', type: 'essentials' },
  { id: 'sources', type: 'sources' },
  { id: 'strategy', type: 'strategy' },
  { id: 'review', type: 'review' },
]

const TOTAL_NON_INTRO = STEPS.filter(s => s.type !== 'intro').length

const SOURCE_FIELDS = [
  { field: 'blog', title: 'Website blog', placeholder: 'https://company.com/blog', helper: 'Articles, SEO pages, and thought leadership.' },
  { field: 'linkedin_company', title: 'LinkedIn company page', placeholder: 'https://linkedin.com/company/company-name', helper: 'Only useful when LinkedIn is a valid channel.' },
  { field: 'linkedin_personal', title: 'LinkedIn profile', placeholder: 'https://linkedin.com/in/person-name', helper: 'Use for founder, expert, or named-person voice.' },
  { field: 'linkedin_events', title: 'LinkedIn events', placeholder: 'https://linkedin.com/events/event-name', helper: 'Events can reveal topics, audiences, and recurring proof points.' },
  { field: 'linkedin_newsletter', title: 'LinkedIn newsletter', placeholder: 'https://linkedin.com/newsletters/name', helper: 'Optional source for depth and recurring themes.' },
  { field: 'instagram', title: 'Instagram', placeholder: 'https://instagram.com/brand', helper: 'Visual proof, product, community, or creator signal.' },
  { field: 'youtube', title: 'YouTube', placeholder: 'https://youtube.com/@brand', helper: 'Videos, Shorts, demos, podcasts, and evergreen search.' },
  { field: 'medium', title: 'Medium', placeholder: 'https://medium.com/@handle', helper: 'Manual-first long-form publishing and source material.' },
  { field: 'quora', title: 'Quora', placeholder: 'https://quora.com/profile/person-or-brand', helper: 'Audience questions and problem language.' },
  { field: 'reddit', title: 'Reddit', placeholder: 'r/category or https://reddit.com/r/category', helper: 'Market listening, objections, and community language.' },
  { field: 'facebook', title: 'Facebook page', placeholder: 'https://facebook.com/brand', helper: 'Community, local trust, and Meta organic signals.' },
  { field: 'twitter', title: 'X profile', placeholder: 'https://x.com/handle', helper: 'Lower priority unless the channel already matters.' },
] as const

const STRATEGY_FIELDS = [
  { field: 'content_goals', title: 'Content goals', placeholder: 'Awareness, trust, traffic, community, leads, sales, education, recruiting.', multiline: true },
  { field: 'active_channels', title: 'Likely channels', placeholder: 'LinkedIn, Instagram, YouTube, Medium, Reddit, Quora, Email, Website.', multiline: false },
  { field: 'approval_model', title: 'Approval model', placeholder: 'Operator-only, owner lead, all stakeholders, or case by case.', multiline: false },
  { field: 'conversion_path', title: 'Conversion path', placeholder: 'Comments, shares, qualified traffic, newsletter, checkout, demos, DMs, or SAM handoff.', multiline: true },
  { field: 'engagement_signals', title: 'Engagement signals', placeholder: 'Comments, shares, saves, clicks, qualified traffic, buyer questions, objections.', multiline: true },
  { field: 'learning_cadence', title: 'Learning cadence', placeholder: 'Weekly review, monthly strategy refresh, campaign-based retrospectives.', multiline: false },
] as const

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function companyNameFromWebsite(value: string) {
  try {
    const host = new URL(normalizeUrl(value)).hostname.replace(/^www\./, '')
    const base = host.split('.')[0] || 'space'
    return base
      .split(/[-_]+/)
      .filter(Boolean)
      .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || 'Space'
  } catch {
    return 'Space'
  }
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { activeOrg, loading: orgLoading } = useOrg()
  const { refetch } = useProject()
  const [stepIndex, setStepIndex] = useState(0)
  const [collected, setCollected] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resume any in-progress session on mount
  useEffect(() => {
    if (orgLoading) return
    if (!activeOrg?.id) return
    let cancelled = false
    supabase.from('onboarding_sessions')
      .select('*')
      .eq('org_id', activeOrg.id)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          const savedStep = typeof data.current_step === 'number' ? data.current_step : 0
          const safeStep = Math.min(Math.max(savedStep, 0), STEPS.length - 1)
          setSessionId(data.id)
          setCollected((data.collected as Record<string, string>) ?? {})
          setStepIndex(safeStep)
        } else {
          // Create a fresh session
          supabase.from('onboarding_sessions').insert({ org_id: activeOrg.id }).select('id').single()
            .then(({ data }) => { if (!cancelled && data) setSessionId(data.id) })
        }
      })
    return () => { cancelled = true }
  }, [activeOrg?.id, orgLoading])

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
    if (step.type === 'website') {
      const value = (collected.website ?? '').trim()
      if (!value) { setError('Company URL is required.'); return }
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

  async function submitWizard() {
    setSubmitting(true)
    setError(null)

    const website = (collected.website ?? '').trim()
    const name = (collected.company_name ?? '').trim() || companyNameFromWebsite(website)
    if (!website) {
      setError('Company URL is required.')
      setSubmitting(false)
      return
    }

    if (!activeOrg?.id) {
      setError('No active workspace is available. Open Vera from a workspace before adding a space.')
      setSubmitting(false)
      return
    }

    const context = buildBusinessContextFromCollected(collected)
    const slugBase = slugify(name) || 'client'
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`

    // Create the client as a project under the current workspace. The old
    // onboarding flow created a whole organization and org-scoped channel rows;
    // spaces now live in projects with their source model in Strategy Brain.
    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .insert({
        org_id: activeOrg.id,
        name,
        slug,
        description: compactProjectDescription(context),
        instructions: mergeProjectInstructions('', context),
        is_default: false,
        is_starred: false,
        is_archived: false,
      })
      .select('id, slug')
      .single()

    if (projectErr || !project) {
      setError(`Could not create space: ${projectErr?.message ?? 'unknown'}`)
      setSubmitting(false)
      return
    }

    if (sessionId) {
      await supabase.from('onboarding_sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          org_id: activeOrg.id,
          current_step: stepIndex,
          collected: { ...collected, project_id: project.id },
        })
        .eq('id', sessionId)
    }

    setSubmitting(false)
    refetch()
    navigate(`/p/${project.slug}/brain`)
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
            <div className="h-full bg-gray-900 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Step content */}
      {step.type === 'intro' && <IntroStep onStart={goNext} />}

      {step.type === 'website' && (
        <WebsiteStep
          website={collected.website ?? ''}
          onChange={v => setField('website', v)}
        />
      )}

      {step.type === 'essentials' && (
        <EssentialsStep
          collected={collected}
          onChange={setField}
        />
      )}

      {step.type === 'sources' && (
        <SourcesStep
          collected={collected}
          onChange={setField}
        />
      )}

      {step.type === 'strategy' && (
        <StrategyStep
          collected={collected}
          onChange={setField}
        />
      )}

      {step.type === 'review' && (
        <ReviewStep
          collected={collected}
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
            {step.type === 'review' ? (
              <button onClick={submitWizard} disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <>Finish setup <Check className="w-4 h-4" /></>}
              </button>
            ) : (
              <button onClick={goNext}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-semibold">
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

function normalizeUrl(value: string) {
  const raw = value.trim()
  if (!raw) return ''
  if (/^(https?:\/\/|r\/|@)/i.test(raw)) return raw
  return `https://${raw}`
}

function buildBusinessContextFromCollected(collected: Record<string, string>): BusinessContext {
  const context: BusinessContext = {
    ...EMPTY_BUSINESS_CONTEXT,
    companyName: (collected.company_name ?? '').trim() || companyNameFromWebsite(collected.website ?? ''),
    website: normalizeUrl(collected.website ?? ''),
    linkedinProfile: normalizeUrl(collected.linkedin_personal ?? ''),
    linkedinCompany: normalizeUrl(collected.linkedin_company ?? ''),
    linkedinEvents: normalizeUrl(collected.linkedin_events ?? ''),
    linkedinNewsletter: normalizeUrl(collected.linkedin_newsletter ?? ''),
    instagram: normalizeUrl(collected.instagram ?? ''),
    youtube: normalizeUrl(collected.youtube ?? ''),
    medium: normalizeUrl(collected.medium ?? ''),
    quora: normalizeUrl(collected.quora ?? ''),
    reddit: normalizeUrl(collected.reddit ?? ''),
    facebook: normalizeUrl(collected.facebook ?? ''),
    x: normalizeUrl(collected.twitter ?? ''),
    industry: (collected.industry ?? '').trim(),
    offer: (collected.offer ?? '').trim(),
    audience: (collected.audience ?? '').trim(),
    contentGoals: (collected.content_goals ?? '').trim(),
    activeChannels: (collected.active_channels ?? '').trim(),
    approvalModel: (collected.approval_model ?? '').trim(),
    conversionPath: (collected.conversion_path ?? '').trim(),
    engagementSignals: (collected.engagement_signals ?? '').trim(),
    learningCadence: (collected.learning_cadence ?? '').trim(),
  }
  const blog = normalizeUrl(collected.blog ?? '')
  const withDefaults = applyDemandDefaults(context)
  if (blog) {
    withDefaults.channelStrategy = `${withDefaults.channelStrategy}\nWebsite blog source: ${blog}`
  }
  return withDefaults
}

function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex w-14 h-14 rounded-2xl bg-gray-100 items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-gray-700" />
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Set up Vera&apos;s Brain</h1>
      <p className="text-base text-gray-600 max-w-md mx-auto mb-8">
        Start with the company URL, then add only the sources and strategy assumptions Vera should use. You can refine everything in the Brain after setup.
      </p>
      <button onClick={onStart}
        className="inline-flex items-center gap-1.5 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-semibold">
        Start with URL <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

function WebsiteStep({ website, onChange }: { website: string; onChange: (v: string) => void }) {
  return (
    <div>
      <StepHeader
        icon={<Globe2 className="w-5 h-5 text-gray-700" />}
        eyebrow="Required first"
        title="Company URL"
        body="Vera uses the website as the primary source for extraction, verification, positioning, product pages, SEO headers, and owned content."
      />
      <input
        type="text"
        value={website}
        placeholder="https://company.com"
        onChange={e => onChange(e.target.value)}
        autoFocus
        className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
      />
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HintCard title="Extract" body="Company facts, offers, pages, proof, and constraints." />
        <HintCard title="Plan" body="Channel fit, audience assumptions, and content jobs." />
        <HintCard title="Learn" body="Performance signals update the Brain after publishing." />
      </div>
    </div>
  )
}

function EssentialsStep({ collected, onChange }: { collected: Record<string, string>; onChange: (field: string, value: string) => void }) {
  return (
    <div>
      <StepHeader
        icon={<FileText className="w-5 h-5 text-gray-700" />}
        eyebrow="Optional facts"
        title="Business context"
        body="Add what you already know. If you leave this light, Vera can extract more from the website and uploaded documents in the Brain."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InputField label="Space name" value={collected.company_name ?? ''} onChange={v => onChange('company_name', v)} placeholder="Acme Inc." />
        <InputField label="Industry" value={collected.industry ?? ''} onChange={v => onChange('industry', v)} placeholder="Fashion, hospitality, SaaS, healthcare" />
        <TextareaField label="Offer" value={collected.offer ?? ''} onChange={v => onChange('offer', v)} placeholder="What do they sell, teach, or promote?" />
        <TextareaField label="Audience" value={collected.audience ?? ''} onChange={v => onChange('audience', v)} placeholder="Who should care and why?" />
      </div>
    </div>
  )
}

function SourcesStep({ collected, onChange }: { collected: Record<string, string>; onChange: (field: string, value: string) => void }) {
  const provided = SOURCE_FIELDS.filter(field => (collected[field.field] ?? '').trim()).length
  return (
    <div>
      <StepHeader
        icon={<Link2 className="w-5 h-5 text-gray-700" />}
        eyebrow={`${provided} sources added`}
        title="Source channels"
        body="Add sources only when they matter. LinkedIn audit and profile scoring are optional, and should run only when LinkedIn is a valid strategy channel."
      />
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-gray-500 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-gray-900">Document extraction lives in the Brain</div>
            <p className="text-sm text-gray-500 mt-1">
              After setup, upload a PDF, DOCX, proposal, brand deck, or brief in Strategy Brain. Vera extracts fields for review before saving.
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SOURCE_FIELDS.map(field => (
          <InputField
            key={field.field}
            label={field.title}
            helper={field.helper}
            value={collected[field.field] ?? ''}
            onChange={v => onChange(field.field, v)}
            placeholder={field.placeholder}
          />
        ))}
      </div>
    </div>
  )
}

function StrategyStep({ collected, onChange }: { collected: Record<string, string>; onChange: (field: string, value: string) => void }) {
  return (
    <div>
      <StepHeader
        icon={<Target className="w-5 h-5 text-gray-700" />}
        eyebrow="Assumptions"
        title="Strategy starting point"
        body="These are not permanent rules. They help Vera avoid generic output until the Brain has source and performance evidence."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {STRATEGY_FIELDS.map(field => field.multiline ? (
          <TextareaField
            key={field.field}
            label={field.title}
            value={collected[field.field] ?? ''}
            onChange={v => onChange(field.field, v)}
            placeholder={field.placeholder}
          />
        ) : (
          <InputField
            key={field.field}
            label={field.title}
            value={collected[field.field] ?? ''}
            onChange={v => onChange(field.field, v)}
            placeholder={field.placeholder}
          />
        ))}
      </div>
    </div>
  )
}

function ReviewStep({ collected, onEdit }: { collected: Record<string, string>; onEdit: (idx: number) => void }) {
  const companyName = (collected.company_name ?? '').trim() || companyNameFromWebsite(collected.website ?? '')
  const sourceRows = SOURCE_FIELDS.map(field => ({
    label: field.title,
    value: collected[field.field] ?? '',
  }))
  const strategyRows = STRATEGY_FIELDS.map(field => ({
    label: field.title,
    value: collected[field.field] ?? '',
  }))

  return (
    <div>
      <StepHeader
        icon={<Check className="w-5 h-5 text-gray-700" />}
        eyebrow="Review"
        title="Create this space"
        body="Click a section to edit. Vera will save this to the Strategy Brain and open the Brain so sources and documents can be pulled next."
      />
      <ReviewGroup title="Required start" onEdit={() => onEdit(1)}>
        <Row label="Company URL" value={collected.website ?? 'Not provided'} />
      </ReviewGroup>
      <ReviewGroup title="Business context" onEdit={() => onEdit(2)}>
        <Row label="Space name" value={companyName} />
        <Row label="Industry" value={collected.industry || 'Not provided'} muted={!collected.industry} />
        <Row label="Offer" value={collected.offer || 'Not provided'} muted={!collected.offer} />
        <Row label="Audience" value={collected.audience || 'Not provided'} muted={!collected.audience} />
      </ReviewGroup>
      <ReviewGroup title={`Sources (${sourceRows.filter(row => row.value.trim()).length})`} onEdit={() => onEdit(3)}>
        {sourceRows.map(row => (
          <Row key={row.label} label={row.label} value={row.value || 'Not provided'} muted={!row.value} />
        ))}
      </ReviewGroup>
      <ReviewGroup title="Strategy assumptions" onEdit={() => onEdit(4)}>
        {strategyRows.map(row => (
          <Row key={row.label} label={row.label} value={row.value || 'Not provided'} muted={!row.value} />
        ))}
      </ReviewGroup>
    </div>
  )
}

function StepHeader({ icon, eyebrow, title, body }: { icon: ReactNode; eyebrow: string; title: string; body: string }) {
  return (
    <div className="mb-6">
      <div className="inline-flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">{icon}</div>
        <span className="text-xs uppercase tracking-wider font-semibold text-gray-500">{eyebrow}</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-sm text-gray-500 leading-relaxed max-w-2xl">{body}</p>
    </div>
  )
}

function HintCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <div className="text-xs text-gray-500 mt-1 leading-relaxed">{body}</div>
    </div>
  )
}

function InputField({ label, value, onChange, placeholder, helper }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; helper?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-900 mb-1">{label}</span>
      {helper && <span className="block text-xs text-gray-500 mb-2 leading-relaxed">{helper}</span>}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
      />
    </label>
  )
}

function TextareaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block sm:col-span-2">
      <span className="block text-sm font-semibold text-gray-900 mb-1">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 resize-y"
      />
    </label>
  )
}

function ReviewGroup({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="mb-4">
      <button type="button" onClick={onEdit} className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700">
        <Network className="w-3.5 h-3.5" />
        {title}
      </button>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {children}
      </div>
    </section>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="w-full px-4 py-3 flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <span className={`text-sm truncate max-w-[60%] ${muted ? 'text-gray-400' : 'text-gray-600'}`}>{value}</span>
    </div>
  )
}
