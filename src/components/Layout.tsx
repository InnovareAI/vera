import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Calendar, Sparkles, CheckSquare, BookOpen, Layers } from 'lucide-react'

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

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-900 rounded flex items-center justify-center">
              <Layers size={13} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 leading-tight">Content Studio</div>
              <div className="text-[10px] text-gray-400 leading-tight">by InnovareAI</div>
            </div>
          </div>
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
            </div>
          </div>
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">TL</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 truncate">Thorsten L.</div>
              <div className="text-[10px] text-gray-400 truncate">InnovareAI</div>
            </div>
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
