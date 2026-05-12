import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-500',
  twitter: 'bg-sky-400',
  instagram: 'bg-pink-500',
  quora: 'bg-red-500',
  facebook: 'bg-indigo-500',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function Calendar() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const today = new Date()
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  useEffect(() => {
    supabase.from('content_posts').select('*').not('scheduled_at', 'is', null).order('scheduled_at')
      .then(({ data }) => { setPosts(data || []); setLoading(false) })
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function postsForDay(day: number): Post[] {
    return posts.filter(p => {
      if (!p.scheduled_at) return false
      const d = new Date(p.scheduled_at)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })
  }

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : []

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null) }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600">‹</button>
            <h2 className="font-semibold text-gray-900">{MONTHS[month]} {year}</h2>
            <button onClick={() => { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null) }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600">›</button>
          </div>

          <div className="grid grid-cols-7 mb-2">
            {DAYS.map(d => <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />
              const dayPosts = postsForDay(day)
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
              const isSelected = day === selectedDay
              return (
                <div key={day} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  className={`min-h-[56px] rounded-xl p-1.5 cursor-pointer transition-all ${isSelected ? 'bg-violet-50 border-2 border-violet-400' : isToday ? 'bg-gray-900' : 'hover:bg-gray-50 border-2 border-transparent'}`}>
                  <div className={`text-xs font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'text-white' : isSelected ? 'text-violet-700' : 'text-gray-700'}`}>
                    {day}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {dayPosts.slice(0, 3).map(post => (
                      <div key={post.id} className={`h-1.5 w-1.5 rounded-full ${PLATFORM_COLORS[post.channel?.toLowerCase() || ''] || 'bg-gray-400'}`} />
                    ))}
                    {dayPosts.length > 3 && <span className="text-[9px] text-gray-400">+{dayPosts.length - 3}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex gap-4 mt-3 flex-wrap">
          {Object.entries(PLATFORM_COLORS).map(([p, c]) => (
            <div key={p} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className={`w-2.5 h-2.5 rounded-full ${c}`} />
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </div>
          ))}
        </div>
      </div>

      <div className="w-72 flex-shrink-0">
        {selectedDay ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 sticky top-0">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">{MONTHS[month]} {selectedDay}</h3>
            {selectedPosts.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No posts scheduled</p>
            ) : (
              <div className="space-y-3">
                {selectedPosts.map(post => (
                  <div key={post.id} className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${PLATFORM_COLORS[post.channel?.toLowerCase() || ''] || 'bg-gray-400'}`} />
                      <span className="text-xs font-medium text-gray-700">{post.channel}</span>
                      <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                        post.status === 'Published' ? 'bg-emerald-100 text-emerald-700' :
                        post.status === 'Scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                      }`}>{post.status}</span>
                    </div>
                    <p className="text-xs font-medium text-gray-900">{post.title || 'Untitled'}</p>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{post.copy}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col items-center justify-center text-center h-48">
            <span className="text-3xl mb-2">📅</span>
            <p className="text-xs text-gray-400">Click a day to see scheduled posts</p>
          </div>
        )}
      </div>
    </div>
  )
}
