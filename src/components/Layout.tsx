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
  MessageSquare, CheckSquare, Brain,
  BarChart3, Zap, Settings, LogOut, ChevronsUpDown, Check, LayoutGrid, CalendarDays, Library, Plus, Clock, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRailContent, useRightRailWidth } from '../lib/rightRailContext'
import { supabase } from '../lib/supabase'
import { ErrorBoundary } from './ErrorBoundary'
import { SettingsModal } from './SettingsModal'

// ─── rail item ────────────────────────────────────────────────────────────
// SAM treatment: icon + label, generous padding. Active = solid coral fill
// with white text/icon (the screenshot's "Sam" item). Inactive = quiet gray.
function RailItem({
  to, icon: Icon, label, badge, onClick,
}: { to: string; icon: React.ElementType; label: string; badge?: number; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      onClick={onClick}
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
// Tiny uppercase group label — gives the rail a felt sequence instead of a flat
// row of equal peers, so a new user can see the order of the work.
function RailLabel({ children }: { children: string }) {
  return (
    <div style={{ padding: '12px 14px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--ghost)' }}>{children}</div>
  )
}

// Recents — the active client's past chats, surfaced in the rail (tester
// request). Clicking one resumes that session: set the per-client session key,
// route to Vera, and signal VeraThread (already-mounted case) to switch.
type RailSession = { session_id: string; title: string | null; last_at: string; message_count: number }
function RailRecents() {
  const { activeProject } = useProject()
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<RailSession[]>([])

  useEffect(() => {
    const pid = activeProject?.id
    if (!pid) { setSessions([]); return }
    let cancelled = false
    const load = () => supabase.rpc('list_chat_sessions', { p_project_id: pid }).then(({ data }) => {
      if (!cancelled) setSessions(((data ?? []) as RailSession[]).slice(0, 5))
    })
    load()
    // Refresh when a chat is started/saved or switched.
    window.addEventListener('vera:home', load)
    window.addEventListener('vera:session', load)
    return () => { cancelled = true; window.removeEventListener('vera:home', load); window.removeEventListener('vera:session', load) }
  }, [activeProject?.id])

  if (!activeProject || sessions.length === 0) return null

  const open = (sid: string) => {
    const target = `/p/${activeProject.slug}/vera`
    try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ }
    if (location.pathname !== target) navigate(target)
    window.dispatchEvent(new CustomEvent('vera:session', { detail: { sid } }))
  }

  return (
    <nav className="space-y-0.5 mt-1">
      <RailLabel>Recents</RailLabel>
      {sessions.map(s => (
        <button key={s.session_id} onClick={() => open(s.session_id)} title={s.title ?? 'Untitled chat'}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 mx-2 transition-colors hover:bg-[var(--fog)]"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)', width: 'calc(100% - 1rem)' }}>
          <Clock size={14} style={{ color: 'var(--ghost)', flexShrink: 0 }} />
          <span className="flex-1 truncate text-left" style={{ fontSize: 13, color: 'var(--ink-quiet)' }}>{s.title || 'Untitled chat'}</span>
        </button>
      ))}
    </nav>
  )
}

function ClientSwitcher() {
  const { activeProject, projects, switchProject } = useProject()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(false)
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
            <button onClick={() => { setOpen(false); setNewClientOpen(true) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 }}>
              <Plus size={13} /> New client
            </button>
            <button onClick={() => { setOpen(false); navigate('/clients') }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: 'var(--ghost)' }}>
              <LayoutGrid size={13} /> View all clients
            </button>
          </div>
        </>
      )}
      {newClientOpen && <NewClientModal onClose={() => setNewClientOpen(false)} />}
    </div>
  )
}

// New client = a sub-workspace (project) under the current tenant (org). Projects
// are writable, so this sidesteps the organizations-RLS wall the old org-per-
// client wizard hit. (Inviting a client user, or a new tenant owner, is the
// separate access layer.) Lands in the client's Brain to set it up.
function NewClientModal({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useOrg()
  const { refetch } = useProject()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || !activeOrg?.id || saving) return
    setSaving(true); setErr(null)
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client'
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    const { error } = await supabase.from('projects').insert({
      org_id: activeOrg.id, name: name.trim(), slug,
      description: website.trim() || null, is_default: false, is_starred: false, is_archived: false,
    })
    if (error) { setErr(error.message); setSaving(false); return }
    refetch()
    onClose()
    navigate(`/p/${slug}/brain`)
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxSizing: 'border-box' }
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(20,20,22,0.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, 94vw)', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-modal)', padding: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>New client</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 16px', lineHeight: 1.5 }}>A sub-workspace under {activeOrg?.name ?? 'your workspace'} — its own brain, content, and calendar.</p>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>Client name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp"
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>Website <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://acme.com"
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={inputStyle} />
        {err && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={create} disabled={saving || !name.trim()}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: saving ? 'wait' : 'pointer', opacity: (!name.trim() || saving) ? 0.6 : 1, boxShadow: 'var(--shadow-glow)' }}>
            {saving ? 'Creating…' : 'Create client'}
          </button>
        </div>
      </div>
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  // Right rail can be collapsed (e.g. to give the conversation full width);
  // the choice persists across navigations + reloads.
  const [railOpen, setRailOpen] = useState(() => { try { return localStorage.getItem('vera-rail-open') !== '0' } catch { return true } })
  const toggleRail = (open: boolean) => { setRailOpen(open); try { localStorage.setItem('vera-rail-open', open ? '1' : '0') } catch { /* ignore */ } }

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

        {/* Primary nav — grouped into the felt sequence of the work: create in
            Vera → move it through the Pipeline (approve → schedule → archive) →
            the Client's brain + how it's landing. Kills the flat-peer trap. */}
        <nav className="pt-1 space-y-0.5">
          <RailItem to={p('vera')}      icon={MessageSquare}   label="Vera" onClick={() => window.dispatchEvent(new CustomEvent('vera:home'))} />

          <RailLabel>Pipeline</RailLabel>
          <RailItem to={p('review')}    icon={CheckSquare}     label="Review" badge={pendingCount} />
          <RailItem to={p('calendar')}  icon={CalendarDays}    label="Calendar" />
          <RailItem to={p('artifacts')} icon={Library}         label="Artifacts" />

          <RailLabel>Client</RailLabel>
          <RailItem to={p('brain')}     icon={Brain}           label="Brain" />
          <RailItem to={p('measure')}   icon={BarChart3}       label="Measure" />
        </nav>

        <RailRecents />

        <div className="flex-1" />

        {/* Utility group — mirrors SAM's AI Settings · Settings · user. */}
        {/* Settings opens as a modal (SAM pattern), not a page nav. */}
        <nav className="space-y-0.5 pb-1">
          <RailItem to="/skills" icon={Zap} label="AI Settings" />
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 mx-2 transition-colors hover:bg-[var(--fog)]"
            style={{ background: 'transparent', color: 'var(--ink-quiet)', fontWeight: 450, fontSize: 14, borderRadius: 'var(--radius-md)', width: 'calc(100% - 1rem)' }}
          >
            <Settings size={17} strokeWidth={1.75} style={{ color: 'var(--ghost)', flexShrink: 0 }} />
            <span className="flex-1 text-left truncate">Settings</span>
          </button>
        </nav>

        {/* Signed-in user — click for an always-visible menu with Log out. */}
        <div className="px-2 pb-3 pt-1" style={{ position: 'relative' }}>
          {userMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setUserMenuOpen(false)} />
              <div style={{ position: 'absolute', left: 8, right: 8, bottom: '100%', marginBottom: 6, zIndex: 40, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-pop)', padding: 4 }}>
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ghost)', borderBottom: '1px solid var(--line)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.email ?? 'Not signed in'}
                </div>
                <button onClick={handleSignOut}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, fontWeight: 500, textAlign: 'left' }}>
                  <LogOut size={14} /> Log out
                </button>
              </div>
            </>
          )}
          <button onClick={() => setUserMenuOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-[var(--fog)]"
            style={{ borderRadius: 'var(--radius-md)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <span className="w-7 h-7 flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: '50%' }}>
              {initials}
            </span>
            <span className="flex-1 truncate text-[13.5px] text-left" style={{ color: 'var(--ink)' }}>{displayName}</span>
            <ChevronsUpDown size={14} style={{ color: 'var(--ghost)', flexShrink: 0 }} />
          </button>
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

      {/* ── Right rail ── a full post preview, supplied via useRightRail.
          Collapsible: a handle on the rail edge hides it; a handle on the
          screen edge brings it back. The choice persists. */}
      {rightRailContent && railOpen && (
        <aside
          className="flex-shrink-0"
          style={{ background: 'transparent', width: rightRailWidth, borderLeft: '1px solid var(--paper-edge)', position: 'relative' }}
        >
          <button onClick={() => toggleRail(false)} title="Hide panel"
            style={{ position: 'absolute', left: -13, top: '50%', transform: 'translateY(-50%)', zIndex: 25, width: 26, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--surface)', color: 'var(--ghost)', cursor: 'pointer', boxShadow: 'var(--shadow-pop)' }}>
            <ChevronRight size={15} />
          </button>
          <div className="overflow-y-auto" style={{ height: '100%' }}>
            {rightRailContent}
          </div>
        </aside>
      )}
      {rightRailContent && !railOpen && (
        <button onClick={() => toggleRail(true)} title="Show panel"
          style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 25, width: 24, height: 46, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRight: 'none', borderTopLeftRadius: 8, borderBottomLeftRadius: 8, background: 'var(--surface)', color: 'var(--ink-quiet)', cursor: 'pointer', boxShadow: 'var(--shadow-pop)' }}>
          <ChevronLeft size={16} />
        </button>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
