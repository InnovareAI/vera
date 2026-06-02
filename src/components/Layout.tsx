// VERA shell. Cream paper + ink + oxblood accent. Single-family Geist —
// hierarchy comes from weight + size + spacing, not from font mixing.
// (Tried Fraunces for display moments; chose to stay monochrome / single-
// font for visual quiet. Linear/Notion/ChatGPT pattern.)
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

import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Star, Sparkles, CheckSquare, BookOpen, Plus,
  Settings, LogOut, Sun, Moon,
  ChevronDown, Check, Monitor,
  BarChart3, FolderOpen, MessagesSquare, Brain,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRailContent, useRightRailWidth } from '../lib/rightRailContext'
import { useTheme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import { ErrorBoundary } from './ErrorBoundary'

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

// ─── rail section heading — LIGHT treatment ──────────────────────────────
// Smaller (10px), tighter letter-spacing, ghost color. Disappears into the
// background unless you're looking for it. Hierarchy via spacing + type
// weight, not decoration.
function RailSection({ label, count }: { label: string; count?: number }) {
  return (
    <div className="px-4 pt-5 pb-1.5 flex items-baseline gap-1.5">
      <span
        className="text-[10px] font-medium uppercase"
        style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}
      >
        {label}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-[10px]" style={{ color: 'var(--mist)' }}>{count}</span>
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
        // Active item carries SAM's coral: soft coral wash + coral text/icon.
        background: isActive ? 'var(--accent-tint)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--ink-quiet)',
        fontWeight: isActive ? 600 : 400,
        borderRadius: 'var(--radius-md)',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={15} style={{ color: isActive ? 'var(--accent)' : 'var(--ghost)' }} className="flex-shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
          <span className="flex-1">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="text-[11px] px-1.5 leading-tight py-px"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--paper-edge)',
                color: isActive ? '#fff' : 'var(--ink-quiet)',
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

// ─── project rail item ───────────────────────────────────────────────────
// Tighter than RailItem — projects are *primary* nav, not artifacts.
// Active state highlights with --fog; star icon for starred projects,
// folder for everything else. Clicking switches the active project
// (URL doesn't change in Phase 1; pages don't filter by project yet).
function ProjectRailItem({
  name, description, isStarred, isActive, onClick,
}: {
  name: string; description: string | null; isStarred: boolean;
  isActive: boolean; onClick: () => void;
}) {
  const Icon = isStarred ? Star : FolderOpen
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-start gap-2 mx-2 px-2 py-1.5 transition-colors text-left hover:bg-[var(--fog)]"
      style={{
        borderRadius: 'var(--radius-md)',
        background: isActive ? 'var(--fog)' : 'transparent',
        width: 'calc(100% - 1rem)',
      }}
    >
      <Icon
        size={12}
        className="flex-shrink-0 mt-0.5"
        style={{ color: isActive ? 'var(--ink)' : 'var(--mist)' }}
        strokeWidth={isActive ? 2 : 1.75}
        fill={isStarred && isActive ? 'currentColor' : 'none'}
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-[12.5px] leading-snug truncate"
          style={{
            color: isActive ? 'var(--ink)' : 'var(--ink-quiet)',
            fontWeight: isActive ? 500 : 400,
          }}
        >
          {name}
        </div>
        {description && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--mist)' }}>
            {description}
          </div>
        )}
      </div>
    </button>
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


// ─── layout ──────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, signOut } = useAuth()
  const { activeOrg } = useOrg()
  const { activeProject, starredProjects, recentProjects, switchProject, refetch: refetchProjects } = useProject()
  const { theme, setTheme } = useTheme()
  const rightRailContent = useRightRailContent()
  const rightRailWidth = useRightRailWidth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)
  const [newProjOpen, setNewProjOpen] = useState(false)

  // The rail now needs exactly one live number: the Review badge —
  // pending/draft posts in the active project. Everything else the rail
  // used to load (pinned campaigns, recent posts, anchors) moved to the
  // Home + Review surfaces per the workflow blueprint.
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

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'V'

  // Build the right URL for a project-scoped section. When a project is
  // active, all project-scoped pages live under /p/:slug. Otherwise we
  // fall back to the legacy flat route (which redirects via
  // RedirectFlatToProject once a project exists).
  const projectPath = (section: string) =>
    activeProject ? `/p/${activeProject.slug}/${section}` : `/${section}`

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'transparent' }}>
      {/* Rail — transparent so the body's coral glow (SAM atmosphere) reads   */}
      {/* through it. Content surfaces (cards, main) stay opaque paper.         */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col"
        style={{
          background: 'transparent',
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

        {/* + New client — primary CTA. Opens the project-create modal.    */}
        {/* (Was "New brief"; briefing now happens in the VERA thread.)    */}
        <div className="px-2 pt-3">
          <button
            onClick={() => setNewProjOpen(true)}
            className="w-full inline-flex items-center gap-2 px-3 py-2 transition-opacity hover:opacity-90"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper-warm)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <Plus size={14} strokeWidth={2.25} />
            <span className="text-[13px] font-medium">New client</span>
          </button>
        </div>

        {/* ── THE SHELF — clients scroll here (altitude 1) ──────────────── */}
        <div className="flex-1 overflow-y-auto pt-2">
          {starredProjects.length > 0 && (
            <>
              <RailSection label="Starred" count={starredProjects.length} />
              {starredProjects.map(p => (
                <ProjectRailItem
                  key={p.id}
                  name={p.name}
                  description={p.description}
                  isStarred={true}
                  isActive={activeProject?.id === p.id}
                  onClick={() => { switchProject(p.slug); navigate(`/p/${p.slug}/dashboard`) }}
                />
              ))}
            </>
          )}
          {recentProjects.length > 0 && (
            <>
              <RailSection label="Recent" />
              {recentProjects.map(p => (
                <ProjectRailItem
                  key={p.id}
                  name={p.name}
                  description={p.description}
                  isStarred={false}
                  isActive={activeProject?.id === p.id}
                  onClick={() => { switchProject(p.slug); navigate(`/p/${p.slug}/dashboard`) }}
                />
              ))}
            </>
          )}
        </div>

        {/* ── THE DESK — the active client's loop ───────────────────────── */}
        {/* Pinned above the footer. The label names the active client so   */}
        {/* the six items below it read clearly as "this client's loop" —   */}
        {/* not floating verbs disconnected from the client list above.     */}
        <nav
          className="pt-2 pb-2 space-y-0.5"
          style={{ borderTop: '1px solid var(--paper-edge)' }}
        >
          {activeProject && (
            <div className="px-4 pt-1 pb-1.5 flex items-center gap-1.5">
              <span
                className="text-[10px] font-medium uppercase truncate"
                style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}
                title={activeProject.name}
              >
                {activeProject.name}
              </span>
            </div>
          )}
          <PrimaryNavItem to={projectPath('dashboard')} icon={Sparkles}      label="Home" />
          <PrimaryNavItem to={projectPath('vera')}      icon={MessagesSquare} label="VERA" />
          <PrimaryNavItem to={projectPath('review')}    icon={CheckSquare}   label="Review" badge={pendingCount} />
          <PrimaryNavItem to={projectPath('knowledge')} icon={BookOpen}      label="Knowledge" />
          <PrimaryNavItem to={projectPath('brain')}     icon={Brain}         label="Brain" />
          <PrimaryNavItem to={projectPath('measure')}   icon={BarChart3}     label="Measure" />
        </nav>

        {/* Footer — Settings + theme + user. No border — separation by   */}
        {/* whitespace alone, matching the light-rails treatment.           */}
        <div
          className="px-2 pt-3 pb-2 mt-2 flex items-center gap-1"
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

      {/* Center + right rail. The center column is just the canvas — there  */}
      {/* is NO global chat dock. Conversation lives on the VERA tab as the   */}
      {/* 3-pane surface (rail · thread · draft artifact), so we never get    */}
      {/* two composers on one page. Right rail renders only when a page      */}
      {/* provides content via the useRightRail() hook.                       */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <main className="flex-1 overflow-y-auto min-h-0" style={{ background: 'var(--paper)' }}>
          <ErrorBoundary variant="route" resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Right rail — same light treatment as the left rail. Same bg as    */}
      {/* canvas, no border. Pages opt in via useRightRail(content, deps,    */}
      {/* width). Width is per-consumer: narrow for a count sidebar, wide    */}
      {/* for the VERA draft artifact.                                       */}
      {rightRailContent && (
        <aside
          className="flex-shrink-0 overflow-y-auto"
          style={{ background: 'transparent', width: rightRailWidth, borderLeft: '1px solid var(--paper-edge)' }}
        >
          {rightRailContent}
        </aside>
      )}

      {newProjOpen && activeOrg && (
        <NewProjectModal
          orgId={activeOrg.id}
          onClose={() => setNewProjOpen(false)}
          onCreated={(slug) => {
            setNewProjOpen(false)
            refetchProjects()
            switchProject(slug)
          }}
        />
      )}
    </div>
  )
}

// ─── NewProjectModal — minimal create flow ───────────────────────────────
// Just name + description. Slug auto-generated from name. Custom
// instructions + brand voice + knowledge are configured later from the
// project settings page (Phase 3). Idea: low-friction creation so the
// operator can spin up "Coca Cola exercise" in 5 seconds without first
// filling out a config form.
function NewProjectModal({
  orgId, onClose, onCreated,
}: { orgId: string; onClose: () => void; onCreated: (slug: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      let slug = slugify(trimmed) || 'project'
      // Collision-safe slug: append -2, -3, ... if needed
      const { data: existing } = await supabase
        .from('projects')
        .select('slug')
        .eq('org_id', orgId)
        .ilike('slug', `${slug}%`)
      const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
      if (taken.has(slug)) {
        let n = 2
        while (taken.has(`${slug}-${n}`)) n++
        slug = `${slug}-${n}`
      }
      const { error: insErr } = await supabase
        .from('projects')
        .insert({
          org_id: orgId,
          name: trimmed,
          slug,
          description: description.trim() || null,
        })
      if (insErr) throw new Error(insErr.message)
      onCreated(slug)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose} style={{ background: 'rgba(0,0,0,0.32)' }}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md p-6"
        style={{
          background: 'var(--paper-warm)',
          border: '1px solid var(--paper-edge)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 60px -16px rgba(0,0,0,0.25)',
        }}
      >
        <h2 className="text-[16px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>New project</h2>
        <p className="text-[12.5px] mb-5" style={{ color: 'var(--ghost)' }}>
          Bounded scope for a brand, prospect, exercise, or internal stream. You can add instructions, knowledge, and a brand voice from settings.
        </p>
        <label className="block">
          <span className="text-[12px] font-medium block mb-1.5" style={{ color: 'var(--ink-quiet)' }}>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={onKey}
            placeholder="Coca Cola — style exercise"
            className="input w-full"
          />
        </label>
        <label className="block mt-3">
          <span className="text-[12px] font-medium block mb-1.5" style={{ color: 'var(--ink-quiet)' }}>Description <span style={{ color: 'var(--mist)' }}>(optional)</span></span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={onKey}
            placeholder="Benchmark vs millennial-targeted CPG"
            className="input w-full"
          />
        </label>
        {error && (
          <p className="mt-3 text-[12px] px-3 py-2" style={{ color: 'var(--accent)', background: 'var(--accent-tint)', border: '1px solid var(--accent-rule)', borderRadius: 'var(--radius-sm)' }}>
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] font-medium hover:opacity-80"
            style={{ color: 'var(--ink-quiet)' }}
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={!name.trim() || busy}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
          >
            {busy ? 'Creating…' : 'Create'}
            <span className="text-[11px] opacity-60 ml-1">⌘↩</span>
          </button>
        </div>
      </div>
    </div>
  )
}
