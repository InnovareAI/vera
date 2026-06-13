import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { BrandVoice } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useAuth } from '../lib/auth'
import {
  Settings2, Users, Mic2, Plug, Building2, Save,
  CheckCircle2, AlertCircle, Sun, Moon, Monitor, BarChart3, ShieldCheck, RefreshCw, KeyRound, Database, ExternalLink
} from 'lucide-react'
import { PublishersCard } from '../components/PublishersCard'
import { ClientIntegrationsCard } from '../components/ClientIntegrationsCard'
import { useTheme, type Theme } from '../lib/themeContext'

type Tab = 'workspace' | 'team' | 'brand' | 'integrations' | 'usage'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'workspace',    label: 'Workspace',    icon: Building2 },
  { id: 'team',         label: 'Access',       icon: Users },
  { id: 'brand',        label: 'Brand Voice',  icon: Mic2 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'usage',        label: 'AI Usage',     icon: BarChart3 },
]

function initialSettingsTab(): Tab {
  if (typeof window === 'undefined') return 'workspace'
  const params = new URL(window.location.href).searchParams
  if (
    params.has('provider')
    || params.has('google_status')
    || params.has('meta_status')
    || params.has('unipile_status')
  ) {
    return 'integrations'
  }
  const value = params.get('tab')
  return TABS.some(tab => tab.id === value) ? value as Tab : 'workspace'
}

// ─── Workspace Tab ────────────────────────────────────────────────────────────
function WorkspaceTab() {
  const { activeOrg, refetch } = useOrg()
  const activeOrgId = activeOrg?.id
  const [form, setForm] = useState({
    name: '', website: '', industry: '', timezone: 'Europe/Berlin', locale: 'en',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('organizations').select('*').eq('id', activeOrgId).single()
      .then(({ data }) => {
        if (data) setForm({
          name:      data.name ?? '',
          website:   data.website ?? '',
          industry:  data.industry ?? '',
          timezone:  data.timezone ?? 'Europe/Berlin',
          locale:    data.locale ?? 'en',
        })
      })
  }, [activeOrgId])

  async function handleSave() {
    if (!activeOrg) return
    setSaving(true)
    await supabase.from('organizations').update(form).eq('id', activeOrg.id)
    setSaving(false)
    setSaved(true)
    refetch()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Workspace Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organisation details and preferences.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        <Field label="Organisation Name" hint="Displayed across the app">
          <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
            className="input" placeholder="InnovareAI" />
        </Field>
        <Field label="Website" hint="Your public website URL">
          <input value={form.website} onChange={e => setForm(f => ({...f, website: e.target.value}))}
            className="input" placeholder="https://innovareai.com" />
        </Field>
        <Field label="Industry" hint="Helps VERA tailor content">
          <input value={form.industry} onChange={e => setForm(f => ({...f, industry: e.target.value}))}
            className="input" placeholder="AI / Technology" />
        </Field>
        <Field label="Timezone">
          <select value={form.timezone} onChange={e => setForm(f => ({...f, timezone: e.target.value}))}
            className="input">
            <option value="Europe/Berlin">Europe/Berlin (CET)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
            <option value="Asia/Dubai">Asia/Dubai (GST)</option>
          </select>
        </Field>
        <Field label="Locale">
          <select value={form.locale} onChange={e => setForm(f => ({...f, locale: e.target.value}))}
            className="input">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="fr">French</option>
          </select>
        </Field>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
        {saved ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Save size={14} />}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
      </button>
      <AppearancePreference />
    </div>
  )
}

function AppearancePreference() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const options: { id: Theme; label: string; icon: React.ElementType }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: 'var(--t-body)', fontWeight: 650 }}>
          Appearance
        </h3>
        <p style={{ margin: '2px 0 0', color: 'var(--faint)', fontSize: 'var(--t-cap)' }}>
          Current: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          background: 'var(--paper-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: 4,
        }}
      >
        {options.map(({ id, label, icon: Icon }) => {
          const active = theme === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-label={`Use ${label.toLowerCase()} theme`}
              onClick={() => setTheme(id)}
              style={{
                minHeight: 36,
                border: active ? '1px solid var(--line-2)' : '1px solid transparent',
                borderRadius: 'var(--radius-md)',
                background: active ? 'var(--surface)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink-2)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 'var(--t-sm)',
                fontWeight: active ? 650 : 550,
                boxShadow: active ? 'var(--shadow-pop)' : 'none',
              }}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Access Tab ───────────────────────────────────────────────────────────────
function TeamTab() {
  const { projects } = useProject()
  const [projectId, setProjectId] = useState('')
  const [email, setEmail] = useState('')
  // Default to Editor so a joining collaborator can edit content out of the box.
  // Viewer stays selectable for view-only stakeholders.
  const [role, setRole] = useState<'viewer' | 'reviewer' | 'editor' | 'owner'>('editor')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { if (!projectId && projects.length) setProjectId(projects[0].id) }, [projects, projectId])

  async function sendInvite() {
    const addr = email.trim().toLowerCase()
    if (!projectId) { setMsg({ kind: 'err', text: 'Pick a client space first.' }); return }
    if (!addr.includes('@')) { setMsg({ kind: 'err', text: 'Enter a valid email address.' }); return }
    setBusy(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'create', project_id: projectId, email: addr, role }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `Invite failed (HTTP ${res.status})`)
      const where = projects.find(p => p.id === projectId)?.name ?? 'the client space'
      setEmail('')
      setMsg({ kind: 'ok', text: `Invited ${addr} as ${role} to ${where}. An email is on its way.` })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Invite could not be sent.' })
    } finally { setBusy(false) }
  }

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white'
  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Access Management</h2>
        <p className="text-sm text-gray-500 mt-0.5">Invite someone into a client space and set their role. Organisation-wide staff access is coming later. For now, access is scoped per client.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Client space</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className={input}>
            {projects.length === 0 && <option value="">No client spaces yet: add a client first</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="person@company.com" className={input} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Role</label>
          <select value={role} onChange={e => setRole(e.target.value as typeof role)} className={input}>
            <option value="viewer">Viewer - can view</option>
            <option value="reviewer">Reviewer - can comment &amp; approve</option>
            <option value="editor">Editor - can create &amp; edit</option>
            <option value="owner">Owner - full access</option>
          </select>
        </div>
        {msg && <p className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
        <div className="flex items-center gap-3">
          <button type="button" onClick={sendInvite} disabled={busy || !projectId}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50">
            <Users size={14} /> {busy ? 'Sending…' : 'Send invite'}
          </button>
          <button type="button" onClick={() => { window.location.href = '/clients' }} className="text-sm text-gray-500 hover:text-gray-700">
            Manage all access, roles &amp; pending invites →
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800">Invites are scoped to one client space. To give someone several clients, invite them to each. Organisation-wide staff access is on the roadmap.</p>
        </div>
      </div>
    </div>
  )
}

// ─── Brand Voice Tab ──────────────────────────────────────────────────────────
function BrandVoiceTab() {
  const { activeOrg } = useOrg()
  const activeOrgId = activeOrg?.id
  const [bv, setBv] = useState<Partial<BrandVoice>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toneInput, setToneInput] = useState('')
  const [ruleInput, setRuleInput] = useState('')
  const [forbidInput, setForbidInput] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('brand_voice').select('*').eq('org_id', activeOrgId).maybeSingle()
      .then(({ data }) => { if (data) setBv(data) })
  }, [activeOrgId])

  async function handleSave() {
    if (!activeOrg) return
    setSaving(true)
    const payload = { ...bv, org_id: activeOrg.id }
    if (bv.id) {
      await supabase.from('brand_voice').update(payload).eq('id', bv.id)
    } else {
      const { data } = await supabase.from('brand_voice').insert(payload).select().single()
      if (data) setBv(data)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function addToArray(key: keyof BrandVoice, val: string) {
    if (!val.trim()) return
    setBv(prev => ({ ...prev, [key]: [...((prev[key] as string[]) || []), val.trim()] }))
  }

  function removeFromArray(key: keyof BrandVoice, idx: number) {
    setBv(prev => ({ ...prev, [key]: ((prev[key] as string[]) || []).filter((_, i) => i !== idx) }))
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Brand Voice</h2>
        <p className="text-sm text-gray-500 mt-0.5">Define the tone and style VERA uses when generating content.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        <Field label="Persona Name" hint="e.g. Alex, Sam">
          <input value={bv.persona_name ?? ''} onChange={e => setBv(f => ({...f, persona_name: e.target.value}))}
            className="input" placeholder="Alex" />
        </Field>
        <Field label="Persona Descriptor" hint="One-line character description">
          <input value={bv.persona_descriptor ?? ''} onChange={e => setBv(f => ({...f, persona_descriptor: e.target.value}))}
            className="input" placeholder="A sharp, empathetic AI strategist" />
        </Field>
        <Field label="System Prompt Override" hint="Advanced: override VERA's base instructions">
          <textarea value={bv.system_prompt ?? ''} onChange={e => setBv(f => ({...f, system_prompt: e.target.value}))}
            className="input min-h-[80px] resize-y" placeholder="Write in first person. Never use buzzwords…" />
        </Field>
      </div>

      <TagField
        label="Tone Words"
        hint="e.g. confident, empathetic, direct"
        items={bv.tone ?? []}
        input={toneInput}
        setInput={setToneInput}
        onAdd={() => { addToArray('tone', toneInput); setToneInput('') }}
        onRemove={i => removeFromArray('tone', i)}
        color="violet"
      />

      <TagField
        label="Writing Rules"
        hint="e.g. Never start a sentence with 'I', Always use Oxford comma"
        items={bv.writing_rules ?? []}
        input={ruleInput}
        setInput={setRuleInput}
        onAdd={() => { addToArray('writing_rules', ruleInput); setRuleInput('') }}
        onRemove={i => removeFromArray('writing_rules', i)}
        color="blue"
      />

      <TagField
        label="Forbidden Phrases"
        hint="e.g. leverage, synergy, game-changer"
        items={bv.forbidden_phrases ?? []}
        input={forbidInput}
        setInput={setForbidInput}
        onAdd={() => { addToArray('forbidden_phrases', forbidInput); setForbidInput('') }}
        onRemove={i => removeFromArray('forbidden_phrases', i)}
        color="red"
      />

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
        {saved ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Save size={14} />}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Brand Voice'}
      </button>
    </div>
  )
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────
function IntegrationsTab() {
  const { activeProject } = useProject()
  const brainHref = activeProject?.slug ? `/p/${activeProject.slug}/brain` : '/clients'

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Agentic integrations</h2>
        <p className="text-sm text-gray-500 mt-0.5">Connect client-owned accounts. Channel strategy and writing rules live inside each client Demand Brain.</p>
      </div>

      <ClientIntegrationsCard />

      {/* Connected blogs / CMSes / Git publishers */}
      <PublishersCard />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-800">Client channel policy</div>
          <div className="text-xs text-gray-400 mt-0.5">Per-client rules prevent one workspace's tone, speaker, approval path, or publishing guard from leaking into another client.</div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Use Demand Brain for channel tone of voice, speaker mode, approval routing, publish guards, measurement focus, and SAM handoff triggers. Settings stays focused on credentials, OAuth, publisher health, and workspace access.
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = brainHref }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors"
          >
            <ShieldCheck size={12} />
            {activeProject?.slug ? 'Open Demand Brain' : 'Pick a client space'}
          </button>
        </div>
      </div>

      {/* AI Model Settings */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-800">AI model defaults</div>
          <div className="text-xs text-gray-400 mt-0.5">Model defaults are managed per client space so spend and quality stay tied to the right provider keys.</div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Open a client space, then go to API keys to set text, image, and video defaults. Premium image and video models require an explicit monthly cap before they can run.
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = '/clients' }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors"
          >
            <KeyRound size={12} />
            Open client spaces
          </button>
          <p className="text-[10px] text-gray-400">
            <AlertCircle size={10} className="inline mr-0.5" />
            Model defaults apply to new generations only. Existing drafts and jobs keep the model they already used.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── AI Usage Tab ────────────────────────────────────────────────────────────
type GenerationUsageRow = {
  id: string
  project_id: string | null
  provider: string | null
  operation: string | null
  model_used: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  usage_metadata: Record<string, unknown> | null
  created_at: string
}

type UsageProject = {
  id: string
  name: string
  slug: string
  ai_policy?: Record<string, unknown> | null
}

type UsageAiPolicy = {
  monthly_budget_usd: number | null
  images_enabled: boolean
  standard_video_enabled: boolean
  premium_media_enabled: boolean
}

type ClientUsageSummary = {
  projectId: string | null
  name: string
  slug: string | null
  policy: UsageAiPolicy
  events: number
  tokens: number
  cost: number
  imageEvents: number
  videoEvents: number
  clientEvents: number
  platformEvents: number
  unknownEvents: number
  topModel: string | null
  topProvider: string | null
}

type ModelUsageSummary = {
  key: string
  provider: string
  model: string
  operation: string
  events: number
  tokens: number
  cost: number
  clientEvents: number
  platformEvents: number
}

type UsageSelectionSource = 'recommended_standard' | 'policy_default' | 'explicit' | 'fallback' | 'unknown'
type UsageSelectionFilter = UsageSelectionSource | 'all'

type SelectionSourceSummary = {
  source: UsageSelectionSource
  events: number
  cost: number
}

type AiEntitlementRow = {
  id: string
  user_id: string
  capability: string
  org_id: string | null
  project_id: string | null
  enabled: boolean
  expires_at: string | null
  note: string | null
  created_at: string
}

type PricingAdminRow = {
  id: string
  provider: string
  model_key: string
  model_match_patterns: string[]
  operation: 'chat.message' | 'image.generate' | 'video.submit'
  billing_unit: 'token' | 'image' | 'megapixel' | 'video' | 'quote'
  input_per_million_usd: number | null
  output_per_million_usd: number | null
  unit_price_usd: number | null
  estimate_label: string
  estimate_detail: string
  source: string
  source_url: string | null
  confidence: 'high' | 'medium' | 'low'
  premium: boolean
  active: boolean
  reviewed_on: string
  metadata: Record<string, unknown>
  updated_at: string
}

type PricingAdminDraft = {
  estimate_label: string
  estimate_detail: string
  input_per_million_usd: string
  output_per_million_usd: string
  unit_price_usd: string
  source: string
  source_url: string
  confidence: PricingAdminRow['confidence']
  premium: boolean
  active: boolean
  reviewed_on: string
}

function AiUsageTab() {
  const { activeOrg } = useOrg()
  const { projects } = useProject()
  const { user } = useAuth()
  const [usageRows, setUsageRows] = useState<GenerationUsageRow[]>([])
  const [entitlements, setEntitlements] = useState<AiEntitlementRow[]>([])
  const [pricingRows, setPricingRows] = useState<PricingAdminRow[]>([])
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, PricingAdminDraft>>({})
  const [pricingAllowed, setPricingAllowed] = useState<boolean | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingSaving, setPricingSaving] = useState<string | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [selectionSourceFilter, setSelectionSourceFilter] = useState<UsageSelectionFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const projectName = useMemo(() => {
    const map = new Map(projects.map(project => [project.id, project.name]))
    return (projectId: string | null) => projectId ? map.get(projectId) ?? 'Unknown client' : 'Workspace'
  }, [projects])
  const projectIds = useMemo(() => new Set(projects.map(project => project.id)), [projects])
  const selectionSourceRows = useMemo(() => summarizeSelectionSources(usageRows), [usageRows])
  const filteredUsageRows = useMemo(() => (
    selectionSourceFilter === 'all'
      ? usageRows
      : usageRows.filter(row => usageSelectionSource(row) === selectionSourceFilter)
  ), [selectionSourceFilter, usageRows])
  const summary = useMemo(() => summarizeWorkspaceUsage(filteredUsageRows), [filteredUsageRows])
  const clientRows = useMemo(() => summarizeByClient(filteredUsageRows, projects as UsageProject[]), [filteredUsageRows, projects])
  const providerRows = useMemo(() => summarizeByProvider(filteredUsageRows), [filteredUsageRows])
  const modelRows = useMemo(() => summarizeByModel(filteredUsageRows), [filteredUsageRows])
  const riskSummary = useMemo(() => summarizeUsageRisk(clientRows), [clientRows])

  const load = useCallback(async () => {
    if (!activeOrg?.id) return
    setLoading(true)
    setError(null)
    const since = usageWindowStartIso()
    const [usageResult, entitlementResult] = await Promise.all([
      supabase
        .from('generation_log')
        .select('id, project_id, provider, operation, model_used, input_tokens, output_tokens, cost_usd, usage_metadata, created_at')
        .eq('org_id', activeOrg.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('ai_user_entitlements')
        .select('id, user_id, capability, org_id, project_id, enabled, expires_at, note, created_at')
        .eq('enabled', true)
        .order('created_at', { ascending: false }),
    ])
    if (usageResult.error || entitlementResult.error) {
      setError(usageResult.error?.message ?? entitlementResult.error?.message ?? 'Could not load AI usage.')
      setUsageRows([])
      setEntitlements([])
    } else {
      setUsageRows((usageResult.data ?? []) as GenerationUsageRow[])
      const visibleEntitlements = ((entitlementResult.data ?? []) as AiEntitlementRow[])
        .filter(row => entitlementAppliesToWorkspace(row, activeOrg.id, projectIds))
      setEntitlements(visibleEntitlements)
    }
    setLoading(false)
  }, [activeOrg?.id, projectIds])

  const loadPricingCatalog = useCallback(async () => {
    if (!user) {
      setPricingAllowed(false)
      setPricingRows([])
      setPricingDrafts({})
      return
    }
    setPricingLoading(true)
    setPricingError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/model-pricing-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ action: 'list' }),
      })
      const data = await res.json().catch(() => ({})) as { rows?: PricingAdminRow[]; error?: string }
      if (res.status === 403 || res.status === 401) {
        setPricingAllowed(false)
        setPricingRows([])
        setPricingDrafts({})
        return
      }
      if (!res.ok) throw new Error(data.error ?? `Pricing catalog failed (HTTP ${res.status})`)
      const rows = data.rows ?? []
      setPricingAllowed(true)
      setPricingRows(rows)
      setPricingDrafts(Object.fromEntries(rows.map(row => [row.id, pricingDraftFromRow(row)])))
    } catch (e) {
      setPricingError(e instanceof Error ? e.message : 'Could not load pricing catalog.')
    } finally {
      setPricingLoading(false)
    }
  }, [user])

  async function savePricingRow(row: PricingAdminRow) {
    const draft = pricingDrafts[row.id]
    if (!draft) return
    setPricingSaving(row.id)
    setPricingError(null)
    try {
      const patch = pricingPatchFromDraft(draft)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/model-pricing-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ action: 'update', id: row.id, patch }),
      })
      const data = await res.json().catch(() => ({})) as { rows?: PricingAdminRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Save failed (HTTP ${res.status})`)
      const rows = data.rows ?? []
      setPricingRows(rows)
      setPricingDrafts(Object.fromEntries(rows.map(item => [item.id, pricingDraftFromRow(item)])))
    } catch (e) {
      setPricingError(e instanceof Error ? e.message : 'Could not save pricing row.')
    } finally {
      setPricingSaving(null)
    }
  }

  function updatePricingDraft(id: string, patch: Partial<PricingAdminDraft>) {
    setPricingDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadPricingCatalog() }, [loadPricingCatalog])

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">AI Usage</h2>
          <p className="text-sm text-gray-500 mt-0.5">Current-month spend, provider usage, and platform media access.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <UsageMetric label="Month spend" value={formatUsageUsd(summary.monthCost)} detail={`${summary.monthEvents} events`} />
        <UsageMetric
          label="Platform key events"
          value={String(summary.platformEvents)}
          detail={`${riskSummary.platformExposureClients} client spaces exposed`}
          tone={riskSummary.platformExposureClients > 0 ? 'danger' : summary.platformEvents > 0 ? 'warn' : 'neutral'}
        />
        <UsageMetric label="Images" value={String(summary.images)} detail={`${summary.imageEvents} image calls`} />
        <UsageMetric label="Videos" value={String(summary.videos)} detail={`${summary.videoEvents} video calls`} tone={summary.videoEvents > 0 ? 'warn' : 'neutral'} />
        <UsageMetric
          label="Budget risk"
          value={String(riskSummary.budgetAlerts)}
          detail={`${riskSummary.videoPolicyAlerts} media policy alerts`}
          tone={riskSummary.budgetAlerts > 0 || riskSummary.videoPolicyAlerts > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Model selection source</p>
            <p className="text-xs text-gray-500 mt-0.5">Filter usage by how Vera chose the model before generation.</p>
          </div>
          {selectionSourceFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setSelectionSourceFilter('all')}
              className="text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectionFilterButton
            active={selectionSourceFilter === 'all'}
            label="All"
            count={usageRows.length}
            cost={usageRows.reduce((sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : 0), 0)}
            onClick={() => setSelectionSourceFilter('all')}
          />
          {selectionSourceRows.map(row => (
            <SelectionFilterButton
              key={row.source}
              active={selectionSourceFilter === row.source}
              label={formatSelectionSourceLabel(row.source)}
              count={row.events}
              cost={row.cost}
              onClick={() => setSelectionSourceFilter(row.source)}
            />
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-800">Client spend controls</p>
            <p className="text-xs text-gray-500 mt-0.5">Current month by client space, budget cap, media policy, and key source.</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{clientRows.length} spaces</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {['Client', 'Spend', 'Budget', 'Activity', 'Media', 'Key source', 'Status'].map(label => (
                  <th key={label} className="px-4 py-2 text-left text-[10px] uppercase tracking-[0.05em] font-semibold text-gray-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 && (
                <tr><td colSpan={7}><EmptyLine text={loading ? 'Loading client spend...' : 'No client usage found this month.'} /></td></tr>
              )}
              {clientRows.map(row => {
                const status = clientUsageStatus(row)
                return (
                  <tr key={row.projectId ?? 'workspace'} className="border-b border-gray-100">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{row.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{row.slug ?? 'workspace scope'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{formatUsageUsd(row.cost)}</td>
                    <td className="px-4 py-3">
                      <BudgetCell cost={row.cost} budget={row.policy.monthly_budget_usd} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700">{row.events} events</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatCompactTokens(row.tokens)} tokens</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700">{row.imageEvents} image · {row.videoEvents} video</p>
                      <p className="text-xs text-gray-400 mt-0.5">{row.topModel ? `${formatProviderName(row.topProvider)} · ${row.topModel}` : 'No model yet'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-emerald-700 font-semibold">{row.clientEvents} client</p>
                      <p className={`text-xs mt-0.5 font-semibold ${row.platformEvents > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{row.platformEvents} platform</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={status.className}>{status.label}</span>
                      <p className="text-xs text-gray-400 mt-1 max-w-[180px]">{status.detail}</p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-800">Provider mix</p>
          </div>
          <div className="divide-y divide-gray-100">
            {providerRows.length === 0 && <EmptyLine text={loading ? 'Loading usage...' : 'No usage recorded in this window.'} />}
            {providerRows.map(row => (
              <div key={row.provider} className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-800">{formatProviderName(row.provider)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{row.events} events · {formatCompactTokens(row.tokens)} tokens</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{formatUsageUsd(row.cost)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{row.platformEvents} platform</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ShieldCheck size={15} className="text-gray-500" />
            <p className="text-sm font-medium text-gray-800">Operator access</p>
          </div>
          <div className="divide-y divide-gray-100">
            {entitlements.length === 0 && <EmptyLine text={loading ? 'Loading access...' : 'No active platform media entitlements visible.'} />}
            {entitlements.map(row => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{formatCapability(row.capability)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{row.user_id === user?.id ? user?.email ?? 'You' : shortId(row.user_id)}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Active</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">{formatEntitlementScope(row, projectName)}</p>
                {row.expires_at && <p className="text-xs text-gray-400 mt-1">Expires {formatSettingsDate(row.expires_at)}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {pricingAllowed !== false && (
        <PricingCatalogAdmin
          rows={pricingRows}
          drafts={pricingDrafts}
          loading={pricingLoading}
          error={pricingError}
          savingId={pricingSaving}
          allowed={pricingAllowed}
          onRefresh={() => void loadPricingCatalog()}
          onDraftChange={updatePricingDraft}
          onSave={savePricingRow}
        />
      )}

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-800">Model spend concentration</p>
          <p className="text-xs text-gray-500 mt-0.5">Highest-cost provider and model pairs for the current month.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {['Model', 'Operation', 'Events', 'Tokens', 'Key source', 'Cost'].map(label => (
                  <th key={label} className="px-4 py-2 text-left text-[10px] uppercase tracking-[0.05em] font-semibold text-gray-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelRows.length === 0 && (
                <tr><td colSpan={6}><EmptyLine text={loading ? 'Loading model spend...' : 'No model spend found this month.'} /></td></tr>
              )}
              {modelRows.slice(0, 12).map(row => (
                <tr key={row.key} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-800">{formatProviderName(row.provider)}</p>
                    <p className="text-xs text-gray-500 font-mono max-w-[260px] truncate" title={row.model}>{row.model}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{formatUsageOperation(row.operation)}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{row.events}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{formatCompactTokens(row.tokens)}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-semibold text-emerald-700">{row.clientEvents} client</span>
                    <span className="mx-1 text-gray-300">/</span>
                    <span className={`font-semibold ${row.platformEvents > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{row.platformEvents} platform</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-gray-900">{formatUsageUsd(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-800">Recent generation events</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {['When', 'Client', 'Operation', 'Provider', 'Model', 'Key', 'Selection', 'Cost'].map(label => (
                  <th key={label} className="px-4 py-2 text-left text-[10px] uppercase tracking-[0.05em] font-semibold text-gray-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsageRows.length === 0 && (
                <tr><td colSpan={8}><EmptyLine text={loading ? 'Loading usage...' : 'No generation events found for this filter.'} /></td></tr>
              )}
              {filteredUsageRows.slice(0, 40).map(row => {
                const metadata = usageMetadata(row)
                const keySource = typeof metadata.key_source === 'string' ? metadata.key_source : 'unknown'
                const selectionSource = usageSelectionSource(row)
                return (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-xs text-gray-500">{formatSettingsDate(row.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{projectName(row.project_id)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{formatUsageOperation(row.operation)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{formatProviderName(row.provider)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono max-w-[220px] truncate" title={row.model_used ?? ''}>{row.model_used ?? 'unknown'}</td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span className={keySource === 'platform' ? 'text-amber-700' : keySource === 'client' ? 'text-emerald-700' : 'text-gray-400'}>{formatKeySourceLabel(keySource)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{formatSelectionSourceLabel(selectionSource)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{typeof row.cost_usd === 'number' ? formatUsageUsd(row.cost_usd) : 'n/a'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function PricingCatalogAdmin({
  rows,
  drafts,
  loading,
  error,
  savingId,
  allowed,
  onRefresh,
  onDraftChange,
  onSave,
}: {
  rows: PricingAdminRow[]
  drafts: Record<string, PricingAdminDraft>
  loading: boolean
  error: string | null
  savingId: string | null
  allowed: boolean | null
  onRefresh: () => void
  onDraftChange: (id: string, patch: Partial<PricingAdminDraft>) => void
  onSave: (row: PricingAdminRow) => void
}) {
  const activeRows = rows.filter(row => row.active).length
  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Database size={16} className="text-gray-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-800">Operator pricing catalog</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Update model prices, review dates, sources, and premium flags without a code deploy.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
            {allowed === null ? 'Checking access' : `${activeRows}/${rows.length} active`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {allowed === null && rows.length === 0 && <EmptyLine text="Checking operator pricing access..." />}
      {allowed === true && rows.length === 0 && <EmptyLine text={loading ? 'Loading pricing catalog...' : 'No pricing rows found.'} />}

      <div className="grid gap-3 p-4">
        {rows.map(row => {
          const draft = drafts[row.id] ?? pricingDraftFromRow(row)
          const disabled = savingId === row.id
          return (
            <div key={row.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{formatProviderName(row.provider)}</span>
                    <span className="text-sm font-semibold text-gray-900">{row.model_key}</span>
                    <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-500">{pricingOperationLabel(row.operation)}</span>
                    <span className={pricingStatusClass(draft.active)}>{draft.active ? 'Active' : 'Inactive'}</span>
                    {draft.premium && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Premium</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {pricingUnitLabel(row.billing_unit)} billing. Updated {formatSettingsDate(row.updated_at)}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSave(row)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  <Save size={12} />
                  {disabled ? 'Saving...' : 'Save row'}
                </button>
              </div>

              <div className="grid lg:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Estimate label</span>
                  <input
                    value={draft.estimate_label}
                    onChange={e => onDraftChange(row.id, { estimate_label: e.target.value })}
                    className="input w-full bg-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Unit price USD</span>
                  <input
                    type="number"
                    step="0.001"
                    value={draft.unit_price_usd}
                    onChange={e => onDraftChange(row.id, { unit_price_usd: e.target.value })}
                    className="input w-full bg-white"
                    placeholder="n/a"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Reviewed on</span>
                  <input
                    type="date"
                    value={draft.reviewed_on}
                    onChange={e => onDraftChange(row.id, { reviewed_on: e.target.value })}
                    className="input w-full bg-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Input per 1M tokens</span>
                  <input
                    type="number"
                    step="0.01"
                    value={draft.input_per_million_usd}
                    onChange={e => onDraftChange(row.id, { input_per_million_usd: e.target.value })}
                    className="input w-full bg-white"
                    placeholder="n/a"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Output per 1M tokens</span>
                  <input
                    type="number"
                    step="0.01"
                    value={draft.output_per_million_usd}
                    onChange={e => onDraftChange(row.id, { output_per_million_usd: e.target.value })}
                    className="input w-full bg-white"
                    placeholder="n/a"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Confidence</span>
                  <select
                    value={draft.confidence}
                    onChange={e => onDraftChange(row.id, { confidence: e.target.value as PricingAdminRow['confidence'] })}
                    className="input w-full bg-white"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>

              <div className="grid lg:grid-cols-[0.8fr_1.2fr_auto] gap-3 mt-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Source key</span>
                  <input
                    value={draft.source}
                    onChange={e => onDraftChange(row.id, { source: e.target.value })}
                    className="input w-full bg-white"
                    placeholder="provider_pricing_YYYY_MM_DD"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-500">Source URL</span>
                  <div className="flex gap-2">
                    <input
                      value={draft.source_url}
                      onChange={e => onDraftChange(row.id, { source_url: e.target.value })}
                      className="input flex-1 bg-white"
                      placeholder="https://provider.example/pricing"
                    />
                    {draft.source_url && (
                      <a
                        href={draft.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center w-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-800"
                        title="Open source"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </label>
                <div className="flex items-end gap-3 pb-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={draft.premium}
                      onChange={e => onDraftChange(row.id, { premium: e.target.checked })}
                    />
                    Premium
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={e => onDraftChange(row.id, { active: e.target.checked })}
                    />
                    Active
                  </label>
                </div>
              </div>

              <label className="space-y-1 block mt-3">
                <span className="text-[11px] font-medium text-gray-500">Estimate detail</span>
                <textarea
                  value={draft.estimate_detail}
                  onChange={e => onDraftChange(row.id, { estimate_detail: e.target.value })}
                  className="input w-full min-h-[72px] bg-white resize-y"
                />
              </label>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="px-4 py-3">
      <label className="text-xs font-medium text-gray-700 mb-0.5 block">{label}</label>
      {hint && <p className="text-[11px] text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

function TagField({ label, hint, items, input, setInput, onAdd, onRemove, color }: {
  label: string; hint: string; items: string[]; input: string;
  setInput: (v: string) => void; onAdd: () => void; onRemove: (i: number) => void;
  color: 'violet' | 'blue' | 'red'
}) {
  const colorMap = {
    violet: 'bg-gray-100 text-gray-900',
    blue:   'bg-blue-100 text-blue-700',
    red:    'bg-red-100 text-red-700',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      <div>
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {items.map((item, i) => (
          <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${colorMap[color]}`}>
            {item}
            <button onClick={() => onRemove(i)} className="opacity-60 hover:opacity-100 ml-0.5">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          className="input flex-1" placeholder="Type and press Enter…"
        />
        <button onClick={onAdd} disabled={!input.trim()}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors">
          Add
        </button>
      </div>
    </div>
  )
}

function UsageMetric({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'neutral' | 'warn' | 'danger' }) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50'
      : 'border-gray-200 bg-white'
  const labelClass = tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-500'
  const detailClass = tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-400'
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className={`text-[11px] font-medium ${labelClass}`}>{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1">{value}</p>
      <p className={`text-xs mt-1 ${detailClass}`}>{detail}</p>
    </div>
  )
}

function SelectionFilterButton({
  active,
  label,
  count,
  cost,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  cost: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition-colors ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
    >
      <span className="block text-xs font-semibold">{label}</span>
      <span className={`block text-[11px] mt-0.5 ${active ? 'text-gray-200' : 'text-gray-400'}`}>
        {count} events · {formatUsageUsd(cost)}
      </span>
    </button>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <div className="px-4 py-6 text-sm text-gray-400">{text}</div>
}

function BudgetCell({ cost, budget }: { cost: number; budget: number | null }) {
  if (!budget) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-500">No cap</p>
        <p className="text-xs text-gray-400 mt-0.5">Set per client</p>
      </div>
    )
  }
  const percent = Math.min(100, Math.round((cost / budget) * 100))
  const barClass = cost >= budget ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="min-w-[130px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">{formatUsageUsd(cost)}</p>
        <p className="text-xs text-gray-400">{percent}%</p>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1">cap {formatUsageUsd(budget)}</p>
    </div>
  )
}

function summarizeWorkspaceUsage(rows: GenerationUsageRow[]) {
  return rows.reduce((summary, row) => {
    const metadata = usageMetadata(row)
    const operation = row.operation ?? ''
    const keySource = metadata.key_source
    summary.monthEvents += 1
    summary.monthCost += typeof row.cost_usd === 'number' ? row.cost_usd : 0
    if (operation.startsWith('image.')) {
      summary.imageEvents += 1
      summary.images += numberFromUnknown(metadata.num_images, 1)
    }
    if (operation.startsWith('video.')) {
      summary.videoEvents += 1
      summary.videos += 1
    }
    if (keySource === 'platform') summary.platformEvents += 1
    if (keySource === 'client') summary.clientEvents += 1
    return summary
  }, {
    monthEvents: 0,
    monthCost: 0,
    imageEvents: 0,
    images: 0,
    videoEvents: 0,
    videos: 0,
    platformEvents: 0,
    clientEvents: 0,
  })
}

function summarizeSelectionSources(rows: GenerationUsageRow[]): SelectionSourceSummary[] {
  const map = new Map<UsageSelectionSource, SelectionSourceSummary>()
  rows.forEach(row => {
    const source = usageSelectionSource(row)
    const current = map.get(source) ?? { source, events: 0, cost: 0 }
    current.events += 1
    current.cost += typeof row.cost_usd === 'number' ? row.cost_usd : 0
    map.set(source, current)
  })
  const order: UsageSelectionSource[] = ['recommended_standard', 'policy_default', 'explicit', 'fallback', 'unknown']
  return order
    .map(source => map.get(source) ?? { source, events: 0, cost: 0 })
    .filter(row => row.events > 0)
}

function summarizeByClient(rows: GenerationUsageRow[], projects: UsageProject[]): ClientUsageSummary[] {
  const projectsById = new Map(projects.map(project => [project.id, project]))
  const modelCounts = new Map<string, Map<string, { model: string; provider: string | null; count: number }>>()
  const map = new Map<string, ClientUsageSummary>()
  rows.forEach(row => {
    const key = row.project_id ?? 'workspace'
    const project = row.project_id ? projectsById.get(row.project_id) : null
    const current = map.get(key) ?? {
      projectId: row.project_id,
      name: project?.name ?? (row.project_id ? 'Unknown client' : 'Workspace'),
      slug: project?.slug ?? null,
      policy: parseUsageAiPolicy(project?.ai_policy),
      events: 0,
      tokens: 0,
      cost: 0,
      imageEvents: 0,
      videoEvents: 0,
      clientEvents: 0,
      platformEvents: 0,
      unknownEvents: 0,
      topModel: null,
      topProvider: null,
    }
    const metadata = usageMetadata(row)
    const operation = row.operation ?? ''
    const cost = typeof row.cost_usd === 'number' ? row.cost_usd : 0
    current.events += 1
    current.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
    current.cost += cost
    if (operation.startsWith('image.')) current.imageEvents += 1
    if (operation.startsWith('video.')) current.videoEvents += 1
    if (metadata.key_source === 'client') current.clientEvents += 1
    else if (metadata.key_source === 'platform') current.platformEvents += 1
    else current.unknownEvents += 1
    if (row.model_used) {
      const modelsForClient = modelCounts.get(key) ?? new Map<string, { model: string; provider: string | null; count: number }>()
      const modelKey = `${row.provider ?? 'unknown'}:${row.model_used}`
      const model = modelsForClient.get(modelKey) ?? { model: row.model_used, provider: row.provider, count: 0 }
      model.count += 1
      modelsForClient.set(modelKey, model)
      modelCounts.set(key, modelsForClient)
    }
    map.set(key, current)
  })
  map.forEach((summary, key) => {
    const top = [...(modelCounts.get(key)?.values() ?? [])].sort((a, b) => b.count - a.count)[0]
    if (top) {
      summary.topModel = top.model
      summary.topProvider = top.provider
    }
  })
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.events - a.events || a.name.localeCompare(b.name))
}

function summarizeByProvider(rows: GenerationUsageRow[]) {
  const map = new Map<string, { provider: string; events: number; tokens: number; cost: number; platformEvents: number }>()
  rows.forEach(row => {
    const provider = row.provider ?? 'unknown'
    const current = map.get(provider) ?? { provider, events: 0, tokens: 0, cost: 0, platformEvents: 0 }
    current.events += 1
    current.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
    current.cost += typeof row.cost_usd === 'number' ? row.cost_usd : 0
    if (usageMetadata(row).key_source === 'platform') current.platformEvents += 1
    map.set(provider, current)
  })
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.events - a.events)
}

function summarizeByModel(rows: GenerationUsageRow[]): ModelUsageSummary[] {
  const map = new Map<string, ModelUsageSummary>()
  rows.forEach(row => {
    const provider = row.provider ?? 'unknown'
    const model = row.model_used ?? 'unknown'
    const operation = row.operation ?? 'unknown'
    const key = `${provider}:${model}:${operation}`
    const current = map.get(key) ?? {
      key,
      provider,
      model,
      operation,
      events: 0,
      tokens: 0,
      cost: 0,
      clientEvents: 0,
      platformEvents: 0,
    }
    current.events += 1
    current.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
    current.cost += typeof row.cost_usd === 'number' ? row.cost_usd : 0
    const keySource = usageMetadata(row).key_source
    if (keySource === 'client') current.clientEvents += 1
    if (keySource === 'platform') current.platformEvents += 1
    map.set(key, current)
  })
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.events - a.events)
}

function summarizeUsageRisk(rows: ClientUsageSummary[]) {
  return rows.reduce((summary, row) => {
    if (row.platformEvents > 0 && !isPlatformMediaProject(row.slug)) summary.platformExposureClients += 1
    if (row.policy.monthly_budget_usd && row.cost >= row.policy.monthly_budget_usd) summary.budgetAlerts += 1
    if (row.videoEvents > 0 && !row.policy.standard_video_enabled) summary.videoPolicyAlerts += 1
    return summary
  }, { platformExposureClients: 0, budgetAlerts: 0, videoPolicyAlerts: 0 })
}

function clientUsageStatus(row: ClientUsageSummary) {
  const budget = row.policy.monthly_budget_usd
  const budgetPercent = budget ? row.cost / budget : 0
  if (row.platformEvents > 0 && !isPlatformMediaProject(row.slug)) {
    return {
      level: 'danger' as const,
      kind: 'platform-key' as const,
      label: 'Platform key used',
      detail: 'This client should run on client-owned keys.',
      className: 'rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700',
    }
  }
  if (budget && row.cost >= budget) {
    return {
      level: 'danger' as const,
      kind: 'budget' as const,
      label: 'Over cap',
      detail: 'Disable media or raise the client budget.',
      className: 'rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700',
    }
  }
  if (row.videoEvents > 0 && !row.policy.standard_video_enabled) {
    return {
      level: 'warn' as const,
      kind: 'media-policy' as const,
      label: 'Video while locked',
      detail: 'Review historical events and client policy.',
      className: 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700',
    }
  }
  if (budgetPercent >= 0.8) {
    return {
      level: 'warn' as const,
      kind: 'budget' as const,
      label: 'Near cap',
      detail: 'Watch premium media and video usage.',
      className: 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700',
    }
  }
  if (row.events === 0) {
    return {
      level: 'neutral' as const,
      kind: 'empty' as const,
      label: 'No usage',
      detail: 'No generation events this month.',
      className: 'rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500',
    }
  }
  return {
    level: 'ok' as const,
    kind: 'ok' as const,
    label: 'Normal',
    detail: row.clientEvents > 0 ? 'Spend is client-key backed.' : 'No client-key spend yet.',
    className: 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700',
  }
}

function parseUsageAiPolicy(value: unknown): UsageAiPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      monthly_budget_usd: null,
      images_enabled: true,
      standard_video_enabled: false,
      premium_media_enabled: false,
    }
  }
  const raw = value as Record<string, unknown>
  return {
    monthly_budget_usd: typeof raw.monthly_budget_usd === 'number' && Number.isFinite(raw.monthly_budget_usd) && raw.monthly_budget_usd > 0 ? raw.monthly_budget_usd : null,
    images_enabled: typeof raw.images_enabled === 'boolean' ? raw.images_enabled : true,
    standard_video_enabled: typeof raw.standard_video_enabled === 'boolean' ? raw.standard_video_enabled : false,
    premium_media_enabled: typeof raw.premium_media_enabled === 'boolean' ? raw.premium_media_enabled : false,
  }
}

function isPlatformMediaProject(slug: string | null) {
  return slug === 'innovareai-brand'
}

function usageMetadata(row: GenerationUsageRow): Record<string, unknown> {
  const value = row.usage_metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function usageSelectionSource(row: GenerationUsageRow): UsageSelectionSource {
  const value = usageMetadata(row).model_selection_source
  if (
    value === 'recommended_standard' ||
    value === 'policy_default' ||
    value === 'explicit' ||
    value === 'fallback'
  ) return value
  return 'unknown'
}

function formatSelectionSourceLabel(value: UsageSelectionSource) {
  if (value === 'recommended_standard') return 'Recommended'
  if (value === 'policy_default') return 'Policy default'
  if (value === 'explicit') return 'Explicit override'
  if (value === 'fallback') return 'Fallback'
  return 'Unknown'
}

function usageWindowStartIso() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

function numberFromUnknown(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatUsageUsd(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}

function pricingDraftFromRow(row: PricingAdminRow): PricingAdminDraft {
  return {
    estimate_label: row.estimate_label,
    estimate_detail: row.estimate_detail,
    input_per_million_usd: numberInputValue(row.input_per_million_usd),
    output_per_million_usd: numberInputValue(row.output_per_million_usd),
    unit_price_usd: numberInputValue(row.unit_price_usd),
    source: row.source,
    source_url: row.source_url ?? '',
    confidence: row.confidence,
    premium: row.premium,
    active: row.active,
    reviewed_on: row.reviewed_on,
  }
}

function pricingPatchFromDraft(draft: PricingAdminDraft) {
  return {
    estimate_label: draft.estimate_label.trim(),
    estimate_detail: draft.estimate_detail.trim(),
    input_per_million_usd: nullableNumberInput(draft.input_per_million_usd),
    output_per_million_usd: nullableNumberInput(draft.output_per_million_usd),
    unit_price_usd: nullableNumberInput(draft.unit_price_usd),
    source: draft.source.trim(),
    source_url: draft.source_url.trim() || null,
    confidence: draft.confidence,
    premium: draft.premium,
    active: draft.active,
    reviewed_on: draft.reviewed_on,
  }
}

function numberInputValue(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function nullableNumberInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function pricingOperationLabel(value: PricingAdminRow['operation']) {
  if (value === 'chat.message') return 'Text'
  if (value === 'image.generate') return 'Image'
  if (value === 'video.submit') return 'Video'
  return value
}

function pricingUnitLabel(value: PricingAdminRow['billing_unit']) {
  if (value === 'token') return 'Token'
  if (value === 'image') return 'Image'
  if (value === 'megapixel') return 'Megapixel'
  if (value === 'video') return 'Video'
  if (value === 'quote') return 'Quote'
  return value
}

function pricingStatusClass(active: boolean) {
  return active
    ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
    : 'rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500'
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatProviderName(value: string | null) {
  if (!value) return 'Unknown'
  if (value === 'openrouter') return 'OpenRouter'
  if (value === 'openai') return 'OpenAI'
  if (value === 'fal') return 'FAL'
  if (value === 'anthropic') return 'Anthropic'
  return value
}

function formatUsageOperation(value: string | null) {
  if (!value) return 'Unknown'
  return value.split('.').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function formatKeySourceLabel(value: string) {
  if (value === 'platform') return 'Platform'
  if (value === 'client') return 'Client'
  return 'Unknown'
}

function formatCapability(value: string) {
  if (value === 'platform_fal_video') return 'Platform standard video'
  if (value === 'platform_premium_video') return 'Platform premium video'
  if (value === 'platform_fal_image') return 'Platform media image'
  return value.replace(/_/g, ' ')
}

function formatEntitlementScope(row: AiEntitlementRow, projectName: (projectId: string | null) => string) {
  if (row.project_id) return `Scope: ${projectName(row.project_id)}`
  if (row.org_id) return 'Scope: workspace'
  return 'Scope: all client spaces'
}

function entitlementAppliesToWorkspace(row: AiEntitlementRow, orgId: string, projectIds: Set<string>) {
  if (row.project_id) return projectIds.has(row.project_id)
  if (row.org_id) return row.org_id === orgId
  return true
}

function shortId(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function formatSettingsDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState<Tab>(() => initialSettingsTab())
  const { activeOrg, loading } = useOrg()

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
  )

  if (!activeOrg) return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      <Settings2 size={32} className="mb-3 text-gray-300" />
      <p className="text-sm">No workspace found. Contact your administrator.</p>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">{activeOrg.name}</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Tab sidebar */}
        <nav className="w-44 flex-shrink-0 bg-white border-r border-gray-100 px-2 py-4 space-y-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                tab === t.id
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {tab === 'workspace'    && <WorkspaceTab />}
          {tab === 'team'         && <TeamTab />}
          {tab === 'brand'        && <BrandVoiceTab />}
          {tab === 'integrations' && <IntegrationsTab />}
          {tab === 'usage'        && <AiUsageTab />}
        </div>
      </div>
    </div>
  )
}
