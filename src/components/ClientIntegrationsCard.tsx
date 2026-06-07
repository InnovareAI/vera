import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  FileCode2,
  Globe2,
  KeyRound,
  Loader2,
  PauseCircle,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  ClientIntegration,
  ClientIntegrationCategory,
  ClientIntegrationConnectionKind,
  ClientIntegrationProvider,
  ClientIntegrationStatus,
  IntegrationCapabilities,
} from '../lib/supabase'
import { useProject } from '../lib/projectContext'

interface IntegrationTemplate {
  provider: ClientIntegrationProvider
  category: ClientIntegrationCategory
  label: string
  eyebrow: string
  description: string
  connectionKind: ClientIntegrationConnectionKind
  credentialRoute: string
  primaryLabel: string
  primaryPlaceholder: string
  scopes: string[]
  capabilities: IntegrationCapabilities
  setupNote: string
  icon: ElementType
  accent: string
}

const PROVIDERS: IntegrationTemplate[] = [
  {
    provider: 'google_search_console',
    category: 'seo',
    label: 'Google Search Console',
    eyebrow: 'Search intelligence',
    description: 'Pull search queries, landing pages, indexing gaps, sitemap state, and SEO opportunity data.',
    connectionKind: 'oauth',
    credentialRoute: 'Google OAuth with Search Console API scopes',
    primaryLabel: 'Verified property URL',
    primaryPlaceholder: 'https://example.com/',
    scopes: ['webmasters.readonly', 'site_verification.read'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Needs Google OAuth and a Search Console ingestion adapter before live reads.',
    icon: Search,
    accent: '#0f766e',
  },
  {
    provider: 'google_analytics_4',
    category: 'analytics',
    label: 'Google Analytics 4',
    eyebrow: 'Performance analytics',
    description: 'Read traffic, acquisition, campaign, conversion, and content performance signals.',
    connectionKind: 'oauth',
    credentialRoute: 'Google OAuth with Analytics readonly scopes',
    primaryLabel: 'GA4 property ID',
    primaryPlaceholder: 'properties/123456789',
    scopes: ['analytics.readonly'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Needs Google OAuth and a GA4 reporting adapter before live reads.',
    icon: BarChart3,
    accent: '#a16207',
  },
  {
    provider: 'wordpress',
    category: 'publisher',
    label: 'WordPress',
    eyebrow: 'Publishing',
    description: 'Publish approved drafts, upload media, update posts, and read taxonomy context.',
    connectionKind: 'app_password',
    credentialRoute: 'WordPress application password stored as an encrypted client key',
    primaryLabel: 'WordPress site URL',
    primaryPlaceholder: 'https://blog.example.com',
    scopes: ['posts.write', 'posts.read', 'media.upload', 'taxonomies.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs the WordPress publishing function and encrypted application password.',
    icon: Globe2,
    accent: '#7c3aed',
  },
  {
    provider: 'webflow',
    category: 'cms',
    label: 'Webflow',
    eyebrow: 'CMS publishing',
    description: 'Create CMS items, stage drafts, and publish approved long-form content to Webflow.',
    connectionKind: 'api_key',
    credentialRoute: 'Webflow API token stored as an encrypted client key',
    primaryLabel: 'Site or collection ID',
    primaryPlaceholder: 'site_... or collection_...',
    scopes: ['cms.write', 'cms.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Webflow CMS adapter before live publishing.',
    icon: FileCode2,
    accent: '#2563eb',
  },
  {
    provider: 'contentful',
    category: 'cms',
    label: 'Contentful',
    eyebrow: 'Headless CMS',
    description: 'Create entries, attach assets, and route approved articles into a Contentful space.',
    connectionKind: 'api_key',
    credentialRoute: 'Contentful management token stored as an encrypted client key',
    primaryLabel: 'Space and environment',
    primaryPlaceholder: 'space_id / environment',
    scopes: ['entries.write', 'assets.write', 'entries.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Contentful management adapter before live publishing.',
    icon: Database,
    accent: '#0891b2',
  },
  {
    provider: 'sanity',
    category: 'cms',
    label: 'Sanity',
    eyebrow: 'Structured content',
    description: 'Write portable text, media references, and article documents into Sanity datasets.',
    connectionKind: 'api_key',
    credentialRoute: 'Sanity write token stored as an encrypted client key',
    primaryLabel: 'Project and dataset',
    primaryPlaceholder: 'project_id / production',
    scopes: ['documents.write', 'assets.write', 'documents.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Sanity mutation adapter before live publishing.',
    icon: Database,
    accent: '#dc2626',
  },
  {
    provider: 'strapi',
    category: 'cms',
    label: 'Strapi',
    eyebrow: 'Self-hosted CMS',
    description: 'Create and publish entries in a Strapi content type with media and metadata.',
    connectionKind: 'api_key',
    credentialRoute: 'Strapi API token stored as an encrypted client key',
    primaryLabel: 'API base and content type',
    primaryPlaceholder: 'https://cms.example.com / articles',
    scopes: ['content.write', 'content.read', 'media.upload'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Strapi adapter before live publishing.',
    icon: Database,
    accent: '#4f46e5',
  },
  {
    provider: 'hubspot_cms',
    category: 'cms',
    label: 'HubSpot CMS',
    eyebrow: 'Marketing CMS',
    description: 'Create blog posts and campaign content in HubSpot with approval controls.',
    connectionKind: 'api_key',
    credentialRoute: 'HubSpot private app token stored as an encrypted client key',
    primaryLabel: 'HubSpot blog ID',
    primaryPlaceholder: '123456789',
    scopes: ['cms.blogs.write', 'cms.blogs.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a HubSpot CMS adapter before live publishing.',
    icon: UploadCloud,
    accent: '#ea580c',
  },
  {
    provider: 'ghost',
    category: 'cms',
    label: 'Ghost',
    eyebrow: 'Editorial publishing',
    description: 'Send approved posts and newsletters into Ghost with tags, authors, and imagery.',
    connectionKind: 'api_key',
    credentialRoute: 'Ghost Admin API key stored as an encrypted client key',
    primaryLabel: 'Ghost Admin URL',
    primaryPlaceholder: 'https://publication.ghost.io',
    scopes: ['posts.write', 'posts.read', 'images.upload'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Ghost Admin API adapter before live publishing.',
    icon: FileCode2,
    accent: '#525252',
  },
  {
    provider: 'shopify_blog',
    category: 'cms',
    label: 'Shopify Blog',
    eyebrow: 'Commerce content',
    description: 'Publish SEO articles and product-led content to Shopify blogs.',
    connectionKind: 'api_key',
    credentialRoute: 'Shopify Admin API token stored as an encrypted client key',
    primaryLabel: 'Shop domain and blog ID',
    primaryPlaceholder: 'brand.myshopify.com / blog_id',
    scopes: ['blogs.write', 'blogs.read', 'files.write'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs a Shopify Admin API adapter before live publishing.',
    icon: ShoppingBag,
    accent: '#16a34a',
  },
  {
    provider: 'custom_cms',
    category: 'cms',
    label: 'Custom CMS',
    eyebrow: 'Other CMS',
    description: 'Register a generic publishing route for a client-specific CMS, webhook, or middleware.',
    connectionKind: 'webhook',
    credentialRoute: 'Webhook secret or API key stored as an encrypted client key',
    primaryLabel: 'Endpoint or adapter name',
    primaryPlaceholder: 'https://cms.example.com/api/vera',
    scopes: ['content.write', 'content.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true },
    setupNote: 'Needs a custom adapter contract before live publishing.',
    icon: Settings2,
    accent: '#be123c',
  },
]

const STATUS_LABELS: Record<ClientIntegrationStatus, string> = {
  not_connected: 'Planned',
  pending: 'Needs auth',
  connected: 'Connected',
  error: 'Error',
  paused: 'Paused',
  revoked: 'Revoked',
}

const STATUS_META: Record<ClientIntegrationStatus, { icon: ElementType; color: string }> = {
  not_connected: { icon: Clock3, color: '#78716c' },
  pending: { icon: KeyRound, color: '#a16207' },
  connected: { icon: CheckCircle2, color: '#059669' },
  error: { icon: AlertTriangle, color: '#dc2626' },
  paused: { icon: PauseCircle, color: '#78716c' },
  revoked: { icon: AlertTriangle, color: '#9f1239' },
}

const CAPABILITY_LABELS: Array<{ key: keyof IntegrationCapabilities; label: string }> = [
  { key: 'read', label: 'Read' },
  { key: 'ingest', label: 'Ingest' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'publish', label: 'Publish' },
  { key: 'upload_media', label: 'Media' },
  { key: 'schedule', label: 'Schedule' },
]

type Draft = {
  displayName: string
  status: ClientIntegrationStatus
  primaryRef: string
  notes: string
  approvalRequired: boolean
  capabilities: IntegrationCapabilities
}

function configString(row: ClientIntegration | undefined, key: string): string {
  const value = row?.config?.[key]
  return typeof value === 'string' ? value : ''
}

function configBool(row: ClientIntegration | undefined, key: string, fallback: boolean): boolean {
  const value = row?.config?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function makeDraft(template: IntegrationTemplate, row?: ClientIntegration): Draft {
  return {
    displayName: row?.display_name ?? template.label,
    status: row?.status ?? 'not_connected',
    primaryRef: configString(row, 'primary_ref'),
    notes: configString(row, 'notes'),
    approvalRequired: configBool(row, 'approval_required', true),
    capabilities: row?.capabilities ?? template.capabilities,
  }
}

function activeCapabilities(capabilities: IntegrationCapabilities): string[] {
  return CAPABILITY_LABELS
    .filter(({ key }) => capabilities[key])
    .map(({ label }) => label)
}

export function ClientIntegrationsCard() {
  const { activeProject } = useProject()
  const activeProjectId = activeProject?.id ?? null
  const [rows, setRows] = useState<ClientIntegration[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ClientIntegrationProvider>('google_search_console')
  const selectedTemplate = PROVIDERS.find(p => p.provider === selectedProvider) ?? PROVIDERS[0]
  const rowByProvider = useMemo(() => new Map(rows.map(row => [row.provider, row])), [rows])
  const selectedRow = rowByProvider.get(selectedProvider)
  const draftKey = `${selectedProvider}:${selectedRow?.id ?? 'new'}:${selectedRow?.updated_at ?? ''}`
  const [draftState, setDraftState] = useState<{ key: string; draft: Draft }>(() => ({
    key: 'google_search_console:new:',
    draft: makeDraft(PROVIDERS[0]),
  }))
  const draft = draftState.key === draftKey ? draftState.draft : makeDraft(selectedTemplate, selectedRow)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function updateDraft(updater: (draft: Draft) => Draft) {
    setDraftState(prev => {
      const base = prev.key === draftKey ? prev.draft : makeDraft(selectedTemplate, selectedRow)
      return { key: draftKey, draft: updater(base) }
    })
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!activeProjectId) {
        setRows([])
        return
      }
      setLoading(true)
      const { data, error } = await supabase
        .from('client_integrations')
        .select('*')
        .eq('project_id', activeProjectId)
        .order('category')
        .order('display_name')
      if (cancelled) return
      if (error) {
        setMessage({ type: 'err', text: error.message })
        setRows([])
      } else {
        setRows((data ?? []) as ClientIntegration[])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [activeProjectId])

  async function saveIntegration(nextStatus?: ClientIntegrationStatus) {
    if (!activeProject) return
    setSaving(true)
    setMessage(null)

    const status = nextStatus ?? draft.status
    const payload = {
      org_id: activeProject.org_id,
      project_id: activeProject.id,
      provider: selectedTemplate.provider,
      category: selectedTemplate.category,
      display_name: draft.displayName.trim() || selectedTemplate.label,
      status,
      connection_kind: selectedTemplate.connectionKind,
      config: {
        ...(selectedRow?.config ?? {}),
        primary_ref: draft.primaryRef.trim(),
        notes: draft.notes.trim(),
        approval_required: draft.approvalRequired,
        credential_route: selectedTemplate.credentialRoute,
        setup_note: selectedTemplate.setupNote,
      },
      capabilities: draft.capabilities,
      scopes: selectedTemplate.scopes,
      health_status: selectedRow?.health_status ?? 'unknown',
      health_detail: selectedRow?.health_detail ?? selectedTemplate.setupNote,
    }

    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id ?? null
    const query = selectedRow
      ? supabase
          .from('client_integrations')
          .update({ ...payload, updated_by: userId })
          .eq('id', selectedRow.id)
          .select()
          .single()
      : supabase
          .from('client_integrations')
          .insert({ ...payload, created_by: userId, updated_by: userId })
          .select()
          .single()

    const { data, error } = await query
    setSaving(false)
    if (error) {
      setMessage({ type: 'err', text: error.message })
      return
    }

    const saved = data as ClientIntegration
    const savedKey = `${selectedProvider}:${saved.id}:${saved.updated_at ?? ''}`
    setRows(prev => {
      const exists = prev.some(row => row.id === saved.id)
      return exists ? prev.map(row => row.id === saved.id ? saved : row) : [...prev, saved]
    })
    setDraftState({ key: savedKey, draft: makeDraft(selectedTemplate, saved) })
    setMessage({ type: 'ok', text: `${selectedTemplate.label} saved for ${activeProject.name}.` })
  }

  async function removeIntegration() {
    if (!selectedRow) return
    if (!confirm(`Remove ${selectedRow.display_name}? Vera will stop seeing this integration for this client space.`)) return
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('client_integrations').delete().eq('id', selectedRow.id)
    setSaving(false)
    if (error) {
      setMessage({ type: 'err', text: error.message })
      return
    }
    setRows(prev => prev.filter(row => row.id !== selectedRow.id))
    setDraftState({ key: `${selectedProvider}:new:`, draft: makeDraft(selectedTemplate) })
    setMessage({ type: 'ok', text: `${selectedTemplate.label} removed.` })
  }

  const connectedCount = rows.filter(row => row.status === 'connected').length
  const pendingCount = rows.filter(row => row.status === 'pending' || row.status === 'not_connected').length
  const publishCount = rows.filter(row => row.status === 'connected' && row.capabilities.publish).length

  if (!activeProject) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <p style={{ color: 'var(--ink)', fontSize: 'var(--t-body)', fontWeight: 650, margin: 0 }}>Agentic integrations</p>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', margin: '4px 0 0' }}>
          Select a client space before configuring search, analytics, and publishing connections.
        </p>
      </div>
    )
  }

  const StatusIcon = STATUS_META[draft.status].icon
  const SelectedIcon = selectedTemplate.icon

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p style={{ color: 'var(--ink)', fontSize: 'var(--t-body)', fontWeight: 700, margin: 0 }}>
            Agentic integrations
          </p>
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', lineHeight: 1.5, margin: '5px 0 0', maxWidth: 680 }}>
            Register Google Search Console (GSC), GA4, WordPress, and CMS routes per client space. Vera reads these capability records before she analyzes, ingests, or publishes anything.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 min-w-[260px]">
          <Metric label="Connected" value={connectedCount} />
          <Metric label="Planned" value={pendingCount} />
          <Metric label="Publish" value={publishCount} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(280px,0.85fr)_minmax(420px,1.15fr)] gap-4">
        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)' }}>
              <Loader2 size={14} className="animate-spin" /> Loading integrations
            </div>
          )}
          {PROVIDERS.map(template => {
            const row = rowByProvider.get(template.provider)
            const active = selectedProvider === template.provider
            const status = row?.status ?? 'not_connected'
            const statusMeta = STATUS_META[status]
            const ProviderIcon = template.icon
            const RowStatusIcon = statusMeta.icon
            return (
              <button
                key={template.provider}
                type="button"
                onClick={() => {
                  setSelectedProvider(template.provider)
                  setMessage(null)
                }}
                className="w-full text-left transition-colors"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '34px minmax(0,1fr)',
                  gap: 10,
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${active ? template.accent : 'var(--line)'}`,
                  background: active ? 'color-mix(in srgb, var(--surface) 88%, var(--paper-2))' : 'var(--surface)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-md)',
                    background: `${template.accent}18`,
                    color: template.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ProviderIcon size={16} strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span style={{ fontSize: 'var(--t-sm)', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {template.label}
                    </span>
                    <span className="inline-flex items-center gap-1" style={{ color: statusMeta.color, fontSize: 11, flexShrink: 0 }}>
                      <RowStatusIcon size={11} />
                      {STATUS_LABELS[status]}
                    </span>
                  </span>
                  <span style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.35, marginTop: 2 }}>
                    {template.eyebrow}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)', overflow: 'hidden' }}>
          <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex items-start gap-3">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 'var(--radius-md)',
                  background: `${selectedTemplate.accent}18`,
                  color: selectedTemplate.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <SelectedIcon size={19} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p style={{ color: 'var(--ink)', margin: 0, fontSize: 15, fontWeight: 700 }}>{selectedTemplate.label}</p>
                <p style={{ color: 'var(--ink-2)', margin: '4px 0 0', fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
                  {selectedTemplate.description}
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1.5"
                style={{
                  color: STATUS_META[draft.status].color,
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 999,
                  padding: '5px 8px',
                  fontSize: 11,
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                <StatusIcon size={12} />
                {STATUS_LABELS[draft.status]}
              </span>
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Labelled label="Display name">
                <input
                  value={draft.displayName}
                  onChange={event => updateDraft(prev => ({ ...prev, displayName: event.target.value }))}
                  style={inputStyle}
                  placeholder={selectedTemplate.label}
                />
              </Labelled>
              <Labelled label="Status">
                <select
                  value={draft.status}
                  onChange={event => updateDraft(prev => ({ ...prev, status: event.target.value as ClientIntegrationStatus }))}
                  style={inputStyle}
                >
                  {(Object.keys(STATUS_LABELS) as ClientIntegrationStatus[]).map(status => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </Labelled>
            </div>

            <Labelled label={selectedTemplate.primaryLabel}>
              <input
                value={draft.primaryRef}
                onChange={event => updateDraft(prev => ({ ...prev, primaryRef: event.target.value }))}
                style={inputStyle}
                placeholder={selectedTemplate.primaryPlaceholder}
              />
            </Labelled>

            <div>
              <p style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 650, margin: '0 0 8px' }}>Agent capabilities</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CAPABILITY_LABELS.map(({ key, label }) => {
                  const active = !!draft.capabilities[key]
                  return (
                    <button
                      key={String(key)}
                      type="button"
                      onClick={() => updateDraft(prev => ({
                        ...prev,
                        capabilities: { ...prev.capabilities, [key]: !prev.capabilities[key] },
                      }))}
                      style={{
                        minHeight: 34,
                        borderRadius: 'var(--radius-md)',
                        border: active ? `1px solid ${selectedTemplate.accent}` : '1px solid var(--line)',
                        background: active ? `${selectedTemplate.accent}16` : 'var(--surface)',
                        color: active ? selectedTemplate.accent : 'var(--ink-2)',
                        fontSize: 12,
                        fontWeight: 650,
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="flex items-start gap-2" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={draft.approvalRequired}
                onChange={event => updateDraft(prev => ({ ...prev, approvalRequired: event.target.checked }))}
                className="mt-1"
              />
              Require human approval before publish, destructive edits, or sending data outside Vera.
            </label>

            <Labelled label="Notes for adapter setup">
              <textarea
                value={draft.notes}
                onChange={event => updateDraft(prev => ({ ...prev, notes: event.target.value }))}
                style={{ ...inputStyle, minHeight: 78, resize: 'vertical' }}
                placeholder={selectedTemplate.setupNote}
              />
            </Labelled>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div className="flex items-start gap-2">
                <ShieldCheck size={15} style={{ color: selectedTemplate.accent, flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 650, margin: 0 }}>Credential route</p>
                  <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '3px 0 0' }}>
                    {selectedTemplate.credentialRoute}. Do not paste secrets here. This registry only stores state, scopes, and non-secret config.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedTemplate.scopes.map(scope => (
                  <span key={scope} style={chipStyle}>{scope}</span>
                ))}
              </div>
            </div>

            {selectedRow && (
              <div className="flex flex-wrap gap-1.5">
                {activeCapabilities(selectedRow.capabilities).map(capability => (
                  <span key={capability} style={{ ...chipStyle, color: selectedTemplate.accent }}>{capability}</span>
                ))}
                <span style={chipStyle}>Health: {selectedRow.health_status}</span>
              </div>
            )}

            {message && (
              <p
                className="inline-flex items-center gap-1.5"
                style={{
                  color: message.type === 'ok' ? '#059669' : '#dc2626',
                  fontSize: 'var(--t-sm)',
                  margin: 0,
                }}
              >
                {message.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {message.text}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveIntegration()}
                  disabled={saving}
                  className="inline-flex items-center gap-2"
                  style={primaryButtonStyle}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save integration
                </button>
                <button
                  type="button"
                  onClick={() => saveIntegration('pending')}
                  disabled={saving}
                  className="inline-flex items-center gap-2"
                  style={secondaryButtonStyle}
                >
                  <KeyRound size={14} />
                  Mark needs auth
                </button>
              </div>
              {selectedRow && (
                <button
                  type="button"
                  onClick={removeIntegration}
                  disabled={saving}
                  className="inline-flex items-center gap-2"
                  style={{ ...secondaryButtonStyle, color: '#dc2626' }}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>

            <p style={{ color: 'var(--ink-2)', fontSize: 11, lineHeight: 1.45, margin: 0 }}>
              {selectedTemplate.setupNote}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
      <p style={{ color: 'var(--ink)', fontSize: 16, fontWeight: 750, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <p style={{ color: 'var(--ink-2)', fontSize: 11, margin: '1px 0 0' }}>{label}</p>
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 650, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  borderRadius: 'var(--radius-md)',
  padding: '9px 10px',
  fontSize: 13,
  outline: 'none',
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--line)',
  borderRadius: 999,
  background: 'var(--paper)',
  color: 'var(--ink-2)',
  padding: '3px 7px',
  fontSize: 11,
  fontWeight: 600,
}

const primaryButtonStyle: CSSProperties = {
  minHeight: 34,
  border: '1px solid var(--ink)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  borderRadius: 'var(--radius-md)',
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  minHeight: 34,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink-2)',
  borderRadius: 'var(--radius-md)',
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 650,
  cursor: 'pointer',
}
