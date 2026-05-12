import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Organisation } from '../lib/supabase'

const INDUSTRY_COLORS: Record<string, string> = {
  'SaaS': 'bg-violet-100 text-violet-700',
  'Fintech': 'bg-emerald-100 text-emerald-700',
  'Healthcare': 'bg-blue-100 text-blue-700',
  'E-commerce': 'bg-orange-100 text-orange-700',
  'Consulting': 'bg-gray-100 text-gray-700',
  'AI': 'bg-pink-100 text-pink-700',
  'Manufacturing': 'bg-amber-100 text-amber-700',
}

export default function Clients() {
  const [clients, setClients] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', industry: '', website: '', slug: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('organisations').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setClients(data || []); setLoading(false) })
  }, [])

  async function addClient() {
    if (!form.name.trim()) return
    setSaving(true)
    const slug = form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data, error } = await supabase.from('organisations').insert({ ...form, slug, plan: 'starter' }).select().single()
    if (!error && data) {
      setClients(prev => [data, ...prev])
      setForm({ name: '', industry: '', website: '', slug: '' })
      setShowAdd(false)
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Manage client organisations and brand settings</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors">
          + Add Client
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-gray-900 mb-4">Add New Client</h2>
            <div className="space-y-3">
              {[
                { key: 'name', label: 'Name *', placeholder: 'Acme Corp' },
                { key: 'industry', label: 'Industry', placeholder: 'SaaS, Fintech, AI…' },
                { key: 'website', label: 'Website', placeholder: 'https://…' },
                { key: 'slug', label: 'Slug (auto-generated if blank)', placeholder: 'acme-corp' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                  <input type="text" value={form[key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={addClient} disabled={saving || !form.name.trim()}
                className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                {saving ? 'Adding…' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading clients…</div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <span className="text-4xl mb-3">🏢</span>
          <p className="text-sm mb-1">No clients yet</p>
          <p className="text-xs">Add your first client to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <div key={client.id} className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-gray-300 transition-all hover:shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                  {client.name.slice(0, 2).toUpperCase()}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  client.plan === 'enterprise' ? 'bg-violet-100 text-violet-700' :
                  client.plan === 'scale' ? 'bg-blue-100 text-blue-700' :
                  client.plan === 'growth' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{client.plan}</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{client.name}</h3>
              {client.industry && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INDUSTRY_COLORS[client.industry] || 'bg-gray-100 text-gray-600'}`}>
                  {client.industry}
                </span>
              )}
              {client.website && <p className="text-xs text-blue-500 mt-2 truncate">{client.website}</p>}
              <p className="text-xs text-gray-400 mt-2">{client.locale} · {client.timezone}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
