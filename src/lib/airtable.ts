const BASE_ID = 'appsGUOLfDEYUlRZX'
const API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY || ''
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

async function airtableFetch(table: string, params: Record<string, string | number> = {}) {
  const qs = Object.keys(params).length
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()
    : ''
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}${qs}`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  })
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`)
  return res.json()
}

async function airtableCreate(table: string, fields: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  })
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`)
  return res.json()
}

async function airtableUpdate(table: string, id: string, fields: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })
  })
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`)
  return res.json()
}

export { airtableFetch, airtableCreate, airtableUpdate }
