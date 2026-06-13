import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Copy, Check, ExternalLink, ArrowLeft, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { parseProjectInstructions } from '../lib/businessContext'
import { approvalRouteForPost } from '../lib/approvalRouting'
import { PublishToConnectedBlog } from '../components/PublishToConnectedBlog'
import { PlatformPostPreview } from '../components/PlatformPostPreview'
import { ApprovalRouteSection } from '../components/ApprovalRoute'
import { useProject } from '../lib/projectContext'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Centralised call into the approval-webhook edge function (the single hub
// for status changes + n8n forwarding + Slack notifications).
async function callApprovalWebhook(payload: Record<string, unknown>): Promise<{ post?: Post; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(APPROVAL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` }
    return { post: data.post as Post }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

type PostLifecycle = 'Draft' | 'Pending Review' | 'Changes Requested' | 'Approved' | 'Scheduled' | 'Posted' | 'Rejected'

function normalizedStatus(status?: string | null) {
  return (status ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

function postLifecycle(post: Post): PostLifecycle {
  const status = normalizedStatus(post.status)
  if (post.posted_at || post.published_at || status === 'posted' || status === 'published') return 'Posted'
  if (status === 'rejected') return 'Rejected'
  if (status === 'scheduled' || ((post.scheduled_at || post.publish_date) && status === 'approved')) return 'Scheduled'
  if (status === 'approved') return 'Approved'
  if (status === 'changes_requested') return 'Changes Requested'
  if (status === 'draft') return 'Draft'
  return 'Pending Review'
}

// Per-channel composer URL + label for the HITL "Open <platform>" button.
// Where the platform supports query-param pre-fill (Twitter), we encode the
// first 240 chars of the post copy. Most platforms don't, so the user copies
// via the "Copy text + hashtags" button and pastes on the new tab.
function composerForChannel(channel: string | null | undefined, copy?: string): { url: string; label: string } {
  const c = (channel ?? '').toLowerCase()
  switch (c) {
    case 'linkedin':  return { url: 'https://www.linkedin.com/feed/?shareActive=true',                       label: 'LinkedIn' }
    case 'twitter':
    case 'x':         return { url: `https://twitter.com/intent/tweet?text=${encodeURIComponent((copy ?? '').slice(0, 240))}`, label: 'X / Twitter' }
    case 'medium':    return { url: 'https://medium.com/new-story',                                          label: 'Medium' }
    case 'substack':  return { url: 'https://substack.com/home',                                             label: 'Substack' }
    case 'reddit':    return { url: 'https://www.reddit.com/submit',                                         label: 'Reddit' }
    case 'quora':     return { url: 'https://www.quora.com/',                                                label: 'Quora' }
    case 'instagram': return { url: 'https://www.instagram.com/',                                            label: 'Instagram (mobile)' }
    case 'email':     return { url: `mailto:?body=${encodeURIComponent((copy ?? '').slice(0, 1000))}`,       label: 'Email' }
    default:          return { url: 'https://www.linkedin.com/feed/?shareActive=true',                       label: 'LinkedIn' }
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

type ActionState = 'idle' | 'saving' | 'done'

export default function ReviewDetail() {
  const { id } = useParams<{ id: string }>()
  const { activeProject } = useProject()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionState>('idle')
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [postedUrl, setPostedUrl] = useState('')
  const [marking, setMarking] = useState(false)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineStatus, setRefineStatus] = useState('')
  const [linkedInPublishReady, setLinkedInPublishReady] = useState(false)
  const [linkedInPublishDetail, setLinkedInPublishDetail] = useState('Connect LinkedIn publishing in client integrations first.')
  const reviewQueuePath = activeProject?.slug ? `/p/${activeProject.slug}/review` : '/review'
  const businessContext = useMemo(
    () => parseProjectInstructions(activeProject?.instructions).businessContext,
    [activeProject?.instructions],
  )

  useEffect(() => {
    if (!id) {
      setError('No post ID provided')
      setLoading(false)
      return
    }
    supabase.from('content_posts').select('*').eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (!data) setError('Post not found')
        else setPost(data as Post)
        setLoading(false)
      })
  }, [id])

  const linkedInCheckPostId = post?.id ?? null
  const linkedInCheckChannel = post?.channel ?? null
  const linkedInCheckProjectId = post?.project_id ?? null

  useEffect(() => {
    let cancelled = false
    async function checkLinkedInPublishReady() {
      const isLinkedIn = linkedInCheckChannel?.toLowerCase() === 'linkedin'
      if (!linkedInCheckPostId || !isLinkedIn) {
        setLinkedInPublishReady(false)
        setLinkedInPublishDetail('Connect LinkedIn publishing in client integrations first.')
        return
      }
      if (!linkedInCheckProjectId) {
        setLinkedInPublishReady(true)
        setLinkedInPublishDetail('Legacy workspace LinkedIn publishing route.')
        return
      }

      const { data, error } = await supabase
        .from('client_integrations')
        .select('id, status, health_status, external_ref, config')
        .eq('project_id', linkedInCheckProjectId)
        .eq('provider', 'linkedin')
        .eq('status', 'connected')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        setLinkedInPublishReady(false)
        setLinkedInPublishDetail(error.message)
        return
      }

      const row = data as { health_status?: string | null; external_ref?: Record<string, unknown> | null; config?: Record<string, unknown> | null } | null
      const accountId = firstString(row?.external_ref?.unipile_account_id, row?.config?.unipile_account_id, row?.external_ref?.account_id)
      const health = row?.health_status ?? 'unknown'
      const healthyEnough = health !== 'stale' && health !== 'error'
      setLinkedInPublishReady(!!accountId && healthyEnough)
      setLinkedInPublishDetail(
        !row
          ? 'Connect LinkedIn publishing in client integrations first.'
          : !accountId
            ? 'LinkedIn publishing is connected, but the Unipile account ID is missing.'
            : !healthyEnough
              ? `LinkedIn publishing is ${health}. Reconnect it before publishing.`
              : 'LinkedIn publishing is connected for this client space.',
      )
    }

    void checkLinkedInPublishReady()
    return () => { cancelled = true }
  }, [linkedInCheckChannel, linkedInCheckPostId, linkedInCheckProjectId])

  // Refine with VERA — the reviewer's feedback goes straight to VERA, who
  // edits the copy / image / video on THIS post in place (refine_post tool).
  async function refineWithVera() {
    if (!post || !refineText.trim() || refining) return
    setRefining(true); setError(null); setRefineStatus('VERA is revising…')
    const SUPA = import.meta.env.VITE_SUPABASE_URL as string
    const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const p = post as unknown as { org_id: string; project_id: string | null }
    const hasVideo = post.media_type === 'video'
    const msg =
      `Refine this existing post using the refine_post tool with post_id "${post.id}". ` +
      `Apply ONLY what the feedback asks — rewrite the copy, regenerate the image, or regenerate the video.\n\n` +
      `Channel: ${post.channel}\nCurrent copy:\n${post.copy ?? ''}\n\n` +
      `The post ${post.media_url ? `has ${hasVideo ? 'a video' : 'an image'}` : 'has no media'}.\n\n` +
      `Operator feedback: "${refineText.trim()}"`
    try {
      const { data: authData, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = authData.session?.access_token
      if (!token) throw new Error('Sign in again before refining this post.')

      const res = await fetch(`${SUPA}/functions/v1/vera-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': ANON },
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }],
          org_id: p.org_id,
          project_id: p.project_id ?? null,
          user_id: null,
          route: window.location.pathname,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`Refine failed (HTTP ${res.status})`)
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); let i
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const fr = buf.slice(0, i); buf = buf.slice(i + 2)
          const ln = fr.split('\n').find(l => l.startsWith('data: ')); if (!ln) continue
          try { const ev = JSON.parse(ln.slice(6)); if (ev.type === 'tool_progress' && ev.status) setRefineStatus(String(ev.status)) } catch { /* skip */ }
        }
      }
      const { data } = await supabase.from('content_posts').select('*').eq('id', post.id).maybeSingle()
      if (data) setPost(data as Post)
      setRefineText(''); setRefineStatus('Updated ✓')
      setTimeout(() => setRefineStatus(''), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setRefineStatus('')
    } finally {
      setRefining(false)
    }
  }

  async function updateStatus(newStatus: string, fb?: string) {
    if (!post) return
    setAction('saving')
    // Map UI status labels → approval-webhook action values
    const actionMap: Record<string, string> = {
      'Approved': 'approved',
      'approved': 'approved',
      'Rejected': 'rejected',
      'rejected': 'rejected',
      'changes_requested': 'changes_requested',
    }
    const apiAction = actionMap[newStatus]
    if (!apiAction) {
      // Statuses not handled by the webhook (Scheduled, Published) — fall back to direct write
      const updates: Record<string, unknown> = { status: newStatus, reviewed_at: new Date().toISOString() }
      if (fb !== undefined) updates.feedback = fb
      const { error } = await supabase.from('content_posts').update(updates).eq('id', post.id)
      if (error) { alert(`Error: ${error.message}`); setAction('idle'); return }
      setPost({ ...post, ...updates } as Post)
      setAction('done')
      return
    }
    const { post: updated, error } = await callApprovalWebhook({
      post_id: post.id, action: apiAction, ...(fb !== undefined ? { feedback: fb } : {}),
    })
    if (error || !updated) {
      alert(`Error: ${error ?? 'no post returned'}`)
      setAction('idle')
      return
    }
    setPost(updated)
    setAction('done')
  }

  async function markAsPosted() {
    if (!post) return
    const url = postedUrl.trim()
    if (!url) return
    setMarking(true)
    const { post: updated, error } = await callApprovalWebhook({
      post_id: post.id, action: 'posted', posted_url: url,
    })
    if (error || !updated) {
      alert(`Error: ${error ?? 'no post returned'}`)
      setMarking(false)
      return
    }
    setPost(updated)
    setMarking(false)
  }

  // Post directly to LinkedIn via Unipile. Available for LinkedIn only when
  // this client space has its own connected publishing integration. Shared
  // research profiles are intentionally excluded here.
  async function postToLinkedIn() {
    if (!post) return
    if (!linkedInPublishReady) {
      alert(linkedInPublishDetail)
      return
    }
    if (!confirm(`Publish this post to LinkedIn via Unipile? This action is immediate and irreversible.`)) return
    await callPublishFunction('unipile-post', 'Unipile post')
  }

  // Publish a blog post by committing an MDX file to InnovareAI-Website on
  // GitHub. Netlify auto-deploys on push (~2 min). Chains back to approval-
  // webhook with the live URL once the commit lands.
  async function publishToBlog() {
    if (!post) return
    if (!confirm(`Commit this post to the blog repo? Netlify will rebuild the site automatically (~2 min). The slug will be derived from the title and cannot easily be changed once posted.`)) return
    await callPublishFunction('blog-publish', 'Blog publish')
  }

  // Send the email post to a recipient list via Postmark. Recipients are a
  // comma- or newline-separated list pasted into the input above the button.
  async function sendEmail() {
    if (!post) return
    const recipients = emailRecipients
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
    if (!recipients.length) {
      alert('Add at least one recipient email address.')
      return
    }
    const preview = recipients.length <= 3 ? recipients.join(', ') : `${recipients.slice(0, 3).join(', ')} +${recipients.length - 3} more`
    if (!confirm(`Send via Postmark to ${recipients.length} recipient(s)?\n\n${preview}\n\nThis action is immediate and irreversible.`)) return
    setMarking(true)
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const token = session?.access_token
      if (!token) throw new Error('Sign in again before sending this email post.')

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ post_id: post.id, recipients }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(`Postmark send failed: ${data.error ?? `HTTP ${res.status}`}`)
        setMarking(false)
        return
      }
      const summary = `Sent: ${data.sent_count} · Failed: ${data.failed_count}`
      if (data.failed_count) {
        alert(`Partial success: ${summary}\n\nFirst failure: ${data.failures?.[0]?.error ?? 'unknown'}`)
      }
      const { data: refetched } = await supabase.from('content_posts').select('*').eq('id', post.id).maybeSingle()
      if (refetched) setPost(refetched as Post)
    } catch (e) {
      alert(`Network error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setMarking(false)
  }

  async function callPublishFunction(fn: string, label: string) {
    if (!post) return
    setMarking(true)
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const token = session?.access_token
      if (!token) throw new Error('Sign in again before publishing this post.')

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ post_id: post.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(`${label} failed: ${data.error ?? `HTTP ${res.status}`}`)
        setMarking(false)
        return
      }
      // The publish functions auto-mark the row posted via approval-webhook;
      // refetch to pick up the new posted_at / posted_url.
      const { data: refetched } = await supabase.from('content_posts').select('*').eq('id', post.id).maybeSingle()
      if (refetched) setPost(refetched as Post)
    } catch (e) {
      alert(`Network error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setMarking(false)
  }

  async function copyBundle() {
    if (!post) return
    const parts = [
      post.copy ?? '',
      post.hashtags?.length ? '\n' + post.hashtags.join(' ') : '',
    ]
    await navigator.clipboard.writeText(parts.filter(Boolean).join(''))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Public, no-login review link. Every post gets a review_token by default;
  // mint one if a legacy post is missing it. The /r/<token> page is served by
  // the service-role review-link function, so anyone with the link can open it
  // (and approve / leave feedback) without an account.
  async function copyShareLink() {
    if (!post) return
    let token = post.review_token ?? null
    if (!token) {
      const bytes = crypto.getRandomValues(new Uint8Array(24))
      token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      const { data, error: tokenErr } = await supabase
        .from('content_posts')
        .update({ review_token: token, review_token_revoked_at: null })
        .eq('id', post.id)
        .select('review_token')
        .single()
      if (tokenErr) { setError('Could not create a share link.'); return }
      token = (data as { review_token?: string | null } | null)?.review_token ?? token
      setPost({ ...post, review_token: token } as Post)
    }
    await navigator.clipboard.writeText(`${window.location.origin}/r/${token}`)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading post…</div>
  }
  if (error || !post) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Link to={reviewQueuePath} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to queue
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6 text-sm">{error || 'Post not found'}</div>
      </div>
    )
  }

  const lifecycle = postLifecycle(post)
  const isDraft = lifecycle === 'Draft'
  const isPending = lifecycle === 'Pending Review'
  const isChangesRequested = lifecycle === 'Changes Requested'
  const isApproved = lifecycle === 'Approved'
  const isScheduled = lifecycle === 'Scheduled'
  const isRejected = lifecycle === 'Rejected'
  const isPosted = lifecycle === 'Posted'
  const composerInfo = composerForChannel(post.channel, post.copy)
  const composerUrl = composerInfo.url
  const compliance = Array.isArray(post.compliance_checks) ? (post.compliance_checks as Array<{ pass?: boolean; label?: string }>) : []
  const approvalRoute = approvalRouteForPost(post, businessContext)
  const statusBadge = isPosted
    ? { text: 'Posted', cls: 'bg-violet-50 text-gray-900 border-violet-200' }
    : isScheduled
    ? { text: 'Scheduled', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
    : isApproved
    ? { text: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : isRejected
    ? { text: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' }
    : isChangesRequested
    ? { text: 'Changes requested', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
    : isDraft
    ? { text: 'Draft', cls: 'bg-gray-50 text-gray-700 border-gray-200' }
    : { text: 'Pending review', cls: 'bg-amber-50 text-amber-700 border-amber-200' }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <Link to={reviewQueuePath} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to queue
      </Link>

      {/* Meta bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-900">Review</h1>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>{statusBadge.text}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={copyShareLink}
            title="Copy a public link anyone can open without logging in, to review and leave feedback"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
            {shareCopied ? <><Check className="w-3.5 h-3.5" /> Link copied</> : <><ExternalLink className="w-3.5 h-3.5" /> Copy public link</>}
          </button>
          <div className="text-xs text-gray-500">
            {post.channel} · {post.format} · Content Generator
          </div>
        </div>
      </div>

      <PlatformPostPreview post={post} density="standard" autoplayMedia={false} />

      <div className="bg-white rounded-xl border border-gray-200 px-4 mt-4">
        <ApprovalRouteSection route={approvalRoute} />
      </div>

      {/* Refine with VERA — feedback → in-place revision of copy/image/video */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <p className="text-xs font-semibold text-gray-900">Refine with VERA</p>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">Tell VERA what to improve — she edits the copy, image, or video on this post in place.</p>
        <textarea
          value={refineText}
          onChange={e => setRefineText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) refineWithVera() }}
          placeholder="e.g. punch up the hook · make the image warmer, less corporate · tighten to 3 lines"
          rows={2}
          disabled={refining}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)] bg-gray-50 disabled:opacity-60"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-gray-400">{refineStatus}</span>
          <button
            onClick={refineWithVera}
            disabled={refining || !refineText.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {refining ? 'Revising…' : 'Refine'}
          </button>
        </div>
      </div>

      {/* Compliance checklist */}
      {compliance.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
          <p className="text-xs font-semibold text-gray-900 mb-3">Compliance &amp; brand checks</p>
          <div className="space-y-1.5">
            {compliance.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`font-semibold ${c.pass ? 'text-emerald-600' : 'text-red-600'}`}>{c.pass ? 'PASS' : 'FAIL'}</span>
                <span className="text-gray-700">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
        {isDraft && (
          <>
            <p className="text-sm font-semibold text-gray-900 mb-1">Draft</p>
            <p className="text-xs text-gray-500 mb-3">Move this into review when it is ready for a human decision.</p>
            <button onClick={() => updateStatus('pending')} disabled={action === 'saving'}
              className="w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
              {action === 'saving' ? 'Saving...' : 'Send to review'}
            </button>
          </>
        )}

        {(isPending || isChangesRequested) && (
          <>
            <p className="text-sm font-semibold text-gray-900 mb-1">
              {isChangesRequested ? 'Changes requested' : 'Ready to approve?'}
            </p>
            {isChangesRequested && post.feedback && (
              <div className="mb-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-700">
                <p className="font-medium text-gray-900 mb-1">Notes:</p>
                {post.feedback}
              </div>
            )}
            <div className="flex gap-2 mb-2">
              <button onClick={() => updateStatus('approved')} disabled={action === 'saving'}
                className="flex-1 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {action === 'saving' ? 'Saving...' : 'Approve'}
              </button>
              <button onClick={() => updateStatus('rejected')} disabled={action === 'saving'}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-red-50 disabled:opacity-50 text-red-700 border-2 border-red-300 rounded-lg text-sm font-semibold">
                Reject
              </button>
            </div>
            {isChangesRequested && (
              <button onClick={() => updateStatus('pending')} disabled={action === 'saving'}
                className="w-full py-2 text-sm font-medium text-gray-600 hover:bg-[var(--fog)] border border-gray-200 rounded-lg mb-2">
                Return to review
              </button>
            )}
            <button onClick={() => setShowFeedback(s => !s)}
              className="w-full py-2 text-sm font-medium text-gray-600 hover:bg-[var(--fog)] border border-gray-200 rounded-lg">
              Request changes
            </button>
            {showFeedback && (
              <div className="mt-3 space-y-2">
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What needs to change?"
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-gray-400 min-h-[80px]" />
                <button onClick={() => updateStatus('changes_requested', feedback)} disabled={action === 'saving' || !feedback.trim()}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  Send feedback
                </button>
              </div>
            )}
          </>
        )}

        {(isApproved || isScheduled) && !isPosted && (
          <>
            <p className="text-sm font-semibold text-emerald-700 mb-1">
              {isScheduled ? 'Scheduled' : 'Approved, ready to post'}
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {isScheduled && (post.scheduled_at || post.publish_date)
                ? `Planned for ${new Date((post.scheduled_at || post.publish_date)!).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. `
                : ''}
              {post.channel?.toLowerCase() === 'linkedin'
                ? 'Auto-publish via Unipile, or copy + open the composer to post manually.'
                : post.channel?.toLowerCase() === 'blog'
                  ? 'Auto-commit to the blog repo (Netlify deploys on push), or copy + post manually.'
                  : post.channel?.toLowerCase() === 'email'
                    ? 'Send via Postmark to a recipient list, or copy + paste into your own email tool.'
                    : 'Copy the bundle, open the composer, paste, and publish.'}
            </p>
            {(approvalRoute.publishGuard || approvalRoute.samTrigger) && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-amber-800 mb-1">Channel policy before publishing</p>
                {approvalRoute.publishGuard && (
                  <p className="text-xs leading-snug text-amber-800">
                    <span className="font-medium">Guard:</span> {approvalRoute.publishGuard}
                  </p>
                )}
                {approvalRoute.samTrigger && (
                  <p className="text-xs leading-snug text-amber-800 mt-1">
                    <span className="font-medium">SAM trigger:</span> {approvalRoute.samTrigger}
                  </p>
                )}
              </div>
            )}
            {post.channel?.toLowerCase() === 'linkedin' && (
              <button onClick={postToLinkedIn} disabled={marking || !linkedInPublishReady}
                title={linkedInPublishDetail}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 mb-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
                {marking ? 'Publishing…' : linkedInPublishReady ? '🚀 Publish to LinkedIn via Unipile' : 'Connect LinkedIn publishing first'}
              </button>
            )}
            {post.channel?.toLowerCase() === 'blog' && (
              <>
                <button onClick={publishToBlog} disabled={marking}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 mb-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
                  {marking ? 'Publishing…' : '📝 Publish to InnovareAI blog (GitHub→Netlify)'}
                </button>
                <PublishToConnectedBlog post={post} />
              </>
            )}
            {post.channel?.toLowerCase() === 'email' && (
              <div className="mb-2 space-y-2">
                <textarea value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)}
                  placeholder="recipient@example.com, another@example.com"
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-gray-400 focus:outline-none resize-none" />
                <button onClick={sendEmail} disabled={marking || !emailRecipients.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
                  {marking ? 'Sending…' : '📧 Send via Postmark'}
                </button>
                <p className="text-xs text-gray-500">Comma-, semicolon-, or newline-separated. Max 100 per send. Subject is parsed from the first "Subject: …" line of the copy.</p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={copyBundle}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-semibold">
                {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy text + hashtags</>}
              </button>
              <a href={composerUrl} target="_blank" rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-semibold">
                <ExternalLink className="w-4 h-4" /> Open {composerInfo.label}
              </a>
            </div>
            {post.media_url && (
              <p className="text-xs text-gray-500 mt-3">
                Media to attach: <a href={post.media_url} target="_blank" rel="noreferrer" className="text-gray-700 hover:underline break-all">{post.media_url}</a>
              </p>
            )}
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-700 mb-1.5">If you posted manually, paste the URL here:</p>
              <div className="flex gap-2">
                <input value={postedUrl} onChange={e => setPostedUrl(e.target.value)} placeholder="https://www.linkedin.com/posts/…"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-gray-400 focus:outline-none" />
                <button onClick={markAsPosted} disabled={marking || !postedUrl.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-lg text-sm font-semibold whitespace-nowrap">
                  {marking ? 'Saving…' : 'Mark as posted'}
                </button>
              </div>
            </div>
          </>
        )}

        {isPosted && (
          <div className="text-sm">
            <p className="font-semibold text-gray-900 mb-1 inline-flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Posted on {new Date(post.posted_at!).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
            <p className="text-xs text-gray-500">
              <a href={post.posted_url ?? '#'} target="_blank" rel="noreferrer" className="text-gray-700 hover:underline break-all">
                {post.posted_url}
              </a>
            </p>
          </div>
        )}

        {isRejected && (
          <div className="text-sm">
            <p className="font-semibold text-red-700 mb-1">Rejected</p>
            <p className="text-gray-500">This post won't be published. Generate a new one from the brief.</p>
            {post.feedback && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-700">
                <p className="font-medium text-gray-900 mb-1">Notes:</p>
                {post.feedback}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 text-center mt-6">Post ID: {post.id}</p>
    </div>
  )
}
