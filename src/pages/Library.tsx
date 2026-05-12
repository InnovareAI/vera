import { useState, useEffect } from 'react'
import { airtableFetch } from '../lib/airtable'

interface Post {
  id: string
  fields: {
    Title?: string
    Body?: string
    Platform?: string
    Status?: string
    'Scheduled Date'?: string
    'Created Time'?: string
    Client?: string[]
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

const STATUS_COLORS: Record<string, string> = {
  Published: 'bg-emerald-100 text-emerald-700',
  Approved: 'bg-green-100 text-green-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'Pending Review': 'bg-amber-100 text-amber-700',
  Draft: 'bg-gray-100 text-gray-600',
  Rejected: 'bg-red-100 text-red-600',
}

export default function Library() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  const platforms = ['All', 'LinkedIn', 'Twitter/X', 'Instagram', 'Quora', 'Facebook']
  const statuses = ['All', 'Published', 'Approved', 'Scheduled', 'Pending Review', 'Draft', 'Rejected']

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

  const filtered = posts.filter(p => {
    const matchSearch = !search ||
      (p.fields.Title || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.fields.Body || '').toLowerCase().includes(search.toLowerCase())
    const matchPlatform = platformFilter === 'All' || p.fields.Platform === platformFilter
    const matchStatus = statusFilter === 'All' || (p.fields.Status || 'Draft') === statusFilter
    return matchSearch && matchPlatform && matchStatus
  })

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
          <p className="text-sm text-gray-500 mt-1">All generated posts — search, filter, reuse</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search posts..."
            className="flex-1 min-w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          <select
            value={platformFilter}
            onChange={e => setPlatformFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          >
            {platforms.map(p => <option key={p}>{p}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
          >
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <p className="text-xs text-gray-400 mb-3">{filtered.length} post{filtered.length !== 1 ? 's' : ''}</p>

        {/* Posts */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
            Loading library...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <span className="text-4xl mb-3">📚</span>
            <p className="text-sm">No posts found</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-2">
            {filtered.map(post => (
              <div
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className={`bg-white rounded-xl p-4 cursor-pointer border-2 transition-all hover:border-gray-300 ${
                  selectedPost?.id === post.id ? 'border-violet-400' : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {post.fields.Platform && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      PLATFORM_COLORS[post.fields.Platform] || 'bg-gray-100 text-gray-600'
                    }`}>
                      {post.fields.Platform}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    STATUS_COLORS[post.fields.Status || 'Draft'] || 'bg-gray-100 text-gray-600'
                  }`}>
                    {post.fields.Status || 'Draft'}
                  </span>
                  {post.fields['Scheduled Date'] && (
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(post.fields['Scheduled Date']).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-900">{post.fields.Title || 'Untitled'}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{post.fields.Body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="w-80 flex-shrink-0">
        {selectedPost ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">Post Detail</h2>
              <button onClick={() => setSelectedPost(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>

            <div className="flex gap-2 flex-wrap mb-3">
              {selectedPost.fields.Platform && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  PLATFORM_COLORS[selectedPost.fields.Platform] || 'bg-gray-100 text-gray-600'
                }`}>
                  {selectedPost.fields.Platform}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                STATUS_COLORS[selectedPost.fields.Status || 'Draft'] || 'bg-gray-100 text-gray-600'
              }`}>
                {selectedPost.fields.Status || 'Draft'}
              </span>
            </div>

            <h3 className="font-semibold text-gray-900 mb-2 text-sm">
              {selectedPost.fields.Title || 'Untitled'}
            </h3>

            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto mb-4">
              {selectedPost.fields.Body || 'No content'}
            </div>

            <button
              onClick={() => copyToClipboard(selectedPost.fields.Body || '')}
              className="w-full py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              📋 Copy to Clipboard
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center justify-center text-center h-48">
            <span className="text-3xl mb-2">📖</span>
            <p className="text-xs text-gray-400">Select a post to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
