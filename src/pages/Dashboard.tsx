import { StatusBadge } from '../components/Layout'

const pending = [
  { id: 1, title: "We're not in the optics business. We're in the certainty business.", client: 'sapmercor', type: 'LinkedIn post', due: 'Tue May 14', status: 'Pending' },
  { id: 2, title: 'Most companies treat optics as a commodity. Thread →', client: 'sapmercor', type: 'X thread', due: 'Tue May 14', status: 'Revision' },
  { id: 3, title: '5 things about precision optics manufacturing', client: 'sapmercor', type: 'LinkedIn carousel', due: 'Wed May 16', status: 'Pending' },
]

const activity = [
  { id: 1, title: 'SAM product launch — LinkedIn post approved', client: 'innovareai', time: '2 hours ago', status: 'Approved' },
  { id: 2, title: 'YouTube script generated — thermal optics walkthrough', client: 'sapmercor', time: '4 hours ago', status: 'Draft' },
]

export default function Dashboard() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{dateStr} · 3 clients active</p>
        </div>
        <button className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          New content
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { value: 12, label: 'Posts this week' },
          { value: 4, label: 'Awaiting approval' },
          { value: 3, label: 'Active campaigns' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Pending Approval */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Pending Approval</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {pending.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{item.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.client} · {item.type} · due {item.due}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Recent Activity</p>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {activity.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{item.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.client} · {item.time}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
