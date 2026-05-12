import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Post, Campaign } from '../lib/supabase'
import { StatusBadge } from '../components/Layout'

export default function Dashboard() {
  const navigate = useNavigate()
  const [pendingPosts, setPendingPosts] = useState<Post[]>([])
  const [recentPosts, setRecentPosts] = useState<Post[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [pendingRes, recentRes, campaignsRes] = await Promise.all([
        supabase.from('content_posts').select('*').in('status', ['Draft', 'Pending Review']).order('created_at', { ascending: false }).limit(5),
        supabase.from('content_posts').select('*').order('updated_at', { ascending: false }).limit(5),
        supabase.from('campaigns').select('*').eq('status', 'active'),
      ])
      setPendingPosts(pendingRes.data || [])
      setRecentPosts(recentRes.data || [])
      setCampaigns(campaignsRes.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const stats = [
    { value: loading ? '—' : pendingPosts.length, label: 'Awaiting approval' },
    { value: loading ? '—' : campaigns.length, label: 'Active campaigns' },
    { value: loading ? '—' : recentPosts.length, label: 'Recent posts' },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{dateStr}</p>
        </div>
        <button onClick={() => navigate('/generate')} className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          New content
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {stats.map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Pending Approval</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</div>
          ) : pendingPosts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Nothing pending</div>
          ) : pendingPosts.map(post => (
            <div key={post.id} onClick={() => navigate('/review')} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{post.title || 'Untitled Post'}</p>
                <p className="text-xs text-gray-400 mt-0.5">{post.channel} · {post.format}</p>
              </div>
              <StatusBadge status={post.status} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Recent Activity</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</div>
          ) : recentPosts.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">No activity yet</div>
          ) : recentPosts.map(post => (
            <div key={post.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{post.title || 'Untitled Post'}</p>
                <p className="text-xs text-gray-400 mt-0.5">{post.channel} · {new Date(post.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <StatusBadge status={post.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
