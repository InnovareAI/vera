// Generate a Unipile hosted-auth URL for LinkedIn. The user clicks the
// returned URL, completes Unipile's hosted flow, and is redirected back to
// `return_url?account_id=XXX&status=success&org_id=YYY` — the frontend then
// PATCHes organizations.unipile_account_id directly.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import { requireOrgMember, requireProjectMember } from "../_shared/auth.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN     = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return new Response(JSON.stringify({ error: 'UNIPILE_DSN / UNIPILE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { org_id, project_id, provider: providerRaw, return_url } = await req.json().catch(() => ({}))
  if (!org_id || !return_url) {
    return new Response(JSON.stringify({ error: 'org_id and return_url are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Which network to connect. Unipile's create-post publishes to LinkedIn +
  // Instagram (X returns with V2). Default LinkedIn for backward compatibility.
  // project_id is optional: when present the frontend stores the connection in
  // client_integrations; without it, this is the legacy org-level connection.
  const ALLOWED = new Set(['LINKEDIN', 'INSTAGRAM', 'X'])
  const provider = String(providerRaw ?? 'LINKEDIN').toUpperCase()
  if (!ALLOWED.has(provider)) {
    return new Response(JSON.stringify({ error: `provider must be one of: ${[...ALLOWED].join(', ')}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const auth = project_id
    ? await requireProjectMember(req, supabase, SERVICE_KEY, project_id, corsHeaders, org_id)
    : await requireOrgMember(req, supabase, SERVICE_KEY, org_id, corsHeaders)
  if (!auth.ok) return auth.response

  // Build the redirect URLs Unipile will hit after the user finishes (or aborts).
  // Both include org_id so the frontend knows which org to attach the account_id to.
  const ret = new URL(return_url)
  ret.searchParams.set('org_id', org_id)
  if (project_id) ret.searchParams.set('project_id', project_id)
  ret.searchParams.set('provider', provider.toLowerCase())
  const successRedirect = new URL(ret.toString()); successRedirect.searchParams.set('unipile_status', 'success')
  const failureRedirect = new URL(ret.toString()); failureRedirect.searchParams.set('unipile_status', 'error')

  // 2-hour expiry, ISO 8601 with .000Z (Unipile requires this exact format)
  const expiresOn = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().replace(/\.\d{3}Z$/, '.000Z')

  const payload = {
    type: 'create',
    providers: [provider],
    api_url: `https://${UNIPILE_DSN}`,
    expiresOn,
    success_redirect_url: successRedirect.toString(),
    failure_redirect_url: failureRedirect.toString(),
    name: `org:${org_id}${project_id ? `:proj:${project_id}` : ''}:${provider.toLowerCase()}`,
    bypass_success_screen: true,
  }

  const res = await fetch(`https://${UNIPILE_DSN}/api/v1/hosted/accounts/link`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    return new Response(JSON.stringify({ error: `Unipile API ${res.status}: ${errText}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const data = await res.json()
  return new Response(JSON.stringify({ auth_url: data.url, expires_on: expiresOn }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
