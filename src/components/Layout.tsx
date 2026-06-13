// VERA shell — modeled on SAM's layout (sam.innovareai.com):
//   · narrow white left rail: the AI ("Vera") at top, a flat icon+label nav,
//     a spacer, then a utility group + the signed-in user
//   · the active item carries a SOLID coral fill (SAM's hallmark)
//   · center is just the canvas (<Outlet/>) — the conversation lives on the
//     Vera tab as the 3-pane surface
//   · right rail = a full post preview, supplied by the page via useRightRail
//
// Labels are VERA's content-side equivalents of SAM's sales rail.

import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  MessageSquare, Brain,
  BarChart3, TrendingUp, Zap, Settings, LogOut, ChevronsUpDown, Check, LayoutGrid, CalendarDays, Library, Plus, Clock, ChevronRight, ChevronLeft, KeyRound,
  FolderOpen, Edit3, PanelLeft, MoreHorizontal, HelpCircle, Bell,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useRightRailContent, useRightRailWidth } from '../lib/rightRailContext'
import { supabase } from '../lib/supabase'
import { ErrorBoundary } from './ErrorBoundary'
import { SettingsModal } from './SettingsModal'
import {
  EMPTY_BUSINESS_CONTEXT,
  compactProjectDescription,
  mergeProjectInstructions,
  type BusinessContext,
} from '../lib/businessContext'

function IconRailItem({
  to, icon: Icon, label, onClick, accent = '#5ee37d',
}: { to: string; icon: React.ElementType; label: string; onClick?: () => void; accent?: string }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="transition-colors"
      style={({ isActive }) => ({
        width: 48,
        height: 48,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        background: isActive ? `${accent}2e` : 'transparent',
        color: isActive ? '#f8fbf8' : 'rgba(230,238,235,0.78)',
        border: isActive ? `1px solid ${accent}55` : '1px solid transparent',
      })}
    >
      {({ isActive }) => (
        <Icon size={22} strokeWidth={isActive ? 2.25 : 1.85} style={{ color: isActive ? accent : undefined }} />
      )}
    </NavLink>
  )
}

function IconRailButton({
  icon: Icon, label, onClick, alert,
}: { icon: React.ElementType; label: string; onClick: () => void; alert?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="transition-colors"
      style={{
        width: 48,
        height: 48,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        background: 'transparent',
        border: '1px solid transparent',
        color: 'rgba(230,238,235,0.78)',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <Icon size={21} strokeWidth={1.85} />
      {alert && <span style={{ position: 'absolute', right: 11, top: 10, width: 7, height: 7, borderRadius: 99, background: '#f05252', border: '1px solid #13201f' }} />}
    </button>
  )
}

function SideNavRow({
  to, icon: Icon, label, badge, accent = '#5ee37d',
}: { to: string; icon?: React.ElementType; label: string; badge?: number; accent?: string }) {
  return (
    <NavLink
      to={to}
      className="flex items-center gap-2.5 transition-colors"
      style={({ isActive }) => ({
        minHeight: 40,
        padding: Icon ? '8px 10px' : '8px 12px',
        borderRadius: 8,
        background: isActive ? 'rgba(255,255,255,0.20)' : 'transparent',
        color: isActive ? '#f7fbf8' : 'rgba(236,242,240,0.86)',
        border: '1px solid transparent',
        boxShadow: isActive ? `inset 3px 0 0 ${accent}` : 'none',
        fontSize: 14,
        fontWeight: isActive ? 650 : 500,
        textDecoration: 'none',
      })}
    >
      {({ isActive }) => (
        <>
          {Icon && <Icon size={17} strokeWidth={isActive ? 2.25 : 1.85} style={{ flexShrink: 0, color: isActive ? accent : 'rgba(210,222,218,0.72)' }} />}
          <span className="flex-1 truncate">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span style={{ minWidth: 20, height: 20, padding: '0 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: isActive ? 'rgba(255,255,255,0.24)' : '#2a61d6', color: '#fff', fontSize: 11, fontWeight: 700 }}>
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function SideNavAction({
  icon: Icon, label, badge, onClick, indent = false, accent = 'rgba(210,222,218,0.68)',
}: { icon?: React.ElementType; label: string; badge?: number; onClick: () => void; indent?: boolean; accent?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 transition-colors"
      style={{
        minHeight: 38,
        padding: indent ? '7px 10px 7px 34px' : (Icon ? '7px 10px' : '7px 12px'),
        borderRadius: 8,
        background: 'transparent',
        border: 'none',
        color: 'rgba(236,242,240,0.82)',
        fontSize: 13.5,
        fontWeight: 500,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {Icon && <Icon size={16} strokeWidth={1.8} style={{ flexShrink: 0, color: accent }} />}
      <span className="flex-1 truncate">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span style={{ minWidth: 20, height: 20, padding: '0 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(255,255,255,0.13)', color: '#fff', fontSize: 11, fontWeight: 700 }}>
          {badge}
        </span>
      )}
    </button>
  )
}

function SideNavGroup({
  label, onAdd,
}: { label: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center gap-2" style={{ padding: '12px 10px 4px' }}>
      <ChevronRight size={14} style={{ transform: 'rotate(90deg)', color: 'rgba(210,222,218,0.82)', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13.5, color: '#f3f8f5', fontWeight: 700 }}>{label}</span>
      {onAdd && (
        <button type="button" onClick={onAdd} title={`Add ${label.toLowerCase()}`} aria-label={`Add ${label.toLowerCase()}`}
          style={{ width: 24, height: 24, borderRadius: 7, border: 'none', background: 'transparent', color: 'rgba(236,242,240,0.86)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Plus size={16} />
        </button>
      )}
    </div>
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
    <div style={{ padding: '10px 14px 3px', fontSize: 9.5, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: 'var(--ghost)' }}>{children}</div>
  )
}

// Recents — the active client's past chats, surfaced in the rail (tester
// request). Clicking one resumes that session: set the per-client session key,
// route to Vera, and signal VeraThread (already-mounted case) to switch.
type RailSession = { session_id: string; title: string | null; last_at: string; message_count: number }
const RECENT_TITLE_MAX = 42
function compactRecentTitle(raw: string | null) {
  const title = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!title) return 'Untitled chat'
  if (title.length <= RECENT_TITLE_MAX) return title
  return `${title.slice(0, RECENT_TITLE_MAX - 3).trimEnd()}...`
}

function localRailSessions(projectId: string): RailSession[] {
  const prefix = `vera-chat-session:${projectId}:`
  const sessions: RailSession[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<RailSession>
      if (!parsed.session_id) continue
      sessions.push({
        session_id: parsed.session_id,
        title: parsed.title ?? null,
        last_at: parsed.last_at ?? new Date(0).toISOString(),
        message_count: parsed.message_count ?? 0,
      })
    }
  } catch {
    return []
  }
  return sessions.sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, 5)
}

function mergeRailSessions(remote: RailSession[], local: RailSession[]) {
  const byId = new Map<string, RailSession>()
  for (const session of [...local, ...remote]) {
    const existing = byId.get(session.session_id)
    if (!existing || session.last_at > existing.last_at || (!existing.title && session.title)) {
      byId.set(session.session_id, session)
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, 5)
}

function RailRecents({ tone = 'light' }: { tone?: 'light' | 'dark' } = {}) {
  const { activeProject } = useProject()
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<RailSession[]>([])
  const dark = tone === 'dark'

  useEffect(() => {
    const pid = activeProject?.id
    if (!pid) { queueMicrotask(() => setSessions([])); return }
    let cancelled = false
    const load = () => {
      const local = localRailSessions(pid)
      setSessions(local)
      supabase.rpc('list_chat_sessions', { p_project_id: pid })
        .then(({ data, error }) => {
          if (cancelled) return
          const remote = error ? [] : ((data ?? []) as RailSession[])
          setSessions(mergeRailSessions(remote, localRailSessions(pid)))
        }, () => {
          if (!cancelled) setSessions(localRailSessions(pid))
        })
    }
    load()
    // Refresh when a chat is started/saved or switched.
    window.addEventListener('vera:home', load)
    window.addEventListener('vera:session', load)
    return () => { cancelled = true; window.removeEventListener('vera:home', load); window.removeEventListener('vera:session', load) }
  }, [activeProject?.id])

  if (!activeProject) return null

  const open = (sid: string) => {
    const target = `/p/${activeProject.slug}/vera`
    try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ }
    if (location.pathname !== target) navigate(target)
    window.dispatchEvent(new CustomEvent('vera:session', { detail: { sid } }))
  }

  // Start a fresh conversation. On the Vera page, fire vera:home so the open
  // thread resets in place; from elsewhere, seed a new session id and navigate
  // in (VeraThread reads this key on mount) so we land on an empty thread.
  const startNew = () => {
    const target = `/p/${activeProject.slug}/vera`
    if (location.pathname === target) {
      window.dispatchEvent(new CustomEvent('vera:home'))
    } else {
      const sid = crypto.randomUUID()
      try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ }
      navigate(target)
    }
  }

  return (
    <nav className="space-y-0.5 mt-1">
      <button onClick={startNew} title="Start a new conversation"
        className="w-full flex items-center gap-2.5 transition-colors"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8, width: '100%', minHeight: 38, padding: '7px 10px' }}>
        <Plus size={15} style={{ color: dark ? '#6ee78b' : 'var(--accent)', flexShrink: 0 }} />
        <span className="flex-1 truncate text-left" style={{ fontSize: 13, fontWeight: 600, color: dark ? 'rgba(236,242,240,0.82)' : 'var(--ink)' }}>New chat</span>
      </button>
      {sessions.length > 0 && <RailLabel>Recents</RailLabel>}
      {sessions.map(s => {
        const title = compactRecentTitle(s.title)
        return (
          <button key={s.session_id} onClick={() => open(s.session_id)} title={title} aria-label={`Open recent chat: ${title}`}
            className="w-full flex items-center gap-2.5 transition-colors"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8, width: '100%', minHeight: 36, padding: '7px 10px' }}>
            <Clock size={14} style={{ color: dark ? 'rgba(210,222,218,0.68)' : 'var(--ghost)', flexShrink: 0 }} />
            <span className="flex-1 truncate text-left" style={{ fontSize: 13, color: dark ? 'rgba(236,242,240,0.70)' : 'var(--ink-quiet)' }}>{title}</span>
          </button>
        )
      })}
    </nav>
  )
}

function ClientSwitcher({ tone = 'light', compact = false }: { tone?: 'light' | 'dark'; compact?: boolean } = {}) {
  const { activeProject, projects, switchProject } = useProject()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const name = activeProject?.name ?? 'Select space'
  const glyph = (s: string) => (s.trim()[0] ?? 'C').toUpperCase()
  const dark = tone === 'dark'

  return (
    <div style={{ position: 'relative', padding: compact ? 0 : (dark ? '8px 0 6px' : '12px 8px 4px'), width: '100%' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: compact ? 'auto' : '100%',
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 5 : 9,
          padding: compact ? 0 : '8px 9px',
          borderRadius: compact ? 0 : 8,
          border: compact ? 'none' : (dark ? '1px solid rgba(255,255,255,0.10)' : '1px solid var(--line)'),
          background: compact ? 'transparent' : (dark ? 'rgba(255,255,255,0.06)' : 'var(--surface)'),
          cursor: 'pointer',
        }}>
        {!compact && <span style={{ width: 22, height: 22, borderRadius: 6, background: dark ? '#2dbf63' : 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{glyph(name)}</span>}
        <span style={{ flex: compact ? '0 1 auto' : 1, minWidth: 0, textAlign: 'left', fontSize: compact ? 12.5 : 13, fontWeight: compact ? 560 : 650, color: dark ? (compact ? 'rgba(231,241,237,0.62)' : '#f7fbf8') : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact ? `Viewing ${name}` : name}</span>
        <ChevronsUpDown size={compact ? 12 : 14} style={{ color: dark ? 'rgba(226,237,232,0.68)' : 'var(--ghost)', flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', left: dark ? 0 : 8, right: compact ? 'auto' : (dark ? 0 : 8), top: '100%', marginTop: 6, zIndex: 40, width: compact ? 250 : undefined, background: dark ? '#132421' : 'var(--surface)', border: dark ? '1px solid rgba(255,255,255,0.10)' : '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: 4, maxHeight: 380, overflowY: 'auto' }}>
            {projects.map(p => {
              const active = p.id === activeProject?.id
              return (
                <button key={p.id} onClick={() => { switchProject(p.slug); setOpen(false) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 8, border: 'none', background: active ? (dark ? 'rgba(255,255,255,0.14)' : 'var(--accent-tint)') : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: active ? (dark ? '#2dbf63' : 'var(--accent)') : (dark ? 'rgba(255,255,255,0.10)' : 'var(--fog)'), color: active || dark ? '#fff' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{glyph(p.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: dark ? '#f7fbf8' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {active && <Check size={13} style={{ color: dark ? '#6ee78b' : 'var(--accent)', flexShrink: 0 }} />}
                </button>
              )
            })}
            <div style={{ height: 1, background: dark ? 'rgba(255,255,255,0.10)' : 'var(--line)', margin: '4px 0' }} />
            <button onClick={() => { setOpen(false); setNewClientOpen(true) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: dark ? '#6ee78b' : 'var(--accent)', fontWeight: 600 }}>
              <Plus size={13} /> New space
            </button>
            <button onClick={() => { setOpen(false); navigate('/spaces') }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: dark ? 'rgba(226,237,232,0.68)' : 'var(--ghost)' }}>
              <LayoutGrid size={13} /> View all spaces
            </button>
          </div>
        </>
      )}
      {newClientOpen && <NewClientModal onClose={() => setNewClientOpen(false)} />}
    </div>
  )
}

function clientNameFromUrl(url: string) {
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
    const base = host.split('.')[0] || 'space'
    return base
      .split(/[-_]+/)
      .filter(Boolean)
      .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || 'Space'
  } catch {
    return 'Space'
  }
}

function cleanCompanyUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

// New space = a sub-workspace (project) under the current tenant (org). Projects
// are writable, so this sidesteps the organizations-RLS wall the old org-per-
// project wizard hit. Access invitations are the separate access layer.
// Lands in the space Brain to set it up.
function NewClientModal({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useOrg()
  const { refetch } = useProject()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [context, setContext] = useState<BusinessContext>({ ...EMPTY_BUSINESS_CONTEXT })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    const website = cleanCompanyUrl(context.website)
    if (!website || !activeOrg?.id || saving) return
    setSaving(true); setErr(null)
    const clientName = name.trim() || clientNameFromUrl(website)
    const businessContext = { ...context, website, companyName: name.trim() || context.companyName.trim() || clientName }
    const base = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'space'
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    const { error } = await supabase.from('projects').insert({
      org_id: activeOrg.id,
      name: clientName,
      slug,
      description: compactProjectDescription(businessContext),
      instructions: mergeProjectInstructions('', businessContext),
      is_default: false,
      is_starred: false,
      is_archived: false,
    })
    if (error) { setErr(error.message); setSaving(false); return }
    refetch()
    onClose()
    navigate(`/p/${slug}/brain`)
  }

  function updateContext(key: keyof BusinessContext, value: string) {
    setContext(prev => ({ ...prev, [key]: value }))
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxSizing: 'border-box' }
  const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(20,20,22,0.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-modal)', padding: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>New space</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 16px', lineHeight: 1.5 }}>A sub-workspace under {activeOrg?.name ?? 'your workspace'} with its own brain, content, and calendar.</p>
        <label style={labelStyle}>Company URL</label>
        <input autoFocus value={context.website} onChange={e => updateContext('website', e.target.value)} placeholder="https://company.com"
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>LinkedIn company page <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.linkedinCompany} onChange={e => updateContext('linkedinCompany', e.target.value)} placeholder="https://linkedin.com/company/company-name"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>LinkedIn profile <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.linkedinProfile} onChange={e => updateContext('linkedinProfile', e.target.value)} placeholder="https://linkedin.com/in/person-name"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>LinkedIn events <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.linkedinEvents} onChange={e => updateContext('linkedinEvents', e.target.value)} placeholder="https://linkedin.com/events/event-name"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>LinkedIn newsletter <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.linkedinNewsletter} onChange={e => updateContext('linkedinNewsletter', e.target.value)} placeholder="https://linkedin.com/newsletters/newsletter-name"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Instagram <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.instagram} onChange={e => updateContext('instagram', e.target.value)} placeholder="https://instagram.com/brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>YouTube <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.youtube} onChange={e => updateContext('youtube', e.target.value)} placeholder="https://youtube.com/@brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Medium <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.medium} onChange={e => updateContext('medium', e.target.value)} placeholder="https://medium.com/@brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Quora <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.quora} onChange={e => updateContext('quora', e.target.value)} placeholder="https://quora.com/profile/person-or-brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Reddit <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.reddit} onChange={e => updateContext('reddit', e.target.value)} placeholder="https://reddit.com/r/community or https://reddit.com/user/name"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Facebook page <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.facebook} onChange={e => updateContext('facebook', e.target.value)} placeholder="https://facebook.com/brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>X profile <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.x} onChange={e => updateContext('x', e.target.value)} placeholder="https://x.com/brand"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Space name <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp"
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Industry <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <input value={context.industry} onChange={e => updateContext('industry', e.target.value)} placeholder="Fashion, hospitality, SaaS"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Offer <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <textarea value={context.offer} onChange={e => updateContext('offer', e.target.value)} placeholder="Products, services, core value proposition."
          style={{ ...textareaStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Target audience <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <textarea value={context.audience} onChange={e => updateContext('audience', e.target.value)} placeholder="Buyers, users, decision makers, segments."
          style={{ ...textareaStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Content goals <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <textarea value={context.contentGoals} onChange={e => updateContext('contentGoals', e.target.value)} placeholder="Awareness, leads, launches, trust, recruiting."
          style={{ ...textareaStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Content objective <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <textarea value={context.demandObjective} onChange={e => updateContext('demandObjective', e.target.value)} placeholder="Awareness, trust, traffic, community, leads, sales, recruiting, or education."
          style={{ ...textareaStyle, marginBottom: 12 }} />
        <label style={labelStyle}>Approval model <span style={{ color: 'var(--ghost)' }}>(optional)</span></label>
        <textarea value={context.approvalModel} onChange={e => updateContext('approvalModel', e.target.value)} placeholder="Operator-only, owner lead, all stakeholders, or case-by-case."
          style={textareaStyle} />
        {err && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={create} disabled={saving || !context.website.trim()}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: saving ? 'wait' : 'pointer', opacity: (!context.website.trim() || saving) ? 0.6 : 1, boxShadow: 'var(--shadow-glow)' }}>
            {saving ? 'Creating…' : 'Create space'}
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
  // When Vera produces an artifact (draft/campaign), reveal the rail so the
  // output is visible even if the operator had collapsed it.
  useEffect(() => {
    const open = () => toggleRail(true)
    window.addEventListener('vera:rail-open', open)
    return () => window.removeEventListener('vera:rail-open', open)
  }, [])
  // Bulletproof reveal: the moment the page supplies rail content where there
  // was none (a fresh draft/campaign), open the rail. This doesn't depend on
  // the vera:rail-open event firing/being caught, so a newly generated post
  // can never silently land in a collapsed rail.
  const hadRailContent = useRef(false)
  useEffect(() => {
    const has = rightRailContent != null
    if (has && !hadRailContent.current) queueMicrotask(() => setRailOpen(true))
    hadRailContent.current = has
  }, [rightRailContent])
  // Responsive: on narrow / half-screen viewports the 3-pane layout cramps, so
  // collapse the rail by default (conversation gets full width) and overlay it
  // when opened. Restore the saved preference when there's room again.
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const narrowRail = vw < 980
  useEffect(() => {
    if (narrowRail) queueMicrotask(() => setRailOpen(false))
    else {
      let shouldOpen = true
      try { shouldOpen = localStorage.getItem('vera-rail-open') !== '0' } catch { /* ignore */ }
      queueMicrotask(() => setRailOpen(shouldOpen))
    }
  }, [narrowRail])

  // One live number in the rail: the Review badge (pending/draft posts in the
  // active project).
  useEffect(() => {
    if (!activeOrg?.id) { queueMicrotask(() => setPendingCount(0)); return }
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
  const reviewPreferenceScope = activeProject?.id ?? activeOrg?.id ?? 'global'

  const startNewPost = () => {
    const target = p('vera')
    if (location.pathname === target) {
      window.dispatchEvent(new CustomEvent('vera:home'))
      return
    }
    if (activeProject?.id) {
      try { localStorage.setItem(`vera-session:${activeProject.id}`, crypto.randomUUID()) } catch { /* ignore */ }
    }
    navigate(target)
  }

  const openReviewTab = (tab: string) => {
    try { localStorage.setItem(`vera-review-tab:${reviewPreferenceScope}`, tab) } catch { /* ignore */ }
    navigate(p('review'))
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0e1c1b' }}>
      {/* Icon rail */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: 76,
          background: 'linear-gradient(180deg, #0c1d1a 0%, #132432 55%, #1f3c36 100%)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          alignItems: 'center',
          padding: '18px 10px 14px',
        }}
      >
        <button
          type="button"
          onClick={() => navigate(p('blueprint'))}
          title="VERA"
          aria-label="VERA"
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.08)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            marginBottom: 20,
          }}
        >
          <img src="/favicon.svg" alt="" style={{ width: 28, height: 28, display: 'block' }} />
        </button>

        <nav className="flex flex-col items-center gap-3">
          <IconRailItem to={p('blueprint')} icon={LayoutGrid} label="Desk" accent="#6ee78b" />
          <IconRailItem to={p('calendar')} icon={CalendarDays} label="Calendar" accent="#52d1ff" />
          <IconRailItem to={p('review')} icon={FolderOpen} label="Publishing" accent="#f7b955" />
          <IconRailItem to={p('vera')} icon={MessageSquare} label="Ask VERA" accent="#a78bfa" onClick={() => window.dispatchEvent(new CustomEvent('vera:home'))} />
          <IconRailItem to={p('artifacts')} icon={Library} label="Studio" accent="#fb7185" />
          <IconRailItem to={p('brain')} icon={Brain} label="Brain" accent="#34d399" />
          <IconRailItem to={p('measure')} icon={BarChart3} label="Performance" accent="#60a5fa" />
        </nav>

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-3">
          <IconRailItem to={p('learning')} icon={TrendingUp} label="Learning" accent="#f472b6" />
          <IconRailItem to={p('keys')} icon={KeyRound} label="Integrations" accent="#facc15" />
          <IconRailItem to="/skills" icon={Zap} label="AI Settings" accent="#c084fc" />
          <IconRailButton icon={Bell} label="Notifications" onClick={() => navigate(p('review'))} alert={pendingCount > 0} />
          <IconRailButton icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} />
          <IconRailButton icon={HelpCircle} label="Help" onClick={() => navigate(p('blueprint'))} />
        </nav>

        <div style={{ position: 'relative', marginTop: 12 }}>
          {userMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setUserMenuOpen(false)} />
              <div style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 8, zIndex: 40, width: 220, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-pop)', padding: 4 }}>
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
            title={displayName}
            aria-label={displayName}
            style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="flex items-center justify-center text-[11px] font-semibold"
              style={{ width: 28, height: 28, background: '#6ee78b', color: '#0d1a18', borderRadius: '50%' }}>
              {initials}
            </span>
          </button>
        </div>
      </aside>

      {/* Publishing rail */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: 270,
          background: 'linear-gradient(180deg, #10211e 0%, #122525 58%, #162d32 100%)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          color: '#edf7f2',
          padding: '26px 16px 16px',
        }}
      >
        <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, color: '#f7fbf8', fontSize: 20, fontWeight: 760, lineHeight: 1.1 }}>Publishing</h1>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: '#6ee78b', boxShadow: '0 0 0 3px rgba(110,231,139,0.14)' }} />
            </div>
            <div style={{ marginTop: 5 }}>
              <ClientSwitcher tone="dark" compact />
            </div>
          </div>
          <button
            type="button"
            title="Collapse navigation"
            aria-label="Collapse navigation"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(236,242,240,0.86)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <PanelLeft size={17} />
          </button>
        </div>

        <button
          type="button"
          onClick={startNewPost}
          className="w-full flex items-center justify-between transition-colors"
          style={{
            minHeight: 46,
            borderRadius: 9,
            border: '1px solid rgba(255,255,255,0.10)',
            background: '#2864d8',
            color: '#fff',
            padding: '0 12px 0 14px',
            fontSize: 14.5,
            fontWeight: 760,
            cursor: 'pointer',
            boxShadow: '0 14px 28px rgba(40,100,216,0.28)',
            marginBottom: 12,
          }}
        >
          <span className="flex items-center gap-2"><Plus size={18} /> New post</span>
          <Edit3 size={17} />
        </button>

        <nav className="space-y-1" style={{ marginTop: 6 }}>
          <SideNavRow to={p('calendar')} label="Calendar" accent="#52d1ff" />
          <SideNavRow to={p('review')} label="Review queue" badge={pendingCount} accent="#f7b955" />
          <SideNavAction label="Drafts" onClick={() => openReviewTab('Draft')} />
          <SideNavAction label="Needs approval" badge={pendingCount} onClick={() => openReviewTab('Pending Review')} />
          <SideNavAction label="Rejected" onClick={() => openReviewTab('Rejected')} />

          <SideNavGroup label="Campaigns" onAdd={() => navigate(p('calendar'))} />
          <SideNavAction label="Active campaigns" onClick={() => navigate(p('calendar'))} indent accent="#6ee78b" />
          <SideNavAction label="Archived campaigns" onClick={() => navigate(p('calendar'))} indent accent="#94a3b8" />

          <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '10px 0' }} />

          <SideNavRow to={p('artifacts')} label="Asset library" accent="#fb7185" />
          <SideNavRow to={p('brain')} label="Brain" accent="#34d399" />
          <SideNavRow to={p('measure')} label="Performance" accent="#60a5fa" />
          <SideNavRow to={p('learning')} label="Learning loop" accent="#f472b6" />
          <SideNavRow to={p('keys')} label="Integrations" accent="#facc15" />
        </nav>

        <div style={{ marginTop: 12 }}>
          <SideNavGroup label="Assist" />
          <SideNavAction label="Ask VERA" onClick={startNewPost} />
          <SideNavAction label="Find content" onClick={() => navigate(p('brain'))} />
          <SideNavAction label="Failed posts" onClick={() => openReviewTab('Rejected')} />
        </div>

        <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 8 }}>
          <RailRecents tone="dark" />
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-2.5"
          style={{ minHeight: 38, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.06)', color: 'rgba(236,242,240,0.86)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
        >
          <Settings size={16} />
          <span className="flex-1">Settings</span>
          <MoreHorizontal size={16} />
        </button>
      </aside>

      {/* Main canvas */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0" style={{ background: 'var(--paper)', borderTopLeftRadius: 18, overflow: 'hidden' }}>
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
        <>
          {narrowRail && <div onClick={() => toggleRail(false)} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(20,20,20,0.18)' }} />}
          <aside
            className="flex-shrink-0"
            style={narrowRail
              ? { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 41, width: 'clamp(320px, 90vw, 460px)', background: 'var(--paper)', borderLeft: '1px solid var(--paper-edge)', boxShadow: 'var(--shadow-modal)' }
              : { background: 'transparent', width: rightRailWidth, borderLeft: '1px solid var(--paper-edge)', position: 'relative' }}
          >
            <button onClick={() => toggleRail(false)} title="Hide panel"
              style={{ position: 'absolute', left: -13, top: '50%', transform: 'translateY(-50%)', zIndex: 25, width: 26, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--surface)', color: 'var(--ghost)', cursor: 'pointer', boxShadow: 'var(--shadow-pop)' }}>
              <ChevronRight size={15} />
            </button>
            <div className="overflow-y-auto" style={{ height: '100%' }}>
              {rightRailContent}
            </div>
          </aside>
        </>
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
