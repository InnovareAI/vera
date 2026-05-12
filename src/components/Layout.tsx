import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Calendar, Sparkles, CheckSquare,
  BookOpen, Layers, Zap, LogOut, Settings, Building2, ChevronDown, Check, Sun, Moon
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useTheme } from '../lib/theme'

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  revision: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-500',
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[s] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function NavItem({ to, icon: Icon, label, badge }: {
  to: string; icon: React.ElementType; label: string; badge?: string | number
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
          isActive
            ? 'bg-gray-100 text-gray-900 font-medium'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
        }`
      }
    >
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {badge === 'New' && (
        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">New</span>
      )}
      {typeof badge === 'number' && badge > 0 && (
        <span className="text-[10px] font-semibold bg-gray-200 text-gray-600 w-4 h-4 rounded-full flex items-center justify-center">{badge}</span>
      )}
    </NavLink>
  )
}

function OrgSwitcher() {
  const { activeOrg, orgs, switchOrg } = useOrg()
  const [open, setOpen] = useState(false)

  if (!activeOrg || orgs.length <= 1) return null

  return (
    <div className="relative px-2 pb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors group"
      >
        <div className="w-5 h-5 rounded bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Building2 size={11} className="text-violet-600" />
        </div>
        <span className="flex-1 text-xs font-medium text-gray-700 truncate text-left">{activeOrg.name}</span>
        <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-2 right-2 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 overflow-hidden">
            {orgs.map(m => (
              <button
                key={m.org_id}
                onClick={() => { switchOrg(m.org_id); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Building2 size={10} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">{m.organisations.name}</div>
                  <div className="text-[10px] text-gray-400 capitalize">{m.role}</div>
                </div>
                {m.org_id === activeOrg.id && (
                  <Check size={12} className="text-violet-500 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, signOut } = useAuth()
  const { activeOrg, activeRole } = useOrg()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'KAI'

  const isAgencyAdmin = activeOrg?.org_type === 'agency' || activeRole === 'agency_admin'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center">
              <Sparkles size={12} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 leading-tight">KAI</div>
              <div className="text-[10px] text-gray-400 leading-tight">by InnovareAI</div>
            </div>
          </div>
        </div>

        {/* Org switcher */}
        <div className="pt-2 border-b border-gray-100">
          <OrgSwitcher />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
          <div>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Workspace</p>
            <div className="space-y-0.5">
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/clients" icon={Users} label="Clients" />
              <NavItem to="/calendar" icon={Calendar} label="Calendar" />
            </div>
          </div>
          <div>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Content</p>
            <div className="space-y-0.5">
              <NavItem to="/generate" icon={Sparkles} label="Generate" badge="New" />
              <NavItem to="/review" icon={CheckSquare} label="Review" badge={4} />
              <NavItem to="/library" icon={BookOpen} label="Library" />
            </div>
          </div>
          <div>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Setup</p>
            <div className="space-y-0.5">
              <NavItem to="/templates" icon={Layers} label="Templates" />
              <NavItem to="/skills" icon={Zap} label="Skills" />
              {isAgencyAdmin && (
                <NavItem to="/agency" icon={Building2} label="Agency" />
              )}
            </div>
          </div>
        </nav>

        {/* Settings + User */}
        <div className="px-2 pb-2 border-t border-gray-100 pt-2 space-y-0.5">
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <NavItem to="/settings" icon={Settings} label="Settings" />
            </div>
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 group">
            <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center text-[10px] font-bold text-violet-700 flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 truncate">
                {user?.email ?? 'Guest'}
              </div>
              <div className="text-[10px] text-gray-400 truncate capitalize">
                {activeRole ?? 'member'}
              </div>
            </div>
            {user && (
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-gray-600 transition-all"
              >
                <LogOut size={12} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
