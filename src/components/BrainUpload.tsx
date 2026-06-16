// BrainUpload — the single place to feed a space's Brain.
//
// Three input lanes, matching how operators think about source material:
//   · Content — paste a note, pull a URL, or drop a document (PDF/DOCX/MD/TXT/CSV).
//               Text is embedded into project_knowledge; the raw file is kept as an asset.
//   · Posts   — paste an existing post and choose what it becomes:
//                 - Reference example → embedded in the Brain as a voice/style sample
//                 - Draft to review   → inserted as a pending content_posts row (lands in Review)
//   · Images  — drop image files. Stored as project_assets, so they show up as brand
//               reference here and as reusable post media in Studio.
//
// The text/URL/file lanes go through the project-ingest function (service role, auth-checked).
// The draft lane inserts content_posts directly (RLS allows org members / project reviewers).
import { useRef, useState } from 'react'
import { Upload, Link2, FileText, Image as ImageIcon, Film, Loader2, Check, Sparkles, Send, BookOpen } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useAuth } from '../lib/auth'
import { SectionLabel, Field, Input, Textarea, Button, color, space, type as t, radius } from '../design'

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-ingest`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

type Tab = 'content' | 'posts' | 'images' | 'videos'
type ContentMode = 'paste' | 'link' | 'file'
type PostDest = 'reference' | 'draft'

function assetKindFor(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessing') || mime.includes('msword')) return 'docx'
  if (mime.startsWith('font/') || mime.includes('font')) return 'font'
  return 'other'
}

async function uploadToStorage(projectId: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext}`
  const { error } = await supabase.storage.from('project-assets').upload(storagePath, file, { cacheControl: '3600', upsert: false })
  if (error) throw new Error(error.message)
  return storagePath
}

export function BrainUpload({ onUploaded }: { onUploaded?: () => void }) {
  const { activeProject } = useProject()
  const { session } = useAuth()

  const [tab, setTab] = useState<Tab>('content')
  const [contentMode, setContentMode] = useState<ContentMode>('paste')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [urlValue, setUrlValue] = useState('')

  const [postTitle, setPostTitle] = useState('')
  const [postText, setPostText] = useState('')
  const [postDest, setPostDest] = useState<PostDest>('reference')

  const [recentImages, setRecentImages] = useState<{ name: string; url: string }[]>([])
  const [recentVideos, setRecentVideos] = useState<{ name: string; url: string }[]>([])
  const [dragOver, setDragOver] = useState(false)

  const docInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const projectId = activeProject?.id
  const orgId = activeProject?.org_id ?? null

  async function callIngest(body: Record<string, unknown>): Promise<{ ok: boolean; report?: string; error?: string }> {
    if (!session?.access_token) return { ok: false, error: 'Sign in before adding to the Brain.' }
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({})) as { error?: string; chunks_ingested?: number; chunks_available?: number; indexed?: boolean; asset_id?: string; note?: string | null }
    if (!res.ok || data.error) return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    const parts: string[] = []
    if (data.chunks_ingested) parts.push(`${data.chunks_ingested} chunk${data.chunks_ingested === 1 ? '' : 's'} embedded`)
    else if (data.indexed === false && data.chunks_available) parts.push(`${data.chunks_available} chunk${data.chunks_available === 1 ? '' : 's'} stored raw`)
    if (data.asset_id) parts.push('asset stored')
    if (data.note) parts.push(data.note)
    return { ok: true, report: parts.join(' · ') || 'stored' }
  }

  function reset(msg: string) { setReport(msg); onUploaded?.() }

  async function submitPaste() {
    if (!projectId || busy) return
    if (pasteText.trim().length < 30) { setError('Add at least 30 characters.'); return }
    setBusy(true); setError(null); setReport(null)
    const r = await callIngest({ kind: 'paste', project_id: projectId, title: pasteTitle.trim() || `Note ${new Date().toLocaleDateString()}`, content: pasteText.trim() })
    setBusy(false)
    if (r.ok) { setPasteText(''); setPasteTitle(''); reset(`Added to Brain · ${r.report}`) } else setError(r.error || 'Failed')
  }

  async function submitUrl() {
    if (!projectId || busy) return
    if (!urlValue.trim().startsWith('http')) { setError('Enter a full URL (https://…).'); return }
    setBusy(true); setError(null); setReport(null)
    const r = await callIngest({ kind: 'url', project_id: projectId, title: urlTitle.trim() || undefined, source_url: urlValue.trim() })
    setBusy(false)
    if (r.ok) { setUrlValue(''); setUrlTitle(''); reset(`Pulled + added to Brain · ${r.report}`) } else setError(r.error || 'Failed')
  }

  async function uploadDocs(files: FileList | File[]) {
    if (!projectId || busy) return
    const arr = Array.from(files)
    if (!arr.length) return
    setBusy(true); setError(null); setReport(null)
    const results: string[] = []
    for (const file of arr) {
      try {
        const storagePath = await uploadToStorage(projectId, file)
        const r = await callIngest({ kind: 'file', project_id: projectId, storage_path: storagePath, file_name: file.name, mime_type: file.type || 'application/octet-stream', file_size: file.size, asset_kind: assetKindFor(file.type || '') })
        results.push(r.ok ? `✓ ${file.name}` : `✗ ${file.name}: ${r.error}`)
      } catch (e) { results.push(`✗ ${file.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    setBusy(false); reset(results.join(' · '))
  }

  async function savePost() {
    if (!projectId || busy) return
    if (postText.trim().length < 10) { setError('Paste the post text first.'); return }
    setBusy(true); setError(null); setReport(null)
    if (postDest === 'reference') {
      const framed = `VOICE EXAMPLE POST — study the tone, structure, and phrasing; do not reuse verbatim.\n\n${postText.trim()}`
      const r = await callIngest({ kind: 'paste', project_id: projectId, title: postTitle.trim() || 'Voice example post', content: framed })
      setBusy(false)
      if (r.ok) { setPostText(''); setPostTitle(''); reset(`Saved as voice example · ${r.report}`) } else setError(r.error || 'Failed')
    } else {
      const { error: insErr } = await supabase.from('content_posts').insert({
        project_id: projectId, org_id: orgId,
        title: postTitle.trim() || null, copy: postText.trim(),
        status: 'pending', channel: 'LinkedIn', format: 'Text-only',
      })
      setBusy(false)
      if (insErr) setError(insErr.message)
      else { setPostText(''); setPostTitle(''); reset('Draft created · find it in Review') }
    }
  }

  async function uploadImages(files: FileList | File[]) {
    if (!projectId || busy) return
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!arr.length) { setError('Drop image files (PNG, JPG, WEBP…).'); return }
    setBusy(true); setError(null); setReport(null)
    const added: { name: string; url: string }[] = []
    const results: string[] = []
    for (const file of arr) {
      try {
        const storagePath = await uploadToStorage(projectId, file)
        const r = await callIngest({ kind: 'file', project_id: projectId, storage_path: storagePath, file_name: file.name, mime_type: file.type, file_size: file.size, asset_kind: 'image' })
        if (r.ok) {
          results.push(`✓ ${file.name}`)
          const { data: signed } = await supabase.storage.from('project-assets').createSignedUrl(storagePath, 3600)
          if (signed?.signedUrl) added.push({ name: file.name, url: signed.signedUrl })
        } else results.push(`✗ ${file.name}: ${r.error}`)
      } catch (e) { results.push(`✗ ${file.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    setBusy(false)
    if (added.length) setRecentImages(prev => [...added, ...prev].slice(0, 12))
    reset(`${results.join(' · ')} · available in Brain and Studio`)
  }

  async function uploadVideos(files: FileList | File[]) {
    if (!projectId || busy) return
    const arr = Array.from(files).filter(f => f.type.startsWith('video/'))
    if (!arr.length) { setError('Drop video files (MP4, MOV, WEBM…).'); return }
    setBusy(true); setError(null); setReport(null)
    const added: { name: string; url: string }[] = []
    const results: string[] = []
    for (const file of arr) {
      try {
        const storagePath = await uploadToStorage(projectId, file)
        const r = await callIngest({ kind: 'file', project_id: projectId, storage_path: storagePath, file_name: file.name, mime_type: file.type, file_size: file.size, asset_kind: 'video' })
        if (r.ok) {
          results.push(`✓ ${file.name}`)
          const { data: signed } = await supabase.storage.from('project-assets').createSignedUrl(storagePath, 3600)
          if (signed?.signedUrl) added.push({ name: file.name, url: signed.signedUrl })
        } else results.push(`✗ ${file.name}: ${r.error}`)
      } catch (e) { results.push(`✗ ${file.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    setBusy(false)
    if (added.length) setRecentVideos(prev => [...added, ...prev].slice(0, 8))
    reset(`${results.join(' · ')} · available in Brain and Studio`)
  }

  if (!projectId) return null

  const card: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }
  const tabs: { id: Tab; label: string; icon: typeof Upload }[] = [
    { id: 'content', label: 'Content', icon: FileText },
    { id: 'posts', label: 'Posts', icon: Send },
    { id: 'images', label: 'Images', icon: ImageIcon },
    { id: 'videos', label: 'Videos', icon: Film },
  ]

  return (
    <section style={{ marginBottom: space[8] }}>
      <SectionLabel style={{ marginBottom: space[3] }}>Upload to Brain</SectionLabel>
      <div style={card}>
        {/* lane switcher */}
        <div style={{ display: 'inline-flex', gap: space[1], padding: space[1], background: color.paper2, borderRadius: radius.pill, marginBottom: space[5] }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setTab(id); setError(null); setReport(null) }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: radius.pill, border: 0, cursor: 'pointer',
                background: tab === id ? color.surface : 'transparent', color: tab === id ? color.ink : color.ghost,
                fontSize: t.size.cap, fontWeight: t.weight.semibold, boxShadow: tab === id ? `0 1px 2px rgba(0,0,0,0.06)` : 'none' }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'content' && (
          <div>
            <div style={{ display: 'inline-flex', gap: space[3], marginBottom: space[4] }}>
              {(['paste', 'link', 'file'] as ContentMode[]).map(m => (
                <button key={m} type="button" onClick={() => setContentMode(m)}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: contentMode === m ? color.ink : color.ghost,
                    fontSize: t.size.cap, fontWeight: t.weight.semibold, borderBottom: `2px solid ${contentMode === m ? color.ink : 'transparent'}`, paddingBottom: 4 }}>
                  {m === 'paste' ? 'Paste' : m === 'link' ? 'Link' : 'File'}
                </button>
              ))}
            </div>
            {contentMode === 'paste' && (
              <div style={{ display: 'grid', gap: space[3] }}>
                <Field label="Title" optional><Input value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} placeholder="e.g. Brand positioning notes" /></Field>
                <Field label="Content"><Textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6} placeholder="Paste briefs, positioning, FAQs, transcripts — anything VERA should know." /></Field>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="primary" leading={busy ? <Loader2 size={14} /> : <BookOpen size={14} />} onClick={submitPaste} disabled={busy || pasteText.trim().length < 30}>{busy ? 'Adding' : 'Add to Brain'}</Button>
                </div>
              </div>
            )}
            {contentMode === 'link' && (
              <div style={{ display: 'grid', gap: space[3] }}>
                <Field label="Title" optional><Input value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="Optional label" /></Field>
                <Field label="URL"><Input value={urlValue} onChange={e => setUrlValue(e.target.value)} placeholder="https://…" /></Field>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="primary" leading={busy ? <Loader2 size={14} /> : <Link2 size={14} />} onClick={submitUrl} disabled={busy || !urlValue.trim()}>{busy ? 'Pulling' : 'Pull + add'}</Button>
                </div>
              </div>
            )}
            {contentMode === 'file' && (
              <div>
                <input ref={docInputRef} type="file" multiple accept=".pdf,.doc,.docx,.md,.markdown,.txt,.csv,.json,text/*,application/pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadDocs(e.target.files); e.target.value = '' }} />
                <Dropzone dragOver={dragOver} setDragOver={setDragOver} onFiles={uploadDocs} onClick={() => docInputRef.current?.click()}
                  icon={Upload} title="Drop documents or click to choose" hint="PDF, DOCX, Markdown, TXT, CSV, JSON. Text is embedded; the file is kept as an asset." busy={busy} />
              </div>
            )}
          </div>
        )}

        {tab === 'posts' && (
          <div style={{ display: 'grid', gap: space[3] }}>
            <Field label="Title" optional><Input value={postTitle} onChange={e => setPostTitle(e.target.value)} placeholder="e.g. Q3 launch post that performed well" /></Field>
            <Field label="Post text"><Textarea value={postText} onChange={e => setPostText(e.target.value)} rows={6} placeholder="Paste the full post." /></Field>
            <div>
              <div style={{ fontSize: t.size.micro, color: color.ghost, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: space[2] }}>What should this become?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[3] }}>
                <DestCard active={postDest === 'reference'} onClick={() => setPostDest('reference')} icon={Sparkles}
                  title="Voice example" body="Embedded in the Brain. VERA studies the style when writing new posts. Not published." />
                <DestCard active={postDest === 'draft'} onClick={() => setPostDest('draft')} icon={Send}
                  title="Draft to review" body="Lands in Review as a pending draft you can edit, approve, and schedule." />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" leading={busy ? <Loader2 size={14} /> : postDest === 'reference' ? <Sparkles size={14} /> : <Send size={14} />} onClick={savePost} disabled={busy || postText.trim().length < 10}>
                {busy ? 'Saving' : postDest === 'reference' ? 'Save as voice example' : 'Create draft'}
              </Button>
            </div>
          </div>
        )}

        {tab === 'images' && (
          <div>
            <input ref={imgInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadImages(e.target.files); e.target.value = '' }} />
            <Dropzone dragOver={dragOver} setDragOver={setDragOver} onFiles={uploadImages} onClick={() => imgInputRef.current?.click()}
              icon={ImageIcon} title="Drop images or click to choose" hint="Logos and brand imagery. Available as Brain reference and as reusable post media in Studio." busy={busy} />
            {recentImages.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: space[2], marginTop: space[4] }}>
                {recentImages.map((img, i) => (
                  <div key={i} title={img.name} style={{ aspectRatio: '1', borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${color.line}`, background: color.paper2 }}>
                    <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'videos' && (
          <div>
            <input ref={videoInputRef} type="file" multiple accept="video/*" style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadVideos(e.target.files); e.target.value = '' }} />
            <Dropzone dragOver={dragOver} setDragOver={setDragOver} onFiles={uploadVideos} onClick={() => videoInputRef.current?.click()}
              icon={Film} title="Drop videos or click to choose" hint="MP4, MOV, WEBM. Available as Brain reference and reusable post media in Studio. Large files can take a moment." busy={busy} />
            {recentVideos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space[2], marginTop: space[4] }}>
                {recentVideos.map((vid, i) => (
                  <div key={i} title={vid.name} style={{ aspectRatio: '16 / 9', borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${color.line}`, background: color.paper2 }}>
                    <video src={vid.url} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(report || error) && (
          <div style={{ marginTop: space[4], fontSize: t.size.cap, color: error ? color.danger : color.success, display: 'flex', alignItems: 'center', gap: 6 }}>
            {error ? null : <Check size={14} />}{error ?? report}
          </div>
        )}
      </div>
    </section>
  )
}

function Dropzone({ dragOver, setDragOver, onFiles, onClick, icon: Icon, title, hint, busy }: {
  dragOver: boolean; setDragOver: (v: boolean) => void; onFiles: (f: FileList | File[]) => void; onClick: () => void
  icon: typeof Upload; title: string; hint: string; busy: boolean
}) {
  return (
    <div onClick={onClick}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) onFiles(e.dataTransfer.files) }}
      style={{ border: `1.5px dashed ${dragOver ? color.ink : color.line}`, borderRadius: radius.lg, padding: `${space[7]} ${space[5]}`, textAlign: 'center', cursor: 'pointer', background: dragOver ? color.paper2 : 'transparent', transition: 'all 0.12s' }}>
      {busy ? <Loader2 size={22} style={{ color: color.ghost }} /> : <Icon size={22} style={{ color: color.ghost }} />}
      <div style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink, marginTop: space[2] }}>{busy ? 'Uploading…' : title}</div>
      <div style={{ fontSize: t.size.micro, color: color.faint, marginTop: 4, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>{hint}</div>
    </div>
  )
}

function DestCard({ active, onClick, icon: Icon, title, body }: { active: boolean; onClick: () => void; icon: typeof Upload; title: string; body: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{ textAlign: 'left', borderRadius: radius.md, padding: space[4], cursor: 'pointer',
        border: `1px solid ${active ? color.ink : color.line}`, background: active ? color.paper2 : color.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}><Icon size={14} /> {title}</div>
      <div style={{ fontSize: t.size.micro, color: color.faint, marginTop: 4, lineHeight: 1.5 }}>{body}</div>
    </button>
  )
}
