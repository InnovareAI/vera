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

export default function Knowledge() {
  const { activeProject } = useProject()
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
        .select('id, project_id, title, content, source_kind, source_url, file_name, file_size, created_at')
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

  async function callIngest(body: Record<string, unknown>): Promise<{ ok: boolean; report?: string; error?: string }> {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok || data.error) return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    const parts: string[] = []
    if (data.chunks_ingested) parts.push(`${data.chunks_ingested} chunk${data.chunks_ingested === 1 ? '' : 's'} embedded`)
    if (data.asset_id)        parts.push('asset stored')
    return { ok: true, report: parts.join(' · ') }
  }

  async function submitPaste() {
    if (!activeProject?.id || busy) return
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
    <div className="p-8 max-w-3xl">
      <div className="mb-7">
        <p className="text-[11px] font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--ghost)' }}>
          {activeProject.name}
        </p>
        <h1 className="text-[24px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>Knowledge</h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'var(--ink-quiet)' }}>
          Everything in here is in VERA's working memory for this project — pasted text, URLs she should fetch, files you upload. Text is embedded and pulled into chat by relevance; raw assets are referenced by name.
        </p>
      </div>

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
        className="p-4 mb-4"
        style={{
          background: 'var(--paper-warm)',
          border: '1px solid var(--paper-edge)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {mode === 'paste' && (
          <>
            <input
              type="text"
              placeholder="Title (optional) — e.g. 'Q2 brief'"
              value={pasteTitle}
              onChange={e => setPasteTitle(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px', color: 'var(--ink)' }}
            />
            <textarea
              placeholder="Paste a brief, brand voice doc, positioning, audience notes, anything VERA should know about this project…"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 text-[13px] outline-none resize-y"
              style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px', color: 'var(--ink)', minHeight: 160 }}
            />
            <div className="flex justify-end mt-2.5">
              <button
                onClick={submitPaste}
                disabled={busy || pasteText.trim().length < 30}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] font-medium transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
              >
                {busy ? <><Loader2 size={13} className="animate-spin" /> Ingesting…</> : 'Ingest'}
              </button>
            </div>
          </>
        )}

        {mode === 'url' && (
          <>
            <input
              type="url"
              placeholder="https://innovareai.com/sam"
              value={urlValue}
              onChange={e => setUrlValue(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px', color: 'var(--ink)' }}
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={urlTitle}
              onChange={e => setUrlTitle(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: '4px', color: 'var(--ink)' }}
            />
            <div className="flex justify-end mt-2.5">
              <button
                onClick={submitUrl}
                disabled={busy || !urlValue.trim().startsWith('http')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] font-medium transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
              >
                {busy ? <><Loader2 size={13} className="animate-spin" /> Fetching…</> : 'Fetch + ingest'}
              </button>
            </div>
          </>
        )}

        {mode === 'file' && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files)
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center py-8 cursor-pointer transition-colors"
              style={{
                background: dragOver ? 'var(--fog)' : 'var(--paper)',
                border: `2px dashed ${dragOver ? 'var(--ink-quiet)' : 'var(--paper-edge)'}`,
                borderRadius: 'var(--radius-md)',
              }}
            >
              <Upload size={20} style={{ color: 'var(--ghost)' }} strokeWidth={1.5} />
              <p className="text-[13px] mt-2.5" style={{ color: 'var(--ink-quiet)' }}>
                Drop files here, or <span style={{ color: 'var(--ink)', textDecoration: 'underline' }}>browse</span>
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--ghost)' }}>
                Logos · PDFs · Word · Markdown · Images · Fonts · up to 50 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          </>
        )}

        {(error || report) && (
          <p
            className="mt-3 text-[12px] px-3 py-2"
            style={{
              color: error ? 'var(--accent)' : 'var(--ink-quiet)',
              background: error ? 'var(--accent-tint)' : 'var(--fog)',
              borderRadius: '4px',
            }}
          >
            {error || report}
          </p>
        )}
      </div>

      {/* Existing knowledge */}
      {knowledge.length > 0 && (
        <section className="mb-7">
          <p className="text-[11px] font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--ghost)' }}>
            Knowledge · {knowledge.length}
          </p>
          <div style={{ borderTop: '1px solid var(--paper-edge)' }}>
            {knowledge.map(k => (
              <div
                key={k.id}
                className="flex items-start gap-3 py-3 group"
                style={{ borderBottom: '1px solid var(--paper-edge)' }}
              >
                <span
                  className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                  style={{
                    background: 'var(--fog)',
                    color: 'var(--ghost)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {k.source_kind}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] truncate" style={{ color: 'var(--ink)' }}>{k.title}</p>
                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--ghost)' }}>
                    {k.source_url ? (
                      <>
                        <a href={k.source_url} target="_blank" rel="noreferrer" className="hover:underline">
                          {k.source_url}
                        </a>
                        {' · '}
                      </>
                    ) : null}
                    {k.content.length.toLocaleString()} chars · {new Date(k.created_at).toLocaleDateString()}
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
            ))}
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
        <p className="text-[13px] py-8 text-center" style={{ color: 'var(--ghost)' }}>
          Nothing absorbed yet. Drop your first brief, brand voice doc, or logo above.
        </p>
      )}
    </div>
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
          <li>· Logos / images / fonts (stored, referenced by name)</li>
          <li style={{ color: 'var(--mist)' }}>· PDFs / Word (stored, no text yet — paste extracted)</li>
        </ul>
      </section>
    </div>
  )
}
