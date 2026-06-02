// VERA shell — modeled on SAM's layout (sam.innovareai.com):
//   · narrow white left rail: the AI ("Vera") at top, a flat icon+label nav,
//     a spacer, then a utility group + the signed-in user
//   · the active item carries a SOLID coral fill (SAM's hallmark)
//   · center is just the canvas (<Outlet/>) — the conversation lives on the
//     Vera tab as the 3-pane surface
//   · right rail = a full post preview, supplied by the page via useRightRail
//
// Labels are VERA's content-side equivalents of SAM's sales rail.

import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  MessageSquare, CheckSquare, BookOpen, Brain,
  BarChart3, Zap, Settings, LogOut, ChevronsUpDown, Check, LayoutGrid,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRailContent, useRightRailWidth } from '../lib/rightRailContext'
import { supabase } from '../lib/supabase'
import { ErrorBoundary } from './ErrorBoundary'

// ─── rail item ────────────────────────────────────────────────────────────
// SAM treatment: icon + label, generous padding. Active = solid coral fill
// with white text/icon (the screenshot's "Sam" item). Inactive = quiet gray.
function RailItem({
  to, icon: Icon, label, badge,
}: { to: string; icon: React.ElementType; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      className="flex items-center gap-2.5 px-2.5 py-2 mx-2 transition-colors"
      style={({ isActive }) => ({
        background: isActive ? 'var(--accent)' : 'transparent',
        color: isActive ? '#fff' : 'var(--ink-quiet)',
        fontWeight: isActive ? 600 : 450,
        fontSize: 14,
        borderRadius: 'var(--radius-md)',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={17} strokeWidth={isActive ? 2.1 : 1.75}
            style={{ color: isActive ? '#fff' : 'var(--ghost)', flexShrink: 0 }} />
          <span className="flex-1 truncate">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="text-[11px] px-1.5 leading-tight py-px"
              style={{
                background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--accent-tint)',
                color: isActive ? '#fff' : 'var(--accent)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
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

// ─── client switcher ──────────────────────────────────────────────────────
// Top-of-rail workspace switcher (Slack/Linear pattern). For an agency tool
// the active CLIENT must always be visible — you never draft for the wrong
// brand. Shows the active client + a dropdown to switch; "View all clients"
// opens the shelf.
function ClientSwitcher() {
  const { activeProject, projects, switchProject } = useProject()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const name = activeProject?.name ?? 'Select client'
  const glyph = (s: string) => (s.trim()[0] ?? 'C').toUpperCase()

  return (
    <div style={{ position: 'relative', padding: '12px 8px 4px' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{glyph(name)}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <ChevronsUpDown size={14} style={{ color: 'var(--ghost)', flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', left: 8, right: 8, top: '100%', marginTop: 4, zIndex: 40, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-pop)', padding: 4, maxHeight: 380, overflowY: 'auto' }}>
            {projects.map(p => {
              const active = p.id === activeProject?.id
              return (
                <button key={p.id} onClick={() => { switchProject(p.slug); setOpen(false) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none', background: active ? 'var(--accent-tint)' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: active ? 'var(--accent)' : 'var(--fog)', color: active ? '#fff' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{glyph(p.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {active && <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                </button>
              )
            })}
            <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
            <button onClick={() => { setOpen(false); navigate('/clients') }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: 'var(--ghost)' }}>
              <LayoutGrid size={13} /> View all clients
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── layout ──────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, signOut } = useAuth()
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const rightRailContent = useRightRailContent()
  const rightRailWidth = useRightRailWidth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)

  // One live number in the rail: the Review badge (pending/draft posts in the
  // active project).
  useEffect(() => {
    if (!activeOrg?.id) { setPendingCount(0); return }
    let q = supabase.from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id)
      .in('status', ['Pending Review', 'pending', 'Draft', 'draft'])
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ count, error }) => setPendingCount(error ? 0 : (count ?? 0)))
  }, [activeOrg?.id, activeProject?.id])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Active project scopes the desk routes; fall back to the flat route.
  const p = (section: string) =>
    activeProject ? `/p/${activeProject.slug}/${section}` : `/${section}`

  const name = user?.email?.split('@')[0] ?? 'Account'
  const displayName = name.charAt(0).toUpperCase() + name.slice(1)
  const initials = (user?.email?.slice(0, 2) ?? 'V').toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'transparent' }}>
      {/* ── Left rail (SAM) ── white, narrow, flat nav, user at the bottom */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{ width: 212, background: 'var(--paper-warm)', borderRight: '1px solid var(--paper-edge)' }}
      >
        {/* Active client — top-of-rail switcher (always-visible context). */}
        <ClientSwitcher />

        {/* Primary nav — the AI ("Vera") sits first, like SAM's "Sam". */}
        <nav className="pt-1 space-y-0.5">
          <RailItem to={p('vera')}      icon={MessageSquare}   label="Vera" />
          <RailItem to={p('review')}    icon={CheckSquare}     label="Review" badge={pendingCount} />
          <RailItem to={p('knowledge')} icon={BookOpen}        label="Knowledge" />
          <RailItem to={p('brain')}     icon={Brain}           label="Brain" />
          <RailItem to={p('measure')}   icon={BarChart3}       label="Measure" />
        </nav>

        <div className="flex-1" />

        {/* Utility group — mirrors SAM's AI Settings · Settings · user. */}
        <nav className="space-y-0.5 pb-1">
          <RailItem to="/skills"   icon={Zap}       label="AI Settings" />
          <RailItem to="/settings" icon={Settings}  label="Settings" />
        </nav>

        {/* Signed-in user — avatar + name, sign-out on hover (SAM pattern). */}
        <div className="px-2 pb-3 pt-1">
          <div className="group relative flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-[var(--fog)]"
            style={{ borderRadius: 'var(--radius-md)' }}>
            <span className="w-7 h-7 flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: '50%' }}>
              {initials}
            </span>
            <span className="flex-1 truncate text-[13.5px]" style={{ color: 'var(--ink)' }}>{displayName}</span>
            {user && (
              <button onClick={handleSignOut} title="Sign out"
                className="opacity-0 group-hover:opacity-100 p-1 transition-opacity"
                style={{ color: 'var(--ghost)' }}>
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Center ── the canvas (conversation lives on the Vera tab). */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <main className="flex-1 overflow-y-auto min-h-0" style={{ background: 'var(--paper)' }}>
          <ErrorBoundary variant="route" resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* ── Right rail ── a full post preview, supplied via useRightRail. */}
      {rightRailContent && (
        <aside
          className="flex-shrink-0 overflow-y-auto"
          style={{ background: 'transparent', width: rightRailWidth, borderLeft: '1px solid var(--paper-edge)' }}
        >
          {rightRailContent}
        </aside>
      )}
    </div>
  )
}
