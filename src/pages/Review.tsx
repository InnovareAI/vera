import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
  quora: 'bg-red-100 text-red-700',
  facebook: 'bg-indigo-100 text-indigo-700',
}

const STATUS_TABS = ['Pending Review', 'Approved', 'Scheduled', 'Published', 'Rejected']

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
    const { error } = await supabase.from('content_posts').update({ status: newStatus }).eq('id', postId)
    if (!error) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p))
      setSelected(prev => prev?.id === postId ? { ...prev, status: newStatus } : prev)
    }
    setSaving(null)
  }

  const filtered = posts.filter(p => {
    if (activeTab === 'Pending Review') return p.status === 'Pending Review' || p.status === 'Draft'
    return p.status === activeTab
  })

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = posts.filter(p => tab === 'Pending Review' ? (p.status === 'Pending Review' || p.status === 'Draft') : p.status === tab).length
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
                      post.status === 'Approved' ? 'bg-green-100 text-green-700' :
                      post.status === 'Scheduled' ? 'bg-blue-100 text-blue-700' :
                      post.status === 'Published' ? 'bg-emerald-100 text-emerald-700' :
                      post.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>{post.status}</span>
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
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-4">
              {selected.copy || 'No content'}
            </div>
            {selected.hashtags && selected.hashtags.length > 0 && (
              <p className="text-xs text-blue-500 mb-4">{selected.hashtags.join(' ')}</p>
            )}
            {selected.model_used && (
              <p className="text-xs text-gray-400 mb-4">Generated by {selected.model_used}</p>
            )}
            <div className="flex flex-col gap-2">
              {(selected.status === 'Pending Review' || selected.status === 'Draft') && (<>
                <button onClick={() => updateStatus(selected.id, 'Approved')} disabled={saving === selected.id}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {saving === selected.id ? 'Saving…' : '✓ Approve'}
                </button>
                <button onClick={() => updateStatus(selected.id, 'Rejected')} disabled={saving === selected.id}
                  className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  ✕ Reject
                </button>
              </>)}
              {selected.status === 'Approved' && (
                <button onClick={() => updateStatus(selected.id, 'Scheduled')} disabled={saving === selected.id}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  📅 Schedule
                </button>
              )}
              {selected.status === 'Scheduled' && (
                <button onClick={() => updateStatus(selected.id, 'Published')} disabled={saving === selected.id}
                  className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  🚀 Mark Published
                </button>
              )}
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
