// Brain — the per-client ground truth VERA reasons from (/p/:slug/brain).
//
// · Custom instructions — per project; vera-chat reads them EVERY turn. The
//   single highest-leverage per-client lever.
// · Brand voice — tone, rules, forbidden phrases, persona (workspace-level for
//   now; shared across the client's projects, same row vera-chat reads).
// · Audiences — who VERA writes toward (read view for now).
// · Knowledge — link to the client's searchable sources (managed in Knowledge;
//   brand-kit files live in Artifacts).

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Brain as BrainIcon, BookOpen, Check, Plus, X, Loader2 } from 'lucide-react'
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

  // ── brand voice (workspace-level — same row vera-chat reads) ──
  const [bv, setBv] = useState<Partial<BrandVoice>>({})
  const [bvSaving, setBvSaving] = useState(false)
  const [bvSaved, setBvSaved] = useState(false)
  useEffect(() => {
    if (!activeOrg?.id) return
    supabase.from('brand_voice').select('*').eq('org_id', activeOrg.id).maybeSingle()
      .then(({ data }) => { if (data) setBv(data as BrandVoice) })
  }, [activeOrg?.id])
  async function saveBv() {
    if (!activeOrg?.id) return
    setBvSaving(true)
    const payload = { ...bv, org_id: activeOrg.id }
    if (bv.id) await supabase.from('brand_voice').update(payload).eq('id', bv.id)
    else { const { data } = await supabase.from('brand_voice').insert(payload).select().single(); if (data) setBv(data as BrandVoice) }
    setBvSaving(false); setBvSaved(true); setTimeout(() => setBvSaved(false), 2500)
  }
  const addTo = (key: keyof BrandVoice, val: string) => { if (val.trim()) setBv(p => ({ ...p, [key]: [...((p[key] as string[]) || []), val.trim()] })) }
  const rmFrom = (key: keyof BrandVoice, i: number) => setBv(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))

  // ── audiences (read) ──
  const [audiences, setAudiences] = useState<Audience[]>([])
  useEffect(() => {
    if (!activeOrg?.id) return
    supabase.from('audiences').select('*').eq('org_id', activeOrg.id).then(({ data }) => setAudiences((data ?? []) as Audience[]))
  }, [activeOrg?.id])

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
          The persona, tone, and rules VERA writes by. <span style={{ color: color.ghost }}>Workspace-level — shared across this client's projects.</span>
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

      {/* Audiences (read) */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Audiences</SectionLabel>
        {audiences.length === 0 ? (
          <p style={{ fontSize: t.size.cap, color: color.ghost }}>No audiences defined yet — editing audiences lands next. For now VERA infers the audience from your instructions + brand voice.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {audiences.map(a => (
              <div key={a.id} style={{ padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                <div style={{ fontSize: t.size.cap, fontWeight: t.weight.semibold, color: color.ink }}>{a.name}{a.is_primary ? ' · primary' : ''}</div>
                {Array.isArray(a.pain_points) && a.pain_points.length > 0 && <div style={{ fontSize: t.size.micro, color: color.ink2, marginTop: 2 }}>Pains: {a.pain_points.join(', ')}</div>}
              </div>
            ))}
          </div>
        )}
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
