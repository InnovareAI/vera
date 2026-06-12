import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, PlatformConfig } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import {
  Settings2, Users, Mic2, Plug, Building2, Save,
  CheckCircle2, AlertCircle, Sun, Moon, Monitor
} from 'lucide-react'
import { PublishersCard } from '../components/PublishersCard'
import { ClientIntegrationsCard } from '../components/ClientIntegrationsCard'
import { useTheme, type Theme } from '../lib/themeContext'

type Tab = 'workspace' | 'team' | 'brand' | 'integrations'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'workspace',    label: 'Workspace',    icon: Building2 },
  { id: 'team',         label: 'Access',       icon: Users },
  { id: 'brand',        label: 'Brand Voice',  icon: Mic2 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
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

type PlatformRuleSetting = {
  id: string
  label: string
  initials: string
  swatch: string
  aliases?: string[]
  charPlaceholder: string
  noteTitle: string
  note: string
}

const PLATFORM_RULES: PlatformRuleSetting[] = [
  { id: 'linkedin', label: 'LinkedIn', initials: 'Li', swatch: 'bg-blue-100 text-blue-700', charPlaceholder: '3000', noteTitle: 'Connected through Unipile', note: 'Use this section for channel-specific voice, limits, and model overrides. OAuth and publishing permissions live in Agentic integrations above.' },
  { id: 'x', label: 'X', initials: 'X', swatch: 'bg-sky-100 text-sky-700', aliases: ['twitter'], charPlaceholder: '280', noteTitle: 'Manual-first channel', note: 'X stays lower priority because API access can be expensive. Use these rules for drafts and manual handoff until an approved connector is enabled.' },
  { id: 'instagram', label: 'Instagram', initials: 'IG', swatch: 'bg-pink-100 text-pink-700', charPlaceholder: '2200', noteTitle: 'Meta connector', note: 'Use this section for caption rules and creative tone. Account permissions are managed through the Meta integration above.' },
  { id: 'facebook', label: 'Facebook', initials: 'FB', swatch: 'bg-indigo-100 text-indigo-700', charPlaceholder: '63206', noteTitle: 'Meta connector', note: 'Use this section for Page copy rules. Account permissions are managed through the Meta integration above.' },
  { id: 'youtube', label: 'YouTube', initials: 'YT', swatch: 'bg-red-100 text-red-700', charPlaceholder: '5000', noteTitle: 'Google connector', note: 'Use this section for video titles, descriptions, Shorts, and long-form tone. Channel access is managed through the YouTube integration above.' },
  { id: 'medium', label: 'Medium', initials: 'Me', swatch: 'bg-stone-100 text-stone-700', charPlaceholder: '10000', noteTitle: 'Manual publishing', note: 'No API token needed. Add the Medium profile or publication URL in Agentic integrations for RSS ingestion and manual handoff.' },
  { id: 'quora', label: 'Quora', initials: 'Qu', swatch: 'bg-red-100 text-red-700', charPlaceholder: '5000', noteTitle: 'Answer handoff', note: 'Use this section for answer style, proof rules, and CTA restraint. Final posting remains manual unless a client-specific adapter is approved.' },
  { id: 'reddit', label: 'Reddit', initials: 'Rd', swatch: 'bg-orange-100 text-orange-700', charPlaceholder: '40000', noteTitle: 'Community-first channel', note: 'Use this section for subreddit tone, rule sensitivity, and non-promotional framing. Vera should research and draft before any human-approved posting.' },
  { id: 'blog', label: 'Blog', initials: 'Bl', swatch: 'bg-amber-100 text-amber-700', charPlaceholder: '10000', noteTitle: 'CMS handoff', note: 'Use this section for article structure and editorial tone. Publishing credentials belong in WordPress or CMS integrations above.' },
  { id: 'email', label: 'Email', initials: 'Em', swatch: 'bg-emerald-100 text-emerald-700', charPlaceholder: '5000', noteTitle: 'Nurture channel', note: 'Use this section for newsletter or nurture tone. ESP credentials and sending approvals should stay in dedicated integrations, not in channel rules.' },
]
function findPlatformRuleConfig(existing: Partial<PlatformConfig>[], setting: PlatformRuleSetting) {
  const aliases = new Set([setting.id, ...(setting.aliases ?? [])])
  const exact = existing.find(config => config.platform === setting.id)
  const legacy = existing.find(config => config.platform && aliases.has(config.platform))
  const found = exact ?? legacy
  return found ? { ...found, platform: setting.id } : null
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
        <p className="text-sm text-gray-500 mt-0.5">Invite someone into a client space and set their role. Organisation-wide staff access is coming later — for now, access is scoped per client.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Client space</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className={input}>
            {projects.length === 0 && <option value="">No client spaces yet — add a client first</option>}
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
            <option value="viewer">Viewer — can view</option>
            <option value="reviewer">Reviewer — can comment &amp; approve</option>
            <option value="editor">Editor — can create &amp; edit</option>
            <option value="owner">Owner — full access</option>
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
  const { activeOrg } = useOrg()
  const activeOrgId = activeOrg?.id
  const [configs, setConfigs] = useState<Partial<PlatformConfig>[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('platform_configs').select('*').eq('org_id', activeOrgId)
      .then(({ data }) => {
        const existing = data || []
        const merged = PLATFORM_RULES.map(setting => {
          const found = findPlatformRuleConfig(existing, setting)
          return found ?? { platform: setting.id, is_active: false, hashtag_limit: 5, org_id: activeOrgId }
        })
        setConfigs(merged)
      })
  }, [activeOrgId])

  function update(platform: string, patch: Partial<PlatformConfig>) {
    setConfigs(prev => prev.map(c => c.platform === platform ? { ...c, ...patch } : c))
  }

  async function handleSave(platform: string) {
    if (!activeOrg) return
    setSaving(platform)
    const config = configs.find(c => c.platform === platform)
    if (!config) { setSaving(null); return }
    if (config.id) {
      await supabase.from('platform_configs').update(config).eq('id', config.id)
    } else {
      const { data } = await supabase.from('platform_configs')
        .insert({ ...config, org_id: activeOrg.id }).select().single()
      if (data) setConfigs(prev => prev.map(c => c.platform === platform ? data : c))
    }
    setSaving(null)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Agentic integrations</h2>
        <p className="text-sm text-gray-500 mt-0.5">Connect client-owned accounts and define the channels Vera can read, analyze, draft for, or publish to.</p>
      </div>

      <ClientIntegrationsCard />

      {/* Connected blogs / CMSes / Git publishers */}
      <PublishersCard />

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Channel writing rules</h3>
          <p className="text-xs text-gray-500 mt-0.5">Set per-channel limits, tone, and model overrides. Credentials stay in the integration cards above, not in this rules section.</p>
        </div>
        {PLATFORM_RULES.map(setting => {
          const platform = setting.id
          const config = configs.find(c => c.platform === platform) ?? {}

          return (
            <div key={platform} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Platform header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${setting.swatch}`}>
                  {setting.initials}
                </div>
                <span className="flex-1 text-sm font-medium text-gray-800">{setting.label}</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-gray-500">{config.is_active ? 'Active' : 'Inactive'}</span>
                  <div
                    onClick={() => update(platform, { is_active: !config.is_active })}
                    className={`w-9 h-5 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${config.is_active ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${config.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                </label>
              </div>

              {/* Config fields */}
              <div className="px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Char Limit</label>
                    <input
                      type="number"
                      value={config.char_limit ?? ''}
                      onChange={e => update(platform, { char_limit: Number(e.target.value) || undefined })}
                      className="input w-full"
                      placeholder={setting.charPlaceholder}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Max Hashtags</label>
                    <input
                      type="number"
                      value={config.hashtag_limit ?? 5}
                      onChange={e => update(platform, { hashtag_limit: Number(e.target.value) })}
                      className="input w-full"
                      placeholder="5"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Model Override</label>
                  <input
                    value={config.model_override ?? ''}
                    onChange={e => update(platform, { model_override: e.target.value || undefined })}
                    className="input w-full"
                    placeholder="e.g. claude-opus-4-6 (leave blank for default)"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Tone Override</label>
                  <input
                    value={config.tone_override ?? ''}
                    onChange={e => update(platform, { tone_override: e.target.value || undefined })}
                    className="input w-full"
                    placeholder="e.g. professional and concise"
                  />
                </div>

                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs font-medium text-gray-700">{setting.noteTitle}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{setting.note}</p>
                </div>

                <button onClick={() => handleSave(platform)} disabled={saving === platform}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
                  <Save size={12} />
                  {saving === platform ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* AI Model Settings */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-800">AI Model Settings</div>
          <div className="text-xs text-gray-400 mt-0.5">Configure the models powering VERA</div>
        </div>
        <div className="px-4 py-3 space-y-3">
          {[
            { key: 'default_text_model', label: 'Default Text Model', placeholder: 'claude-sonnet-4-6' },
            { key: 'default_image_model', label: 'Image Generation Model', placeholder: 'google/gemini-3.1-flash-image-preview' },
          ].map(({ key, label, placeholder }) => (
            <Field key={key} label={label}>
              <input className="input" placeholder={placeholder} defaultValue="" />
            </Field>
          ))}
          <p className="text-[10px] text-gray-400">
            <AlertCircle size={10} className="inline mr-0.5" />
            Model overrides apply to new generations only. Stored in org settings.
          </p>
        </div>
      </div>
    </div>
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
        </div>
      </div>
    </div>
  )
}
