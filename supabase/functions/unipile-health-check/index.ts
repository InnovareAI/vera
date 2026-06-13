// Daily Unipile account health check.
//
// For every legacy org account and project-scoped space integration account,
// hit Unipile's GET /accounts/{id}.
//
// Legacy org accounts still update organizations.unipile_* columns. New client
// connections update client_integrations.health_status so each space can
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
  observation?: ObservationSyncResult
}

type ObservationSyncResult = 'opened' | 'already_open' | 'resolved'

type OrgUnipileRow = {
  id: string
  name: string | null
  unipile_account_id: string | null
}

type ProjectRow = {
  id: string
  name: string | null
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
    .in('status', ['connected', 'pending', 'error', 'revoked'])

  if (integrationError) {
    return new Response(JSON.stringify({ error: integrationError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: HealthResult[] = []

  for (const org of (orgs ?? []) as OrgUnipileRow[]) {
    const accountId = org.unipile_account_id as string
    const now = new Date().toISOString()

    const outcome = await checkUnipileAccount(accountId)
    if (outcome.status === 'healthy') {
      await supabase.from('organizations').update({
        unipile_last_health_check: now,
        unipile_health_status: 'healthy',
      }).eq('id', org.id)
      const observation = await syncWorkspaceResearchHealthObservations(supabase, org, 'healthy')
      results.push({
        scope: 'organization',
        org_id: org.id,
        name: org.name ?? 'Workspace',
        account_id: accountId,
        status: 'healthy',
        observation,
      })
    } else if (outcome.status === 'stale') {
      // Account is gone or revoked. Clear legacy org-level accounts so old
      // settings screens show a reconnect prompt.
      await supabase.from('organizations').update({
        unipile_account_id: null,
        unipile_last_health_check: now,
        unipile_health_status: 'stale',
      }).eq('id', org.id)
      const observation = await syncWorkspaceResearchHealthObservations(supabase, org, 'stale', outcome.detail)
      results.push({
        scope: 'organization',
        org_id: org.id,
        name: org.name ?? 'Workspace',
        account_id: accountId,
        status: 'stale',
        detail: outcome.detail,
        observation,
      })
    } else {
      // 5xx or network-level errors leave account_id intact.
      await supabase.from('organizations').update({
        unipile_last_health_check: now,
        unipile_health_status: 'unknown',
      }).eq('id', org.id)
      const observation = await syncWorkspaceResearchHealthObservations(supabase, org, 'error', outcome.detail)
      results.push({
        scope: 'organization',
        org_id: org.id,
        name: org.name ?? 'Workspace',
        account_id: accountId,
        status: 'unknown',
        detail: outcome.detail,
        observation,
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
    const observation = await syncClientIntegrationHealthObservation(
      supabase,
      row,
      outcome.status === 'unknown' ? 'error' : outcome.status,
      outcome.detail,
    )
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
      observation,
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

async function syncWorkspaceResearchHealthObservations(
  supabase: ReturnType<typeof createClient<any>>,
  org: OrgUnipileRow,
  status: HealthStatus,
  detail?: string,
): Promise<ObservationSyncResult | undefined> {
  const dedupPrefix = `connector_health:workspace_research:${org.id}:`

  if (status === 'healthy') {
    const { data } = await supabase
      .from('agent_observations')
      .update({
        status: 'actioned',
        actioned_at: new Date().toISOString(),
        acted_result: {
          stage: 'resolved',
          scope: 'workspace_research',
          provider: 'linkedin',
          resolved_at: new Date().toISOString(),
        },
      })
      .like('dedup_key', `${dedupPrefix}%`)
      .eq('status', 'open')
      .select('id')
    return data && data.length > 0 ? 'resolved' : undefined
  }

  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, name')
    .eq('org_id', org.id)
    .eq('is_archived', false)

  if (projectError) {
    console.warn(`workspace research health project lookup failed for ${org.id}: ${projectError.message}`)
    return undefined
  }

  let opened = 0
  let duplicate = 0
  for (const project of (projects ?? []) as ProjectRow[]) {
    const { error } = await supabase
      .from('agent_observations')
      .insert({
        org_id: org.id,
        project_id: project.id,
        kind: 'connector_health',
        severity: status === 'stale' ? 'high' : 'medium',
        title: 'LinkedIn research profile needs attention',
        detail: workspaceResearchHealthDetail(org, status, detail),
        proposed_action: 'Open integrations',
        action_kind: 'open_integrations',
        action_payload: {
          scope: 'workspace_research',
          provider: 'linkedin',
          project_id: project.id,
          org_id: org.id,
          status,
          detail: detail ?? null,
        },
        dedup_key: `${dedupPrefix}${project.id}`,
        surface_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })

    if (!error) opened++
    else if (error.code === '23505') duplicate++
    else console.warn(`workspace research observation failed for project ${project.id}: ${error.message}`)
  }

  if (opened > 0) return 'opened'
  if (duplicate > 0) return 'already_open'
  return undefined
}

async function syncClientIntegrationHealthObservation(
  supabase: ReturnType<typeof createClient<any>>,
  row: ClientIntegrationRow,
  status: HealthStatus,
  detail?: string,
): Promise<ObservationSyncResult | undefined> {
  const dedupKey = `connector_health:client_integration:${row.id}`

  if (status === 'healthy') {
    const { data } = await supabase
      .from('agent_observations')
      .update({
        status: 'actioned',
        actioned_at: new Date().toISOString(),
        acted_result: {
          stage: 'resolved',
          integration_id: row.id,
          provider: row.provider,
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
      org_id: row.org_id,
      project_id: row.project_id,
      kind: 'connector_health',
      severity: status === 'stale' ? 'high' : 'medium',
      title: `${integrationName(row)} needs attention`,
      detail: integrationHealthDetail(row, status, detail),
      proposed_action: 'Open integrations',
      action_kind: 'open_integrations',
      action_payload: {
        scope: 'client_integration',
        integration_id: row.id,
        provider: row.provider,
        project_id: row.project_id,
        status,
        detail: detail ?? null,
      },
      dedup_key: dedupKey,
      surface_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })

  if (!error) return 'opened'
  if (error.code === '23505') return 'already_open'
  console.warn(`connector_health observation failed for space integration ${row.id}: ${error.message}`)
  return undefined
}

function integrationName(row: ClientIntegrationRow): string {
  const displayName = row.display_name?.trim() || providerLabel(row.provider)
  return `${displayName} connector`
}

function integrationHealthDetail(row: ClientIntegrationRow, status: HealthStatus, detail?: string): string {
  const provider = providerLabel(row.provider)
  if (status === 'stale') {
    return `${provider} returned an authentication or not-found response. Reconnect this space integration before VERA uses it for publishing or research. ${detail ?? ''}`.trim()
  }
  return `${provider} health is unknown after the scheduled check. The integration may still work, but an operator should inspect it before relying on it. ${detail ?? ''}`.trim()
}

function providerLabel(provider: string): string {
  return ({
    linkedin: 'LinkedIn',
    meta_facebook_pages: 'Facebook Pages',
    meta_instagram: 'Instagram',
    google_search_console: 'Google Search Console',
    google_analytics_4: 'Google Analytics 4',
    youtube: 'YouTube',
  } as Record<string, string>)[provider] ?? provider.replace(/_/g, ' ')
}

function workspaceResearchHealthDetail(org: OrgUnipileRow, status: HealthStatus, detail?: string): string {
  const workspace = org.name?.trim() || 'this workspace'
  if (status === 'stale') {
    return `The shared LinkedIn research profile for ${workspace} was revoked or rejected. Reconnect it before VERA runs LinkedIn research across spaces. ${detail ?? ''}`.trim()
  }
  return `The shared LinkedIn research profile for ${workspace} could not be verified. Research may still work, but an operator should inspect the connection. ${detail ?? ''}`.trim()
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
