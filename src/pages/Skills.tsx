import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, Dispatch, ElementType, ReactNode, SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Layers,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  color,
  radius,
  space,
  type as t,
} from '../design'

type SkillType = 'platform' | 'content' | 'brand' | 'persona' | 'enrichment' | 'tool'
type SkillAgent = 'strategist' | 'writer' | 'brand_guard' | 'publisher' | 'all'
type Confidence = 'low' | 'medium' | 'high' | 'validated'
type ScopeFilter = 'all' | 'global' | 'workspace' | 'client'
type FormScope = 'workspace' | 'client'
type ViewMode = 'constitution' | 'skills' | 'evals'

type ExampleItem = {
  label?: string
  text?: string
  ref?: string
}

interface Skill {
  id: string
  org_id: string | null
  project_id?: string | null
  parent_id: string | null
  type: SkillType
  name: string
  description: string
  injected_into: SkillAgent
  prompt_module: string
  trigger_when: Record<string, unknown>
  trigger_description?: string
  gotchas?: string[]
  good_examples?: ExampleItem[]
  bad_examples?: ExampleItem[]
  source_refs?: ExampleItem[]
  confidence?: Confidence
  performance_notes?: string
  last_reviewed_at?: string | null
  tags: string[]
  is_active: boolean
  is_system: boolean
  sort_order: number
}

interface SkillPerformance {
  skill_id: string
  total_invocations: number
  approved_count: number
  rejected_count: number
  edited_count: number
  approval_rate: number | null
  last_used_at: string | null
}

interface LearningStats {
  activeSkills: number
  trackedSkills: number
  totalUses: number
  approved: number
  edited: number
  rejected: number
  noSignalSkills: number
  bestSkill?: Skill
  bestPerformance?: SkillPerformance
}

interface EvalScenario {
  id: string
  org_id: string | null
  project_id?: string | null
  name: string
  category: 'constitution' | 'strategy' | 'copy' | 'platform' | 'brand' | 'compliance' | 'autonomy' | 'knowledge'
  description: string
  prompt: string
  expected_behaviors: string[]
  failure_modes: string[]
  rubric: Record<string, number>
  tags: string[]
  source_refs?: ExampleItem[]
  is_system: boolean
  is_active: boolean
  sort_order: number
}

const SKILL_TYPES: SkillType[] = ['platform', 'content', 'brand', 'persona', 'enrichment', 'tool']
const SKILL_AGENTS: SkillAgent[] = ['strategist', 'writer', 'brand_guard', 'publisher', 'all']
const CONFIDENCE: Confidence[] = ['low', 'medium', 'high', 'validated']

const agentLabel: Record<SkillAgent, string> = {
  strategist: 'Strategist',
  writer: 'Writer',
  brand_guard: 'Brand Guard',
  publisher: 'Publisher',
  all: 'All agents',
}

const typeDot: Record<SkillType, string> = {
  platform: color.dotBlue,
  content: color.ink2,
  brand: color.dotAmber,
  persona: color.dotPink,
  enrichment: color.dotGreen,
  tool: color.dotViolet,
}

const confidenceColor: Record<Confidence, string> = {
  low: color.warn,
  medium: color.info,
  high: color.success,
  validated: color.accent,
}

const emptyForm = {
  scope: 'client' as FormScope,
  name: '',
  type: 'content' as SkillType,
  description: '',
  injected_into: 'writer' as SkillAgent,
  trigger_description: '',
  trigger_when: '{\n  "platform": "linkedin"\n}',
  prompt_module: '',
  gotchas: '',
  good_examples: '',
  bad_examples: '',
  source_refs: '',
  confidence: 'medium' as Confidence,
  performance_notes: '',
  tags: '',
}

function linesToArray(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function arrayToLines(value?: string[] | null) {
  return (value ?? []).join('\n')
}

function textToExamples(value: string): ExampleItem[] {
  return linesToArray(value).map(line => {
    const idx = line.indexOf(':')
    if (idx > 0 && idx < 48) {
      return {
        label: line.slice(0, idx).trim(),
        text: line.slice(idx + 1).trim(),
      }
    }
    return { text: line }
  })
}

function examplesToText(value?: ExampleItem[] | null) {
  if (!Array.isArray(value)) return ''
  return value
    .map(item => {
      if (typeof item === 'string') return item
      const label = item.label?.trim()
      const text = (item.text ?? item.ref ?? '').trim()
      if (!text) return ''
      return label ? `${label}: ${text}` : text
    })
    .filter(Boolean)
    .join('\n')
}

function scopeOf(skill: Skill): ScopeFilter {
  if (skill.is_system || (!skill.org_id && !skill.project_id)) return 'global'
  if (skill.project_id) return 'client'
  return 'workspace'
}

function formatDate(value?: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function compactJson(value: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) return '{}'
  return JSON.stringify(value, null, 2)
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Trigger JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}

function parseViewMode(value: string | null): ViewMode | null {
  if (value === 'constitution' || value === 'skills' || value === 'evals') return value
  return null
}

function parseScopeFilter(value: string | null): ScopeFilter | null {
  if (value === 'all' || value === 'global' || value === 'workspace' || value === 'client') return value
  return null
}

export default function Skills() {
  const [searchParams] = useSearchParams()
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const activeOrgId = activeOrg?.id ?? null
  const activeProjectId = activeProject?.id ?? null
  useRightRail(null, [])

  const [skills, setSkills] = useState<Skill[]>([])
  const [performance, setPerformance] = useState<Record<string, SkillPerformance>>({})
  const [evalScenarios, setEvalScenarios] = useState<EvalScenario[]>([])
  const [evalError, setEvalError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>(() => parseViewMode(searchParams.get('view')) ?? 'constitution')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [typeFilter, setTypeFilter] = useState<SkillType | 'all'>('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(() => parseScopeFilter(searchParams.get('scope')) ?? 'all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    let skillQuery = supabase.from('skills').select('*').order('sort_order').order('name')
    if (activeOrgId) skillQuery = skillQuery.or(`org_id.is.null,org_id.eq.${activeOrgId}`)
    else skillQuery = skillQuery.is('org_id', null)

    let evalQuery = supabase.from('vera_evaluation_scenarios').select('*').order('sort_order').order('name')
    if (activeOrgId) evalQuery = evalQuery.or(`org_id.is.null,org_id.eq.${activeOrgId}`)
    else evalQuery = evalQuery.is('org_id', null)

    const [{ data: skillRows, error: skillErr }, { data: perfRows }, { data: evalRows, error: evalErr }] = await Promise.all([
      skillQuery,
      activeOrgId
        ? supabase.from('skill_performance').select('*').or(`org_id.is.null,org_id.eq.${activeOrgId}`)
        : supabase.from('skill_performance').select('*').is('org_id', null),
      evalQuery,
    ])

    if (skillErr) {
      setError(skillErr.message)
      setSkills([])
      setLoading(false)
      return
    }

    const visible = ((skillRows ?? []) as Skill[]).filter(skill => {
      if (!skill.project_id) return true
      return skill.project_id === activeProjectId
    })
    const visibleEvals = ((evalRows ?? []) as EvalScenario[]).filter(scenario => {
      if (!scenario.project_id) return true
      return scenario.project_id === activeProjectId
    })

    setSkills(visible)
    setEvalScenarios(visibleEvals)
    setEvalError(evalErr?.message ?? null)
    setPerformance(Object.fromEntries(
      ((perfRows ?? []) as SkillPerformance[]).map(row => [row.skill_id, row]),
    ))
    setLoading(false)
  }, [activeOrgId, activeProjectId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const nextView = parseViewMode(searchParams.get('view'))
    const nextScope = parseScopeFilter(searchParams.get('scope'))
    const nextQuery = searchParams.get('q')
    if (nextView) setView(nextView)
    if (nextScope) setScopeFilter(nextScope)
    if (nextQuery !== null) setQuery(nextQuery)
  }, [searchParams])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return skills.filter(skill => {
      const typeMatch = typeFilter === 'all' || skill.type === typeFilter
      const scopeMatch = scopeFilter === 'all' || scopeOf(skill) === scopeFilter
      const text = [
        skill.name,
        skill.description,
        skill.trigger_description,
        skill.prompt_module,
        ...(skill.tags ?? []),
        ...(skill.gotchas ?? []),
      ].join(' ').toLowerCase()
      return typeMatch && scopeMatch && (!term || text.includes(term))
    })
  }, [skills, query, typeFilter, scopeFilter])

  const counts = useMemo(() => ({
    global: skills.filter(s => scopeOf(s) === 'global').length,
    workspace: skills.filter(s => scopeOf(s) === 'workspace').length,
    client: skills.filter(s => scopeOf(s) === 'client').length,
  }), [skills])

  const learningStats = useMemo<LearningStats>(() => {
    const visibleSkillIds = new Set(skills.map(skill => skill.id))
    const rows = Object.values(performance)
      .filter(row => visibleSkillIds.has(row.skill_id) && row.total_invocations > 0)
    const bestPerformance = [...rows].sort((a, b) => {
      const rateDiff = (b.approval_rate ?? -1) - (a.approval_rate ?? -1)
      if (rateDiff !== 0) return rateDiff
      return b.total_invocations - a.total_invocations
    })[0]

    return {
      activeSkills: skills.filter(skill => skill.is_active).length,
      trackedSkills: rows.length,
      totalUses: rows.reduce((sum, row) => sum + row.total_invocations, 0),
      approved: rows.reduce((sum, row) => sum + row.approved_count, 0),
      edited: rows.reduce((sum, row) => sum + row.edited_count, 0),
      rejected: rows.reduce((sum, row) => sum + row.rejected_count, 0),
      noSignalSkills: skills.filter(skill => skill.is_active && !(performance[skill.id]?.total_invocations > 0)).length,
      bestSkill: bestPerformance ? skills.find(skill => skill.id === bestPerformance.skill_id) : undefined,
      bestPerformance,
    }
  }, [skills, performance])

  const constitutionSkills = useMemo(() => {
    const constitutionalNames = new Set([
      'Vera Constitution',
      'Anti-Sycophancy Marketing Challenge',
      'Evidence and Claim Discipline',
      'Human Approval Gates',
      'Vera Evaluation Rubric',
    ])
    const constitutionalTags = new Set([
      'constitution',
      'anti-sycophancy',
      'approval',
      'autonomy',
      'claims',
      'evidence',
      'evaluation',
      'operating-model',
      'safety',
    ])
    return skills.filter(skill =>
      constitutionalNames.has(skill.name) ||
      (skill.tags ?? []).some(tag => constitutionalTags.has(tag))
    )
  }, [skills])

  function openNew(scope: FormScope = activeProject?.id ? 'client' : 'workspace') {
    setEditingId(null)
    setForm({ ...emptyForm, scope })
    setShowForm(true)
    setError(null)
  }

  function openEdit(skill: Skill) {
    setEditingId(skill.id)
    setForm({
      scope: scopeOf(skill) === 'client' ? 'client' : 'workspace',
      name: skill.name,
      type: skill.type,
      description: skill.description,
      injected_into: skill.injected_into,
      trigger_description: skill.trigger_description ?? '',
      trigger_when: compactJson(skill.trigger_when ?? {}),
      prompt_module: skill.prompt_module,
      gotchas: arrayToLines(skill.gotchas),
      good_examples: examplesToText(skill.good_examples),
      bad_examples: examplesToText(skill.bad_examples),
      source_refs: examplesToText(skill.source_refs),
      confidence: skill.confidence ?? 'medium',
      performance_notes: skill.performance_notes ?? '',
      tags: (skill.tags ?? []).join(', '),
    })
    setShowForm(true)
    setError(null)
  }

  async function forkSkill(skill: Skill, scope: FormScope = activeProject?.id ? 'client' : 'workspace') {
    if (!activeOrg?.id) {
      setError('Pick a workspace before creating custom skills.')
      return
    }
    if (scope === 'client' && !activeProject?.id) {
      setError('Pick a client before creating a client skill.')
      return
    }

    const payload = {
      parent_id: skill.id,
      org_id: activeOrg.id,
      project_id: scope === 'client' ? activeProject?.id : null,
      type: skill.type,
      name: `${skill.name} custom`,
      description: skill.description,
      injected_into: skill.injected_into,
      prompt_module: skill.prompt_module,
      trigger_when: skill.trigger_when ?? {},
      trigger_description: skill.trigger_description ?? '',
      gotchas: skill.gotchas ?? [],
      good_examples: skill.good_examples ?? [],
      bad_examples: skill.bad_examples ?? [],
      source_refs: skill.source_refs ?? [],
      confidence: skill.confidence ?? 'medium',
      performance_notes: skill.performance_notes ?? '',
      tags: skill.tags ?? [],
      is_active: true,
      is_system: false,
    }

    const { data, error: insertErr } = await supabase.from('skills').insert(payload).select().single()
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    if (data) {
      setSkills(prev => [...prev, data as Skill])
      openEdit(data as Skill)
    }
  }

  async function toggleActive(skill: Skill) {
    if (skill.is_system) return
    const { error: updateErr } = await supabase.from('skills').update({ is_active: !skill.is_active }).eq('id', skill.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_active: !s.is_active } : s))
  }

  async function deleteSkill(skill: Skill) {
    if (skill.is_system) return
    if (!confirm(`Delete "${skill.name}"? Vera will stop using this skill.`)) return
    const { error: deleteErr } = await supabase.from('skills').delete().eq('id', skill.id)
    if (deleteErr) {
      setError(deleteErr.message)
      return
    }
    setSkills(prev => prev.filter(s => s.id !== skill.id))
  }

  async function saveSkill() {
    if (!activeOrg?.id) {
      setError('Pick a workspace before saving skills.')
      return
    }
    if (form.scope === 'client' && !activeProject?.id) {
      setError('Pick a client before saving a client skill.')
      return
    }
    if (!form.name.trim() || !form.description.trim() || !form.prompt_module.trim()) {
      setError('Name, description, and prompt module are required.')
      return
    }

    let trigger_when: Record<string, unknown>
    try {
      trigger_when = parseJsonObject(form.trigger_when)
    } catch (parseErr) {
      setError(parseErr instanceof Error ? parseErr.message : 'Trigger JSON is invalid.')
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      org_id: activeOrg.id,
      project_id: form.scope === 'client' ? activeProject?.id : null,
      type: form.type,
      name: form.name.trim(),
      description: form.description.trim(),
      injected_into: form.injected_into,
      trigger_description: form.trigger_description.trim(),
      prompt_module: form.prompt_module.trim(),
      trigger_when,
      gotchas: linesToArray(form.gotchas),
      good_examples: textToExamples(form.good_examples),
      bad_examples: textToExamples(form.bad_examples),
      source_refs: textToExamples(form.source_refs),
      confidence: form.confidence,
      performance_notes: form.performance_notes.trim(),
      tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      is_system: false,
      is_active: true,
      last_reviewed_at: new Date().toISOString(),
    }

    const { data, error: saveErr } = editingId
      ? await supabase.from('skills').update(payload).eq('id', editingId).select().single()
      : await supabase.from('skills').insert(payload).select().single()

    setSaving(false)
    if (saveErr) {
      setError(saveErr.message)
      return
    }
    if (data) {
      const saved = data as Skill
      setSkills(prev => editingId ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved])
      setShowForm(false)
      setEditingId(null)
    }
  }

  return (
    <div style={{ padding: space[8], maxWidth: 1180 }}>
      <PageHeader
        eyebrow="AI Settings"
        title="Vera Intelligence"
        subtitle="The operating system behind Vera: constitutional principles, reusable skills, and repeatable evaluation scenarios."
        actions={
          <div style={{ display: 'flex', gap: space[2] }}>
            <Button variant="secondary" leading={<Plus size={14} />} onClick={() => openNew('workspace')} disabled={!activeOrg}>
              Workspace skill
            </Button>
            <Button variant="primary" leading={<Plus size={14} />} onClick={() => openNew('client')} disabled={!activeProject}>
              Space skill
            </Button>
          </div>
        }
      />

      <ViewTabs view={view} setView={setView} />

      {view === 'constitution' && (
        <ConstitutionView skills={constitutionSkills} loading={loading} />
      )}

      {view === 'evals' && (
        <EvaluationSuite scenarios={evalScenarios} loading={loading} error={evalError} />
      )}

      {view === 'skills' && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: space[3], marginBottom: space[5] }}>
        <Metric icon={Sparkles} label="Global Vera" value={counts.global} tone={color.accent} />
        <Metric icon={Layers} label="Workspace" value={counts.workspace} tone={color.dotBlue} />
        <Metric icon={BookOpen} label={activeProject ? 'Active space' : 'Space'} value={counts.client} tone={color.dotGreen} />
        <Metric icon={BarChart3} label="With signal" value={learningStats.trackedSkills} tone={color.dotViolet} />
      </div>

      <LearningSignalPanel stats={learningStats} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr) 180px 220px',
          gap: space[3],
          alignItems: 'center',
          marginBottom: space[5],
        }}
      >
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search skills, gotchas, platforms, sources"
          leading={<Search size={15} />}
        />
        <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as SkillType | 'all')}>
          <option value="all">All types</option>
          {SKILL_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </Select>
        <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value as ScopeFilter)}>
          <option value="all">All scopes</option>
          <option value="global">Global Vera</option>
          <option value="workspace">Workspace</option>
          <option value="client">Active client</option>
        </Select>
      </div>

      {error && (
        <div
          style={{
            marginBottom: space[4],
            padding: space[4],
            border: `1px solid ${color.danger}`,
            borderRadius: radius.md,
            color: color.danger,
            background: 'rgba(185,28,28,0.06)',
            fontSize: t.size.sm,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: space[8], color: color.ghost, fontSize: t.size.sm }}>Loading skills...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Zap size={28} />}
          title="No skills found"
          body="Change the filters or create a client skill for this workspace."
          actions={<Button variant="secondary" leading={<Plus size={14} />} onClick={() => openNew()}>Create skill</Button>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {filtered.map(skill => (
            <SkillRow
              key={skill.id}
              skill={skill}
              performance={performance[skill.id]}
              expanded={expanded === skill.id}
              onToggle={() => setExpanded(expanded === skill.id ? null : skill.id)}
              onFork={() => forkSkill(skill)}
              onEdit={() => openEdit(skill)}
              onDelete={() => deleteSkill(skill)}
              onActive={() => toggleActive(skill)}
            />
          ))}
        </div>
      )}
        </>
      )}

      {view === 'skills' && showForm && (
        <SkillForm
          form={form}
          setForm={setForm}
          editing={!!editingId}
          saving={saving}
          activeProjectName={activeProject?.name ?? null}
          canUseClientScope={!!activeProject?.id}
          error={error}
          onClose={() => { setShowForm(false); setEditingId(null); setError(null) }}
          onSave={saveSkill}
        />
      )}
    </div>
  )
}

function ViewTabs({ view, setView }: { view: ViewMode; setView: (view: ViewMode) => void }) {
  const tabs: Array<{ id: ViewMode; label: string; icon: ElementType }> = [
    { id: 'constitution', label: 'Constitution', icon: ShieldCheck },
    { id: 'skills', label: 'Skills', icon: Zap },
    { id: 'evals', label: 'Evaluation Suite', icon: Target },
  ]
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: `${space[2]} 0 ${space[5]}` }}>
      <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: radius.md, background: color.paper2, border: `1px solid ${color.line}` }}>
        {tabs.map(tab => {
          const active = view === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                border: 0,
                borderRadius: radius.sm,
                padding: '7px 11px',
                background: active ? color.surface : 'transparent',
                color: active ? color.ink : color.ghost,
                boxShadow: active ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                cursor: 'pointer',
                fontSize: t.size.sm,
                fontWeight: active ? t.weight.semibold : t.weight.medium,
              }}
            >
              <Icon size={14} strokeWidth={1.9} />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConstitutionView({ skills, loading }: { skills: Skill[]; loading: boolean }) {
  if (loading) {
    return <div style={{ padding: space[8], color: color.ghost, fontSize: t.size.sm }}>Loading constitution...</div>
  }
  if (!skills.length) {
    return (
      <EmptyState
        icon={<ShieldCheck size={28} />}
        title="Constitution not seeded yet"
        body="Apply the constitution migration to seed Vera's core operating skills."
      />
    )
  }

  const primary = skills.find(skill => skill.name === 'Vera Constitution')
  const supporting = skills.filter(skill => skill.id !== primary?.id)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(280px, 0.95fr)', gap: space[5] }}>
      <section style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[5] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[3] }}>
          <span style={{ width: 32, height: 32, borderRadius: radius.sm, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: color.accent, background: color.accentSoft }}>
            <ShieldCheck size={17} />
          </span>
          <div>
            <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h3, fontWeight: t.weight.semibold }}>Vera Constitution</h2>
            <p style={{ margin: '4px 0 0', color: color.ghost, fontSize: t.size.cap }}>Runtime principles Vera applies before strategy, copy, review, and tool use.</p>
          </div>
        </div>
        {primary ? (
          <>
            <p style={{ margin: '0 0 12px', color: color.ink2, fontSize: t.size.sm, lineHeight: 1.55 }}>{primary.description}</p>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, color: color.ink, background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.sm, padding: space[4], fontSize: t.size.sm, lineHeight: 1.55, fontFamily: t.family.sans }}>
              {primary.prompt_module}
            </pre>
          </>
        ) : (
          <p style={{ margin: 0, color: color.ghost, fontSize: t.size.sm }}>The core constitution skill is not present yet.</p>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
        {supporting.map(skill => (
          <div key={skill.id} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2], flexWrap: 'wrap' }}>
              <Badge dot={typeDot[skill.type]}>{skill.type}</Badge>
              <Badge dot={confidenceColor[skill.confidence ?? 'medium']}>{skill.confidence ?? 'medium'}</Badge>
            </div>
            <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>{skill.name}</h3>
            <p style={{ margin: '6px 0 0', color: color.ghost, fontSize: t.size.sm, lineHeight: 1.45 }}>{skill.description}</p>
            {skill.gotchas?.length ? (
              <div style={{ marginTop: space[3] }}>
                <p style={{ margin: '0 0 5px', color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>Failure modes</p>
                <List items={skill.gotchas.slice(0, 4)} empty="No failure modes recorded." />
              </div>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  )
}

function EvaluationSuite({ scenarios, loading, error }: { scenarios: EvalScenario[]; loading: boolean; error: string | null }) {
  if (loading) {
    return <div style={{ padding: space[8], color: color.ghost, fontSize: t.size.sm }}>Loading evaluation suite...</div>
  }
  if (error) {
    return (
      <EmptyState
        icon={<Target size={28} />}
        title="Evaluation schema needed"
        body={error}
      />
    )
  }
  if (!scenarios.length) {
    return (
      <EmptyState
        icon={<Target size={28} />}
        title="No evaluation scenarios"
        body="Apply the evaluation migration or create workspace scenarios for Vera QA."
      />
    )
  }

  const categories = Array.from(new Set(scenarios.map(s => s.category)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[5] }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: space[3] }}>
        <Metric icon={Target} label="Scenarios" value={scenarios.length} tone={color.accent} />
        <Metric icon={ShieldCheck} label="Categories" value={categories.length} tone={color.dotBlue} />
        <Metric icon={BookOpen} label="System tests" value={scenarios.filter(s => s.is_system).length} tone={color.dotGreen} />
        <Metric icon={BarChart3} label="Active" value={scenarios.filter(s => s.is_active).length} tone={color.dotViolet} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: space[4] }}>
        {scenarios.map(scenario => (
          <EvalScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </div>
  )
}

function EvalScenarioCard({ scenario }: { scenario: EvalScenario }) {
  const rubric = Object.entries(scenario.rubric ?? {})
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(scenario.prompt)
  }

  return (
    <article style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4], display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <div>
        <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap', marginBottom: space[2] }}>
          <Badge dot={color.accent}>{scenario.category}</Badge>
          {scenario.is_system && <Badge>System</Badge>}
          {!scenario.is_active && <Badge>Inactive</Badge>}
        </div>
        <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>{scenario.name}</h2>
        <p style={{ margin: '6px 0 0', color: color.ghost, fontSize: t.size.sm, lineHeight: 1.45 }}>{scenario.description}</p>
      </div>

      <div style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.sm, padding: space[3] }}>
        <p style={{ margin: '0 0 5px', color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>Test prompt</p>
        <p style={{ margin: 0, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.45 }}>{scenario.prompt}</p>
      </div>

      <DetailMini title="Expected behavior" items={scenario.expected_behaviors} />
      <DetailMini title="Failure modes" items={scenario.failure_modes} />

      {rubric.length > 0 && (
        <div>
          <p style={{ margin: '0 0 6px', color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>Rubric</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {rubric.map(([key, value]) => <Badge key={key}>{`${key.replaceAll('_', ' ')}: ${value}`}</Badge>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space[3] }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {(scenario.tags ?? []).slice(0, 4).map(tag => <Badge key={tag}>{tag}</Badge>)}
        </div>
        <Button variant="secondary" size="sm" leading={<Copy size={13} />} onClick={copyPrompt}>Copy prompt</Button>
      </div>
    </article>
  )
}

function DetailMini({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p style={{ margin: '0 0 6px', color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>{title}</p>
      <List items={(items ?? []).slice(0, 5)} empty="None recorded." />
    </div>
  )
}

function Metric({ icon: Icon, label, value, tone }: { icon: ElementType; label: string; value: number; tone: string }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4], display: 'flex', alignItems: 'center', gap: space[3] }}>
      <span style={{ width: 30, height: 30, borderRadius: radius.sm, background: color.paper2, color: tone, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <div>
        <div style={{ color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, lineHeight: 1 }}>{value}</div>
        <div style={{ color: color.ghost, fontSize: t.size.cap, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

function LearningSignalPanel({ stats }: { stats: LearningStats }) {
  const bestLabel = stats.bestSkill && stats.bestPerformance
    ? `${stats.bestSkill.name} - ${stats.bestPerformance.approval_rate ?? 0}% approved`
    : 'No skill has enough signal yet.'
  const signalGap = stats.noSignalSkills > 0
    ? `${stats.noSignalSkills} active skill${stats.noSignalSkills === 1 ? '' : 's'} still need review outcomes.`
    : 'Every active skill has at least one review outcome.'

  return (
    <section
      style={{
        marginBottom: space[5],
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        padding: space[5],
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: space[5],
        alignItems: 'stretch',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
          <span style={{ width: 28, height: 28, borderRadius: radius.sm, background: color.accentSoft, color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart3 size={15} strokeWidth={2} />
          </span>
          <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold }}>Learning signals</h2>
        </div>
        <p style={{ margin: 0, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.55 }}>
          Approvals, edits, rejections, and posted outcomes show which skills Vera should trust for each client, channel, and person.
        </p>
        <div style={{ marginTop: space[4], display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[3] }}>
          <SignalMini label="Active skills" value={stats.activeSkills} tone={color.ink} />
          <SignalMini label="Tracked skills" value={stats.trackedSkills} tone={color.dotViolet} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: space[3] }}>
        <SignalMini label="Total uses" value={stats.totalUses} tone={color.dotBlue} />
        <SignalMini label="Approved" value={stats.approved} tone={color.success} />
        <SignalMini label="Edited" value={stats.edited} tone={color.warn} />
        <SignalMini label="Rejected" value={stats.rejected} tone={color.danger} />
        <div style={{ gridColumn: 'span 2', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
          <p style={{ margin: 0, color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>Best performer</p>
          <p style={{ margin: '6px 0 0', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{bestLabel}</p>
        </div>
        <div style={{ gridColumn: 'span 2', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
          <p style={{ margin: 0, color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>Signal gap</p>
          <p style={{ margin: '6px 0 0', color: stats.noSignalSkills > 0 ? color.ink : color.success, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{signalGap}</p>
        </div>
      </div>
    </section>
  )
}

function SignalMini({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[3] }}>
      <div style={{ color: tone, fontSize: t.size.h4, fontWeight: t.weight.semibold, lineHeight: 1 }}>{value}</div>
      <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 5, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>{label}</div>
    </div>
  )
}

function SkillRow({
  skill,
  performance,
  expanded,
  onToggle,
  onFork,
  onEdit,
  onDelete,
  onActive,
}: {
  skill: Skill
  performance?: SkillPerformance
  expanded: boolean
  onToggle: () => void
  onFork: () => void
  onEdit: () => void
  onDelete: () => void
  onActive: () => void
}) {
  const scope = scopeOf(skill)
  const conf = skill.confidence ?? 'medium'
  const canEdit = !skill.is_system

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: space[4], padding: space[4], alignItems: 'start' }}>
        <button onClick={onToggle} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2], flexWrap: 'wrap' }}>
            <Badge dot={typeDot[skill.type]}>{skill.type}</Badge>
            <Badge>{scope === 'global' ? 'Global Vera' : scope === 'client' ? 'Space' : 'Workspace'}</Badge>
            <Badge dot={confidenceColor[conf]}>{conf}</Badge>
            {!skill.is_active && <Badge>Inactive</Badge>}
            {skill.parent_id && <Badge>Forked</Badge>}
          </div>
          <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold, lineHeight: 1.25 }}>{skill.name}</h2>
          <p style={{ margin: '5px 0 0', color: color.ghost, fontSize: t.size.sm, lineHeight: 1.45 }}>{skill.description}</p>
          {skill.trigger_description && (
            <p style={{ margin: '8px 0 0', color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>
              <b style={{ color: color.ink }}>Trigger:</b> {skill.trigger_description}
            </p>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <SkillPerformanceMini performance={performance} />
          {skill.is_system ? (
            <Button variant="secondary" size="sm" leading={<Copy size={13} />} onClick={onFork}>Fork</Button>
          ) : (
            <>
              <button
                onClick={onActive}
                title={skill.is_active ? 'Disable skill' : 'Enable skill'}
                style={{
                  width: 34,
                  height: 18,
                  borderRadius: 999,
                  border: 0,
                  background: skill.is_active ? color.accent : color.line2,
                  padding: 2,
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block', width: 14, height: 14, borderRadius: '50%', background: '#fff', transform: skill.is_active ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 120ms var(--ease)' }} />
              </button>
              <Button variant="ghost" size="sm" iconOnly leading={<Pencil size={14} />} onClick={onEdit} />
              <Button variant="ghost" size="sm" iconOnly leading={<Trash2 size={14} />} onClick={onDelete} />
            </>
          )}
          {!canEdit && <Button variant="ghost" size="sm" iconOnly leading={<BookOpen size={14} />} onClick={onToggle} />}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${color.line}`, background: color.paper2, padding: space[4], display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
          <DetailBlock title="Prompt module" icon={Sparkles} wide>
            <pre style={preStyle}>{skill.prompt_module}</pre>
          </DetailBlock>
          <DetailBlock title="Gotchas" icon={AlertTriangle}>
            <List items={skill.gotchas ?? []} empty="No gotchas captured yet." />
          </DetailBlock>
          <DetailBlock title="Good examples" icon={Check}>
            <ExampleList items={skill.good_examples ?? []} empty="No good examples yet." />
          </DetailBlock>
          <DetailBlock title="Avoid examples" icon={ShieldCheck}>
            <ExampleList items={skill.bad_examples ?? []} empty="No avoid examples yet." />
          </DetailBlock>
          <DetailBlock title="Sources" icon={BookOpen}>
            <ExampleList items={skill.source_refs ?? []} empty="No sources linked yet." />
          </DetailBlock>
          <DetailBlock title="Trigger JSON" icon={Target}>
            <pre style={preStyle}>{compactJson(skill.trigger_when ?? {})}</pre>
          </DetailBlock>
          <DetailBlock title="Performance notes" icon={BarChart3}>
            <p style={{ margin: 0, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>{skill.performance_notes || 'No manual performance notes yet.'}</p>
            <p style={{ margin: '8px 0 0', color: color.ghost, fontSize: t.size.cap }}>Last reviewed: {formatDate(skill.last_reviewed_at)}</p>
          </DetailBlock>
        </div>
      )}
    </div>
  )
}

function SkillPerformanceMini({ performance }: { performance?: SkillPerformance }) {
  if (!performance || performance.total_invocations === 0) {
    return <span style={{ color: color.ghost, fontSize: t.size.cap, whiteSpace: 'nowrap' }}>No signal</span>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15, minWidth: 72 }}>
      <span style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>
        {performance.approval_rate ?? 0}% approved
      </span>
      <span style={{ color: color.ghost, fontSize: t.size.micro }}>
        {performance.total_invocations} use{performance.total_invocations === 1 ? '' : 's'}
      </span>
    </div>
  )
}

function Badge({ children, dot }: { children: string; dot?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: color.ink2, background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.pill, padding: '2px 8px', fontSize: t.size.micro, fontWeight: t.weight.medium }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />}
      {children}
    </span>
  )
}

const preStyle: CSSProperties = {
  margin: 0,
  color: color.ink2,
  fontSize: t.size.cap,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  fontFamily: t.family.mono,
}

function DetailBlock({ title, icon: Icon, children, wide }: { title: string; icon: ElementType; children: ReactNode; wide?: boolean }) {
  return (
    <section style={{ gridColumn: wide ? '1 / -1' : undefined, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4] }}>
      <h3 style={{ margin: `0 0 ${space[3]}`, color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold, display: 'flex', alignItems: 'center', gap: space[2] }}>
        <Icon size={14} color={color.ghost} />
        {title}
      </h3>
      {children}
    </section>
  )
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p style={{ margin: 0, color: color.ghost, fontSize: t.size.cap }}>{empty}</p>
  return (
    <ul style={{ margin: 0, paddingLeft: 16, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  )
}

function ExampleList({ items, empty }: { items: ExampleItem[]; empty: string }) {
  if (!Array.isArray(items) || !items.length) return <p style={{ margin: 0, color: color.ghost, fontSize: t.size.cap }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {items.map((item, index) => (
        <p key={`${item.label ?? ''}-${index}`} style={{ margin: 0, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
          {item.label && <b style={{ color: color.ink }}>{item.label}: </b>}
          {item.text ?? item.ref}
        </p>
      ))}
    </div>
  )
}

function SkillForm({
  form,
  setForm,
  editing,
  saving,
  activeProjectName,
  canUseClientScope,
  error,
  onClose,
  onSave,
}: {
  form: typeof emptyForm
  setForm: Dispatch<SetStateAction<typeof emptyForm>>
  editing: boolean
  saving: boolean
  activeProjectName: string | null
  canUseClientScope: boolean
  error: string | null
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex' }}>
      <button aria-label="Close" onClick={onClose} style={{ flex: 1, border: 0, background: 'rgba(0,0,0,0.22)' }} />
      <aside style={{ width: 'min(620px, 94vw)', height: '100%', background: color.surface, borderLeft: `1px solid ${color.line}`, boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: space[6], borderBottom: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[4] }}>
          <div>
            <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h3, fontWeight: t.weight.semibold }}>{editing ? 'Edit skill' : 'Create skill'}</h2>
            <p style={{ margin: '5px 0 0', color: color.ghost, fontSize: t.size.cap }}>Write descriptions for Vera: when to trigger, what to avoid, and what evidence supports the skill.</p>
          </div>
          <Button variant="ghost" iconOnly leading={<X size={16} />} onClick={onClose} />
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: space[6], display: 'flex', flexDirection: 'column', gap: space[5] }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
            <Field label="Scope">
              <Select value={form.scope} onChange={e => setForm(prev => ({ ...prev, scope: e.target.value as FormScope }))}>
                <option value="workspace">Workspace skill</option>
                <option value="client" disabled={!canUseClientScope}>Space skill{activeProjectName ? `: ${activeProjectName}` : ''}</option>
              </Select>
            </Field>
            <Field label="Confidence">
              <Select value={form.confidence} onChange={e => setForm(prev => ({ ...prev, confidence: e.target.value as Confidence }))}>
                {CONFIDENCE.map(conf => <option key={conf} value={conf}>{conf}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Name">
            <Input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="LinkedIn founder voice audit" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
            <Field label="Type">
              <Select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value as SkillType }))}>
                {SKILL_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </Select>
            </Field>
            <Field label="Inject into">
              <Select value={form.injected_into} onChange={e => setForm(prev => ({ ...prev, injected_into: e.target.value as SkillAgent }))}>
                {SKILL_AGENTS.map(agent => <option key={agent} value={agent}>{agentLabel[agent]}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Description" helper="This is for the model. Describe when Vera should use the skill, not just what it is.">
            <Textarea rows={3} value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Use when reviewing platform-native posts for hook strength, proof, voice, and channel fit." />
          </Field>

          <Field label="Trigger guidance">
            <Textarea rows={3} value={form.trigger_description} onChange={e => setForm(prev => ({ ...prev, trigger_description: e.target.value }))} placeholder="Trigger when the operator asks for a channel audit, named-person voice check, or post rewrite." />
          </Field>

          <Field label="Prompt module">
            <Textarea rows={9} value={form.prompt_module} onChange={e => setForm(prev => ({ ...prev, prompt_module: e.target.value }))} placeholder="Purpose, process, gotchas, output format." style={{ fontFamily: t.family.mono }} />
          </Field>

          <Field label="Gotchas" helper="One per line. These should come from failures, rejected posts, compliance issues, and repeated manual edits.">
            <Textarea rows={5} value={form.gotchas} onChange={e => setForm(prev => ({ ...prev, gotchas: e.target.value }))} placeholder={'Generic opener\nUnsupported authority claim\nCTA asks too much'} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
            <Field label="Good examples" helper="One per line. Use Label: example when useful.">
              <Textarea rows={5} value={form.good_examples} onChange={e => setForm(prev => ({ ...prev, good_examples: e.target.value }))} />
            </Field>
            <Field label="Avoid examples" helper="One per line.">
              <Textarea rows={5} value={form.bad_examples} onChange={e => setForm(prev => ({ ...prev, bad_examples: e.target.value }))} />
            </Field>
          </div>

          <Field label="Sources" helper="One per line. Example: General Vera KB: platform-specific review rules.">
            <Textarea rows={4} value={form.source_refs} onChange={e => setForm(prev => ({ ...prev, source_refs: e.target.value }))} />
          </Field>

          <Field label="Trigger JSON" helper="Used by the Strategist and Writer to auto-match platform, format, or job. Must be valid JSON.">
            <Textarea rows={5} value={form.trigger_when} onChange={e => setForm(prev => ({ ...prev, trigger_when: e.target.value }))} style={{ fontFamily: t.family.mono }} />
          </Field>

          <Field label="Performance notes">
            <Textarea rows={3} value={form.performance_notes} onChange={e => setForm(prev => ({ ...prev, performance_notes: e.target.value }))} placeholder="What reviewers or performance data have taught us about this skill." />
          </Field>

          <Field label="Tags">
            <Input value={form.tags} onChange={e => setForm(prev => ({ ...prev, tags: e.target.value }))} placeholder="linkedin, voice, audit" />
          </Field>

          {error && (
            <div style={{ color: color.danger, fontSize: t.size.sm, background: 'rgba(185,28,28,0.06)', border: `1px solid ${color.danger}`, borderRadius: radius.md, padding: space[3] }}>
              {error}
            </div>
          )}
        </div>

        <footer style={{ padding: space[5], borderTop: `1px solid ${color.line}`, display: 'flex', justifyContent: 'flex-end', gap: space[3] }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} leading={<Check size={14} />} onClick={onSave}>
            {editing ? 'Save changes' : 'Create skill'}
          </Button>
        </footer>
      </aside>
    </div>
  )
}
