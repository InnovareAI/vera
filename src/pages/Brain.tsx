// Brain — the per-client ground truth VERA reasons from (/p/:slug/brain).
//
// · Custom instructions — per project; vera-chat reads them EVERY turn. The
//   single highest-leverage per-client lever.
// · Brand voice — tone, rules, forbidden phrases, persona (workspace-level for
//   now; shared across the client's projects, same row vera-chat reads).
// · Audiences — who VERA writes toward (read view for now).
// · Knowledge — link to the client's searchable sources (managed in Knowledge;
//   brand-kit files live in Artifacts).

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Brain as BrainIcon, BookOpen, Check, Plus, X, Loader2, Trash2, Sparkles, Upload, FileText, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, Audience } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useAuth } from '../lib/auth'
import { useRightRail } from '../lib/rightRailContext'
import { PageHeader, SectionLabel, Field, Input, Textarea, Button, EmptyState, color, space, type as t, radius } from '../design'
import {
  EMPTY_BUSINESS_CONTEXT,
  compactProjectDescription,
  mergeProjectInstructions,
  parseProjectInstructions,
  type BusinessContext,
  type BusinessContextKey,
} from '../lib/businessContext'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const BUSINESS_DOC_ACCEPT = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.html',
  '.htm',
].join(',')
const MAX_BUSINESS_DOC_BYTES = 20 * 1024 * 1024
const BUSINESS_SOURCE_KEYS: BusinessContextKey[] = [
  'website',
  'linkedinCompany',
  'linkedinProfile',
  'linkedinEvents',
  'linkedinNewsletter',
  'instagram',
  'medium',
  'facebook',
  'x',
]
type SourcePullReport = { label?: string; ok?: boolean; items?: number; error?: string }

function fileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function businessDocMime(file: File) {
  if (file.type) return file.type
  const ext = fileExtension(file.name)
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === 'json') return 'application/json'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  return 'text/plain'
}

function isTextBusinessDoc(file: File, mime: string) {
  if (mime.startsWith('text/')) return true
  if (mime === 'application/json') return true
  return ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'].includes(fileExtension(file.name))
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function mergeExtractedContext(current: BusinessContext, extracted: Partial<BusinessContext>) {
  const next = { ...current }
  for (const key of Object.keys(EMPTY_BUSINESS_CONTEXT) as BusinessContextKey[]) {
    const value = extracted[key]
    if (typeof value === 'string' && value.trim()) next[key] = value.trim()
  }
  return next
}

export default function Brain() {
  const { activeProject, refetch } = useProject()
  const { activeOrg } = useOrg()
  const { session } = useAuth()
  useRightRail(null, []) // full canvas

  // ── business context + custom instructions (project.instructions) ──
  const businessFileRef = useRef<HTMLInputElement>(null)
  const [business, setBusiness] = useState<BusinessContext>({ ...EMPTY_BUSINESS_CONTEXT })
  const [instr, setInstr] = useState('')
  const [instrSaving, setInstrSaving] = useState(false)
  const [instrSaved, setInstrSaved] = useState(false)
  const [extractingContext, setExtractingContext] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [extractError, setExtractError] = useState<string | null>(null)
  const [pullingSources, setPullingSources] = useState(false)
  const [sourceStatus, setSourceStatus] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)

  useEffect(() => {
    const parsed = parseProjectInstructions(activeProject?.instructions ?? '')
    setInstr(parsed.customInstructions)
    setBusiness({
      ...EMPTY_BUSINESS_CONTEXT,
      ...parsed.businessContext,
      website: parsed.businessContext.website || ((activeProject?.description ?? '').startsWith('http') ? activeProject?.description ?? '' : ''),
      companyName: parsed.businessContext.companyName || activeProject?.name || '',
    })
  }, [activeProject?.id, activeProject?.instructions, activeProject?.name, activeProject?.description])

  async function saveInstr() {
    if (!activeProject?.id) return
    setInstrSaving(true)
    const context = { ...business, companyName: business.companyName.trim() || activeProject.name }
    await supabase.from('projects').update({
      instructions: mergeProjectInstructions(instr, context),
      description: compactProjectDescription(context) ?? activeProject.description ?? null,
    }).eq('id', activeProject.id)
    setInstrSaving(false); setInstrSaved(true); setTimeout(() => setInstrSaved(false), 2500)
    refetch()
  }

  function updateBusiness(key: BusinessContextKey, value: string) {
    setBusiness(prev => ({ ...prev, [key]: value }))
  }

  async function extractBusinessContext(files: FileList | null) {
    const file = files?.[0]
    if (!file || !activeProject?.id) return
    setExtractError(null)
    setExtractStatus('')
    if (!session?.access_token) {
      setExtractError('Sign in before extracting business context.')
      return
    }
    if (file.size > MAX_BUSINESS_DOC_BYTES) {
      setExtractError('Use a document under 20 MB.')
      return
    }

    setExtractingContext(true)
    try {
      const mime = businessDocMime(file)
      const payload: Record<string, unknown> = {
        project_id: activeProject.id,
        project_name: activeProject.name,
        file_name: file.name,
        mime_type: mime,
        existing_context: business,
      }
      if (mime === 'application/pdf' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileExtension(file.name) === 'pdf' || fileExtension(file.name) === 'docx') {
        const dataUrl = await readFileAsDataUrl(file)
        payload.data_base64 = dataUrl.split(',')[1] ?? ''
      } else if (isTextBusinessDoc(file, mime)) {
        payload.text = await readFileAsText(file)
      } else {
        throw new Error('Use PDF, DOCX, TXT, Markdown, CSV, JSON, or HTML.')
      }

      const res = await fetch(`${SUPA}/functions/v1/extract-business-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; context?: Partial<BusinessContext>; source?: string }
      if (!res.ok) throw new Error(data.error ?? `Extraction failed with HTTP ${res.status}`)
      setBusiness(prev => mergeExtractedContext(prev, data.context ?? {}))
      setExtractStatus(`Extracted from ${data.source ?? file.name}. Review and save.`)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : 'Could not extract this document.')
    } finally {
      setExtractingContext(false)
      if (businessFileRef.current) businessFileRef.current.value = ''
    }
  }

  async function pullBusinessSources() {
    if (!activeProject?.id) return
    setSourceError(null)
    setSourceStatus('')
    if (!session?.access_token) {
      setSourceError('Sign in before pulling sources.')
      return
    }
    if (!BUSINESS_SOURCE_KEYS.some(key => business[key].trim())) {
      setSourceError('Add at least one source URL first.')
      return
    }

    setPullingSources(true)
    try {
      const res = await fetch(`${SUPA}/functions/v1/extract-business-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: activeProject.id,
          project_name: activeProject.name,
          existing_context: business,
          pull_sources: true,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string
        context?: Partial<BusinessContext>
        sources?: SourcePullReport[]
      }
      if (!res.ok) throw new Error(data.error ?? `Source pull failed with HTTP ${res.status}`)
      setBusiness(prev => mergeExtractedContext(prev, data.context ?? {}))
      const reports = data.sources ?? []
      const okCount = reports.filter(item => item.ok).length
      const total = reports.length || BUSINESS_SOURCE_KEYS.filter(key => business[key].trim()).length
      setSourceStatus(`Pulled ${okCount}/${total} sources. Review and save.`)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'Could not pull these sources.')
    } finally {
      setPullingSources(false)
    }
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

  // ── agentic draft: Vera reads the client's content (content-audit) and
  // proposes the brand voice; the operator reviews + Saves (HITL). Chat/
  // agentic-first — the brain shouldn't start as a blank form. ──
  const [drafting, setDrafting] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  async function runDraft() {
    if (!activeOrg?.id || drafting) return
    setDrafting(true); setDraftStatus("Reading this client's content…")
    try {
      const res = await fetch(`${SUPA}/functions/v1/content-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ org_id: activeOrg.id }),
      })
      if (!res.body) throw new Error('no response from the audit')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim(); if (!json) continue
          let ev: { event?: string; message?: string; proposal?: { brand_voice?: Record<string, string[]>; personas?: unknown[] } }
          try { ev = JSON.parse(json) } catch { continue }
          if (ev.event === 'started' || ev.event === 'fetching') setDraftStatus("Reading this client's content…")
          else if (ev.event === 'synthesising') setDraftStatus('Drafting the brand voice…')
          else if (ev.event === 'done') {
            const v = ev.proposal?.brand_voice ?? {}
            const n = ev.proposal?.personas?.length ?? 0
            setBv(prev => ({
              ...prev,
              tone: v.tone ?? prev.tone,
              writing_rules: v.writing_rules ?? prev.writing_rules,
              forbidden_phrases: v.forbidden_phrases ?? prev.forbidden_phrases,
              required_phrases: v.required_phrases ?? prev.required_phrases,
            }))
            setBvInherited(false)
            setDraftStatus(`Drafted from this client's content. Review the brand voice below and Save.${n ? ` Vera also spotted ${n} audience${n === 1 ? '' : 's'}; add the ones that fit.` : ''}`)
          }
          else if (ev.event === 'error') throw new Error(ev.message ?? 'audit failed')
        }
      }
    } catch (e) {
      setDraftStatus(`Couldn't draft automatically (${(e as Error).message}). You can still fill the brain by hand below.`)
    } finally {
      setDrafting(false)
    }
  }

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
    return <div style={{ padding: space[8], maxWidth: 760 }}><EmptyState icon={<BrainIcon size={22} strokeWidth={1.5} />} title="No active project" body="Pick a client in the left rail to set its brain: instructions, voice, audiences." /></div>
  }

  const sourceCount = BUSINESS_SOURCE_KEYS
    .filter(key => business[key].trim()).length
  const factCount = (['offer', 'audience', 'customerProblems', 'differentiators', 'competitors', 'proofPoints', 'contentGoals', 'constraints'] as BusinessContextKey[])
    .filter(key => business[key].trim()).length

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1040 }}>
      <PageHeader eyebrow={activeProject.name} title="Brain"
        subtitle="The ground truth VERA reasons from for this client: instructions it reads every turn, the brand voice, audiences, and knowledge." />

      {/* Agentic-first: let Vera draft the brain from the client's content
          instead of starting blank. Prefills the brand voice for review. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap', marginBottom: space[8], padding: `${space[4]} ${space[5]}`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
        <Button variant="secondary" size="sm" onClick={runDraft} disabled={drafting || !activeOrg}>
          {drafting ? <><Loader2 size={14} className="animate-spin" /> Drafting…</> : <><Sparkles size={14} /> Draft this brain with Vera</>}
        </Button>
        <span style={{ flex: 1, minWidth: 200, fontSize: t.size.cap, color: draftStatus ? color.ink2 : color.ghost, lineHeight: 1.5 }}>
          {draftStatus || "Vera reads this client's content and drafts the brand voice. You review and save. Beats filling a blank form."}
        </span>
      </div>

      {/* Business context */}
      <section style={{ marginBottom: space[9] }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[3] }}>
          <div>
            <SectionLabel>Business context</SectionLabel>
            <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `${space[2]} 0 0` }}>
              Start with the company URL, then add the social sources and facts VERA should ground every answer in.
            </p>
          </div>
          <span style={{ fontSize: t.size.cap, color: color.ghost }}>
            {sourceCount}/9 sources · {factCount}/8 context fields
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4], alignItems: 'start' }}>
          <div style={{ padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: space[4] }}>
              <Field label="Company URL" helper="Primary source for extraction and verification.">
                <Input value={business.website} onChange={e => updateBusiness('website', e.target.value)} placeholder="https://company.com" />
              </Field>
              <Field label="Company name">
                <Input value={business.companyName} onChange={e => updateBusiness('companyName', e.target.value)} placeholder={activeProject.name} />
              </Field>
              <Field label="LinkedIn company page">
                <Input value={business.linkedinCompany} onChange={e => updateBusiness('linkedinCompany', e.target.value)} placeholder="https://linkedin.com/company/company-name" />
              </Field>
              <Field label="LinkedIn profile">
                <Input value={business.linkedinProfile} onChange={e => updateBusiness('linkedinProfile', e.target.value)} placeholder="https://linkedin.com/in/person-name" />
              </Field>
              <Field label="LinkedIn events">
                <Input value={business.linkedinEvents} onChange={e => updateBusiness('linkedinEvents', e.target.value)} placeholder="https://linkedin.com/events/event-name" />
              </Field>
              <Field label="LinkedIn newsletter">
                <Input value={business.linkedinNewsletter} onChange={e => updateBusiness('linkedinNewsletter', e.target.value)} placeholder="https://linkedin.com/newsletters/newsletter-name" />
              </Field>
              <Field label="Instagram">
                <Input value={business.instagram} onChange={e => updateBusiness('instagram', e.target.value)} placeholder="https://instagram.com/brand" />
              </Field>
              <Field label="Medium">
                <Input value={business.medium} onChange={e => updateBusiness('medium', e.target.value)} placeholder="https://medium.com/@brand" />
              </Field>
              <Field label="Facebook page">
                <Input value={business.facebook} onChange={e => updateBusiness('facebook', e.target.value)} placeholder="https://facebook.com/brand" />
              </Field>
              <Field label="X profile">
                <Input value={business.x} onChange={e => updateBusiness('x', e.target.value)} placeholder="https://x.com/brand" />
              </Field>
              <Field label="Industry">
                <Input value={business.industry} onChange={e => updateBusiness('industry', e.target.value)} placeholder="Fashion, hospitality, SaaS, healthcare" />
              </Field>
            </div>
          </div>

          <div style={{ padding: space[5], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[4] }}>
            <input
              ref={businessFileRef}
              type="file"
              accept={BUSINESS_DOC_ACCEPT}
              style={{ display: 'none' }}
              onChange={e => { void extractBusinessContext(e.target.files) }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
                <FileText size={15} />
                Extract from document
              </div>
              <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
                Upload a PDF, DOCX, brief, proposal, or brand deck. VERA extracts the fields, then you review and save.
              </p>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
                <RefreshCw size={15} />
                Pull website and socials
              </div>
              <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
                Pull the website, LinkedIn, Instagram, Medium, Facebook, X, events, and newsletters. Innovare handles public scraping; connected LinkedIn and Instagram use Unipile.
              </p>
            </div>
            {(extractStatus || extractError || sourceStatus || sourceError) && (
              <p style={{ margin: 0, fontSize: t.size.cap, color: (extractError || sourceError) ? color.danger : color.success, lineHeight: 1.5 }}>
                {extractError || sourceError || extractStatus || sourceStatus}
              </p>
            )}
            <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={() => businessFileRef.current?.click()} disabled={extractingContext}>
                {extractingContext ? <Loader2 size={13} /> : <Upload size={13} />}
                {extractingContext ? 'Extracting...' : 'Upload'}
              </Button>
              <Button variant="secondary" size="sm" onClick={pullBusinessSources} disabled={pullingSources}>
                {pullingSources ? <Loader2 size={13} /> : <RefreshCw size={13} />}
                {pullingSources ? 'Pulling...' : 'Pull sources'}
              </Button>
              <Button variant="primary" size="sm" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
                {instrSaving ? <Loader2 size={13} /> : <Check size={13} />} Save
              </Button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[4] }}>
            <div>
              <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Business facts</div>
              <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>The strategy layer VERA uses for content, campaigns, and answers.</div>
            </div>
            {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved.</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4] }}>
            <Field label="Offer">
              <Textarea value={business.offer} onChange={e => updateBusiness('offer', e.target.value)} rows={3} placeholder="Products, services, pricing model, flagship offer, core value proposition." />
            </Field>
            <Field label="Target audience">
              <Textarea value={business.audience} onChange={e => updateBusiness('audience', e.target.value)} rows={3} placeholder="Who buys, who uses it, decision makers, industries, regions, customer segments." />
            </Field>
            <Field label="Customer problems">
              <Textarea value={business.customerProblems} onChange={e => updateBusiness('customerProblems', e.target.value)} rows={3} placeholder="Pain points, unmet needs, buying triggers, risks, objections." />
            </Field>
            <Field label="Differentiators">
              <Textarea value={business.differentiators} onChange={e => updateBusiness('differentiators', e.target.value)} rows={3} placeholder="Positioning, category, why this client is different, proof of advantage." />
            </Field>
            <Field label="Competitors">
              <Textarea value={business.competitors} onChange={e => updateBusiness('competitors', e.target.value)} rows={2} placeholder="Named competitors, alternatives, comparison points." />
            </Field>
            <Field label="Proof points">
              <Textarea value={business.proofPoints} onChange={e => updateBusiness('proofPoints', e.target.value)} rows={3} placeholder="Metrics, case studies, customer names, credentials, testimonials, awards." />
            </Field>
            <Field label="Content goals">
              <Textarea value={business.contentGoals} onChange={e => updateBusiness('contentGoals', e.target.value)} rows={3} placeholder="Awareness, lead generation, recruiting, trust, launches, events, campaign themes." />
            </Field>
            <Field label="Constraints">
              <Textarea value={business.constraints} onChange={e => updateBusiness('constraints', e.target.value)} rows={2} placeholder="Legal, compliance, forbidden claims, regions, tone limits, approval rules." />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
            <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
              {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save business context
            </Button>
            {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>VERA uses this from the next turn.</span>}
          </div>
        </div>
      </section>

      {/* Custom instructions */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Custom instructions</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          The standing brief VERA reads <strong style={{ color: color.ink }}>every turn</strong> for {activeProject.name}: tone, do/don't, positioning, recurring CTAs, in plain language.
        </p>
        <Textarea value={instr} onChange={e => setInstr(e.target.value)} rows={7}
          placeholder={`e.g. Write in a confident, peer-to-peer voice for B2B founders. Lead with a concrete number or a real failure mode, never a hypothetical. Avoid "leverage", "synergy", "game-changer". Always close with one sharp question.`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[3] }}>
          <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
            {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save instructions
          </Button>
          {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved. VERA uses this from the next turn.</span>}
        </div>
      </section>

      {/* Brand voice */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Brand voice</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[4]}` }}>
          The persona, tone, and rules VERA writes by for {activeProject.name}.{' '}
          {bvInherited
            ? <span style={{ color: color.ghost }}>Showing the workspace default. Saving creates a voice specific to this client.</span>
            : <span style={{ color: color.ghost }}>Specific to this client.</span>}
        </p>
        <div style={{ display: 'grid', gap: space[4] }}>
          <Field label="Persona name"><Input value={bv.persona_name ?? ''} onChange={e => setBv(f => ({ ...f, persona_name: e.target.value }))} placeholder="e.g. Alex" /></Field>
          <Field label="Persona descriptor"><Input value={bv.persona_descriptor ?? ''} onChange={e => setBv(f => ({ ...f, persona_descriptor: e.target.value }))} placeholder="A sharp, empathetic B2B strategist" /></Field>
          <Field label="User tone of voice" helper="How the person or brand should sound when VERA writes for them.">
            <Textarea value={bv.system_prompt ?? ''} onChange={e => setBv(f => ({ ...f, system_prompt: e.target.value }))} rows={4} placeholder="Direct, practical, warm, lightly opinionated. Uses short sentences, concrete examples, and avoids hype." />
          </Field>
          <TagInput label="Tone words" placeholder="confident, direct…" items={(bv.tone as string[]) ?? []} onAdd={v => addTo('tone', v)} onRemove={i => rmFrom('tone', i)} />
          <TagInput label="Writing rules" placeholder="Always use the Oxford comma" items={(bv.writing_rules as string[]) ?? []} onAdd={v => addTo('writing_rules', v)} onRemove={i => rmFrom('writing_rules', i)} />
          <TagInput label="Forbidden phrases" placeholder="leverage, synergy…" items={(bv.forbidden_phrases as string[]) ?? []} onAdd={v => addTo('forbidden_phrases', v)} onRemove={i => rmFrom('forbidden_phrases', i)} danger />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
          <Button variant="primary" size="md" onClick={saveBv} disabled={bvSaving} style={{ background: color.ink, color: color.surface }}>
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
          Who VERA writes toward, driving register, proof points, and which pains to hit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {addingAudience && activeOrg?.id && (
            <AudienceEditor initial={{}} orgId={activeOrg.id} onSaved={() => { setAddingAudience(false); reloadAudiences() }} onCancel={() => setAddingAudience(false)} />
          )}
          {audiences.map(a => <AudienceEditor key={a.id} initial={a} orgId={activeOrg?.id ?? ''} onSaved={reloadAudiences} />)}
          {audiences.length === 0 && !addingAudience && (
            <p style={{ fontSize: t.size.cap, color: color.ghost }}>No audiences yet. Add one so VERA writes toward a specific reader.</p>
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
            <div style={{ fontSize: t.size.micro, color: color.ghost }}>Paste, URLs, and docs VERA can search and cite. Brand-kit files, logos, guidelines, now live in Artifacts.</div>
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
        <Button variant="primary" size="sm" onClick={save} disabled={saving || !a.name?.trim()} style={{ background: color.ink, color: color.surface }}>{saving ? <Loader2 size={13} /> : <Check size={13} />} Save</Button>
        <Button variant="ghost" size="sm" onClick={del}><Trash2 size={13} /> {a.id ? 'Delete' : 'Cancel'}</Button>
      </div>
    </div>
  )
}
