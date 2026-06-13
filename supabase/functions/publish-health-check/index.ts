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

type AdminClient = ReturnType<typeof createClient<any>>
type HealthStatus = 'healthy' | 'stale' | 'unknown'
type PublisherRow = {
  id: string
  kind: string
  name: string | null
  config: Record<string, unknown> | null
  credentials_ref: string | null
  org_id: string
  project_id: string | null
}
type HealthResult = {
  publisher_id: string
  kind: string
  status: HealthStatus
  detail?: string
  observation?: 'opened' | 'already_open' | 'resolved'
}

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

  const supabase = createClient<any>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: publishers, error } = await supabase
    .from('publishers')
    .select('id, kind, name, config, credentials_ref, org_id, project_id')
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: HealthResult[] = []

  for (const p of (publishers ?? []) as PublisherRow[]) {
    const now = new Date().toISOString()
    try {
      const status = await checkPublisher(p.kind, p.config, p.credentials_ref ?? '', p.id)
      await supabase.from('publishers').update({
        health_status: status.status,
        health_detail: status.detail ?? null,
        last_health_check: now,
      }).eq('id', p.id)
      const observation = await syncConnectorHealthObservation(supabase, p, status)
      results.push({ publisher_id: p.id, kind: p.kind, status: status.status, detail: status.detail, observation })
    } catch (err) {
      const status = {
        status: 'unknown' as const,
        detail: err instanceof Error ? err.message : String(err),
      }
      await supabase.from('publishers').update({
        health_status: status.status,
        health_detail: status.detail,
        last_health_check: now,
      }).eq('id', p.id)
      const observation = await syncConnectorHealthObservation(supabase, p, status)
      results.push({ publisher_id: p.id, kind: p.kind, status: status.status, detail: status.detail, observation })
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
): Promise<{ status: HealthStatus; detail?: string }> {
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

async function syncConnectorHealthObservation(
  supabase: AdminClient,
  publisher: PublisherRow,
  status: { status: HealthStatus; detail?: string },
): Promise<HealthResult['observation']> {
  const dedupKey = `connector_health:${publisher.id}`

  if (status.status === 'healthy') {
    const { data } = await supabase
      .from('agent_observations')
      .update({
        status: 'actioned',
        actioned_at: new Date().toISOString(),
        acted_result: {
          stage: 'resolved',
          publisher_id: publisher.id,
          publisher_kind: publisher.kind,
          resolved_at: new Date().toISOString(),
        },
      })
      .eq('dedup_key', dedupKey)
      .eq('status', 'open')
      .select('id')
    return data && data.length > 0 ? 'resolved' : undefined
  }

  const { error } = await supabase
    .from('agent_observations')
    .insert({
      org_id: publisher.org_id,
      project_id: publisher.project_id,
      kind: 'connector_health',
      severity: status.status === 'stale' ? 'high' : 'medium',
      title: `${displayPublisherName(publisher)} needs attention`,
      detail: connectorHealthDetail(publisher, status),
      proposed_action: 'Open integrations',
      action_kind: 'open_integrations',
      action_payload: {
        publisher_id: publisher.id,
        publisher_kind: publisher.kind,
        provider: providerForPublisherKind(publisher.kind),
        project_id: publisher.project_id,
        status: status.status,
        detail: status.detail ?? null,
      },
      dedup_key: dedupKey,
      surface_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })

  if (!error) return 'opened'
  if (error.code === '23505') return 'already_open'
  console.warn(`connector_health observation failed for ${publisher.id}: ${error.message}`)
  return undefined
}

function displayPublisherName(publisher: PublisherRow): string {
  const name = typeof publisher.name === 'string' && publisher.name.trim()
    ? publisher.name.trim()
    : publisher.kind.replace(/_/g, ' ')
  return `${name} connector`
}

function connectorHealthDetail(
  publisher: PublisherRow,
  status: { status: HealthStatus; detail?: string },
): string {
  const platform = publisher.kind.replace(/_/g, ' ')
  if (status.status === 'stale') {
    return `${platform} returned an authentication or not-found response. Reconnect this publisher before VERA tries to publish approved content. ${status.detail ?? ''}`.trim()
  }
  return `${platform} health is unknown after the scheduled check. Publishing may still work, but an operator should inspect the connector before relying on it. ${status.detail ?? ''}`.trim()
}

function providerForPublisherKind(kind: string): string {
  return ({
    wordpress: 'wordpress',
    ghost: 'ghost',
    github_mdx: 'custom_cms',
    webflow: 'webflow',
    contentful: 'contentful',
    sanity: 'sanity',
    hubspot: 'hubspot_cms',
    strapi: 'strapi',
  } as Record<string, string>)[kind] ?? 'custom_cms'
}
