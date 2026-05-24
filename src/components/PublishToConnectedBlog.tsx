// "Publish to a connected blog" — the operator-facing flow for the
// generalized publishing platform.
//
// Flow:
//   1. Load publishers connected for the active workspace
//   2. Operator picks one
//   3. Run dry_run → show preview (rendered HTML, final slug, warnings,
//      would-create taxonomies)
//   4. Operator confirms → publish()
//   5. Show outcome — success URL + verify status, or typed error + recovery

import { useState, useEffect } from 'react'
import { Loader2, ChevronDown, ExternalLink, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import type { Post } from '../lib/supabase'

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

interface Publisher {
  id: string
  kind: string
  name: string
  health_status: string | null
  config: Record<string, unknown>
}

export function PublishToConnectedBlog({ post }: { post: Post }) {
  const { activeOrg } = useOrg()
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    supabase.from('publishers').select('id, kind, name, health_status, config')
      .eq('org_id', activeOrg.id)
      .order('connected_at', { ascending: false })
      .then(({ data }) => {
        setPublishers((data ?? []) as Publisher[])
        setLoading(false)
      })
  }, [activeOrg])

  if (loading) return null
  if (publishers.length === 0) return null  // hide the whole thing when no publishers connected

  const selected = publishers.find(p => p.id === selectedId)

  return (
    <>
      <div className="relative mb-2">
        <button onClick={() => setOpen(o => !o)}
          className="w-full inline-flex items-center justify-between gap-1.5 py-2.5 px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-lg text-sm font-semibold">
          <span>🌐 Publish to a connected blog</span>
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {publishers.map(p => (
              <button key={p.id}
                onClick={() => { setSelectedId(p.id); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 text-left border-b border-gray-100 last:border-b-0">
                <div className="w-7 h-7 rounded-md bg-gray-100 text-gray-700 flex items-center justify-center text-[10px] font-bold uppercase">
                  {p.kind.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                  <div className="text-[11px] text-gray-500 capitalize">
                    {p.kind.replace('_', ' ')} · {p.health_status ?? 'never checked'}
                  </div>
                </div>
                <span className={`inline-block w-2 h-2 rounded-full ${
                  p.health_status === 'healthy' ? 'bg-emerald-500' :
                  p.health_status === 'stale'   ? 'bg-red-500' :
                  p.health_status === 'unknown' ? 'bg-amber-500' :
                  'bg-gray-300'
                }`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <PublishModal publisher={selected} post={post} onClose={() => setSelectedId(null)} />}
    </>
  )
}

// ─── Dry-run + confirm + publish modal ─────────────────────────────────────
function PublishModal({ publisher, post, onClose }: {
  publisher: Publisher; post: Post; onClose: () => void
}) {
  const [stage, setStage] = useState<'dry_run' | 'confirm' | 'publishing' | 'done' | 'failed'>('dry_run')
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState<{ message: string; recovery: string } | null>(null)

  useEffect(() => {
    void runDryRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publisher.id])

  async function runDryRun() {
    setStage('dry_run'); setError(null)
    const fn = connectorFn(publisher.kind)
    if (!fn) {
      setError({ message: `No connector for ${publisher.kind} yet.`, recovery: 'WordPress only in phase 1. Ghost/Webflow/etc. are next.' })
      setStage('failed'); return
    }
    try {
      const res = await fetch(FN_URL(fn), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({
          action: 'dry_run',
          publisher_id: publisher.id,
          post: toPostInput(post),
        }),
      })
      const data = await res.json() as DryRunResult & { error?: { message: string; recovery_action: string } }
      if (data.error || !data.ok) {
        setError({
          message: data.error?.message ?? 'Dry run failed.',
          recovery: data.error?.recovery_action ?? 'Try again.',
        })
        setStage('failed'); return
      }
      setDryRun(data)
      setStage('confirm')
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), recovery: 'Network — try again.' })
      setStage('failed')
    }
  }

  async function runPublish() {
    setStage('publishing'); setError(null)
    const fn = connectorFn(publisher.kind)
    if (!fn) return
    const idempotency_key = `${post.id}:${publisher.id}:${(post.updated_at ?? '').slice(0, 19)}`
    try {
      const res = await fetch(FN_URL(fn), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({
          action: 'publish',
          publisher_id: publisher.id,
          post: toPostInput(post),
          post_id: post.id,
          idempotency_key,
        }),
      })
      const data = await res.json() as PublishResult & { error?: { message: string; recovery_action: string } }
      if (!data.ok) {
        setError({
          message: data.error?.message ?? 'Publish failed.',
          recovery: data.error?.recovery_action ?? 'Check the audit log.',
        })
        setStage('failed')
        return
      }
      setResult(data)
      setStage('done')

      // Mark posted via approval-webhook (same hook the LinkedIn flow uses)
      if (data.remote_url) {
        fetch(FN_URL('approval-webhook'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
          body: JSON.stringify({ post_id: post.id, action: 'posted', posted_url: data.remote_url }),
        }).catch(() => {})
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), recovery: 'Network — try again.' })
      setStage('failed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">
            Publish to <span className="capitalize">{publisher.kind.replace('_', ' ')}</span> · {publisher.name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {stage === 'dry_run' && 'Generating preview…'}
            {stage === 'confirm' && 'Review the preview, then publish.'}
            {stage === 'publishing' && 'Publishing…'}
            {stage === 'done' && 'Published.'}
            {stage === 'failed' && 'Something didn\'t work.'}
          </p>
        </div>

        <div className="px-6 py-5">
          {stage === 'dry_run' && (
            <div className="py-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Rendering and checking slug…
            </div>
          )}

          {stage === 'confirm' && dryRun && (
            <div className="space-y-4">
              <Field label="Final slug" value={dryRun.preview.final_slug} mono />
              <Field label="Status target" value={post.status === 'Approved' ? 'published' : 'draft'} />
              {dryRun.preview.target_categories.length > 0 &&
                <Field label="Categories" value={dryRun.preview.target_categories.join(' · ')} />}
              {dryRun.preview.target_tags.length > 0 &&
                <Field label="Tags" value={dryRun.preview.target_tags.join(' · ')} />}
              {dryRun.preview.image_will_upload &&
                <Field label="Featured image" value="will upload from media_url" />}

              {dryRun.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold mb-1">Warnings</p>
                  {dryRun.warnings.map((w, i) => <p key={i} className="text-xs text-amber-900">• {w}</p>)}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Rendered HTML preview</p>
                <div className="text-xs text-gray-700 border border-gray-100 rounded-md p-3 max-h-64 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: dryRun.preview.rendered_html.slice(0, 5_000) }} />
              </div>
            </div>
          )}

          {stage === 'publishing' && (
            <div className="py-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Uploading image · creating post · verifying…
            </div>
          )}

          {stage === 'done' && result && (
            <div className="py-4 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-3">
                <Check size={20} />
              </div>
              <p className="text-sm font-medium text-gray-900 mb-1">Published to {publisher.name}</p>
              {result.remote_url && (
                <a href={result.remote_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
                  View live post <ExternalLink size={11} />
                </a>
              )}
              {result.verified === false && (
                <p className="text-xs text-amber-700 mt-2">⚠ Post created but verify didn\'t confirm published status — check on the site.</p>
              )}
            </div>
          )}

          {stage === 'failed' && error && (
            <div className="py-4">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-3">
                <X size={20} />
              </div>
              <p className="text-sm font-medium text-gray-900 text-center mb-1">{error.message}</p>
              <p className="text-xs text-gray-600 text-center mb-3">{error.recovery}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'confirm' && (
            <button onClick={runPublish}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800">
              Publish now →
            </button>
          )}
          {stage === 'failed' && (
            <button onClick={runDryRun}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">{label}</p>
      <p className={`text-xs text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

interface DryRunResult {
  ok: boolean
  preview: {
    rendered_html: string
    final_slug: string
    target_categories: string[]
    target_tags: string[]
    image_will_upload: boolean
  }
  warnings: string[]
}

interface PublishResult {
  ok: boolean
  remote_id?: string
  remote_url?: string
  verified?: boolean
  attempt_id?: string
}

function connectorFn(kind: string): string | null {
  return ({
    wordpress: 'wordpress-publish',
    ghost: 'ghost-publish',
    github_mdx: 'git-publish',
    webflow: 'webflow-publish',
    contentful: 'contentful-publish',
    sanity: 'sanity-publish',
    hubspot: 'hubspot-publish',
    strapi: 'strapi-publish',
  } as Record<string, string>)[kind] ?? null
}

function toPostInput(post: Post): Record<string, unknown> {
  // Parse "## Title\n\n…" or use post.title.
  const md = post.copy ?? ''
  const titleMatch = md.match(/^#\s+(.+)$/m)
  const title = post.title || titleMatch?.[1] || '(untitled)'
  // If the markdown leads with a title heading, strip it from the body
  const body_md = titleMatch ? md.replace(titleMatch[0], '').trim() : md.trim()

  return {
    title,
    body_md,
    excerpt: undefined,
    slug: undefined,  // let the connector derive + collision-check
    tags: post.hashtags?.map(h => h.replace(/^#/, '')) ?? [],
    categories: [],   // populate from post metadata once we add a categories field
    featured_image_url: post.media_url ?? undefined,
    status: post.status === 'Approved' ? 'published' : 'draft',
  }
}
