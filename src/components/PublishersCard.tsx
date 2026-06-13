// Connected blogs / CMS / Git publishers, Settings to Integrations.
//
// One-screen connect flow: operator pastes URL → auto-discover-publisher
// runs → shows what we found + asks for ONLY the credential the platform
// needs. Every other field is pre-filled.

import { useState, useEffect } from 'react'
import { Loader2, Plus, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in again before managing publishers.')
  return { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }
}

interface Publisher {
  id: string
  kind: string
  name: string
  config: Record<string, unknown>
  health_status: string | null
  health_detail: string | null
  last_health_check: string | null
  connected_at: string
  project_id: string | null
}

export function PublishersCard() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const [list, setList] = useState<Publisher[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    let query = supabase.from('publishers').select('*').eq('org_id', activeOrg.id)
    query = activeProject?.id ? query.eq('project_id', activeProject.id) : query.is('project_id', null)
    query.order('connected_at', { ascending: false })
      .then(({ data }) => {
        setList((data ?? []) as Publisher[])
        setLoading(false)
      })
  }, [activeOrg, activeProject?.id])

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Connected blogs & CMSes</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-detects WordPress / Ghost / static sites on Vercel-Netlify-CF Pages. One URL, we discover the rest.
          </p>
        </div>
        <button onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800">
          <Plus size={12} /> Add a blog
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">
          No blogs connected yet. Click <span className="font-medium">Add a blog</span> to wire one up.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100">
              <div className="w-8 h-8 rounded-md bg-gray-100 text-gray-700 flex items-center justify-center text-[11px] font-bold uppercase">
                {p.kind.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                <div className="text-[11px] text-gray-500 capitalize">
                  {p.kind.replace('_', ' ')} · {p.health_status ?? 'never checked'}
                </div>
              </div>
              <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                p.health_status === 'healthy' ? 'bg-emerald-500' :
                p.health_status === 'stale'   ? 'bg-red-500' :
                p.health_status === 'unknown' ? 'bg-amber-500' :
                'bg-gray-300'
              }`} />
            </div>
          ))}
        </div>
      )}

      {wizardOpen && <AddBlogWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}

// ─── One-screen add-a-blog wizard ──────────────────────────────────────────
interface Discovery {
  platform: string
  recommended_path: 'cms_direct' | 'headless_cms' | 'git_backed' | 'manual_paste'
  confidence: number
  detection_summary?: string
  detected_cms: string
  detected_hosting: string
  detected_ssg: string
  original_url?: string
  sniffed_blog_url?: string | null
  hint: {
    connection_name?: string
    base_url?: string
    api_endpoint?: string
    wp_categories?: string[]
    wp_tags?: string[]
    repo?: string
    branch?: string
    content_dir?: string
    file_format?: string
    sniff_source?: string
  }
  credential_needed: {
    kind: string
    label: string
    hint: string
    fields: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; note?: string }>
  } | null
  message?: string
}

// Manual-pick platforms, for cases where auto-detection can't see the
// CMS (Strapi self-hosted on a different domain than the rendered site,
// or operators who already know what they want).
const MANUAL_PLATFORMS: Record<string, { label: string; kind: string; fields: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; note?: string }>; hint: string }> = {
  strapi: {
    label: 'Strapi (self-hosted)',
    kind: 'strapi',
    hint: 'Your Strapi API URL + content type UID + API token. Strapi runs on a separate domain from the rendered site so we can\'t auto-detect it from a public URL.',
    fields: [
      { name: 'base_url', label: 'Strapi URL', type: 'text', placeholder: 'https://cms.example.com', note: 'The Strapi admin/API root.' },
      { name: 'content_type_uid', label: 'Content type UID', type: 'text', placeholder: 'articles', note: 'Kebab-case ID from Strapi → Content-Type Builder (e.g. "articles" or "blog-posts").' },
      { name: 'token', label: 'API Token', type: 'password', placeholder: '...', note: 'Generate in Strapi Admin → Settings → API Tokens with read/write on this content type.' },
    ],
  },
  hubspot: {
    label: 'HubSpot CMS',
    kind: 'hubspot',
    hint: 'If your HubSpot site isn\'t reachable publicly (preview / sandbox), enter manually. Otherwise paste the live URL to auto-detect.',
    fields: [
      { name: 'access_token', label: 'Private App Access Token', type: 'password', placeholder: 'pat-na1-...', note: 'HubSpot → Settings → Integrations → Private Apps.' },
      { name: 'content_group_id', label: 'Blog ID', type: 'text', placeholder: '123456789', note: 'The numeric blog ID (visible in HubSpot URLs).' },
    ],
  },
}

function AddBlogWizard({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const [url, setUrl] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [creds, setCreds] = useState<Record<string, string>>({})
  // Editable mirrors of the auto-discovered hint values (operator can override)
  const [editName, setEditName] = useState('Main blog')
  const [editRepo, setEditRepo] = useState('')
  const [editPrMode, setEditPrMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; recovery?: string } | null>(null)
  const [manualKind, setManualKind] = useState<string | null>(null)

  function pickManualPlatform(kind: string) {
    const m = MANUAL_PLATFORMS[kind]
    if (!m) return
    setManualKind(kind)
    setDiscovery({
      platform: m.kind,
      recommended_path: 'cms_direct',
      confidence: 1.0,
      detected_cms: m.kind,
      detected_hosting: 'unknown',
      detected_ssg: 'unknown',
      hint: { connection_name: m.label },
      credential_needed: { kind: m.kind, label: m.label, hint: m.hint, fields: m.fields },
    })
  }

  async function runDiscover() {
    if (!url.trim()) return
    setDiscovering(true); setError(null); setDiscovery(null)
    try {
      const res = await fetch(FN('auto-discover-publisher'), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json() as Discovery & { error?: string }
      if (data.error) throw new Error(data.error)
      setDiscovery(data)
      setEditName(data.hint.connection_name ?? 'Main blog')
      setEditRepo(data.hint.repo ?? '')
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) })
    } finally { setDiscovering(false) }
  }

  async function runConnect() {
    if (!discovery?.credential_needed || !activeOrg) return
    setSubmitting(true); setError(null)
    try {
      const connectorEndpoint = {
        wordpress: 'wordpress-publish',
        ghost: 'ghost-publish',
        github_mdx: 'git-publish',
        webflow: 'webflow-publish',
        contentful: 'contentful-publish',
        sanity: 'sanity-publish',
        hubspot: 'hubspot-publish',
        strapi: 'strapi-publish',
      }[discovery.credential_needed.kind]
      if (!connectorEndpoint) {
        setError({ message: `No connector for ${discovery.credential_needed.kind}.`, recovery: 'Coming next.' })
        return
      }

      // Build the platform-specific payload
      const payload: Record<string, unknown> = {
        action: 'connect',
        org_id: activeOrg.id,
        name: editName.trim() || 'Main blog',
      }
      if (activeProject?.id) payload.client_project_id = activeProject.id
      if (discovery.credential_needed.kind === 'wordpress') {
        Object.assign(payload, {
          base_url: discovery.hint.base_url,
          username: creds.username,
          app_password: creds.app_password,
        })
      } else if (discovery.credential_needed.kind === 'ghost') {
        Object.assign(payload, {
          base_url: discovery.hint.base_url,
          api_key: creds.api_key,
        })
      } else if (discovery.credential_needed.kind === 'github_mdx') {
        Object.assign(payload, {
          repo: editRepo.trim() || discovery.hint.repo,
          branch: discovery.hint.branch ?? 'main',
          content_dir: discovery.hint.content_dir ?? 'content/blog',
          file_format: discovery.hint.file_format ?? 'mdx',
          pr_mode: editPrMode,
          github_pat: creds.github_pat,
        })
      } else {
        // Webflow / Contentful / Sanity, pass every field from credential_needed
        // verbatim. The credential_needed.fields[] schema enumerates exactly what
        // the connector wants, so we forward all of them.
        for (const f of discovery.credential_needed.fields) {
          payload[f.name] = creds[f.name]
        }
      }

      const res = await fetch(FN(connectorEndpoint), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string; recovery_action: string } }
      if (!data.ok) {
        setError({ message: data.error?.message ?? 'Connection failed.', recovery: data.error?.recovery_action })
        return
      }
      // Connected, close + refresh
      onClose()
      window.location.reload()
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) })
    } finally { setSubmitting(false) }
  }

  const canSubmit = !!discovery?.credential_needed && discovery.credential_needed.fields.every(f => {
    if (f.name === 'repo') return !!editRepo.trim() || !!discovery.hint.repo
    // Fields with default placeholders (environment_id, dataset) auto-fill
    // from placeholder if operator doesn't type, we still want them required-on-submit.
    return !!(creds[f.name]?.trim() || f.placeholder)
  }) && !submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Add a blog</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Paste your blog URL, we will auto-discover the platform and pre-fill everything we can.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* URL input, hidden when operator picked a manual platform */}
          {!manualKind && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Where does your blog live?</label>
              <div className="flex gap-2">
                <input autoFocus value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !discovering && runDiscover()}
                  placeholder="https://acme.com/blog  or  https://blog.acme.com"
                  className="input flex-1" />
                <button onClick={runDiscover} disabled={!url.trim() || discovering}
                  className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {discovering ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Discovering…</> : 'Discover'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Paste any page on your blog. If you're not sure, paste your homepage and we'll find the blog.
                {' '}
                <span className="text-gray-500">Using Strapi or another self-hosted CMS?{' '}
                  <button onClick={() => pickManualPlatform('strapi')} className="text-gray-700 underline hover:text-gray-900">Set up manually</button>
                </span>
              </p>
            </div>
          )}

          {/* When discovery returns nothing useful, offer the manual platform list */}
          {discovery && !discovery.credential_needed && !manualKind && (
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs font-medium text-gray-700 mb-2">We couldn't auto-detect a supported platform at that URL. Pick manually:</p>
              <div className="space-y-1.5">
                {Object.entries(MANUAL_PLATFORMS).map(([k, p]) => (
                  <button key={k} onClick={() => pickManualPlatform(k)}
                    className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:bg-white text-xs">
                    <div className="font-medium text-gray-900">{p.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manual-pick mode banner, back button */}
          {manualKind && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-700">
                Setting up <span className="font-medium">{MANUAL_PLATFORMS[manualKind]?.label}</span> manually.
              </p>
              <button onClick={() => { setManualKind(null); setDiscovery(null); setCreds({}) }}
                className="text-[11px] text-gray-500 hover:text-gray-700 underline">
                ← Back to URL detection
              </button>
            </div>
          )}

          {/* Sniffed-elsewhere banner */}
          {discovery?.sniffed_blog_url && discovery.original_url && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs font-medium text-blue-900">
                Couldn't find a blog at <code className="bg-blue-100 px-1 rounded">{discovery.original_url}</code>, but we found one at <code className="bg-blue-100 px-1 rounded">{discovery.sniffed_blog_url}</code>.
              </p>
              <p className="text-[11px] text-blue-700 mt-1">
                We're using that. If wrong, paste the actual blog URL above and Discover again.
              </p>
            </div>
          )}

          {/* Discovery result + credential form (single screen, all on one page) */}
          {discovery && discovery.credential_needed && (
            <>
              <DiscoveryCard discovery={discovery} />

              <div className="space-y-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Connection name</label>
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="input w-full" />
                </div>

                {discovery.credential_needed.kind === 'github_mdx' && (
                  <>
                    {!discovery.hint.repo && (
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">GitHub repo (owner/name)</label>
                        <input value={editRepo} onChange={e => setEditRepo(e.target.value)} className="input w-full"
                          placeholder="innovareai/blog" />
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={editPrMode} onChange={e => setEditPrMode(e.target.checked)} />
                      <span>Open a Pull Request instead of pushing directly</span>
                    </label>
                  </>
                )}

                <div className="pt-2">
                  <p className="text-xs font-medium text-gray-900 mb-1">{discovery.credential_needed.label}</p>
                  <p className="text-[11px] text-gray-500 mb-3">{discovery.credential_needed.hint}</p>
                  {discovery.credential_needed.fields.filter(f => f.name !== 'repo').map(field => (
                    <div key={field.name} className="mb-3">
                      <label className="text-xs font-medium text-gray-700 block mb-1">{field.label}</label>
                      <input
                        type={field.type}
                        value={creds[field.name] ?? ''}
                        onChange={e => setCreds(c => ({ ...c, [field.name]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="input w-full"
                        autoComplete="off"
                      />
                      {field.note && <p className="text-[11px] text-gray-400 mt-1">{field.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Unknown / unsupported platform */}
          {discovery && !discovery.credential_needed && (
            <div className="text-center py-6 px-4 bg-gray-50 rounded-lg">
              <Globe className="w-7 h-7 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-700">{discovery.message ?? 'No supported connector for this site yet.'}</p>
              <p className="text-[11px] text-gray-500 mt-1">WordPress · Ghost · Git-backed static sites are live. Webflow / HubSpot / headless CMSes ship next.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-xs font-medium text-red-700">{error.message}</p>
              {error.recovery && <p className="text-[11px] text-red-600 mt-1">{error.recovery}</p>}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          {discovery?.credential_needed && (
            <button onClick={runConnect} disabled={!canSubmit}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1.5">
              {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : `Connect ${discovery.platform}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Discovery summary card ────────────────────────────────────────────────
function DiscoveryCard({ discovery }: { discovery: Discovery }) {
  const pathStyle = {
    cms_direct:   { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
    headless_cms: { bg: 'bg-blue-50',     text: 'text-blue-700'    },
    git_backed:   { bg: 'bg-violet-50',   text: 'text-violet-700'  },
    manual_paste: { bg: 'bg-gray-100',    text: 'text-gray-600'    },
  }[discovery.recommended_path]

  return (
    <div className={`p-4 rounded-lg ${pathStyle.bg} space-y-3`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${pathStyle.text}`}>Detected</span>
        <span className={`text-sm font-semibold ${pathStyle.text} capitalize`}>
          {discovery.platform.replace('_', ' ')}
          {discovery.confidence > 0.4 && <span className="ml-2 text-xs opacity-70">{Math.round(discovery.confidence * 100)}%</span>}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {discovery.detected_hosting !== 'unknown' && (
          <DiscoveryRow label="Hosting" value={discovery.detected_hosting.replace('_', ' ')} />
        )}
        {discovery.detected_ssg !== 'unknown' && (
          <DiscoveryRow label="Framework" value={discovery.detected_ssg} />
        )}
        {discovery.hint.api_endpoint && (
          <DiscoveryRow label="API endpoint" value={discovery.hint.api_endpoint} mono fullWidth />
        )}
        {discovery.hint.repo && (
          <DiscoveryRow
            label="GitHub repo"
            value={`${discovery.hint.repo}@${discovery.hint.branch ?? 'main'} → ${discovery.hint.content_dir ?? 'content/blog'}`}
            mono fullWidth
            note={discovery.hint.sniff_source ? `sniffed from ${discovery.hint.sniff_source}` : undefined}
          />
        )}
        {discovery.hint.wp_categories && discovery.hint.wp_categories.length > 0 && (
          <DiscoveryRow label="Categories found" value={`${discovery.hint.wp_categories.length} (${discovery.hint.wp_categories.slice(0, 5).join(', ')}${discovery.hint.wp_categories.length > 5 ? '…' : ''})`} fullWidth />
        )}
        {discovery.hint.wp_tags && discovery.hint.wp_tags.length > 0 && (
          <DiscoveryRow label="Tags found" value={`${discovery.hint.wp_tags.length} (${discovery.hint.wp_tags.slice(0, 5).join(', ')}${discovery.hint.wp_tags.length > 5 ? '…' : ''})`} fullWidth />
        )}
      </div>
    </div>
  )
}

function DiscoveryRow({ label, value, mono, fullWidth, note }: { label: string; value: string; mono?: boolean; fullWidth?: boolean; note?: string }) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className={`text-xs text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</div>
      {note && <div className="text-[10px] text-gray-500 italic">{note}</div>}
    </div>
  )
}
