// KAI shell — "Atelier" aesthetic. Cream paper + ink + oxblood accent,
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

import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Star, Clock, Sparkles, CheckSquare, Telescope, BookOpen, Plus,
  Calendar, Layers, Zap, Building2, Settings, LogOut, Sun, Moon,
  ChevronDown, Check, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useTheme } from '../lib/theme'

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
    m.organisations.name.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--paper-warm)] transition-colors text-left group"
        style={{ borderBottom: '1px solid var(--paper-edge)' }}
      >
        <div
          className="w-6 h-6 flex items-center justify-center text-[11px] font-display font-medium flex-shrink-0"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: '3px',
          }}
        >
          {activeOrg?.name?.slice(0, 1).toUpperCase() ?? '◐'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-display font-medium leading-tight truncate" style={{ color: 'var(--ink)' }}>
            {activeOrg?.name ?? 'Select workspace'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] mt-0.5 font-mono" style={{ color: 'var(--ghost)' }}>
            workspace · {orgs.length}
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
              background: 'var(--paper)',
              border: '1px solid var(--paper-edge)',
              boxShadow: '0 12px 32px -8px rgba(14, 14, 15, 0.18)',
              borderRadius: '4px',
            }}
          >
            <input
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search workspaces…"
              className="w-full px-3 py-2.5 text-[12px] outline-none"
              style={{
                background: 'transparent',
                color: 'var(--ink)',
                borderBottom: '1px solid var(--paper-edge)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <div className="max-h-72 overflow-y-auto py-1">
              {matches.map(m => (
                <button
                  key={m.org_id}
                  onClick={() => { switchOrg(m.org_id); setOpen(false); setFilter('') }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--paper-warm)] transition-colors text-left"
                >
                  <div
                    className="w-5 h-5 flex items-center justify-center text-[10px] font-display font-medium flex-shrink-0"
                    style={{
                      background: m.org_id === activeOrg?.id ? 'var(--oxblood)' : 'var(--fog)',
                      color: m.org_id === activeOrg?.id ? 'var(--paper)' : 'var(--ink)',
                      borderRadius: '3px',
                    }}
                  >
                    {m.organisations.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] truncate" style={{ color: 'var(--ink)' }}>{m.organisations.name}</div>
                    <div className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--ghost)' }}>{m.role}</div>
                  </div>
                  {m.org_id === activeOrg?.id && (
                    <Check size={11} style={{ color: 'var(--oxblood)' }} className="flex-shrink-0" />
                  )}
                </button>
              ))}
              {matches.length === 0 && (
                <div className="px-3 py-3 text-[11px] font-mono" style={{ color: 'var(--ghost)' }}>
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
// Em-dash typographic divider — the "notebook spread" detail. Hairline above.
function RailSection({ label, count }: { label: string; count?: number }) {
  return (
    <div className="px-4 pt-5 pb-1.5 flex items-baseline gap-2">
      <span className="text-[9px] uppercase tracking-[0.18em] font-mono" style={{ color: 'var(--ghost)' }}>
        — {label}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-[9px] font-mono" style={{ color: 'var(--mist)' }}>· {count}</span>
      )}
      <span className="flex-1 h-px rule-oxblood mt-1 ml-2" />
    </div>
  )
}

// ─── primary nav item ────────────────────────────────────────────────────
function PrimaryNavItem({
  to, icon: Icon, label, badge,
}: { to: string; icon: React.ElementType; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-4 py-2 text-[13px] transition-all group ${
          isActive ? 'is-active' : ''
        }`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--oxblood-tint)' : 'transparent',
        color: isActive ? 'var(--ink)' : 'var(--ink-quiet)',
        fontWeight: isActive ? 500 : 400,
      })}
    >
      {({ isActive }) => (
        <>
          {/* oxblood left-edge bar when active — the "you are here" mark */}
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px]"
            style={{ background: isActive ? 'var(--oxblood)' : 'transparent' }}
          />
          <Icon size={14} style={{ color: isActive ? 'var(--oxblood)' : 'var(--ghost)' }} className="flex-shrink-0" />
          <span className="flex-1">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="text-[10px] font-mono px-1.5 py-px"
              style={{
                background: isActive ? 'var(--oxblood)' : 'var(--paper-edge)',
                color: isActive ? 'var(--paper)' : 'var(--ink-quiet)',
                borderRadius: '2px',
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
function RailItem({
  to, icon: Icon, title, meta,
}: { to: string; icon?: React.ElementType; title: string; meta?: string }) {
  return (
    <NavLink
      to={to}
      className="group flex items-start gap-2 px-4 py-1.5 hover:bg-[var(--paper-warm)] transition-colors"
    >
      {Icon && (
        <Icon size={11} style={{ color: 'var(--mist)' }} className="flex-shrink-0 mt-1 group-hover:text-[var(--oxblood)] transition-colors" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] leading-snug truncate" style={{ color: 'var(--ink-quiet)' }}>
          {title}
        </div>
        {meta && (
          <div className="text-[10px] uppercase tracking-wider font-mono mt-0.5 truncate" style={{ color: 'var(--mist)' }}>
            {meta}
          </div>
        )}
      </div>
    </NavLink>
  )
}

// ─── mock data for pinned + recent ───────────────────────────────────────
// These will get wired to real schema in a follow-up. Visual treatment
// locked in first; data shape locked in by what these items want to express.
const MOCK_PINNED = [
  { id: 'p1', to: '/library?campaign=q1-linkedin',   title: 'Q1 LinkedIn campaign', meta: '12 posts · 4 pending' },
  { id: 'p2', to: '/library?campaign=weekly-news',   title: 'Weekly newsletter',    meta: 'next: Mar 18' },
  { id: 'p3', to: '/library?campaign=fashion-pitch', title: 'NIVEA fashion pitch',  meta: '6 assets · drafting' },
]
const MOCK_RECENT = [
  { id: 'r1', to: '/review',              title: 'Why AI BDRs win on velocity', meta: 'post · 2h' },
  { id: 'r2', to: '/library',             title: 'Jellyfish 10s commercial',    meta: 'video · 3h' },
  { id: 'r3', to: '/dashboard',           title: 'Newsletter audit — March',    meta: 'audit · 5h' },
  { id: 'r4', to: '/library',             title: 'InnovareAI brand voice v3',   meta: 'voice · 1d' },
  { id: 'r5', to: '/review',              title: 'LinkedIn post · Filipino…',   meta: 'draft · 1d' },
]

// ─── layout ──────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, signOut } = useAuth()
  const { activeOrg, activeRole } = useOrg()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

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
        className="w-60 flex-shrink-0 flex flex-col"
        style={{
          background: 'var(--paper)',
          borderRight: '1px solid var(--paper-edge)',
        }}
      >
        {/* Brand mark — typographic, not iconic */}
        <div className="px-4 pt-5 pb-3 flex items-baseline gap-2">
          <span className="font-display text-[22px] leading-none tracking-tight" style={{ color: 'var(--ink)', fontVariationSettings: '"opsz" 144, "wght" 500' }}>
            kai
          </span>
          <span className="text-[9px] uppercase tracking-[0.16em] font-mono" style={{ color: 'var(--ghost)' }}>
            by InnovareAI
          </span>
        </div>

        {/* Workspace switcher */}
        <WorkspaceSwitcher />

        {/* + Brief CTA — primary action, oxblood block */}
        <div className="px-3 pt-3">
          <button
            onClick={() => navigate('/generate')}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 transition-all hover:opacity-95"
            style={{
              background: 'var(--oxblood)',
              color: 'var(--paper)',
              borderRadius: '3px',
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              <span className="text-[12px] font-medium tracking-wide">New brief</span>
            </span>
            <span className="text-[10px] font-mono opacity-60 uppercase tracking-wider">⌘N</span>
          </button>
        </div>

        {/* Primary nav */}
        <nav className="pt-3 pb-1">
          <PrimaryNavItem to="/dashboard"  icon={Sparkles}    label="Overview" />
          <PrimaryNavItem to="/review"     icon={CheckSquare} label="Review" badge={4} />
          <PrimaryNavItem to="/audit"      icon={Telescope}   label="Audit" />
          <PrimaryNavItem to="/library"    icon={BookOpen}    label="Library" />
        </nav>

        {/* Scrolling middle — pinned + recent + more */}
        <div className="flex-1 overflow-y-auto">
          <RailSection label="pinned" count={MOCK_PINNED.length} />
          {MOCK_PINNED.map(p => (
            <RailItem key={p.id} to={p.to} icon={Star} title={p.title} meta={p.meta} />
          ))}

          <RailSection label="recent" />
          {MOCK_RECENT.map(r => (
            <RailItem key={r.id} to={r.to} icon={Clock} title={r.title} meta={r.meta} />
          ))}

          {/* More — collapsed secondary routes */}
          <div className="px-4 pt-5 pb-1">
            <button
              onClick={() => setMoreOpen(o => !o)}
              className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] font-mono hover:opacity-80"
              style={{ color: 'var(--ghost)' }}
            >
              <ChevronRight size={9} className={`transition-transform ${moreOpen ? 'rotate-90' : ''}`} />
              — more
            </button>
          </div>
          {moreOpen && (
            <div className="pb-2">
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
          className="px-3 py-2.5 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--paper-edge)' }}
        >
          <NavLink
            to="/settings"
            className="flex items-center gap-2 flex-1 px-1.5 py-1 hover:bg-[var(--paper-warm)] rounded-sm transition-colors text-[12px]"
            style={{ color: 'var(--ink-quiet)' }}
          >
            <Settings size={13} style={{ color: 'var(--ghost)' }} />
            <span>Settings</span>
          </NavLink>
          <button
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className="p-1.5 hover:bg-[var(--paper-warm)] rounded-sm transition-colors"
          >
            {theme === 'dark'
              ? <Sun size={13} style={{ color: 'var(--ghost)' }} />
              : <Moon size={13} style={{ color: 'var(--ghost)' }} />}
          </button>
          <div className="group relative">
            <button
              className="w-6 h-6 flex items-center justify-center text-[9px] font-mono uppercase tracking-wider"
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
