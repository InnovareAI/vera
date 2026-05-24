// Connected blogs / CMS / Git publishers — Settings → Integrations.
//
// Phase 0: list publishers, run detect-cms wizard to scaffold a new
// connection, but the per-platform connect steps are stubbed pending
// phase 1 (WordPress first, then Ghost / Webflow / git-publish).

import { useState, useEffect } from 'react'
import { Loader2, Plus, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'

const DETECT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/detect-cms`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

interface Publisher {
  id: string
  kind: string
  name: string
  config: Record<string, unknown>
  health_status: string | null
  health_detail: string | null
  last_health_check: string | null
  connected_at: string
}

export function PublishersCard() {
  const { activeOrg } = useOrg()
  const [list, setList] = useState<Publisher[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('publishers').select('*').eq('org_id', activeOrg.id).order('connected_at', { ascending: false })
      .then(({ data }) => {
        setList((data ?? []) as Publisher[])
        setLoading(false)
      })
  }, [activeOrg])

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Connected blogs & CMSes</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Publishing targets for client blogs. Auto-detects WordPress / Ghost / Webflow / Vercel-Netlify static sites.
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

// ─── Add-a-blog wizard ──────────────────────────────────────────────────────
function AddBlogWizard({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useOrg()
  const [step, setStep] = useState<'url' | 'detecting' | 'detected' | 'connect'>('url')
  const [url, setUrl] = useState('')
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runDetect() {
    if (!url.trim()) return
    setStep('detecting')
    setError(null)
    try {
      const res = await fetch(DETECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json() as DetectionResult & { error?: string }
      if (data.error) throw new Error(data.error)
      setDetection(data)
      setStep('detected')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('url')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Add a blog</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {step === 'url' && 'Paste the URL — we\'ll figure out the platform.'}
            {step === 'detecting' && 'Looking at the site…'}
            {step === 'detected' && 'Here\'s what we found.'}
            {step === 'connect' && 'Connecting…'}
          </p>
        </div>

        <div className="px-6 py-5">
          {step === 'url' && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Blog URL</label>
              <input
                autoFocus value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runDetect()}
                placeholder="https://acme.com/blog"
                className="input w-full"
              />
              <p className="text-[11px] text-gray-400 mt-1.5">Just the blog homepage — we'll inspect it from there.</p>
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          )}

          {step === 'detecting' && (
            <div className="py-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Inspecting {url}…
            </div>
          )}

          {step === 'detected' && detection && (
            <DetectionResult detection={detection} url={url} onContinue={() => setStep('connect')} />
          )}

          {step === 'connect' && detection && (() => {
            const onConnected = () => { onClose(); window.location.reload() }
            if (detection.detected_cms === 'wordpress') {
              return <WordPressConnectForm detection={detection} url={url} orgId={activeOrg?.id ?? ''} onConnected={onConnected} />
            }
            if (detection.detected_cms === 'ghost') {
              return <GhostConnectForm url={url} orgId={activeOrg?.id ?? ''} onConnected={onConnected} />
            }
            if (detection.recommended_path === 'git_backed') {
              return <GitPublishConnectForm url={url} orgId={activeOrg?.id ?? ''} onConnected={onConnected} />
            }
            return <ComingSoonForm detection={detection} />
          })()}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
            {step === 'detected' ? 'Cancel' : 'Close'}
          </button>
          {step === 'url' && (
            <button onClick={runDetect} disabled={!url.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
              Detect →
            </button>
          )}
          {step === 'detected' && detection && detection.recommended_path !== 'manual_paste' && (
            <button onClick={() => setStep('connect')}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800">
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface DetectionResult {
  url: string
  detected_cms: string
  cms_confidence: number
  cms_signals: string[]
  detected_hosting: string
  hosting_confidence: number
  detected_ssg: string
  ssg_confidence: number
  recommended_path: 'cms_direct' | 'headless_cms' | 'git_backed' | 'manual_paste'
  recommendation_reason: string
}

function DetectionResult({ detection, url, onContinue: _onContinue }: { detection: DetectionResult; url: string; onContinue: () => void }) {
  const pathBadge = {
    cms_direct:   { bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'Direct CMS publish' },
    headless_cms: { bg: 'bg-blue-50',     text: 'text-blue-700',    label: 'Headless CMS' },
    git_backed:   { bg: 'bg-violet-50',   text: 'text-violet-700',  label: 'Git-backed static' },
    manual_paste: { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Manual paste' },
  }[detection.recommended_path]

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">Inspected: <code className="text-gray-700">{url}</code></div>

      <div className={`p-3 rounded-lg ${pathBadge.bg}`}>
        <div className={`text-[10px] uppercase tracking-wider font-semibold ${pathBadge.text} mb-1`}>
          {pathBadge.label}
        </div>
        <p className="text-sm text-gray-800">{detection.recommendation_reason}</p>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-xs">
        <StackLayer label="CMS"     value={detection.detected_cms}     confidence={detection.cms_confidence} />
        <StackLayer label="Hosting" value={detection.detected_hosting} confidence={detection.hosting_confidence} />
        <StackLayer label="Framework" value={detection.detected_ssg}   confidence={detection.ssg_confidence} />
      </dl>

      {detection.cms_signals.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Detected signals</p>
          <ul className="text-[11px] text-gray-600 space-y-0.5">
            {detection.cms_signals.slice(0, 5).map((s, i) => <li key={i}>• {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── WordPress connect form (phase 1) ──────────────────────────────────────
function WordPressConnectForm({ detection: _detection, url, orgId, onConnected }: {
  detection: DetectionResult; url: string; orgId: string; onConnected: () => void
}) {
  // Pre-fill defaults from the detected URL
  const detectedBase = (() => { try { return new URL(url).origin } catch { return url } })()
  const [name, setName] = useState('Main blog')
  const [baseUrl, setBaseUrl] = useState(detectedBase)
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<{ message: string; recovery: string } | null>(null)

  async function submit() {
    if (!orgId) { setErr({ message: 'No workspace selected.', recovery: 'Pick a workspace and try again.' }); return }
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wordpress-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({
          action: 'connect',
          org_id: orgId, name, base_url: baseUrl, username, app_password: appPassword,
        }),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string; recovery_action: string }; publisher_id?: string }
      if (!data.ok || !data.publisher_id) {
        setErr({
          message: data.error?.message ?? 'Connection failed.',
          recovery: data.error?.recovery_action ?? 'Check the URL and credentials and try again.',
        })
        return
      }
      onConnected()
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : String(e), recovery: 'Try again, or check network.' })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!(name.trim() && baseUrl.trim() && username.trim() && appPassword.trim()) && !submitting

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800">
        Connecting to <span className="font-medium">{detectedBase}</span>. You'll need an
        Application Password from WP Admin → Users → Your Profile.
      </p>

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Connection name</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input w-full" placeholder="Main blog" />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">WordPress URL</label>
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="input w-full"
          placeholder="https://blog.example.com" />
        <p className="text-[11px] text-gray-400 mt-1">Site root, not a sub-path. We'll talk to /wp-json/wp/v2/.</p>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Username</label>
        <input value={username} onChange={e => setUsername(e.target.value)} className="input w-full"
          placeholder="your-wp-username" autoComplete="off" />
        <p className="text-[11px] text-gray-400 mt-1">The WP username (not email).</p>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Application Password</label>
        <input type="password" value={appPassword} onChange={e => setAppPassword(e.target.value)}
          className="input w-full" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autoComplete="off" />
        <p className="text-[11px] text-gray-400 mt-1">
          Generate in <code>WP Admin → Users → Profile → Application Passwords</code>. Spaces in the
          password are fine — copy it exactly.
        </p>
      </div>

      {err && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs font-medium text-red-700">{err.message}</p>
          <p className="text-[11px] text-red-600 mt-1">{err.recovery}</p>
        </div>
      )}

      <button onClick={submit} disabled={!canSubmit}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
        {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect WordPress'}
      </button>
    </div>
  )
}

// ─── Ghost connect form ────────────────────────────────────────────────────
function GhostConnectForm({ url, orgId, onConnected }: { url: string; orgId: string; onConnected: () => void }) {
  const detectedBase = (() => { try { return new URL(url).origin } catch { return url } })()
  const [name, setName] = useState('Main blog')
  const [baseUrl, setBaseUrl] = useState(detectedBase)
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<{ message: string; recovery: string } | null>(null)

  async function submit() {
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ghost-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({ action: 'connect', org_id: orgId, name, base_url: baseUrl, api_key: apiKey }),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string; recovery_action: string } }
      if (!data.ok) {
        setErr({ message: data.error?.message ?? 'Connection failed.',
                 recovery: data.error?.recovery_action ?? 'Try again.' })
        return
      }
      onConnected()
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : String(e), recovery: 'Network — try again.' })
    } finally { setSubmitting(false) }
  }

  const canSubmit = !!(name.trim() && baseUrl.trim() && apiKey.trim()) && !submitting

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800">
        Connecting to <span className="font-medium">{detectedBase}</span>. You'll need a Custom Integration's
        Admin API Key (Ghost Admin → Integrations → Add custom integration).
      </p>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Connection name</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input w-full" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Ghost site URL</label>
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="input w-full" />
        <p className="text-[11px] text-gray-400 mt-1">Site root, e.g. https://blog.example.com.</p>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Admin API Key</label>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
          className="input w-full" placeholder="<24-char id>:<64-char secret>" autoComplete="off" />
        <p className="text-[11px] text-gray-400 mt-1">
          Format is <code>id:secret</code>. Copy from Ghost Admin → Integrations → your custom integration → Admin API Key.
        </p>
      </div>
      {err && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs font-medium text-red-700">{err.message}</p>
          <p className="text-[11px] text-red-600 mt-1">{err.recovery}</p>
        </div>
      )}
      <button onClick={submit} disabled={!canSubmit}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
        {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect Ghost'}
      </button>
    </div>
  )
}

// ─── Git-publish connect form ──────────────────────────────────────────────
function GitPublishConnectForm({ url, orgId, onConnected }: { url: string; orgId: string; onConnected: () => void }) {
  const [name, setName] = useState('Main blog')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [contentDir, setContentDir] = useState('content/blog')
  const [fileFormat, setFileFormat] = useState<'mdx' | 'md'>('mdx')
  const [pat, setPat] = useState('')
  const [prMode, setPrMode] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<{ message: string; recovery: string } | null>(null)

  async function submit() {
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/git-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({
          action: 'connect',
          org_id: orgId, name, repo, branch, content_dir: contentDir, file_format: fileFormat,
          pr_mode: prMode, webhook_url: webhookUrl.trim() || null, github_pat: pat,
        }),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string; recovery_action: string } }
      if (!data.ok) {
        setErr({ message: data.error?.message ?? 'Connection failed.',
                 recovery: data.error?.recovery_action ?? 'Try again.' })
        return
      }
      onConnected()
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : String(e), recovery: 'Network — try again.' })
    } finally { setSubmitting(false) }
  }

  const canSubmit = !!(name && repo && branch && contentDir && pat) && /^[\w.-]+\/[\w.-]+$/.test(repo) && !submitting

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800">
        Detected a static site at <span className="font-medium">{(() => { try { return new URL(url).origin } catch { return url } })()}</span>.
        We'll publish by committing Markdown files to your GitHub repo — the site rebuilds automatically on push.
      </p>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Connection name</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Repo (owner/name)</label>
          <input value={repo} onChange={e => setRepo(e.target.value)} className="input w-full" placeholder="innovareai/blog" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Branch</label>
          <input value={branch} onChange={e => setBranch(e.target.value)} className="input w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Content folder</label>
          <input value={contentDir} onChange={e => setContentDir(e.target.value)} className="input w-full" placeholder="content/blog" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">File format</label>
          <select value={fileFormat} onChange={e => setFileFormat(e.target.value as 'mdx' | 'md')} className="input w-full">
            <option value="mdx">mdx</option>
            <option value="md">md</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">GitHub Personal Access Token</label>
        <input type="password" value={pat} onChange={e => setPat(e.target.value)} className="input w-full"
          placeholder="github_pat_..." autoComplete="off" />
        <p className="text-[11px] text-gray-400 mt-1">
          Fine-grained PAT with <strong>Contents: Read+Write</strong> on this repo. Generate at GitHub → Settings → Developer settings → Personal access tokens.
        </p>
      </div>
      <div>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={prMode} onChange={e => setPrMode(e.target.checked)} />
          <span>Open a Pull Request instead of pushing directly</span>
        </label>
        <p className="text-[11px] text-gray-400 mt-0.5 ml-5">
          Recommended for teams with deploy gates or PR-required branches.
        </p>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Build hook URL (optional)</label>
        <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} className="input w-full"
          placeholder="https://api.vercel.com/v1/integrations/deploy/..." />
        <p className="text-[11px] text-gray-400 mt-1">
          Only needed if your site doesn't auto-rebuild on push (monorepos, deploy filters). We POST after the commit.
        </p>
      </div>
      {err && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs font-medium text-red-700">{err.message}</p>
          <p className="text-[11px] text-red-600 mt-1">{err.recovery}</p>
        </div>
      )}
      <button onClick={submit} disabled={!canSubmit}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
        {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect GitHub'}
      </button>
    </div>
  )
}

function ComingSoonForm({ detection }: { detection: DetectionResult }) {
  return (
    <div className="py-8 text-center">
      <Globe className="w-8 h-8 mx-auto text-gray-300 mb-3" />
      <p className="text-sm text-gray-700">
        Connector for <strong className="capitalize">{detection.detected_cms === 'unknown' ? detection.recommended_path.replace('_', ' ') : detection.detected_cms}</strong> ships next.
      </p>
      <p className="text-xs text-gray-500 mt-2 max-w-sm mx-auto">
        WordPress is the first concrete connector. Ghost, Webflow, headless CMSes, and the universal git-publish follow.
      </p>
    </div>
  )
}

function StackLayer({ label, value, confidence }: { label: string; value: string; confidence: number }) {
  const known = value !== 'unknown' && confidence >= 0.4
  return (
    <div className="p-2.5 rounded-md border border-gray-100">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
      <div className={`text-sm font-medium mt-0.5 capitalize ${known ? 'text-gray-900' : 'text-gray-400'}`}>
        {value.replace('_', ' ')}
      </div>
      {known && (
        <div className="text-[10px] text-gray-500 mt-0.5">{Math.round(confidence * 100)}% confidence</div>
      )}
    </div>
  )
}
