// Daily Unipile account health check.
//
// For every org with a unipile_account_id, hit Unipile's GET /accounts/{id}.
// On success: bump unipile_last_health_check + mark healthy.
// On 4xx (account revoked, deleted, never existed): NULL the account_id so
// the operator gets the reconnect prompt next time they open Settings.
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
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN')
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY')

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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, unipile_account_id')
    .not('unipile_account_id', 'is', null)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: Array<{
    org_id: string; name: string; account_id: string
    status: 'healthy' | 'stale' | 'unknown'
    detail?: string
  }> = []

  for (const org of orgs ?? []) {
    const accountId = org.unipile_account_id as string
    const now = new Date().toISOString()

    try {
      const res = await fetch(
        `https://${UNIPILE_DSN}/api/v1/accounts/${encodeURIComponent(accountId)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Accept': 'application/json' } },
      )

      if (res.ok) {
        await supabase.from('organizations').update({
          unipile_last_health_check: now,
          unipile_health_status: 'healthy',
        }).eq('id', org.id)
        results.push({ org_id: org.id as string, name: org.name as string, account_id: accountId, status: 'healthy' })
      } else if (res.status >= 400 && res.status < 500) {
        // Account is gone or revoked — clear it. Operator will see the
        // reconnect prompt in Settings.
        const body = await res.text().catch(() => '')
        await supabase.from('organizations').update({
          unipile_account_id: null,
          unipile_last_health_check: now,
          unipile_health_status: 'stale',
        }).eq('id', org.id)
        results.push({
          org_id: org.id as string, name: org.name as string, account_id: accountId,
          status: 'stale', detail: `HTTP ${res.status}: ${body.slice(0, 120)}`,
        })
      } else {
        // 5xx or weird response — leave account_id, mark unknown
        await supabase.from('organizations').update({
          unipile_last_health_check: now,
          unipile_health_status: 'unknown',
        }).eq('id', org.id)
        results.push({
          org_id: org.id as string, name: org.name as string, account_id: accountId,
          status: 'unknown', detail: `HTTP ${res.status} (5xx — left intact)`,
        })
      }
    } catch (err) {
      // Network-level error — leave account_id alone, mark unknown
      await supabase.from('organizations').update({
        unipile_last_health_check: now,
        unipile_health_status: 'unknown',
      }).eq('id', org.id)
      results.push({
        org_id: org.id as string, name: org.name as string, account_id: accountId,
        status: 'unknown', detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return new Response(JSON.stringify({
    checked: orgs?.length ?? 0,
    healthy: results.filter(r => r.status === 'healthy').length,
    stale:   results.filter(r => r.status === 'stale').length,
    unknown: results.filter(r => r.status === 'unknown').length,
    results,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
