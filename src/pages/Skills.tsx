import { useState, useEffect } from 'react'
import { Plus, Sparkles, Copy, Pencil, Trash2, ChevronDown, ChevronUp, X, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

type SkillType = 'platform' | 'content' | 'brand' | 'persona' | 'enrichment' | 'tool'
type SkillAgent = 'strategist' | 'writer' | 'brand_guard' | 'publisher' | 'all'

interface Skill {
  id: string
  org_id: string | null
  parent_id: string | null
  type: SkillType
  name: string
  description: string
  injected_into: SkillAgent
  prompt_module: string
  trigger_when: Record<string, string>
  tags: string[]
  is_active: boolean
  is_system: boolean
  sort_order: number
}

const typeColors: Record<SkillType, string> = {
  platform:    'bg-blue-100 text-blue-700',
  content:     'bg-gray-100 text-gray-900',
  brand:       'bg-amber-100 text-amber-700',
  persona:     'bg-pink-100 text-pink-700',
  enrichment:  'bg-emerald-100 text-emerald-700',
  tool:        'bg-gray-100 text-gray-600',
}

const agentColors: Record<SkillAgent, string> = {
  strategist:  'text-gray-700',
  writer:      'text-gray-700',
  brand_guard: 'text-amber-600',
  publisher:   'text-emerald-600',
  all:         'text-gray-500',
}

const agentLabels: Record<SkillAgent, string> = {
  strategist:  'Strategist',
  writer:      'Writer',
  brand_guard: 'Brand Guard',
  publisher:   'Publisher',
  all:         'All agents',
}

const SKILL_TYPES: SkillType[] = ['platform', 'content', 'brand', 'persona', 'enrichment', 'tool']
const SKILL_AGENTS: SkillAgent[] = ['strategist', 'writer', 'brand_guard', 'publisher', 'all']

const emptyForm = {
  name: '',
  type: 'content' as SkillType,
  description: '',
  injected_into: 'writer' as SkillAgent,
  prompt_module: '',
  tags: '',
}

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<SkillType | 'all'>('all')
  const [tab, setTab] = useState<'library' | 'custom'>('library')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [activeOrgName, setActiveOrgName] = useState<string | null>(null)

  useEffect(() => {
    // Resolve the active org from the most recent audit (same convention used
    // on the Dashboard until proper auth lands). Without an active org, new
    // skills land as global (org_id NULL).
    supabase.from('linkedin_audits').select('org_id, created_at').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        const oid = (data?.[0]?.org_id as string | undefined) ?? null
        if (!oid) { fetchSkills(null); return }
        setActiveOrgId(oid)
        supabase.from('organisations').select('name').eq('id', oid).maybeSingle()
          .then(({ data: org }) => setActiveOrgName((org?.name as string) ?? null))
        fetchSkills(oid)
      })
  }, [])

  async function fetchSkills(orgId: string | null) {
    setLoading(true)
    // Show global (org_id null) skills AND skills for the active org.
    const q = supabase.from('skills').select('*').order('sort_order').order('name')
    const { data } = orgId
      ? await q.or(`org_id.is.null,org_id.eq.${orgId}`)
      : await q.is('org_id', null)
    setSkills(data ?? [])
    setLoading(false)
  }

  async function toggleActive(skill: Skill) {
    if (skill.is_system) return
    await supabase.from('skills').update({ is_active: !skill.is_active }).eq('id', skill.id)
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_active: !s.is_active } : s))
  }

  async function forkSkill(skill: Skill) {
    const { data } = await supabase.from('skills').insert({
      parent_id: skill.id,
      org_id: activeOrgId,
      type: skill.type,
      name: `${skill.name} (custom)`,
      description: skill.description,
      injected_into: skill.injected_into,
      prompt_module: skill.prompt_module,
      trigger_when: skill.trigger_when,
      tags: skill.tags,
      is_active: true,
      is_system: false,
    }).select().single()
    if (data) {
      setSkills(prev => [...prev, data])
      setTab('custom')
      openEdit(data)
    }
  }

  async function deleteSkill(id: string) {
    await supabase.from('skills').delete().eq('id', id)
    setSkills(prev => prev.filter(s => s.id !== id))
  }

  function openEdit(skill: Skill) {
    setEditingId(skill.id)
    setForm({
      name: skill.name,
      type: skill.type,
      description: skill.description,
      injected_into: skill.injected_into,
      prompt_module: skill.prompt_module,
      tags: skill.tags.join(', '),
    })
    setShowForm(true)
  }

  function openNew() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  async function saveSkill() {
    if (!form.name.trim() || !form.prompt_module.trim()) return
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim(),
      injected_into: form.injected_into,
      prompt_module: form.prompt_module.trim(),
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      is_system: false,
      is_active: true,
      org_id: editingId ? undefined : activeOrgId,  // only set org_id on insert; preserve on update
    }

    if (editingId) {
      const { data } = await supabase.from('skills').update(payload).eq('id', editingId).select().single()
      if (data) setSkills(prev => prev.map(s => s.id === editingId ? data : s))
    } else {
      const { data } = await supabase.from('skills').insert(payload).select().single()
      if (data) setSkills(prev => [...prev, data])
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => { setSaved(false); setShowForm(false) }, 800)
  }

  const displayed = skills.filter(s => {
    const tabMatch = tab === 'library' ? s.is_system : !s.is_system
    const typeMatch = filter === 'all' || s.type === filter
    return tabMatch && typeMatch
  })

  const customCount = skills.filter(s => !s.is_system).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
            <Sparkles size={14} className="text-gray-700" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Skills</h1>
            <p className="text-xs text-gray-400">
              Prompt modules injected into agents at runtime
              {activeOrgName && <span className="ml-1">· editing for <span className="font-semibold text-gray-600">{activeOrgName}</span></span>}
            </p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 bg-gray-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus size={13} />
          New skill
        </button>
      </div>

      {/* Tabs + filters */}
      <div className="px-8 py-3 border-b border-gray-100 bg-white flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('library')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${tab === 'library' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Library
          </button>
          <button
            onClick={() => setTab('custom')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${tab === 'custom' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Custom
            {customCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === 'custom' ? 'bg-white/20' : 'bg-gray-100'}`}>
                {customCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex gap-1.5">
          {(['all', ...SKILL_TYPES] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full capitalize transition-colors ${
                filter === t
                  ? t === 'all' ? 'bg-gray-900 text-white' : typeColors[t as SkillType]
                  : 'bg-gray-50 text-gray-400 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading skills…</div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-sm text-gray-400">
              {tab === 'custom' ? 'No custom skills yet.' : 'No skills match this filter.'}
            </p>
            {tab === 'custom' && (
              <button onClick={openNew} className="text-xs text-gray-700 font-semibold hover:underline">
                Create your first skill →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {displayed.map(skill => (
              <div key={skill.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Type badge */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${typeColors[skill.type]}`}>
                    {skill.type}
                  </span>

                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800 truncate">{skill.name}</p>
                      {skill.parent_id && (
                        <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">forked</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{skill.description}</p>
                  </div>

                  {/* Agent tag */}
                  <span className={`text-[11px] font-semibold flex-shrink-0 ${agentColors[skill.injected_into]}`}>
                    → {agentLabels[skill.injected_into]}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {skill.is_system ? (
                      <button
                        onClick={() => forkSkill(skill)}
                        title="Fork and customise"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Copy size={13} />
                      </button>
                    ) : (
                      <>
                        {/* Active toggle */}
                        <button
                          onClick={() => toggleActive(skill)}
                          className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${skill.is_active ? 'bg-gray-500' : 'bg-gray-200'}`}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${skill.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        <button
                          onClick={() => openEdit(skill)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-blue-50 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteSkill(skill.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}

                    {/* Expand prompt */}
                    <button
                      onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      {expanded === skill.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Expanded prompt */}
                {expanded === skill.id && (
                  <div className="px-4 pb-3 pt-0 border-t border-gray-50">
                    <p className="text-[11px] font-semibold text-gray-400 mb-1.5 mt-2">Prompt module</p>
                    <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
                      {skill.prompt_module}
                    </pre>
                    {skill.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {skill.tags.map(tag => (
                          <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slide-over form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setShowForm(false)} />
          <div className="w-[480px] bg-white h-full shadow-2xl flex flex-col">
            {/* Form header */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {editingId ? 'Edit skill' : 'New skill'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                <X size={15} />
              </button>
            </div>

            {/* Form body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. LinkedIn Thought Leadership"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50"
                />
              </div>

              {/* Type + Agent row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as SkillType }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50"
                  >
                    {SKILL_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Inject into</label>
                  <select
                    value={form.injected_into}
                    onChange={e => setForm(f => ({ ...f, injected_into: e.target.value as SkillAgent }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50"
                  >
                    {SKILL_AGENTS.map(a => <option key={a} value={a}>{agentLabels[a]}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Description <span className="text-gray-400 font-normal normal-case">(shown to Strategist for skill selection)</span>
                </label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Formats content for LinkedIn with professional tone and strong hook"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50"
                />
              </div>

              {/* Prompt module */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Prompt module <span className="text-gray-400 font-normal normal-case">(injected into agent system prompt)</span>
                </label>
                <textarea
                  value={form.prompt_module}
                  onChange={e => setForm(f => ({ ...f, prompt_module: e.target.value }))}
                  placeholder="Write the instructions that will be injected into the agent's system prompt when this skill is active…"
                  rows={8}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50 font-mono leading-relaxed resize-none"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Tags <span className="text-gray-400 font-normal normal-case">(comma-separated)</span></label>
                <input
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="linkedin, thought-leadership, b2b"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-gray-50"
                />
              </div>
            </div>

            {/* Form footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 text-sm text-gray-600 border border-gray-200 rounded-lg py-2.5 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSkill}
                disabled={saving || !form.name.trim() || !form.prompt_module.trim()}
                className="flex-1 text-sm font-semibold bg-gray-900 text-white rounded-lg py-2.5 hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : editingId ? 'Save changes' : 'Create skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
