import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, PlatformConfig } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useAuth } from '../lib/auth'
import {
  Settings2, Users, Mic2, Plug, Building2, Save, Plus, Trash2,
  Eye, EyeOff, CheckCircle2, XCircle, AlertCircle
} from 'lucide-react'

type Tab = 'workspace' | 'team' | 'brand' | 'integrations'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'workspace',    label: 'Workspace',    icon: Building2 },
  { id: 'team',         label: 'Team',         icon: Users },
  { id: 'brand',        label: 'Brand Voice',  icon: Mic2 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
]

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'quora']
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', twitter: 'X (Twitter)', instagram: 'Instagram',
  facebook: 'Facebook', quora: 'Quora',
}

// ─── Workspace Tab ────────────────────────────────────────────────────────────
function WorkspaceTab() {
  const { activeOrg, refetch } = useOrg()
  const [form, setForm] = useState({
    name: '', website: '', industry: '', timezone: 'Europe/Berlin', locale: 'en',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('organizations').select('*').eq('id', activeOrg.id).single()
      .then(({ data }) => {
        if (data) setForm({
          name:      data.name ?? '',
          website:   data.website ?? '',
          industry:  data.industry ?? '',
          timezone:  data.timezone ?? 'Europe/Berlin',
          locale:    data.locale ?? 'en',
        })
      })
  }, [activeOrg?.id])

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
    </div>
  )
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────
interface Member {
  id: string
  user_id: string
  role: string
  users: { email: string; full_name?: string } | null
}

function TeamTab() {
  const { activeOrg, activeRole } = useOrg()
  const { user } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{type: 'ok'|'err'; text: string} | null>(null)

  const canManage = ['owner','admin'].includes(activeRole ?? '')

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('org_members')
      .select('id, user_id, role, users(email, full_name)')
      .eq('org_id', activeOrg.id)
      .then(({ data }) => { setMembers((data as unknown as Member[]) || []); setLoading(false) })
  }, [activeOrg?.id])

  async function handleInvite() {
    if (!activeOrg || !inviteEmail.trim()) return
    setInviting(true)
    setInviteMsg(null)

    // Find auth user by email
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', inviteEmail.trim())
      .single()

    if (!existing) {
      setInviteMsg({ type: 'err', text: 'No account found with that email. Ask them to sign up first.' })
      setInviting(false)
      return
    }

    const { error } = await supabase.from('org_members').insert({
      user_id: existing.id,
      org_id: activeOrg.id,
      role: inviteRole,
    })

    if (error) {
      setInviteMsg({ type: 'err', text: error.message })
    } else {
      setInviteMsg({ type: 'ok', text: `${inviteEmail} added as ${inviteRole}.` })
      setInviteEmail('')
      // Refresh
      supabase.from('org_members')
        .select('id, user_id, role, users(email, full_name)')
        .eq('org_id', activeOrg.id)
        .then(({ data }) => setMembers((data as unknown as Member[]) || []))
    }
    setInviting(false)
  }

  async function handleRemove(memberId: string) {
    await supabase.from('org_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    await supabase.from('org_members').update({ role: newRole }).eq('id', memberId)
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage who has access to this workspace.</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {members.map((m, i) => (
            <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
                {(m.users?.email ?? '?').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">
                  {m.users?.full_name || m.users?.email || m.user_id}
                </div>
                <div className="text-xs text-gray-400 truncate">{m.users?.email}</div>
              </div>
              {canManage && m.user_id !== user?.id ? (
                <>
                  <select value={m.role} onChange={e => handleRoleChange(m.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 bg-white">
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="agency_admin">Agency Admin</option>
                  </select>
                  <button onClick={() => handleRemove(m.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500 capitalize">{m.role}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Add Member</p>
          <div className="flex gap-2">
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="Email address" className="input flex-1" />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              className="input w-32">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="agency_admin">Agency Admin</option>
            </select>
            <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
              <Plus size={14} />
              {inviting ? 'Adding…' : 'Add'}
            </button>
          </div>
          {inviteMsg && (
            <p className={`text-xs flex items-center gap-1.5 ${inviteMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
              {inviteMsg.type === 'ok' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {inviteMsg.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Brand Voice Tab ──────────────────────────────────────────────────────────
function BrandVoiceTab() {
  const { activeOrg } = useOrg()
  const [bv, setBv] = useState<Partial<BrandVoice>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toneInput, setToneInput] = useState('')
  const [ruleInput, setRuleInput] = useState('')
  const [forbidInput, setForbidInput] = useState('')

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('brand_voice').select('*').eq('org_id', activeOrg.id).maybeSingle()
      .then(({ data }) => { if (data) setBv(data) })
  }, [activeOrg?.id])

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
  const [configs, setConfigs] = useState<Partial<PlatformConfig>[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('platform_configs').select('*').eq('org_id', activeOrg.id)
      .then(({ data }) => {
        const existing = data || []
        // Ensure all platforms have an entry
        const merged = PLATFORMS.map(p => {
          const found = existing.find(e => e.platform === p)
          return found ?? { platform: p, is_active: false, hashtag_limit: 5, org_id: activeOrg.id }
        })
        setConfigs(merged)
      })
  }, [activeOrg?.id])

  function update(platform: string, patch: Partial<PlatformConfig>) {
    setConfigs(prev => prev.map(c => c.platform === platform ? { ...c, ...patch } : c))
  }

  async function handleSave(platform: string) {
    if (!activeOrg) return
    setSaving(platform)
    const config = configs.find(c => c.platform === platform)
    if (!config) return
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
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Platform Integrations</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configure settings and API keys for each publishing platform.</p>
      </div>

      <div className="space-y-3">
        {PLATFORMS.map(platform => {
          const config = configs.find(c => c.platform === platform) ?? {}
          const isRevealed = reveal[platform]

          return (
            <div key={platform} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Platform header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  platform === 'linkedin' ? 'bg-blue-100 text-blue-700' :
                  platform === 'twitter'  ? 'bg-sky-100 text-sky-700' :
                  platform === 'instagram' ? 'bg-pink-100 text-pink-700' :
                  platform === 'facebook' ? 'bg-indigo-100 text-indigo-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {PLATFORM_LABELS[platform].slice(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 text-sm font-medium text-gray-800">{PLATFORM_LABELS[platform]}</span>
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
                      placeholder={platform === 'twitter' ? '280' : '3000'}
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

                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                    <span>API / Access Token</span>
                    <button onClick={() => setReveal(r => ({...r, [platform]: !r[platform]}))}
                      className="text-gray-400 hover:text-gray-600">
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </label>
                  <div className="relative">
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      value={(config as Record<string, unknown>)['access_token'] as string ?? ''}
                      onChange={e => update(platform, { access_token: e.target.value } as Partial<PlatformConfig>)}
                      className="input w-full pr-8"
                      placeholder="Stored encrypted · not used directly by VERA yet"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    <AlertCircle size={10} className="inline mr-0.5" />
                    API keys are stored in your Supabase project — auto-posting coming soon.
                  </p>
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
  const [tab, setTab] = useState<Tab>('workspace')
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
