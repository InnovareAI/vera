// Project Knowledge — operator drops everything they want VERA to absorb:
// pasted text, URLs to pull, files to upload (text, markdown, PDF, DOCX,
// images, logos, fonts).
//
// Three input affordances at the top:
//   · Paste — quick textarea, hit "Ingest" to embed + store
//   · URL — fetch a public page, strip HTML, ingest
//   · File upload — drag-drop or click. Text files get ingested into
//     project_knowledge AND stored as assets. Binary files (PDF, images,
//     fonts, etc) get stored as assets only — VERA can reference them
//     but can't read their contents yet (server-side parse is Phase 4).
//
// Below the input row: split view —
//   · Knowledge (text-based, retrievable by VERA semantic search)
//   · Assets   (raw files — logos, PDFs, images)
//
// Per row: delete affordance, download (signed URL), title/source.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Link2, FileText, Loader2, Trash2, ExternalLink, FileImage, FileType } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { useAuth } from '../lib/auth'
import {
  PageHeader,
  EmptyState,
  Button,
  Field,
  Input,
  Textarea,
  color,
  space,
  type as t,
  radius,
} from '../design'

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-ingest`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

interface KnowledgeRow {
  id: string
  project_id: string
  title: string
  content: string
  source_kind: 'paste' | 'url' | 'upload'
  source_url: string | null
  file_name: string | null
  file_size: number | null
  created_at: string
  updated_at: string
  // VERA-classified fields (populated async after ingest by project-ingest)
  kind: 'brief' | 'voice' | 'audit' | 'positioning' | 'case_study' | 'intel' | 'reference' | 'source_pull' | 'other' | null
  summary: string | null
  suggestion: string | null
  extracted: unknown
  classified_at: string | null
}

interface AssetRow {
  id: string
  project_id: string
  name: string
  kind: string
  mime_type: string
  storage_path: string
  file_size: number
  knowledge_id: string | null
  created_at: string
}

type Mode = 'paste' | 'url' | 'file'

function classifyAssetKind(mime: string): string {
  if (mime.startsWith('image/'))           return 'image'
  if (mime === 'application/pdf')           return 'pdf'
  if (mime.includes('wordprocessingml'))    return 'docx'
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'markdown'
  if (mime.startsWith('text/'))             return 'text'
  if (mime === 'application/json')          return 'json'
  if (mime === 'text/csv' || mime === 'application/csv') return 'csv'
  if (mime.startsWith('font/') || mime === 'application/font-woff' || mime === 'application/font-woff2') return 'font'
  if (mime.startsWith('video/'))            return 'video'
  if (mime.startsWith('audio/'))            return 'audio'
  return 'other'
}

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function iconFor(kind: string) {
  if (kind === 'image' || kind === 'logo') return FileImage
  if (kind === 'pdf' || kind === 'docx')   return FileText
  if (kind === 'font')                     return FileType
  return FileText
}

function sourceConnectorLabel(source: unknown) {
  if (source === 'unipile') return 'Unipile'
  if (source === 'apify') return 'Apify'
  if (source === 'direct') return 'Direct'
  return 'Connector'
}

function sourcePullMeta(row: KnowledgeRow) {
  const extracted = row.extracted && typeof row.extracted === 'object' ? row.extracted as Record<string, unknown> : {}
  const items = typeof extracted.items === 'number' ? extracted.items : null
  const requestedItems = typeof extracted.requestedItems === 'number' ? extracted.requestedItems : null
  const indexed = typeof extracted.indexed === 'boolean' ? extracted.indexed : null
  const collectedAt = typeof extracted.collectedAt === 'string' ? extracted.collectedAt : row.updated_at
  return {
    connector: sourceConnectorLabel(extracted.source),
    itemLabel: items == null ? 'items unknown' : requestedItems ? `${items}/${requestedItems} items` : `${items} item${items === 1 ? '' : 's'}`,
    indexed,
    collectedAt,
  }
}

function compactDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'unknown date'
  return parsed.toLocaleDateString()
}

export default function Knowledge() {
  const { activeProject } = useProject()
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('paste')
  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [urlValue, setUrlValue] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeRow[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!activeProject?.id) {
      setKnowledge([])
      setAssets([])
      return
    }
    const [kRes, aRes] = await Promise.all([
      supabase.from('project_knowledge')
        .select('id, project_id, title, content, source_kind, source_url, file_name, file_size, created_at, updated_at, kind, summary, suggestion, extracted, classified_at')
        .eq('project_id', activeProject.id)
        .order('created_at', { ascending: false }),
      supabase.from('project_assets')
        .select('id, project_id, name, kind, mime_type, storage_path, file_size, knowledge_id, created_at')
        .eq('project_id', activeProject.id)
        .order('created_at', { ascending: false }),
    ])
    setKnowledge((kRes.data as KnowledgeRow[]) ?? [])
    setAssets((aRes.data as AssetRow[]) ?? [])
  }, [activeProject?.id])

  useEffect(() => { load() }, [load])

  // Poll while any knowledge entry is still being classified by VERA
  // (classification fires after upload and typically lands in 1-3s).
  useEffect(() => {
    const pending = knowledge.some(k => k.kind !== 'source_pull' && !k.classified_at)
    if (!pending) return
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [knowledge, load])

  async function callIngest(body: Record<string, unknown>): Promise<{ ok: boolean; report?: string; error?: string }> {
    const accessToken = session?.access_token
    if (!accessToken) return { ok: false, error: 'Sign in before adding project knowledge.' }
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json() as {
      error?: string
      chunks_ingested?: number
      chunks_available?: number
      indexed?: boolean
      asset_id?: string
      note?: string | null
    }
    if (!res.ok || data.error) return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    const parts: string[] = []
    if (data.chunks_ingested) {
      parts.push(`${data.chunks_ingested} chunk${data.chunks_ingested === 1 ? '' : 's'} embedded`)
    } else if (data.indexed === false && data.chunks_available) {
      parts.push(`${data.chunks_available} chunk${data.chunks_available === 1 ? '' : 's'} stored raw`)
    }
    if (data.asset_id) parts.push('asset stored')
    if (data.note) parts.push(data.note)
    return { ok: true, report: parts.join(' · ') || 'stored' }
  }

  async function submitPaste() {
    if (!activeProject?.id || busy) return
    if (!session?.access_token) { setError('Sign in before adding project knowledge.'); return }
    if (pasteText.trim().length < 30) { setError('Need at least 30 characters'); return }
    setBusy(true); setError(null); setReport(null)
    const r = await callIngest({
      kind: 'paste',
      project_id: activeProject.id,
      title: pasteTitle || `Pasted ${new Date().toLocaleDateString()}`,
      content: pasteText,
    })
    setBusy(false)
    if (r.ok) {
      setReport(`Ingested · ${r.report}`)
      setPasteText('')
      setPasteTitle('')
      load()
    } else setError(r.error || 'Failed')
  }

  async function submitUrl() {
    if (!activeProject?.id || busy) return
    if (!session?.access_token) { setError('Sign in before adding project knowledge.'); return }
    if (!urlValue.trim().startsWith('http')) { setError('Need a full URL (https://…)'); return }
    setBusy(true); setError(null); setReport(null)
    const r = await callIngest({
      kind: 'url',
      project_id: activeProject.id,
      title: urlTitle || undefined,
      source_url: urlValue.trim(),
    })
    setBusy(false)
    if (r.ok) {
      setReport(`Fetched + ingested · ${r.report}`)
      setUrlValue('')
      setUrlTitle('')
      load()
    } else setError(r.error || 'Failed')
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!activeProject?.id || busy) return
    if (!session?.access_token) { setError('Sign in before uploading project files.'); return }
    const arr = Array.from(files)
    if (arr.length === 0) return
    setBusy(true); setError(null); setReport(null)
    const results: string[] = []
    for (const file of arr) {
      try {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
        const storagePath = `${activeProject.id}/${crypto.randomUUID()}${ext}`
        const { error: upErr } = await supabase.storage
          .from('project-assets')
          .upload(storagePath, file, { cacheControl: '3600', upsert: false })
        if (upErr) { results.push(`✗ ${file.name}: ${upErr.message}`); continue }

        const r = await callIngest({
          kind: 'file',
          project_id: activeProject.id,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          asset_kind: classifyAssetKind(file.type || ''),
        })
        if (r.ok) results.push(`✓ ${file.name}`)
        else results.push(`✗ ${file.name}: ${r.error}`)
      } catch (e) {
        results.push(`✗ ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(false)
    setReport(results.join(' · '))
    load()
  }

  async function deleteKnowledge(id: string) {
    if (!confirm('Delete this knowledge entry? VERA will lose access.')) return
    await supabase.from('project_knowledge').delete().eq('id', id)
    load()
  }

  async function deleteAsset(asset: AssetRow) {
    if (!confirm(`Delete "${asset.name}"? This removes the file too.`)) return
    await supabase.storage.from('project-assets').remove([asset.storage_path])
    await supabase.from('project_assets').delete().eq('id', asset.id)
    load()
  }

  async function downloadAsset(asset: AssetRow) {
    const { data, error } = await supabase.storage
      .from('project-assets')
      .createSignedUrl(asset.storage_path, 3600)
    if (error || !data?.signedUrl) { setError(error?.message ?? 'Failed to create download URL'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  useRightRail(
    <KnowledgeRightRail
      knowledgeCount={knowledge.length}
      assetCount={assets.length}
      projectName={activeProject?.name ?? null}
    />,
    [knowledge.length, assets.length, activeProject?.id],
  )

  if (!activeProject) {
    return (
      <div className="p-8 max-w-3xl">
        <p className="text-[14px]" style={{ color: 'var(--ghost)' }}>
          No active project. Pick a project in the left rail to manage its knowledge.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: space[8], maxWidth: 760 }}>
      <PageHeader
        eyebrow={activeProject.name}
        title="Knowledge"
        subtitle="Everything in here is in VERA's working memory for this project — pasted text, URLs she should fetch, files you upload. Text is embedded and pulled into chat by relevance; raw assets are referenced by name."
        size="md"
        style={{ marginBottom: space[7] }}
      />

      {/* Mode tabs */}
      <div
        className="inline-flex mb-3 p-0.5"
        style={{ background: 'var(--fog)', borderRadius: '99px' }}
      >
        {[
          { id: 'paste' as const, label: 'Paste', icon: FileText },
          { id: 'url' as const, label: 'URL', icon: Link2 },
          { id: 'file' as const, label: 'Files', icon: Upload },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setMode(t.id); setError(null); setReport(null) }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-medium transition-colors"
            style={{
              background: mode === t.id ? 'var(--paper-warm)' : 'transparent',
              color: mode === t.id ? 'var(--ink)' : 'var(--ink-quiet)',
              borderRadius: '99px',
              boxShadow: mode === t.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <t.icon size={13} strokeWidth={1.75} /> {t.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div
        style={{
          background: color.surface,
          border: `1px solid ${color.line}`,
          borderRadius: radius.md,
          padding: space[5],
          marginBottom: space[5],
        }}
      >
        {mode === 'paste' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
            <Field>
              <Input
                type="text"
                placeholder="Title (optional) — e.g. 'Q2 brief'"
                value={pasteTitle}
                onChange={e => setPasteTitle(e.target.value)}
              />
            </Field>
            <Field>
              <Textarea
                placeholder="Paste a brief, brand voice doc, positioning, audience notes, anything VERA should know about this project…"
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={8}
                style={{ minHeight: 160 }}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                onClick={submitPaste}
                loading={busy}
                disabled={pasteText.trim().length < 30}
              >
                {busy ? 'Ingesting…' : 'Ingest'}
              </Button>
            </div>
          </div>
        )}

        {mode === 'url' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
            <Field>
              <Input
                type="url"
                placeholder="https://innovareai.com/sam"
                value={urlValue}
                onChange={e => setUrlValue(e.target.value)}
              />
            </Field>
            <Field>
              <Input
                type="text"
                placeholder="Title (optional)"
                value={urlTitle}
                onChange={e => setUrlTitle(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                onClick={submitUrl}
                loading={busy}
                disabled={!urlValue.trim().startsWith('http')}
              >
                {busy ? 'Fetching…' : 'Fetch + ingest'}
              </Button>
            </div>
          </div>
        )}

        {mode === 'file' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: `${space[9]} 0`,
              cursor: 'pointer',
              transition: `background 120ms var(--ease), border-color 120ms var(--ease)`,
              background: dragOver ? color.paper2 : color.paper,
              border: `2px dashed ${dragOver ? color.ink2 : color.line}`,
              borderRadius: radius.md,
            }}
          >
            <Upload size={20} strokeWidth={1.5} style={{ color: color.ghost }} />
            <p style={{ fontSize: t.size.sm, marginTop: space[3], color: color.ink2 }}>
              Drop files here, or <span style={{ color: color.ink, textDecoration: 'underline' }}>browse</span>
            </p>
            <p style={{ fontSize: t.size.cap, marginTop: space[1], color: color.ghost }}>
              PDFs · Word · Markdown · Logos · Images · Fonts · up to 50 MB. Text is extracted automatically.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
            />
          </div>
        )}

        {(error || report) && (
          <p
            style={{
              marginTop: space[4],
              fontSize: t.size.cap,
              padding: `${space[2]} ${space[3]}`,
              color: error ? color.danger : color.ink2,
              background: error ? 'rgba(185,28,28,0.06)' : color.paper2,
              border: error ? `1px solid rgba(185,28,28,0.18)` : 'none',
              borderRadius: radius.sm,
            }}
          >
            {error || report}
          </p>
        )}
      </div>

      {/* Existing knowledge — agentic surface */}
      {knowledge.length > 0 && (
        <section className="mb-7">
          <p className="text-[11px] font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--ghost)' }}>
            Knowledge · {knowledge.length}
          </p>
          <div style={{ borderTop: '1px solid var(--paper-edge)' }}>
            {knowledge.map(k => {
              const isSourcePull = k.kind === 'source_pull'
              const pullMeta = isSourcePull ? sourcePullMeta(k) : null
              return (
                <div
                  key={k.id}
                  className="flex items-start gap-3 py-3 group"
                  style={{ borderBottom: '1px solid var(--paper-edge)' }}
                >
                  <KindBadge kind={k.kind} classified={isSourcePull || !!k.classified_at} indexed={pullMeta?.indexed ?? null} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] truncate" style={{ color: 'var(--ink)' }}>{k.title}</p>

                    {/* VERA's classification summary — speaks back what she found */}
                    {k.summary && (
                      <p className="text-[12.5px] mt-1 leading-snug" style={{ color: 'var(--ink-quiet)' }}>
                        <span style={{ color: 'var(--ink)' }}>VERA</span> · {k.summary}
                      </p>
                    )}

                    {/* Agentic proposed action */}
                    {k.suggestion && (
                      <div className="mt-2 inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5"
                        style={{
                          background: 'var(--accent-tint)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--accent)',
                        }}
                      >
                        <span>↗</span>
                        <span style={{ color: 'var(--ink)' }}>{k.suggestion}</span>
                      </div>
                    )}

                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--ghost)' }}>
                      {k.source_url ? (
                        <>
                          <a href={k.source_url} target="_blank" rel="noreferrer" className="hover:underline">
                            {k.source_url}
                          </a>
                          {' · '}
                        </>
                      ) : null}
                      {pullMeta
                        ? `source pull · ${pullMeta.connector} · ${pullMeta.itemLabel} · ${pullMeta.indexed === true ? 'semantic indexed' : pullMeta.indexed === false ? 'raw fallback' : 'stored'} · refreshed ${compactDate(pullMeta.collectedAt)}`
                        : `${k.source_kind} · ${k.content.length.toLocaleString()} chars · ${compactDate(k.created_at)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteKnowledge(k.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    style={{ color: 'var(--ghost)' }}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Existing assets */}
      {assets.length > 0 && (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--ghost)' }}>
            Assets · {assets.length}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {assets.map(a => {
              const Icon = iconFor(a.kind)
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-3 p-3 group"
                  style={{
                    background: 'var(--paper-warm)',
                    border: '1px solid var(--paper-edge)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--fog)', borderRadius: '4px' }}
                  >
                    <Icon size={15} style={{ color: 'var(--ink-quiet)' }} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] truncate" style={{ color: 'var(--ink)' }}>{a.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--ghost)' }}>
                      {a.kind} · {bytesHuman(a.file_size)}
                    </p>
                  </div>
                  <button
                    onClick={() => downloadAsset(a)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    style={{ color: 'var(--ghost)' }}
                    title="Download"
                  >
                    <ExternalLink size={13} />
                  </button>
                  <button
                    onClick={() => deleteAsset(a)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    style={{ color: 'var(--ghost)' }}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {knowledge.length === 0 && assets.length === 0 && (
        <EmptyState
          icon={<FileText size={22} strokeWidth={1.5} />}
          title="Nothing absorbed yet"
          body="Drop your first brief, brand voice doc, or logo above. VERA will classify it and pull it into chat by relevance."
        />
      )}
    </div>
  )
}

// ─── KindBadge — VERA's classification of a knowledge entry ──────────
const KIND_LABEL: Record<string, string> = {
  brief:       'Brief',
  voice:       'Voice',
  audit:       'Audit',
  positioning: 'Positioning',
  case_study:  'Case study',
  intel:       'Intel',
  reference:   'Reference',
  source_pull: 'Source',
  other:       'Other',
}
function KindBadge({ kind, classified, indexed }: { kind: KnowledgeRow['kind']; classified: boolean; indexed?: boolean | null }) {
  if (!classified) {
    return (
      <span
        className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 inline-flex items-center gap-1"
        style={{ background: 'var(--fog)', color: 'var(--ghost)', letterSpacing: '0.06em' }}
        title="VERA is reading…"
      >
        <Loader2 size={9} className="animate-spin" /> Reading
      </span>
    )
  }
  if (kind === 'source_pull') {
    return (
      <span
        className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
        style={{
          background: indexed ? 'rgba(22,163,74,0.10)' : 'rgba(245,158,11,0.12)',
          color: indexed ? 'rgb(22,101,52)' : 'rgb(146,64,14)',
          letterSpacing: '0.06em',
        }}
      >
        {KIND_LABEL.source_pull}
      </span>
    )
  }
  return (
    <span
      className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
      style={{
        background: kind === 'brief' || kind === 'voice' ? 'var(--accent-tint)' : 'var(--fog)',
        color: kind === 'brief' || kind === 'voice' ? 'var(--accent)' : 'var(--ink-quiet)',
        letterSpacing: '0.06em',
      }}
    >
      {KIND_LABEL[kind ?? 'other'] ?? KIND_LABEL.other}
    </span>
  )
}

function KnowledgeRightRail({
  knowledgeCount, assetCount, projectName,
}: {
  knowledgeCount: number
  assetCount: number
  projectName: string | null
}) {
  return (
    <div className="flex flex-col gap-6 py-6 pr-5 pl-1">
      <section>
        <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
          {projectName ?? 'Project'} · totals
        </p>
        <div className="text-[12px] flex flex-col gap-1.5" style={{ color: 'var(--ink-quiet)' }}>
          <div className="flex justify-between">
            <span>Knowledge entries</span>
            <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{knowledgeCount}</b>
          </div>
          <div className="flex justify-between">
            <span>Assets</span>
            <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{assetCount}</b>
          </div>
        </div>
      </section>

      <section>
        <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
          What VERA absorbs
        </p>
        <ul className="text-[12px] space-y-1.5" style={{ color: 'var(--ink-quiet)' }}>
          <li>· Pasted text — briefs, voice docs, positioning</li>
          <li>· URLs — public web pages (we strip HTML)</li>
          <li>· Text files (.md, .txt, .csv, .json)</li>
          <li>· PDFs — text extracted server-side, embedded</li>
          <li>· Word (.docx) — text extracted server-side, embedded</li>
          <li>· Logos / images / fonts (stored, referenced by name)</li>
        </ul>
      </section>
    </div>
  )
}
