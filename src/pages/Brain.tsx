// Brain — the per-client ground truth VERA reasons from (/p/:slug/brain).
//
// · Custom instructions — per project; vera-chat reads them EVERY turn. The
//   single highest-leverage per-client lever.
// · Brand voice — tone, rules, forbidden phrases, persona (workspace-level for
//   now; shared across the client's projects, same row vera-chat reads).
// · Audiences — who VERA writes toward (read view for now).
// · Knowledge — link to the client's searchable sources (managed in Knowledge;
//   brand-kit files live in Artifacts).

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Brain as BrainIcon, BookOpen, Check, Plus, X, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, Audience } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useRightRail } from '../lib/rightRailContext'
import { PageHeader, SectionLabel, Field, Input, Textarea, Button, EmptyState, color, space, type as t, radius } from '../design'

export default function Brain() {
  const { activeProject, refetch } = useProject()
  const { activeOrg } = useOrg()
  useRightRail(null, []) // full canvas

  // ── custom instructions (per project — read by vera-chat every turn) ──
  const [instr, setInstr] = useState('')
  const [instrSaving, setInstrSaving] = useState(false)
  const [instrSaved, setInstrSaved] = useState(false)
  useEffect(() => { setInstr(activeProject?.instructions ?? '') }, [activeProject?.id, activeProject?.instructions])

  async function saveInstr() {
    if (!activeProject?.id) return
    setInstrSaving(true)
    await supabase.from('projects').update({ instructions: instr.trim() || null }).eq('id', activeProject.id)
    setInstrSaving(false); setInstrSaved(true); setTimeout(() => setInstrSaved(false), 2500)
    refetch()
  }

  // ── brand voice (per-client — vera-chat now reads the project row first) ──
  const [bv, setBv] = useState<Partial<BrandVoice>>({})
  const [bvInherited, setBvInherited] = useState(false) // showing workspace default (no client row yet)
  const [bvSaving, setBvSaving] = useState(false)
  const [bvSaved, setBvSaved] = useState(false)
  useEffect(() => {
    if (!activeProject?.id || !activeOrg?.id) return
    let cancelled = false
    ;(async () => {
      // a client-specific row?
      const { data: proj } = await supabase.from('brand_voice').select('*').eq('project_id', activeProject.id).limit(1)
      if (cancelled) return
      if (proj && proj.length) { setBv(proj[0] as BrandVoice); setBvInherited(false); return }
      // none yet — pre-fill from the workspace default (project_id null) so the
      // editor isn't blank; drop id so Save creates a client-specific row.
      const { data: org } = await supabase.from('brand_voice').select('*').eq('org_id', activeOrg.id).order('project_id', { nullsFirst: true }).limit(1)
      if (cancelled) return
      if (org && org.length) { setBv({ ...(org[0] as BrandVoice), id: undefined }); setBvInherited(true) }
      else { setBv({}); setBvInherited(false) }
    })()
    return () => { cancelled = true }
  }, [activeProject?.id, activeOrg?.id])
  async function saveBv() {
    if (!activeOrg?.id || !activeProject?.id) return
    setBvSaving(true)
    const payload = { ...bv, org_id: activeOrg.id, project_id: activeProject.id }
    if (bv.id) await supabase.from('brand_voice').update(payload).eq('id', bv.id)
    else { const { data } = await supabase.from('brand_voice').insert(payload).select().single(); if (data) setBv(data as BrandVoice) }
    setBvSaving(false); setBvInherited(false); setBvSaved(true); setTimeout(() => setBvSaved(false), 2500)
  }
  const addTo = (key: keyof BrandVoice, val: string) => { if (val.trim()) setBv(p => ({ ...p, [key]: [...((p[key] as string[]) || []), val.trim()] })) }
  const rmFrom = (key: keyof BrandVoice, i: number) => setBv(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))

  // ── audiences (editable) ──
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [addingAudience, setAddingAudience] = useState(false)
  const reloadAudiences = useCallback(() => {
    if (!activeOrg?.id) return
    supabase.from('audiences').select('*').eq('org_id', activeOrg.id).order('created_at').then(({ data }) => setAudiences((data ?? []) as Audience[]))
  }, [activeOrg?.id])
  useEffect(() => { reloadAudiences() }, [reloadAudiences])

  // ── content categories (per-client buckets — Vera tags posts, Calendar/Artifacts filter) ──
  const [categories, setCategories] = useState<{ id: string; name: string; color: string | null }[]>([])
  const [catName, setCatName] = useState('')
  const reloadCategories = useCallback(() => {
    if (!activeProject?.id) return
    supabase.from('content_categories').select('id, name, color').eq('project_id', activeProject.id).order('sort_order')
      .then(({ data }) => setCategories((data ?? []) as { id: string; name: string; color: string | null }[]))
  }, [activeProject?.id])
  useEffect(() => { reloadCategories() }, [reloadCategories])
  const CAT_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#EF6A6A', '#d97706', '#db2777', '#0891b2', '#65a30d']
  async function addCategory(name: string) {
    if (!name.trim() || !activeProject?.id) return
    await supabase.from('content_categories').insert({ project_id: activeProject.id, org_id: activeOrg?.id ?? null, name: name.trim(), color: CAT_COLORS[categories.length % CAT_COLORS.length], sort_order: categories.length })
    setCatName(''); reloadCategories()
  }
  async function deleteCategory(id: string) { await supabase.from('content_categories').delete().eq('id', id); reloadCategories() }
  async function seedDefaultCategories() {
    if (!activeProject?.id) return
    const defaults = ['Evergreen', 'Educational', 'Product', 'Founder POV', 'News', 'Engagement']
    await supabase.from('content_categories').insert(defaults.map((name, i) => ({ project_id: activeProject.id, org_id: activeOrg?.id ?? null, name, color: CAT_COLORS[i % CAT_COLORS.length], sort_order: i })))
    reloadCategories()
  }

  if (!activeProject) {
    return <div style={{ padding: space[8], maxWidth: 760 }}><EmptyState icon={<BrainIcon size={22} strokeWidth={1.5} />} title="No active project" body="Pick a client in the left rail to set its brain — instructions, voice, audiences." /></div>
  }

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 760 }}>
      <PageHeader eyebrow={activeProject.name} title="Brain"
        subtitle="The ground truth VERA reasons from for this client — instructions it reads every turn, the brand voice, audiences, and knowledge." />

      {/* Custom instructions */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Custom instructions</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          The standing brief VERA reads <strong style={{ color: color.ink }}>every turn</strong> for {activeProject.name} — tone, do/don't, positioning, recurring CTAs, in plain language.
        </p>
        <Textarea value={instr} onChange={e => setInstr(e.target.value)} rows={7}
          placeholder={`e.g. Write in a confident, peer-to-peer voice for B2B founders. Lead with a concrete number or a real failure mode — never a hypothetical. Avoid "leverage", "synergy", "game-changer". Always close with one sharp question.`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[3] }}>
          <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving}>
            {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save instructions
          </Button>
          {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved · VERA uses this from the next turn</span>}
        </div>
      </section>

      {/* Brand voice */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Brand voice</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[4]}` }}>
          The persona, tone, and rules VERA writes by for {activeProject.name}.{' '}
          {bvInherited
            ? <span style={{ color: color.ghost }}>Showing the workspace default — saving creates a voice specific to this client.</span>
            : <span style={{ color: color.ghost }}>Specific to this client.</span>}
        </p>
        <div style={{ display: 'grid', gap: space[4] }}>
          <Field label="Persona name"><Input value={bv.persona_name ?? ''} onChange={e => setBv(f => ({ ...f, persona_name: e.target.value }))} placeholder="e.g. Alex" /></Field>
          <Field label="Persona descriptor"><Input value={bv.persona_descriptor ?? ''} onChange={e => setBv(f => ({ ...f, persona_descriptor: e.target.value }))} placeholder="A sharp, empathetic B2B strategist" /></Field>
          <TagInput label="Tone words" placeholder="confident, direct…" items={(bv.tone as string[]) ?? []} onAdd={v => addTo('tone', v)} onRemove={i => rmFrom('tone', i)} />
          <TagInput label="Writing rules" placeholder="Always use the Oxford comma" items={(bv.writing_rules as string[]) ?? []} onAdd={v => addTo('writing_rules', v)} onRemove={i => rmFrom('writing_rules', i)} />
          <TagInput label="Forbidden phrases" placeholder="leverage, synergy…" items={(bv.forbidden_phrases as string[]) ?? []} onAdd={v => addTo('forbidden_phrases', v)} onRemove={i => rmFrom('forbidden_phrases', i)} danger />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
          <Button variant="primary" size="md" onClick={saveBv} disabled={bvSaving}>
            {bvSaving ? <Loader2 size={14} /> : <Check size={14} />} Save brand voice
          </Button>
          {bvSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved</span>}
        </div>
      </section>

      {/* Audiences (editable) */}
      <section style={{ marginBottom: space[9] }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] }}>
          <SectionLabel>Audiences</SectionLabel>
          {activeOrg?.id && !addingAudience && (
            <Button variant="secondary" size="sm" onClick={() => setAddingAudience(true)}><Plus size={13} /> Add audience</Button>
          )}
        </div>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Who VERA writes toward — drives register, proof points, and which pains to hit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {addingAudience && activeOrg?.id && (
            <AudienceEditor initial={{}} orgId={activeOrg.id} onSaved={() => { setAddingAudience(false); reloadAudiences() }} onCancel={() => setAddingAudience(false)} />
          )}
          {audiences.map(a => <AudienceEditor key={a.id} initial={a} orgId={activeOrg?.id ?? ''} onSaved={reloadAudiences} />)}
          {audiences.length === 0 && !addingAudience && (
            <p style={{ fontSize: t.size.cap, color: color.ghost }}>No audiences yet — add one so VERA writes toward a specific reader.</p>
          )}
        </div>
      </section>

      {/* Content categories */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Content categories</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Reusable buckets for this client's content. Vera tags every post with one; Calendar &amp; Artifacts filter by them.
        </p>
        {categories.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[3] }}>
            <span style={{ fontSize: t.size.cap, color: color.ghost }}>No categories yet.</span>
            <Button variant="secondary" size="sm" onClick={seedDefaultCategories}><Plus size={13} /> Add a starter set</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: space[3] }}>
            {categories.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', fontSize: t.size.cap, color: color.ink, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color ?? color.ghost, flexShrink: 0 }} />
                {c.name}
                <button onClick={() => deleteCategory(c.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.faint, display: 'flex', padding: 0 }}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: space[2], maxWidth: 360 }}>
          <Input value={catName} placeholder="Add a category (e.g. Case study)" onChange={e => setCatName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(catName) } }} />
          <Button variant="secondary" size="md" onClick={() => addCategory(catName)}><Plus size={14} /></Button>
        </div>
      </section>

      {/* Knowledge link */}
      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Knowledge sources</SectionLabel>
        <Link to={`/p/${activeProject.slug}/knowledge`} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, textDecoration: 'none' }}>
          <BookOpen size={18} style={{ color: color.accent, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink }}>Manage knowledge sources →</div>
            <div style={{ fontSize: t.size.micro, color: color.ghost }}>Paste, URLs, and docs VERA can search and cite. (Brand-kit files — logos, guidelines — now live in Artifacts.)</div>
          </div>
        </Link>
      </section>

      <div style={{ height: space[8] }} />
    </div>
  )
}

// token-styled tag input (chips + add)
function TagInput({ label, placeholder, items, onAdd, onRemove, danger }: {
  label: string; placeholder?: string; items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void; danger?: boolean
}) {
  const [val, setVal] = useState('')
  const chip = danger ? color.danger : color.accent
  const commit = () => { onAdd(val); setVal('') }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      <span style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2 }}>{label}</span>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((it, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: t.size.micro, color: chip, background: color.surface, border: `1px solid ${chip}`, borderRadius: radius.pill }}>
              {it}<button onClick={() => onRemove(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: chip, display: 'flex', padding: 0 }}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: space[2] }}>
        <Input value={val} placeholder={placeholder} onChange={e => setVal(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
        <Button variant="secondary" size="md" onClick={commit}><Plus size={14} /></Button>
      </div>
    </div>
  )
}

// Inline editor for one audience — name, primary flag, pain points, goals.
function AudienceEditor({ initial, orgId, onSaved, onCancel }: {
  initial: Partial<Audience>; orgId: string; onSaved: () => void; onCancel?: () => void
}) {
  const [a, setA] = useState<Partial<Audience>>(initial)
  const [saving, setSaving] = useState(false)
  const addArr = (key: 'pain_points' | 'goals', v: string) => { if (v.trim()) setA(p => ({ ...p, [key]: [...((p[key] as string[]) || []), v.trim()] })) }
  const rmArr = (key: 'pain_points' | 'goals', i: number) => setA(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))
  async function save() {
    if (!a.name?.trim() || !orgId) return
    setSaving(true)
    const payload = { org_id: orgId, name: a.name.trim(), kind: a.kind || 'audience', is_primary: !!a.is_primary, pain_points: a.pain_points ?? [], goals: a.goals ?? [] }
    if (a.id) await supabase.from('audiences').update(payload).eq('id', a.id)
    else await supabase.from('audiences').insert(payload)
    setSaving(false); onSaved()
  }
  async function del() {
    if (!a.id) { onCancel?.(); return }
    if (!confirm(`Delete audience "${a.name}"?`)) return
    await supabase.from('audiences').delete().eq('id', a.id); onSaved()
  }
  return (
    <div style={{ padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <div style={{ display: 'flex', gap: space[3], alignItems: 'center' }}>
        <Input value={a.name ?? ''} placeholder="Audience name (e.g. VP of Sales)" onChange={e => setA(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.cap, color: color.ink2, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={!!a.is_primary} onChange={e => setA(p => ({ ...p, is_primary: e.target.checked }))} /> Primary
        </label>
      </div>
      <TagInput label="Pain points" placeholder="e.g. Forecast credibility with the board" items={(a.pain_points as string[]) ?? []} onAdd={v => addArr('pain_points', v)} onRemove={i => rmArr('pain_points', i)} />
      <TagInput label="Goals" placeholder="e.g. Hit pipeline targets without more headcount" items={(a.goals as string[]) ?? []} onAdd={v => addArr('goals', v)} onRemove={i => rmArr('goals', i)} />
      <div style={{ display: 'flex', gap: space[2] }}>
        <Button variant="primary" size="sm" onClick={save} disabled={saving || !a.name?.trim()}>{saving ? <Loader2 size={13} /> : <Check size={13} />} Save</Button>
        <Button variant="ghost" size="sm" onClick={del}><Trash2 size={13} /> {a.id ? 'Delete' : 'Cancel'}</Button>
      </div>
    </div>
  )
}
