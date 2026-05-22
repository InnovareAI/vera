import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'

const APPROVAL_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approval-webhook`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
  quora: 'bg-red-100 text-red-700',
  facebook: 'bg-indigo-100 text-indigo-700',
}

const STATUS_TABS = ['Pending Review', 'Approved', 'Scheduled', 'Posted', 'Rejected']

export default function Review() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('Pending Review')
  const [selected, setSelected] = useState<Post | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('content_posts').select('*').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setPosts(data || []); setLoading(false) })

    // Real-time updates
    const channel = supabase.channel('review-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_posts' }, payload => {
        if (payload.eventType === 'UPDATE') {
          setPosts(prev => prev.map(p => p.id === (payload.new as Post).id ? payload.new as Post : p))
          setSelected(prev => prev?.id === (payload.new as Post).id ? payload.new as Post : prev)
        }
        if (payload.eventType === 'INSERT') setPosts(prev => [payload.new as Post, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function updateStatus(postId: string, newStatus: string) {
    setSaving(postId)
    // Approved/Rejected go through approval-webhook (single hub for status
    // change + n8n forward + Slack notify). Scheduled/Published flow stays
    // direct since those are operator-internal state and don't need notify.
    const webhookActions: Record<string, string> = { 'Approved': 'approved', 'Rejected': 'rejected' }
    const apiAction = webhookActions[newStatus]
    if (apiAction) {
      try {
        const res = await fetch(APPROVAL_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ post_id: postId, action: apiAction }),
        })
        const data = await res.json()
        if (res.ok && data.post) {
          setPosts(prev => prev.map(p => p.id === postId ? data.post as Post : p))
          setSelected(prev => prev?.id === postId ? data.post as Post : prev)
        }
      } catch { /* swallow — operator will see no state change and can retry */ }
    } else {
      const { error } = await supabase.from('content_posts').update({ status: newStatus }).eq('id', postId)
      if (!error) {
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p))
        setSelected(prev => prev?.id === postId ? { ...prev, status: newStatus } : prev)
      }
    }
    setSaving(null)
  }

  // Map DB status values → UI tabs
  const isPending = (s: string) =>
    ['Pending Review', 'Draft', 'pending', 'changes_requested'].includes(s)
  const isPosted = (p: Post) => !!p.posted_at

  const filtered = posts.filter(p => {
    if (activeTab === 'Pending Review') return isPending(p.status) && !isPosted(p)
    if (activeTab === 'Approved') return (p.status === 'Approved' || p.status === 'approved') && !isPosted(p)
    if (activeTab === 'Scheduled') return p.status === 'Scheduled' && !isPosted(p)
    if (activeTab === 'Posted') return isPosted(p)
    if (activeTab === 'Rejected') return p.status === 'Rejected' || p.status === 'rejected'
    return p.status === activeTab
  })

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = posts.filter(p => {
      if (tab === 'Pending Review') return isPending(p.status) && !isPosted(p)
      if (tab === 'Approved') return (p.status === 'Approved' || p.status === 'approved') && !isPosted(p)
      if (tab === 'Scheduled') return p.status === 'Scheduled' && !isPosted(p)
      if (tab === 'Posted') return isPosted(p)
      if (tab === 'Rejected') return p.status === 'Rejected' || p.status === 'rejected'
      return p.status === tab
    }).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex h-full gap-6">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-1">Approve, reject, or schedule generated content</p>
        </div>

        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
          {STATUS_TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {tab}
              {tabCounts[tab] > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-300 text-gray-600'}`}>{tabCounts[tab]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading posts…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <span className="text-3xl mb-2">📭</span>
              <p className="text-sm">No posts in this queue</p>
            </div>
          ) : filtered.map(post => (
            <div key={post.id} onClick={() => setSelected(post)}
              className={`bg-white rounded-xl p-4 cursor-pointer border-2 transition-all hover:border-gray-300 ${selected?.id === post.id ? 'border-violet-400 shadow-sm' : 'border-transparent'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {post.channel && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[post.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                        {post.channel}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isPosted(post) ? 'bg-emerald-100 text-emerald-700' :
                      post.status === 'Approved' ? 'bg-green-100 text-green-700' :
                      post.status === 'Scheduled' ? 'bg-blue-100 text-blue-700' :
                      post.status === 'Published' ? 'bg-emerald-100 text-emerald-700' :
                      post.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>{isPosted(post) ? 'Posted' : post.status}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate">{post.title || 'Untitled Post'}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{post.copy}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-96 flex-shrink-0">
        {selected ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">Post Preview</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            {selected.channel && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[selected.channel.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                {selected.channel}
              </span>
            )}
            <h3 className="font-semibold text-gray-900 mt-3 mb-2">{selected.title || 'Untitled'}</h3>
            {/* Generated image */}
            {selected.media_url && (
              <div className="mb-3 rounded-xl overflow-hidden border border-gray-100">
                <img src={selected.media_url} alt="Generated visual" className="w-full object-cover max-h-48" />
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-4">
              {selected.copy || 'No content'}
            </div>
            {selected.hashtags && selected.hashtags.length > 0 && (
              <p className="text-xs text-blue-500 mb-4">{selected.hashtags.join(' ')}</p>
            )}
            {selected.model_used && (
              <p className="text-xs text-gray-400 mb-4">Generated by {selected.model_used}</p>
            )}
            {isPosted(selected) && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
                <div className="font-medium text-emerald-800 mb-1">✓ Posted to {selected.channel}</div>
                {selected.posted_at && (
                  <div className="text-emerald-700">
                    {new Date(selected.posted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                )}
                {selected.posted_url && (
                  <a href={selected.posted_url} target="_blank" rel="noopener noreferrer"
                    className="mt-1 inline-block text-emerald-700 underline hover:text-emerald-900 truncate max-w-full">
                    {selected.posted_url}
                  </a>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {isPending(selected.status) && !isPosted(selected) && (<>
                <button onClick={() => updateStatus(selected.id, 'Approved')} disabled={saving === selected.id}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {saving === selected.id ? 'Saving…' : '✓ Approve'}
                </button>
                <button onClick={() => updateStatus(selected.id, 'Rejected')} disabled={saving === selected.id}
                  className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  ✕ Reject
                </button>
              </>)}
              {selected.status === 'Approved' && !isPosted(selected) && (
                <button onClick={() => updateStatus(selected.id, 'Scheduled')} disabled={saving === selected.id}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  📅 Schedule
                </button>
              )}
              {selected.status === 'Scheduled' && !isPosted(selected) && (
                <button onClick={() => updateStatus(selected.id, 'Published')} disabled={saving === selected.id}
                  className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  🚀 Mark Published
                </button>
              )}
              <a href={`/review/${selected.id}`}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors text-center">
                Open detail →
              </a>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center justify-center text-center h-64">
            <span className="text-4xl mb-3">👆</span>
            <p className="text-sm text-gray-500">Select a post to preview and take action</p>
          </div>
        )}
      </div>
    </div>
  )
}
