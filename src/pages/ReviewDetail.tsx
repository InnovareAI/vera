import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Copy, Check, ExternalLink, ArrowLeft, ThumbsUp, MessageCircle, Repeat2, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { PublishToConnectedBlog } from '../components/PublishToConnectedBlog'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Centralised call into the approval-webhook edge function (the single hub
// for status changes + n8n forwarding + Slack notifications).
async function callApprovalWebhook(payload: Record<string, unknown>): Promise<{ post?: Post; error?: string }> {
  try {
    const res = await fetch(APPROVAL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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

type ActionState = 'idle' | 'saving' | 'done'

export default function ReviewDetail() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionState>('idle')
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)
  const [postedUrl, setPostedUrl] = useState('')
  const [marking, setMarking] = useState(false)
  const [emailRecipients, setEmailRecipients] = useState('')

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

  async function updateStatus(newStatus: string, fb?: string) {
    if (!post) return
    setAction('saving')
    // Map UI status labels → approval-webhook action values
    const actionMap: Record<string, string> = {
      'Approved': 'approved',
      'Rejected': 'rejected',
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

  // Post directly to LinkedIn via Unipile. Available for the LinkedIn channel
  // when the org has a connected unipile_account_id. Wraps unipile-post edge
  // function which handles the API call + chains back to approval-webhook to
  // mark the row posted + fire Slack notify.
  async function postToLinkedIn() {
    if (!post) return
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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading post…</div>
  }
  if (error || !post) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Link to="/review" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to queue
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6 text-sm">{error || 'Post not found'}</div>
      </div>
    )
  }

  const statusLower = (post.status ?? '').toLowerCase()
  const isPending = statusLower === 'pending' || statusLower === 'changes_requested' || statusLower === 'draft' || post.status === 'Pending Review'
  const isApproved = statusLower === 'approved'
  const isRejected = statusLower === 'rejected'
  const isPosted = !!post.posted_at
  const composerInfo = composerForChannel(post.channel, post.copy)
  const initial = (post.profile_name ?? 'T')[0]
  const composerUrl = composerInfo.url
  const compliance = Array.isArray(post.compliance_checks) ? (post.compliance_checks as Array<{ pass?: boolean; label?: string }>) : []
  const statusBadge = isPosted
    ? { text: 'Posted', cls: 'bg-violet-50 text-gray-900 border-violet-200' }
    : isApproved
    ? { text: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : isRejected
    ? { text: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' }
    : statusLower === 'changes_requested'
    ? { text: 'Changes requested', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
    : { text: 'Pending review', cls: 'bg-amber-50 text-amber-700 border-amber-200' }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <Link to="/review" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to queue
      </Link>

      {/* Meta bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-900">Review</h1>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>{statusBadge.text}</span>
        </div>
        <div className="text-xs text-gray-500">
          {post.channel} · {post.format}{post.author ? ` · by ${post.author}` : ''}
        </div>
      </div>

      {/* LinkedIn-styled preview */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 pt-4 flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight">{post.profile_name ?? 'Thorsten Linz'}</p>
            <p className="text-xs text-gray-500 leading-snug mt-0.5">{post.profile_title ?? 'CEO & Co-Founder @ InnovareAI'}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{post.publish_date ? new Date(post.publish_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : 'Draft preview'}</p>
          </div>
        </div>
        <div className="px-4 pt-3">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{post.copy}</p>
          {post.hashtags && post.hashtags.length > 0 && (
            <p className="text-sm text-blue-600 mt-2">{post.hashtags.join(' ')}</p>
          )}
        </div>
        {post.media_url && (
          <div className="mt-3">
            <img src={post.media_url} alt="Post media" className="w-full block" />
          </div>
        )}
        <div className="flex gap-1 px-2 py-1 mt-3 border-t border-gray-100">
          {[{ Icon: ThumbsUp, label: 'Like' }, { Icon: MessageCircle, label: 'Comment' }, { Icon: Repeat2, label: 'Repost' }, { Icon: Send, label: 'Send' }].map(({ Icon, label }) => (
            <button key={label} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-600 hover:bg-[var(--fog)] rounded">
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
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
        {isPending && (
          <>
            <p className="text-sm font-semibold text-gray-900 mb-3">Ready to approve?</p>
            <div className="flex gap-2 mb-2">
              <button onClick={() => updateStatus('approved')} disabled={action === 'saving'}
                className="flex-1 py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {action === 'saving' ? 'Saving…' : 'Approve'}
              </button>
              <button onClick={() => updateStatus('rejected')} disabled={action === 'saving'}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-red-50 disabled:opacity-50 text-red-700 border-2 border-red-300 rounded-lg text-sm font-semibold">
                Reject
              </button>
            </div>
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

        {isApproved && !isPosted && (
          <>
            <p className="text-sm font-semibold text-emerald-700 mb-1">Approved — ready to post</p>
            <p className="text-xs text-gray-500 mb-4">
              {post.channel?.toLowerCase() === 'linkedin'
                ? 'Auto-publish via Unipile, or copy + open the composer to post manually.'
                : post.channel?.toLowerCase() === 'blog'
                  ? 'Auto-commit to the blog repo (Netlify deploys on push), or copy + post manually.'
                  : post.channel?.toLowerCase() === 'email'
                    ? 'Send via Postmark to a recipient list, or copy + paste into your own email tool.'
                    : 'Copy the bundle, open the composer, paste, and publish.'}
            </p>
            {post.channel?.toLowerCase() === 'linkedin' && (
              <button onClick={postToLinkedIn} disabled={marking}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 mb-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
                {marking ? 'Publishing…' : '🚀 Publish to LinkedIn via Unipile'}
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
