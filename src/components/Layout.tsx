// VERA shell — "Atelier" aesthetic. Cream paper + ink + oxblood accent,
// Fraunces (serif display) + Geist (body) + Geist Mono (metadata).
//
// Structure top to bottom in the rail:
//   1. Brand mark (typographic, not iconic)
//   2. Workspace switcher (single line; click expands)
//   3. + Brief CTA (oxblood block — primary action)
//   4. Primary nav (Overview · Review · Audit · Library)
//   5. Pinned (mock data for now; schema to follow)
//   6. Recent (mock data for now)
//   7. "More" (collapsed secondary routes — Calendar / Templates / Skills / Agency)
//   8. Footer (Settings + theme toggle + user)
//
// The canvas (right side) is just <Outlet />. No tabs, no breadcrumbs,
// no second nav. One focused view at a time.

import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Star, Clock, Sparkles, CheckSquare, Telescope, BookOpen, Plus,
  Calendar, Layers, Zap, Building2, Settings, LogOut, Sun, Moon,
  ChevronDown, Check, ChevronRight, Radar, Monitor,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useTheme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import type { Campaign, Post } from '../lib/supabase'

// ─── shared status badge (kept here so pages that import it still work) ──
const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  revision: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-500',
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[s] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

// ─── workspace switcher ──────────────────────────────────────────────────
// Single-line top-of-rail. Glyph + name + chevron. Click expands an overlay
// with the full client list, search, and "Add client".
function WorkspaceSwitcher() {
  const { activeOrg, orgs, switchOrg } = useOrg()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const matches = orgs.filter(m =>
    m.organizations.name.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="relative px-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-2 py-2 hover:bg-[var(--fog)] transition-colors text-left group"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <div
          className="w-6 h-6 flex items-center justify-center text-[11px] font-medium flex-shrink-0"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper-warm)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {activeOrg?.name?.slice(0, 1).toUpperCase() ?? '·'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium leading-tight truncate" style={{ color: 'var(--ink)' }}>
            {activeOrg?.name ?? 'Select workspace'}
          </div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ghost)' }}>
            {orgs.length === 1 ? '1 workspace' : `${orgs.length} workspaces`}
          </div>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--ghost)' }} className="flex-shrink-0 group-hover:opacity-100 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-2 right-2 top-full mt-1 z-40 overflow-hidden"
            style={{
              background: 'var(--paper-warm)',
              border: '1px solid var(--paper-edge)',
              boxShadow: '0 16px 48px -12px rgba(0, 0, 0, 0.12), 0 4px 12px -4px rgba(0, 0, 0, 0.06)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <input
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search workspaces"
              className="w-full px-4 py-3 text-[13px] outline-none"
              style={{
                background: 'transparent',
                color: 'var(--ink)',
                borderBottom: '1px solid var(--paper-edge)',
              }}
            />
            <div className="max-h-72 overflow-y-auto p-1">
              {matches.map(m => (
                <button
                  key={m.org_id}
                  onClick={() => { switchOrg(m.org_id); setOpen(false); setFilter('') }}
                  className="w-full flex items-center gap-2.5 px-2 py-2 hover:bg-[var(--fog)] transition-colors text-left"
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  <div
                    className="w-5 h-5 flex items-center justify-center text-[10px] font-medium flex-shrink-0"
                    style={{
                      background: m.org_id === activeOrg?.id ? 'var(--ink)' : 'var(--fog)',
                      color: m.org_id === activeOrg?.id ? 'var(--paper-warm)' : 'var(--ink)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {m.organizations.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate" style={{ color: 'var(--ink)' }}>{m.organizations.name}</div>
                    <div className="text-[11px] truncate capitalize" style={{ color: 'var(--ghost)' }}>{m.role}</div>
                  </div>
                  {m.org_id === activeOrg?.id && (
                    <Check size={12} style={{ color: 'var(--ink)' }} className="flex-shrink-0" />
                  )}
                </button>
              ))}
              {matches.length === 0 && (
                <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--ghost)' }}>
                  No workspaces match "{filter}"
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── rail section heading ────────────────────────────────────────────────
// Quiet uppercase label with subtle letter-spacing — no em-dash, no rule.
// Modern minimal: hierarchy comes from spacing, not decorative chrome.
function RailSection({ label, count }: { label: string; count?: number }) {
  return (
    <div className="px-4 pt-6 pb-2 flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium" style={{ color: 'var(--ghost)' }}>
        {label}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-[11px]" style={{ color: 'var(--mist)' }}>{count}</span>
      )}
    </div>
  )
}

// ─── primary nav item ────────────────────────────────────────────────────
// Modern minimal: full pill-shaped hover/active background instead of an
// edge-bar. Single radius, generous padding, no decorative elements.
function PrimaryNavItem({
  to, icon: Icon, label, badge,
}: { to: string; icon: React.ElementType; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-2 py-1.5 mx-2 text-[13px] transition-all ${
          isActive ? 'is-active' : ''
        }`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--fog)' : 'transparent',
        color: isActive ? 'var(--ink)' : 'var(--ink-quiet)',
        fontWeight: isActive ? 500 : 400,
        borderRadius: 'var(--radius-md)',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={15} style={{ color: isActive ? 'var(--ink)' : 'var(--ghost)' }} className="flex-shrink-0" strokeWidth={isActive ? 2 : 1.75} />
          <span className="flex-1">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="text-[11px] px-1.5 leading-tight py-px"
              style={{
                background: isActive ? 'var(--ink)' : 'var(--paper-edge)',
                color: isActive ? 'var(--paper-warm)' : 'var(--ink-quiet)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 500,
              }}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

// ─── rail item (pinned / recent) ─────────────────────────────────────────
// Quieter than nav items — smaller text, no icon prominence, indent for
// hierarchy.
function RailItem({
  to, icon: Icon, title, meta,
}: { to: string; icon?: React.ElementType; title: string; meta?: string }) {
  return (
    <NavLink
      to={to}
      className="group flex items-start gap-2 mx-2 px-2 py-1.5 hover:bg-[var(--fog)] transition-colors"
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      {Icon && (
        <Icon size={12} style={{ color: 'var(--mist)' }} className="flex-shrink-0 mt-0.5 group-hover:text-[var(--ink-quiet)] transition-colors" strokeWidth={1.75} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] leading-snug truncate" style={{ color: 'var(--ink-quiet)' }}>
          {title}
        </div>
        {meta && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--mist)' }}>
            {meta}
          </div>
        )}
      </div>
    </NavLink>
  )
}

// ─── theme switcher ──────────────────────────────────────────────────────
// 3-way segmented control: Sun (light) · Monitor (system) · Moon (dark).
// Active mode gets the pill background; others are quiet. Matches Linear /
// GitHub / Vercel pattern.
function ThemeSwitcher({
  theme,
  setTheme,
}: {
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
}) {
  const options: Array<{ value: 'light' | 'dark' | 'system'; Icon: React.ElementType; label: string }> = [
    { value: 'light',  Icon: Sun,     label: 'Light' },
    { value: 'system', Icon: Monitor, label: 'System' },
    { value: 'dark',   Icon: Moon,    label: 'Dark' },
  ]
  return (
    <div
      className="inline-flex items-center p-0.5"
      style={{
        background: 'var(--fog)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {options.map(({ value, Icon, label }) => {
        const active = theme === value
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            aria-label={label}
            className="p-1.5 transition-all"
            style={{
              background: active ? 'var(--paper-warm)' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Icon
              size={13}
              strokeWidth={active ? 2 : 1.75}
              style={{ color: active ? 'var(--ink)' : 'var(--ghost)' }}
            />
          </button>
        )
      })}
    </div>
  )
}

// Relative time formatter for Recent list
function ago(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const min = Math.round(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── layout ──────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, signOut } = useAuth()
  const { activeOrg, activeRole } = useOrg()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const [pinnedCampaigns, setPinnedCampaigns] = useState<Campaign[]>([])
  const [recentPosts, setRecentPosts] = useState<Post[]>([])

  // Load pinned campaigns + recent posts for the active workspace. Both feed
  // the rail; the "Pinned" section shows operator-flagged campaigns and the
  // "Recent" section shows posts touched in the last week.
  useEffect(() => {
    if (!activeOrg?.id) {
      setPinnedCampaigns([])
      setRecentPosts([])
      return
    }
    const orgId = activeOrg.id
    Promise.all([
      supabase.from('campaigns')
        .select('id, name, theme, status, is_pinned, post_count, color, start_date, end_date')
        .eq('org_id', orgId)
        .eq('is_pinned', true)
        .order('start_date', { ascending: false, nullsFirst: false })
        .limit(6),
      supabase.from('content_posts')
        .select('id, title, channel, status, posted_at, updated_at, campaign_id')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(8),
    ]).then(([campRes, postRes]) => {
      setPinnedCampaigns((campRes.data as Campaign[]) ?? [])
      setRecentPosts((postRes.data as Post[]) ?? [])
    })
  }, [activeOrg?.id])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'KA'
  const isAgencyAdmin = activeOrg?.org_type === 'agency' || activeRole === 'agency_admin'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--paper)' }}>
      {/* Rail */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col"
        style={{
          background: 'var(--paper)',
          borderRight: '1px solid var(--paper-edge)',
        }}
      >
        {/* Brand mark */}
        <div className="px-4 pt-5 pb-4 flex items-center gap-2">
          <div
            className="w-7 h-7 flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper-warm)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            V
          </div>
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            VERA
          </span>
        </div>

        {/* Workspace switcher */}
        <WorkspaceSwitcher />

        {/* + Brief CTA — ink-filled primary action, Notion style */}
        <div className="px-2 pt-3">
          <button
            onClick={() => navigate('/generate')}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 transition-opacity hover:opacity-90"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper-warm)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={14} strokeWidth={2.25} />
              <span className="text-[13px] font-medium">New brief</span>
            </span>
            <span className="text-[11px] opacity-60">⌘N</span>
          </button>
        </div>

        {/* Primary nav */}
        <nav className="pt-3 pb-1 space-y-0.5">
          <PrimaryNavItem to="/dashboard"  icon={Sparkles}    label="Overview" />
          <PrimaryNavItem to="/review"     icon={CheckSquare} label="Review" badge={4} />
          <PrimaryNavItem to="/audit"      icon={Telescope}   label="Audit" />
          <PrimaryNavItem to="/intel"      icon={Radar}       label="Intel" />
          <PrimaryNavItem to="/library"    icon={BookOpen}    label="Library" />
        </nav>

        {/* Scrolling middle — pinned + recent + more */}
        <div className="flex-1 overflow-y-auto">
          <RailSection label="Pinned" count={pinnedCampaigns.length} />
          {pinnedCampaigns.length === 0 ? (
            <div className="px-4 py-1 text-[12px]" style={{ color: 'var(--mist)' }}>
              No pinned campaigns
            </div>
          ) : pinnedCampaigns.map(c => (
            <RailItem
              key={c.id}
              to={`/review?campaign=${c.id}`}
              icon={Star}
              title={c.name}
              meta={[
                c.status !== 'active' ? c.status : null,
                typeof c.post_count === 'number' ? `${c.post_count} posts` : null,
              ].filter(Boolean).join(' · ') || undefined}
            />
          ))}

          <RailSection label="Recent" />
          {recentPosts.length === 0 ? (
            <div className="px-4 py-1 text-[12px]" style={{ color: 'var(--mist)' }}>
              Nothing here yet
            </div>
          ) : recentPosts.map(p => (
            <RailItem
              key={p.id}
              to={`/review/${p.id}`}
              icon={Clock}
              title={p.title || 'Untitled post'}
              meta={`${(p.channel ?? 'post').toLowerCase()} · ${ago(p.updated_at)}`}
            />
          ))}

          {/* More — collapsed secondary routes */}
          <div className="px-4 pt-5 pb-1">
            <button
              onClick={() => setMoreOpen(o => !o)}
              className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--ghost)' }}
            >
              <ChevronRight size={11} className={`transition-transform ${moreOpen ? 'rotate-90' : ''}`} strokeWidth={2} />
              More
            </button>
          </div>
          {moreOpen && (
            <div className="pb-2 space-y-0.5 pt-1">
              <RailItem to="/clients"   icon={Building2} title="Clients" />
              <RailItem to="/calendar"  icon={Calendar}  title="Calendar" />
              <RailItem to="/templates" icon={Layers}    title="Templates" />
              <RailItem to="/skills"    icon={Zap}       title="Skills" />
              {isAgencyAdmin && <RailItem to="/agency" icon={Building2} title="Agency" />}
            </div>
          )}
        </div>

        {/* Footer — Settings + theme + user */}
        <div
          className="px-2 py-2 flex items-center gap-1"
          style={{ borderTop: '1px solid var(--paper-edge)' }}
        >
          <NavLink
            to="/settings"
            className="flex items-center gap-2 flex-1 px-2 py-1.5 hover:bg-[var(--fog)] transition-colors text-[13px]"
            style={{ color: 'var(--ink-quiet)', borderRadius: 'var(--radius-md)' }}
          >
            <Settings size={14} style={{ color: 'var(--ghost)' }} strokeWidth={1.75} />
            <span>Settings</span>
          </NavLink>
          <ThemeSwitcher theme={theme} setTheme={setTheme} />
          <div className="group relative">
            <button
              className="w-7 h-7 flex items-center justify-center text-[11px] font-medium"
              style={{
                background: 'var(--fog)',
                color: 'var(--ink)',
                borderRadius: '50%',
              }}
            >
              {initials}
            </button>
            {user && (
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="absolute right-0 top-full mt-1 opacity-0 group-hover:opacity-100 p-1 transition-opacity"
                style={{ color: 'var(--ghost)' }}
              >
                <LogOut size={12} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Canvas */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
        <Outlet />
      </main>
    </div>
  )
}
