// Daily Unipile account health check.
//
// For every legacy org account and project-scoped client integration account,
// hit Unipile's GET /accounts/{id}.
//
// Legacy org accounts still update organizations.unipile_* columns. New client
// connections update client_integrations.health_status so each client space can
// go stale independently.
//
// Network errors and 5xx don't punish the account — they just mark unknown
// and skip. We don't want a transient Unipile outage to disconnect every
// org overnight.
//
// Trigger: pg_cron daily at 03:30 UTC. Or manually:
//   curl -X POST .../functions/v1/unipile-health-check \
//     -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')

type JsonRecord = Record<string, unknown>

type HealthStatus = 'healthy' | 'stale' | 'unknown' | 'error'

type HealthResult = {
  scope: 'organization' | 'client_integration'
  org_id: string
  name: string
  account_id: string
  status: HealthStatus
  project_id?: string
  integration_id?: string
  provider?: string
  detail?: string
}

type ClientIntegrationRow = {
  id: string
  org_id: string
  project_id: string
  provider: string
  display_name: string
  status: string
  config: JsonRecord | null
  external_ref: JsonRecord | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return new Response(JSON.stringify({ error: 'UNIPILE_DSN / UNIPILE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!isServiceRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, unipile_account_id')
    .not('unipile_account_id', 'is', null)

  if (orgError) {
    return new Response(JSON.stringify({ error: orgError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: integrationRows, error: integrationError } = await supabase
    .from('client_integrations')
    .select('id, org_id, project_id, provider, display_name, status, config, external_ref')
    .eq('provider', 'linkedin')
    .in('status', ['connected', 'pending', 'error', 'revoked'])

  if (integrationError) {
    return new Response(JSON.stringify({ error: integrationError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: HealthResult[] = []

  for (const org of orgs ?? []) {
    const accountId = org.unipile_account_id as string
    const now = new Date().toISOString()

    const outcome = await checkUnipileAccount(accountId)
    if (outcome.status === 'healthy') {
      await supabase.from('organizations').update({
        unipile_last_health_check: now,
        unipile_health_status: 'healthy',
      }).eq('id', org.id)
      results.push({
        scope: 'organization',
        org_id: org.id as string,
        name: org.name as string,
        account_id: accountId,
        status: 'healthy',
      })
    } else if (outcome.status === 'stale') {
      // Account is gone or revoked. Clear legacy org-level accounts so old
      // settings screens show a reconnect prompt.
      await supabase.from('organizations').update({
        unipile_account_id: null,
        unipile_last_health_check: now,
        unipile_health_status: 'stale',
      }).eq('id', org.id)
      results.push({
        scope: 'organization',
        org_id: org.id as string,
        name: org.name as string,
        account_id: accountId,
        status: 'stale',
        detail: outcome.detail,
      })
    } else {
      // 5xx or network-level errors leave account_id intact.
      await supabase.from('organizations').update({
        unipile_last_health_check: now,
        unipile_health_status: 'unknown',
      }).eq('id', org.id)
      results.push({
        scope: 'organization',
        org_id: org.id as string,
        name: org.name as string,
        account_id: accountId,
        status: 'unknown',
        detail: outcome.detail,
      })
    }
  }

  for (const row of (integrationRows ?? []) as ClientIntegrationRow[]) {
    const accountId = getUnipileAccountId(row)
    if (!accountId) continue

    const now = new Date().toISOString()
    const outcome = await checkUnipileAccount(accountId)
    const update: Record<string, unknown> = {
      last_health_check: now,
      health_status: outcome.status === 'unknown' ? 'error' : outcome.status,
      health_detail: outcome.detail ?? null,
    }
    if (outcome.status === 'healthy') update.status = 'connected'
    if (outcome.status === 'stale') update.status = 'revoked'

    await supabase.from('client_integrations').update(update).eq('id', row.id)
    results.push({
      scope: 'client_integration',
      org_id: row.org_id,
      project_id: row.project_id,
      integration_id: row.id,
      provider: row.provider,
      name: row.display_name,
      account_id: accountId,
      status: outcome.status === 'unknown' ? 'error' : outcome.status,
      detail: outcome.detail,
    })
  }

  return new Response(JSON.stringify({
    checked: results.length,
    legacy_orgs_checked: orgs?.length ?? 0,
    client_integrations_checked: results.filter(r => r.scope === 'client_integration').length,
    healthy: results.filter(r => r.status === 'healthy').length,
    stale:   results.filter(r => r.status === 'stale').length,
    unknown: results.filter(r => r.status === 'unknown').length,
    error: results.filter(r => r.status === 'error').length,
    results,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function isServiceRequest(req: Request) {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const apiKey = req.headers.get('apikey') ?? ''
  return bearer === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY
}

async function checkUnipileAccount(accountId: string): Promise<{ status: HealthStatus; detail?: string }> {
  try {
    const res = await fetch(
      `https://${UNIPILE_DSN}/api/v1/accounts/${encodeURIComponent(accountId)}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY ?? '', 'Accept': 'application/json' } },
    )

    if (res.ok) return { status: 'healthy' }
    if (res.status >= 400 && res.status < 500) {
      const body = await res.text().catch(() => '')
      return { status: 'stale', detail: `HTTP ${res.status}: ${body.slice(0, 120)}` }
    }
    return { status: 'unknown', detail: `HTTP ${res.status} (left intact)` }
  } catch (err) {
    return { status: 'unknown', detail: err instanceof Error ? err.message : String(err) }
  }
}

function getUnipileAccountId(row: ClientIntegrationRow): string | null {
  return firstString(
    row.external_ref?.unipile_account_id,
    row.config?.unipile_account_id,
    row.external_ref?.account_id,
  )
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
