// Daily health check for every connected publisher.
//
// Iterates publishers table, calls each connector's health_check() verb,
// updates publishers.health_status + last_health_check accordingly.
//
// Mirrors the unipile-health-check pattern: 4xx-marks-stale (so the
// reconnect prompt surfaces in Settings), 5xx/network leaves status
// unchanged ('unknown') because transient outages shouldn't punish
// the operator.
//
// Trigger: pg_cron daily. Or manually:
//   curl -X POST .../functions/v1/publish-health-check \
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!isServiceRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: publishers, error } = await supabase
    .from('publishers')
    .select('id, kind, name, config, credentials_ref, org_id')
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: Array<{ publisher_id: string; kind: string; status: string; detail?: string }> = []

  for (const p of publishers ?? []) {
    const now = new Date().toISOString()
    try {
      const status = await checkPublisher(p.kind as string, p.config, p.credentials_ref as string, p.id as string)
      await supabase.from('publishers').update({
        health_status: status.status,
        health_detail: status.detail ?? null,
        last_health_check: now,
      }).eq('id', p.id)
      results.push({ publisher_id: p.id as string, kind: p.kind as string, status: status.status, detail: status.detail })
    } catch (err) {
      await supabase.from('publishers').update({
        health_status: 'unknown',
        health_detail: err instanceof Error ? err.message : String(err),
        last_health_check: now,
      }).eq('id', p.id)
      results.push({ publisher_id: p.id as string, kind: p.kind as string, status: 'unknown', detail: 'check threw' })
    }
  }

  return new Response(JSON.stringify({
    checked: publishers?.length ?? 0,
    healthy: results.filter(r => r.status === 'healthy').length,
    stale:   results.filter(r => r.status === 'stale').length,
    unknown: results.filter(r => r.status === 'unknown').length,
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

// Connector dispatch. Calls the per-platform edge function's health_check
// action via internal HTTP (rather than imports — keeps each connector
// independently deployable).
async function checkPublisher(
  kind: string,
  _config: unknown,
  _credentialsRef: string,
  publisher_id?: string,
): Promise<{ status: 'healthy' | 'stale' | 'unknown'; detail?: string }> {
  const targetFn = ({
    wordpress: 'wordpress-publish',
    ghost: 'ghost-publish',
    github_mdx: 'git-publish',
    webflow: 'webflow-publish',
    contentful: 'contentful-publish',
    sanity: 'sanity-publish',
    hubspot: 'hubspot-publish',
    strapi: 'strapi-publish',
  } as Record<string, string>)[kind]

  if (!targetFn || !publisher_id) {
    return { status: 'unknown', detail: `Connector for kind=${kind} not implemented yet` }
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${targetFn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ action: 'health_check', publisher_id }),
    })
    if (!res.ok) return { status: 'unknown', detail: `dispatch HTTP ${res.status}` }
    const data = await res.json() as { status?: 'healthy' | 'stale' | 'unknown'; detail?: string }
    return { status: data.status ?? 'unknown', detail: data.detail }
  } catch (e) {
    return { status: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
}
