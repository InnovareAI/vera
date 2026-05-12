import { useState, useEffect } from 'react'
import { airtableFetch, airtableCreate } from '../lib/airtable'

interface Client {
  id: string
  fields: {
    Name?: string
    Industry?: string
    Website?: string
    Status?: string
    Notes?: string
    'Created Time'?: string
  }
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ Name: '', Industry: '', Website: '', Notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const data = await airtableFetch('Clients', { pageSize: 100 })
      setClients(data.records || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function addClient() {
    if (!form.Name.trim()) return
    setSaving(true)
    try {
      const record = await airtableCreate('Clients', { ...form, Status: 'Active' })
      setClients(prev => [record, ...prev])
      setForm({ Name: '', Industry: '', Website: '', Notes: '' })
      setShowAdd(false)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const INDUSTRY_COLORS: Record<string, string> = {
    'SaaS': 'bg-violet-100 text-violet-700',
    'Fintech': 'bg-emerald-100 text-emerald-700',
    'Healthcare': 'bg-blue-100 text-blue-700',
    'E-commerce': 'bg-orange-100 text-orange-700',
    'Consulting': 'bg-gray-100 text-gray-700',
    'AI': 'bg-pink-100 text-pink-700',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Manage client accounts and brand settings</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          + Add Client
        </button>
      </div>

      {/* Add client modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-gray-900 mb-4">Add New Client</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Name *</label>
                <input
                  type="text"
                  value={form.Name}
                  onChange={e => setForm(p => ({ ...p, Name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Industry</label>
                <input
                  type="text"
                  value={form.Industry}
                  onChange={e => setForm(p => ({ ...p, Industry: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="SaaS, Fintech, etc."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Website</label>
                <input
                  type="text"
                  value={form.Website}
                  onChange={e => setForm(p => ({ ...p, Website: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Notes</label>
                <textarea
                  value={form.Notes}
                  onChange={e => setForm(p => ({ ...p, Notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                  rows={3}
                  placeholder="Any notes about this client..."
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addClient}
                disabled={saving || !form.Name.trim()}
                className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
          Loading clients...
        </div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <span className="text-4xl mb-3">🏢</span>
          <p className="text-sm mb-1">No clients yet</p>
          <p className="text-xs">Add your first client to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <div
              key={client.id}
              className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-gray-300 transition-all hover:shadow-sm"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                  {(client.fields.Name || 'C').slice(0, 2).toUpperCase()}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  client.fields.Status === 'Active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {client.fields.Status || 'Active'}
                </span>
              </div>

              <h3 className="font-semibold text-gray-900 mb-1">{client.fields.Name || 'Unnamed'}</h3>

              {client.fields.Industry && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  INDUSTRY_COLORS[client.fields.Industry] || 'bg-gray-100 text-gray-600'
                }`}>
                  {client.fields.Industry}
                </span>
              )}

              {client.fields.Website && (
                <p className="text-xs text-blue-500 mt-2 truncate">{client.fields.Website}</p>
              )}

              {client.fields.Notes && (
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{client.fields.Notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
