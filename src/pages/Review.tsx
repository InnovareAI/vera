import { useState, useEffect } from 'react'
import { airtableFetch, airtableUpdate } from '../lib/airtable'

interface Post {
  id: string
  fields: {
    Title?: string
    Body?: string
    Platform?: string
    Status?: string
    'Scheduled Date'?: string
    Client?: string[]
    Campaign?: string[]
    'Created Time'?: string
  }
}

const PLATFORM_COLORS: Record<string, string> = {
  LinkedIn: 'bg-blue-100 text-blue-700',
  Twitter: 'bg-sky-100 text-sky-700',
  'Twitter/X': 'bg-sky-100 text-sky-700',
  Instagram: 'bg-pink-100 text-pink-700',
  Quora: 'bg-red-100 text-red-700',
  Facebook: 'bg-indigo-100 text-indigo-700',
}

const STATUS_TABS = ['Pending Review', 'Approved', 'Scheduled', 'Published', 'Rejected']

export default function Review() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('Pending Review')
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    loadPosts()
  }, [])

  async function loadPosts() {
    setLoading(true)
    try {
      const data = await airtableFetch('Posts', { pageSize: 100 })
      setPosts(data.records || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(postId: string, newStatus: string) {
    setSaving(postId)
    try {
      await airtableUpdate('Posts', postId, { Status: newStatus })
      setPosts(prev =>
        prev.map(p => p.id === postId ? { ...p, fields: { ...p.fields, Status: newStatus } } : p)
      )
      if (selectedPost?.id === postId) {
        setSelectedPost(prev => prev ? { ...prev, fields: { ...prev.fields, Status: newStatus } } : null)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(null)
    }
  }

  const filtered = posts.filter(p => {
    const status = p.fields.Status || 'Draft'
    if (activeTab === 'Pending Review') return status === 'Pending Review' || status === 'Draft'
    return status === activeTab
  })

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = posts.filter(p => {
      const s = p.fields.Status || 'Draft'
      if (tab === 'Pending Review') return s === 'Pending Review' || s === 'Draft'
      return s === tab
    }).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex h-full gap-6">
      {/* Left panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-1">Approve, reject, or schedule generated content</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {tabCounts[tab] > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-300 text-gray-600'
                }`}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Post list */}
        <div className="flex-1 overflow-auto space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              Loading posts...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <span className="text-3xl mb-2">📭</span>
              <p className="text-sm">No posts in this queue</p>
            </div>
          ) : (
            filtered.map(post => (
              <div
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className={`bg-white rounded-xl p-4 cursor-pointer border-2 transition-all hover:border-gray-300 ${
                  selectedPost?.id === post.id ? 'border-violet-400 shadow-sm' : 'border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {post.fields.Platform && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          PLATFORM_COLORS[post.fields.Platform] || 'bg-gray-100 text-gray-600'
                        }`}>
                          {post.fields.Platform}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        post.fields.Status === 'Approved' ? 'bg-green-100 text-green-700' :
                        post.fields.Status === 'Scheduled' ? 'bg-blue-100 text-blue-700' :
                        post.fields.Status === 'Published' ? 'bg-emerald-100 text-emerald-700' :
                        post.fields.Status === 'Rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {post.fields.Status || 'Draft'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {post.fields.Title || 'Untitled Post'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {post.fields.Body || ''}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel — post detail */}
      <div className="w-96 flex-shrink-0">
        {selectedPost ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">Post Preview</h2>
              <button
                onClick={() => setSelectedPost(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {selectedPost.fields.Platform && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                PLATFORM_COLORS[selectedPost.fields.Platform] || 'bg-gray-100 text-gray-600'
              }`}>
                {selectedPost.fields.Platform}
              </span>
            )}

            <h3 className="font-semibold text-gray-900 mt-3 mb-2">
              {selectedPost.fields.Title || 'Untitled'}
            </h3>

            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-4">
              {selectedPost.fields.Body || 'No content'}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {(selectedPost.fields.Status === 'Pending Review' || selectedPost.fields.Status === 'Draft') && (
                <>
                  <button
                    onClick={() => updateStatus(selectedPost.id, 'Approved')}
                    disabled={saving === selectedPost.id}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {saving === selectedPost.id ? 'Saving...' : '✓ Approve'}
                  </button>
                  <button
                    onClick={() => updateStatus(selectedPost.id, 'Rejected')}
                    disabled={saving === selectedPost.id}
                    className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    ✕ Reject
                  </button>
                </>
              )}
              {selectedPost.fields.Status === 'Approved' && (
                <button
                  onClick={() => updateStatus(selectedPost.id, 'Scheduled')}
                  disabled={saving === selectedPost.id}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  📅 Schedule
                </button>
              )}
              {selectedPost.fields.Status === 'Scheduled' && (
                <button
                  onClick={() => updateStatus(selectedPost.id, 'Published')}
                  disabled={saving === selectedPost.id}
                  className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
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
