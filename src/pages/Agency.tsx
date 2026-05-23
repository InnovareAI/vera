import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { Building2, Plus, Users, ChevronRight, Globe } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface ClientOrg {
  id: string
  name: string
  slug: string
  plan: string
  website?: string
  industry?: string
  org_type: string
  member_count?: number
}

export default function Agency() {
  const { activeOrg } = useOrg()
  const navigate = useNavigate()
  const [clients, setClients] = useState<ClientOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', website: '', industry: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    // Fetch all client orgs that have this agency as their agency_id
    supabase.from('organisations')
      .select('*')
      .eq('agency_id', activeOrg.id)
      .then(({ data }) => { setClients(data || []); setLoading(false) })
  }, [activeOrg?.id])

  async function handleCreateClient() {
    if (!activeOrg || !newForm.name.trim()) return
    setCreating(true)

    const slug = newForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const { data, error } = await supabase.from('organisations').insert({
      name: newForm.name.trim(),
      slug,
      plan: 'starter',
      timezone: 'Europe/Berlin',
      locale: 'en',
      org_type: 'client',
      agency_id: activeOrg.id,
      website: newForm.website || null,
      industry: newForm.industry || null,
      settings: {},
    }).select().single()

    if (!error && data) {
      setClients(prev => [...prev, data])
      setNewForm({ name: '', website: '', industry: '' })
      setShowNew(false)
    }
    setCreating(false)
  }

  const planColors: Record<string, string> = {
    starter: 'bg-gray-100 text-gray-600',
    growth:  'bg-blue-100 text-blue-700',
    scale:   'bg-gray-100 text-gray-900',
    enterprise: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agency</h1>
          <p className="text-sm text-gray-500 mt-1">Manage client workspaces under {activeOrg?.name}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          <Plus size={15} />
          New Client
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Clients', value: clients.length, icon: Building2, color: 'text-gray-700 bg-gray-50' },
          { label: 'Active', value: clients.filter(c => c.plan !== 'starter').length, icon: Globe, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Starter Plan', value: clients.filter(c => c.plan === 'starter').length, icon: Users, color: 'text-gray-600 bg-gray-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                <Icon size={18} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Client list */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading clients…</div>
      ) : clients.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center h-48 text-center">
          <Building2 size={32} className="text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-600">No clients yet</p>
          <p className="text-xs text-gray-400 mt-1">Add your first client workspace to get started</p>
          <button onClick={() => setShowNew(true)}
            className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors">
            <Plus size={12} /> Add Client
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {clients.map(client => (
            <div key={client.id}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => navigate('/settings')}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Building2 size={16} className="text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{client.name}</div>
                    <div className="text-xs text-gray-400">{client.slug}</div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors mt-0.5" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${planColors[client.plan] || 'bg-gray-100 text-gray-600'}`}>
                  {client.plan}
                </span>
                {client.industry && (
                  <span className="text-[11px] text-gray-400">{client.industry}</span>
                )}
                {client.website && (
                  <a href={client.website} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[11px] text-gray-600 hover:underline truncate max-w-[120px]">
                    {client.website.replace('https://', '')}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New client modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New Client Workspace</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Client Name *</label>
                <input
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({...f, name: e.target.value}))}
                  className="input w-full"
                  placeholder="Acme Corp"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Website</label>
                <input
                  value={newForm.website}
                  onChange={e => setNewForm(f => ({...f, website: e.target.value}))}
                  className="input w-full"
                  placeholder="https://acme.com"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Industry</label>
                <input
                  value={newForm.industry}
                  onChange={e => setNewForm(f => ({...f, industry: e.target.value}))}
                  className="input w-full"
                  placeholder="SaaS / Fintech / Healthcare…"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowNew(false)}
                className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateClient} disabled={creating || !newForm.name.trim()}
                className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
