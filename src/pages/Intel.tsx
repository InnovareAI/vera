// /intel — Daily competitor intel timeline. Lists competitor_events for the
// active workspace, filterable by competitor + event kind. Each card lets the
// operator one-click "Brief a response" which deep-links into /generate with
// the intel context pre-loaded.
//
// Refresh button hits the discover-competitor-intel edge function to pull
// fresh sitemap diffs + RSS feeds on demand (the daily cron does the same in
// the background).

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, FileText, Globe, Megaphone, RefreshCw, Check, Filter } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'

const DISCOVER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover-competitor-intel`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

interface Competitor { id: string; name: string; website_url: string }
interface CompetitorEvent {
  id: string
  competitor_id: string
  kind: 'new_page' | 'blog_post' | 'website_change' | 'social_post' | 'new_competitor'
  source_url: string
  title: string | null
  summary: string | null
  meta: Record<string, unknown> | null
  detected_at: string
  read_at: string | null
  briefed_at: string | null
}

const KIND_LABEL: Record<CompetitorEvent['kind'], string> = {
  new_page: 'New page',
  blog_post: 'Blog post',
  website_change: 'Site change',
  social_post: 'Social',
  new_competitor: 'New competitor',
}
const KIND_ICON: Record<CompetitorEvent['kind'], React.ElementType> = {
  new_page: Globe,
  blog_post: FileText,
  website_change: Globe,
  social_post: Megaphone,
  new_competitor: Megaphone,
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Intel() {
  const { activeOrg } = useOrg()
  const navigate = useNavigate()
  const [events, setEvents] = useState<CompetitorEvent[]>([])
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshReport, setRefreshReport] = useState<string | null>(null)
  const [competitorFilter, setCompetitorFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')

  useEffect(() => {
    if (!activeOrg?.id) {
      setEvents([]); setCompetitors([]); setLoading(false); return
    }
    const orgId = activeOrg.id
    setLoading(true)
    Promise.all([
      supabase.from('competitor_events')
        .select('*')
        .eq('org_id', orgId)
        .order('detected_at', { ascending: false })
        .limit(100),
      supabase.from('competitors')
        .select('id, name, website_url')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name'),
    ]).then(([eventRes, competitorRes]) => {
      setEvents((eventRes.data as CompetitorEvent[]) ?? [])
      setCompetitors((competitorRes.data as Competitor[]) ?? [])
      setLoading(false)
    })
  }, [activeOrg?.id])

  const competitorsById = new Map(competitors.map(c => [c.id, c]))

  const filtered = events.filter(e => {
    if (competitorFilter !== 'all' && e.competitor_id !== competitorFilter) return false
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    return true
  })

  async function refresh() {
    if (!activeOrg?.id) return
    setRefreshing(true)
    setRefreshReport(null)
    try {
      const res = await fetch(DISCOVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ org_id: activeOrg.id }),
      })
      const data = await res.json()
      if (res.ok) {
        const news = data.events_created ?? 0
        setRefreshReport(`Scanned ${data.competitor_count} competitors · ${news} new ${news === 1 ? 'event' : 'events'}`)
        // Reload events
        const { data: newEvents } = await supabase.from('competitor_events')
          .select('*')
          .eq('org_id', activeOrg.id)
          .order('detected_at', { ascending: false })
          .limit(100)
        setEvents((newEvents as CompetitorEvent[]) ?? [])
      } else {
        setRefreshReport(`Error: ${data.error ?? `HTTP ${res.status}`}`)
      }
    } catch (e) {
      setRefreshReport(`Network error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setRefreshing(false)
  }

  async function markRead(eventId: string) {
    await supabase.from('competitor_events').update({ read_at: new Date().toISOString() }).eq('id', eventId)
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, read_at: new Date().toISOString() } : e))
  }

  function briefResponse(event: CompetitorEvent) {
    // Mark briefed (don't await — UI shouldn't block on this)
    supabase.from('competitor_events').update({ briefed_at: new Date().toISOString() }).eq('id', event.id)
    // Deep-link into /generate with the intel context
    navigate(`/generate?intel=${event.id}`)
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-[12px] font-mono uppercase tracking-wider" style={{ color: 'var(--ghost)' }}>Loading intel…</p>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Page header */}
      <div className="flex items-end justify-between mb-5 gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-none tracking-tight" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 144, "wght" 500' }}>
            Intel
          </h1>
          <p className="text-[12px] uppercase tracking-wider font-mono mt-2" style={{ color: 'var(--ghost)' }}>
            {events.length} events · {competitors.length} competitors tracked
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshReport && (
            <span className="text-[11px] font-mono" style={{ color: 'var(--ghost)' }}>{refreshReport}</span>
          )}
          <button
            onClick={refresh}
            disabled={refreshing || !activeOrg?.id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-all disabled:opacity-40"
            style={{
              background: 'var(--oxblood)', color: 'var(--paper)', borderRadius: '3px',
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Filters */}
      {(competitors.length > 0 || events.length > 0) && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
            <Filter size={12} style={{ color: 'var(--ghost)' }} />
            <select value={competitorFilter} onChange={e => setCompetitorFilter(e.target.value)}
              className="text-[12px] outline-none cursor-pointer"
              style={{ background: 'transparent', color: 'var(--ink)', border: 'none', fontFamily: 'var(--font-body)' }}>
              <option value="all">All competitors</option>
              {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'var(--paper-warm)', border: '1px solid var(--paper-edge)', borderRadius: '3px' }}>
            <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}
              className="text-[12px] outline-none cursor-pointer"
              style={{ background: 'transparent', color: 'var(--ink)', border: 'none', fontFamily: 'var(--font-body)' }}>
              <option value="all">All event types</option>
              {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-auto space-y-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64" style={{ color: 'var(--ghost)' }}>
            <span className="font-display text-3xl mb-3" style={{ color: 'var(--mist)' }}>—</span>
            <p className="text-sm">No intel yet.</p>
            <p className="text-[12px] font-mono mt-2" style={{ color: 'var(--ghost)' }}>
              {competitors.length === 0
                ? 'Add competitors in Settings → Competitors to start tracking.'
                : 'Click Refresh to scan now, or wait for the daily cron at 06:00 UTC.'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32" style={{ color: 'var(--ghost)' }}>
            <span className="font-display text-2xl mb-2" style={{ color: 'var(--mist)' }}>—</span>
            <p className="text-sm">No events match the active filters.</p>
          </div>
        ) : filtered.map(event => {
          const competitor = competitorsById.get(event.competitor_id)
          const Icon = KIND_ICON[event.kind]
          const isUnread = !event.read_at
          return (
            <div key={event.id}
              className="p-4 transition-all relative"
              style={{
                background: 'var(--paper)',
                border: `1px solid ${isUnread ? 'var(--oxblood-rule)' : 'var(--paper-edge)'}`,
                borderRadius: '4px',
              }}>
              {isUnread && (
                <span className="absolute left-0 top-2 bottom-2 w-[2px]"
                  style={{ background: 'var(--oxblood)', borderRadius: '0 1px 1px 0' }} />
              )}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <Icon size={14} style={{ color: isUnread ? 'var(--oxblood)' : 'var(--ghost)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5"
                      style={{ background: 'var(--paper-warm)', color: 'var(--ink-quiet)', borderRadius: '2px' }}>
                      {KIND_LABEL[event.kind]}
                    </span>
                    {competitor && (
                      <span className="text-[11px] font-mono" style={{ color: 'var(--oxblood)' }}>
                        {competitor.name}
                      </span>
                    )}
                    <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--mist)' }}>
                      {relativeTime(event.detected_at)}
                    </span>
                  </div>
                  <p className="font-display text-[15px] leading-snug mb-1" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 24, "wght" 500' }}>
                    {event.title || event.source_url}
                  </p>
                  {event.summary && (
                    <p className="text-[12px] line-clamp-2 mb-2" style={{ color: 'var(--ink-quiet)' }}>
                      {event.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <a href={event.source_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-mono"
                      style={{ color: 'var(--ghost)' }}>
                      <ExternalLink size={11} /> View source
                    </a>
                    <button onClick={() => briefResponse(event)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 transition-all"
                      style={{
                        background: 'var(--oxblood-tint)', color: 'var(--oxblood)',
                        borderRadius: '2px',
                      }}>
                      Brief a response →
                    </button>
                    {isUnread && (
                      <button onClick={() => markRead(event.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-mono ml-auto"
                        style={{ color: 'var(--ghost)' }}>
                        <Check size={11} /> Mark read
                      </button>
                    )}
                    {event.briefed_at && (
                      <span className="text-[11px] font-mono ml-auto" style={{ color: 'var(--oxblood)' }}>
                        ✓ briefed
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
