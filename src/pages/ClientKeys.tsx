// Per-client API keys. A client manages its OWN provider keys inside its OWN
// space (scoped to the active project), rather than the agency-wide /clients
// shelf. Saving goes through the client-secrets function (which authorizes via
// canManageProject — the space owner / org admins); listing + revoking are
// direct, gated by client_api_keys RLS (can_project_manage).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Bot, CheckCircle2, Clapperboard, Clock3, Crown, ImagePlus, KeyRound, Lock, RefreshCw, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useProject } from '../lib/projectContext'
import { PageHeader, SectionLabel, Button, Field, Input, Select, Textarea, color, space, type as t, radius, useToast } from '../design'

type ClientApiKey = {
  id: string
  provider: string
  label: string
  secret_preview: string | null
  status: 'active' | 'invalid' | 'revoked'
  last_used_at: string | null
  created_at: string
}

type UsageMetadata = Record<string, unknown>

type GenerationUsageRow = {
  id: string
  provider: string | null
  operation: string | null
  model_used: string | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number | null
  cost_usd: number | null
  usage_metadata: UsageMetadata | null
  created_at: string
}

type AiPolicy = {
  images_enabled: boolean
  standard_video_enabled: boolean
  premium_media_enabled: boolean
}

const DEFAULT_AI_POLICY: AiPolicy = {
  images_enabled: true,
  standard_video_enabled: false,
  premium_media_enabled: false,
}

const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter (text + images)' },
  { value: 'anthropic', label: 'Anthropic (text)' },
  { value: 'openai', label: 'OpenAI (images)' },
  { value: 'fal', label: 'FAL (images + video)' },
]
const providerLabel = (v: string) => PROVIDERS.find(p => p.value === v)?.label ?? v

export default function ClientKeys() {
  const { activeProject, refetch } = useProject()
  const { session } = useAuth()
  const { push } = useToast()
  const [keys, setKeys] = useState<ClientApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState('openrouter')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [config, setConfig] = useState('')
  const [saving, setSaving] = useState(false)
  const [usageRows, setUsageRows] = useState<GenerationUsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [aiPolicy, setAiPolicy] = useState<AiPolicy>(DEFAULT_AI_POLICY)
  const [policySaving, setPolicySaving] = useState(false)

  const load = useCallback(async () => {
    if (!activeProject?.id) { setKeys([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('client_api_keys')
      .select('id, provider, label, secret_preview, status, last_used_at, created_at')
      .eq('project_id', activeProject.id)
      .order('created_at', { ascending: false })
    setKeys((data ?? []) as ClientApiKey[])
    setLoading(false)
  }, [activeProject?.id])

  useEffect(() => { void load() }, [load])

  const loadUsage = useCallback(async () => {
    if (!activeProject?.id) {
      setUsageRows([])
      setUsageLoading(false)
      setUsageError(null)
      return
    }
    setUsageLoading(true)
    setUsageError(null)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('generation_log')
      .select('id, provider, operation, model_used, input_tokens, output_tokens, duration_ms, cost_usd, usage_metadata, created_at')
      .eq('project_id', activeProject.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      setUsageRows([])
      setUsageError(error.message)
    } else {
      setUsageRows((data ?? []) as GenerationUsageRow[])
    }
    setUsageLoading(false)
  }, [activeProject?.id])

  useEffect(() => { void loadUsage() }, [loadUsage])

  useEffect(() => {
    setAiPolicy(parseAiPolicy(activeProject?.ai_policy))
  }, [activeProject?.id, activeProject?.ai_policy])

  async function saveKey() {
    if (!activeProject?.id || !session?.access_token) return
    if (!label.trim() || !secret.trim()) { push({ kind: 'warn', title: 'Add a label and an API key' }); return }
    let cfg: Record<string, unknown> = {}
    if (config.trim()) {
      try {
        const parsed = JSON.parse(config)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        cfg = parsed as Record<string, unknown>
      } catch { push({ kind: 'danger', title: 'Provider config must be a JSON object' }); return }
    }
    setSaving(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-secrets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: activeProject.id, provider, label: label.trim(), secret: secret.trim(), config: cfg }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; warning?: string; model_count?: number }
      if (!res.ok) throw new Error(data.error ?? `Save failed (HTTP ${res.status})`)
      setSecret(''); setLabel('')
      push({
        kind: data.warning ? 'warn' : 'success',
        title: data.warning ? 'Key saved with a note' : 'API key saved',
        body: data.warning ?? `Validated for ${providerLabel(provider)}.`,
      })
      await load()
    } catch (e) {
      push({ kind: 'danger', title: 'Could not save the key', body: e instanceof Error ? e.message : 'Save failed' })
    } finally { setSaving(false) }
  }

  async function revokeKey(id: string) {
    const { error } = await supabase.from('client_api_keys').update({ status: 'revoked' }).eq('id', id)
    if (error) { push({ kind: 'danger', title: 'Could not revoke the key', body: error.message }); return }
    push({ kind: 'success', title: 'Key revoked' })
    await load()
  }

  async function saveAiPolicy(next: AiPolicy) {
    if (!activeProject?.id) return
    const prev = aiPolicy
    setAiPolicy(next)
    setPolicySaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ ai_policy: next })
      .eq('id', activeProject.id)
    setPolicySaving(false)
    if (error) {
      setAiPolicy(prev)
      push({ kind: 'danger', title: 'Policy update failed', body: error.message })
      return
    }
    refetch()
    push({ kind: 'success', title: 'AI usage policy updated' })
  }

  function togglePolicy(key: keyof AiPolicy, value: boolean) {
    void saveAiPolicy({ ...aiPolicy, [key]: value })
  }

  const usageSummary = useMemo(() => summarizeUsage(usageRows), [usageRows])

  if (!activeProject) return null
  const active = keys.filter(k => k.status === 'active')
  const activeProviders = new Set(active.map(k => k.provider))
  const clientCapabilities = [
    {
      icon: Bot,
      title: 'Text engine',
      ready: activeProviders.has('openrouter') || activeProviders.has('anthropic'),
      body: activeProviders.has('openrouter')
        ? 'OpenRouter is active for chat, content generation, and model testing.'
        : activeProviders.has('anthropic')
          ? 'Anthropic is active for chat and content generation.'
          : 'Add OpenRouter or Anthropic before relying on client-owned text generation.',
    },
    {
      icon: ImagePlus,
      title: 'Image generation',
      ready: aiPolicy.images_enabled && (activeProviders.has('openrouter') || activeProviders.has('openai') || activeProviders.has('fal')),
      body: !aiPolicy.images_enabled
        ? 'Locked by policy. Vera will not generate images for this client space.'
        : activeProviders.has('openrouter')
        ? 'Nano Banana and supported image models can run through this client OpenRouter key.'
        : activeProviders.has('openai')
          ? 'Premium OpenAI image generation is available for this client.'
          : activeProviders.has('fal')
            ? 'FAL image models are available for this client.'
            : 'Add OpenRouter for the normal image path, or FAL/OpenAI for provider-specific image models.',
    },
    {
      icon: Clapperboard,
      title: 'Video rendering',
      ready: aiPolicy.standard_video_enabled && (activeProviders.has('fal') || activeProviders.has('fal_ai')),
      body: !aiPolicy.standard_video_enabled
        ? 'Locked by policy. Vera will use storyboards and briefs instead of real video renders.'
        : activeProviders.has('fal') || activeProviders.has('fal_ai')
          ? 'Client-owned FAL is active. Video rendering can run from this client budget.'
        : 'Locked. Real video rendering requires a client-owned FAL key. Vera will use storyboards and briefs instead.',
    },
  ]

  const card: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }
  const statusColor = (s: string) => s === 'active' ? color.success : s === 'invalid' ? color.danger : color.ghost

  return (
    <div style={{ padding: `${space[8]} ${space[8]} ${space[10]}`, maxWidth: 820 }}>
      <PageHeader
        eyebrow={activeProject.name}
        title="API keys"
        subtitle="Connect this space to its own AI provider keys. Keys are stored encrypted and used only for this client. OpenRouter covers text and supported image models. FAL is required for client-owned video generation."
      />

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Client-owned capabilities</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: space[3] }}>
          {clientCapabilities.map(item => (
            <CapabilityCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }} action={policySaving ? 'Saving...' : 'Auto-save'}>AI usage policy</SectionLabel>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: space[3] }}>
            <PolicyToggle
              icon={ImagePlus}
              title="Image generation"
              body="Allow standard image generation through client-owned OpenRouter, FAL, or OpenAI keys."
              checked={aiPolicy.images_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('images_enabled', value)}
            />
            <PolicyToggle
              icon={Clapperboard}
              title="Standard video"
              body="Allow real video renders only when this client also has its own active FAL key."
              checked={aiPolicy.standard_video_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('standard_video_enabled', value)}
            />
            <PolicyToggle
              icon={Crown}
              title="Premium media"
              body="Allow premium image and video models only for client budgets that explicitly cover them."
              checked={aiPolicy.premium_media_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('premium_media_enabled', value)}
              danger
            />
          </div>
          <p style={{ fontSize: t.size.micro, color: color.faint, margin: `${space[3]} 0 0`, lineHeight: 1.5 }}>
            Text generation stays available through the selected text provider. Video still requires a client-owned FAL key even when enabled here.
          </p>
        </div>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel
          style={{ marginBottom: space[3] }}
          action={
            <button
              type="button"
              onClick={() => void loadUsage()}
              title="Refresh usage"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', color: color.ghost, cursor: 'pointer', fontSize: t.size.micro, padding: 0 }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          }
        >
          Usage ledger
        </SectionLabel>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: space[3], marginBottom: space[5] }}>
            <UsageMetric icon={Activity} label="Events" value={formatNumber(usageSummary.events)} detail="Last 30 days" tone="info" />
            <UsageMetric icon={Bot} label="Text tokens" value={formatNumber(usageSummary.tokens)} detail={`${formatNumber(usageSummary.chatEvents)} chat turns`} tone="success" />
            <UsageMetric icon={ImagePlus} label="Images" value={formatNumber(usageSummary.images)} detail={`${formatNumber(usageSummary.imageEvents)} image events`} tone="warn" />
            <UsageMetric icon={Clapperboard} label="Videos" value={formatNumber(usageSummary.videos)} detail={`${formatNumber(usageSummary.videoEvents)} submits`} tone="danger" />
            <UsageMetric icon={KeyRound} label="Client key" value={formatNumber(usageSummary.clientKeyEvents)} detail={`${formatNumber(usageSummary.platformKeyEvents)} platform-backed`} tone="success" />
            <UsageMetric icon={Clock3} label="Estimated spend" value={formatMoney(usageSummary.knownCost)} detail={usageSummary.hasKnownCost ? `${formatNumber(usageSummary.estimatedCostEvents)} estimated rows` : 'Provider billing pending'} tone="info" />
          </div>

          {usageError ? (
            <div style={{ border: `1px solid ${color.danger}`, borderRadius: radius.md, padding: space[4], color: color.danger, fontSize: t.size.cap }}>
              Usage could not load: {usageError}
            </div>
          ) : usageLoading ? (
            <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0 }}>Loading usage...</p>
          ) : usageRows.length === 0 ? (
            <div style={{ border: `1px dashed ${color.line}`, borderRadius: radius.md, padding: space[5], textAlign: 'center' }}>
              <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0 }}>No usage recorded in the last 30 days. Completed chat, image, and video runs will appear here.</p>
            </div>
          ) : (
            <UsageTable rows={usageRows.slice(0, 12)} />
          )}
        </div>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Add a key</SectionLabel>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
            <Field label="Provider">
              <Select value={provider} onChange={e => setProvider(e.target.value)}>
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Label">
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Production key" />
            </Field>
          </div>
          <div style={{ marginTop: space[4] }}>
            <Field label="API key">
              <Input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Paste the provider API key" autoComplete="off" />
            </Field>
          </div>
          <div style={{ marginTop: space[4] }}>
            <Field label="Provider config (JSON)" optional helper="Only for provider-specific options. Do not put secondary secrets here.">
              <Textarea value={config} onChange={e => setConfig(e.target.value)} rows={2} placeholder='{"endpoint":"..."}' />
            </Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: space[4] }}>
            <Button variant="primary" leading={<KeyRound size={14} />} onClick={saveKey} disabled={saving || !label.trim() || !secret.trim()}>
              {saving ? 'Saving' : 'Save key'}
            </Button>
          </div>
          <p style={{ fontSize: t.size.micro, color: color.faint, margin: `${space[3]} 0 0`, lineHeight: 1.5 }}>
            The key is validated with the provider and stored encrypted. Only the space owner can add or revoke keys.
          </p>
        </div>
      </section>

      <section>
        <SectionLabel style={{ marginBottom: space[3] }} action={`${active.length} active`}>Saved keys</SectionLabel>
        {loading ? (
          <p style={{ fontSize: t.size.cap, color: color.ghost }}>Loading…</p>
        ) : keys.length === 0 ? (
          <div style={{ ...card, textAlign: 'center' }}>
            <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0 }}>No keys yet. Add one above to run this space on its own provider key.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            {keys.map(k => (
              <div key={k.id} style={{ ...card, padding: space[4], display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], opacity: k.status === 'revoked' ? 0.55 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: space[2] }}>
                    <span style={{ fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{k.label}</span>
                    <span style={{ fontSize: t.size.micro, color: color.ghost }}>{providerLabel(k.provider)}</span>
                  </div>
                  <div style={{ fontSize: t.size.micro, color: color.faint, marginTop: 2 }}>
                    <span style={{ color: statusColor(k.status), textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.status}</span>
                    {k.secret_preview ? ` · ${k.secret_preview}` : ''}
                    {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {k.status === 'active' && (
                  <button onClick={() => revokeKey(k.id)} title="Revoke this key"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surface, color: color.ink2, fontSize: t.size.micro, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <Trash2 size={13} /> Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PolicyToggle({
  icon: Icon,
  title,
  body,
  checked,
  disabled,
  danger,
  onChange,
}: {
  icon: LucideIcon
  title: string
  body: string
  checked: boolean
  disabled?: boolean
  danger?: boolean
  onChange: (value: boolean) => void
}) {
  const accent = danger ? color.danger : checked ? color.success : color.ghost
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: space[3], background: checked ? 'var(--success-tint)' : color.paper2, border: `1px solid ${checked ? 'var(--success-line)' : color.line}`, borderRadius: radius.md, padding: space[4], minHeight: 154, cursor: disabled ? 'wait' : 'pointer' }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
          <Icon size={16} style={{ color: accent }} />
          {title}
        </span>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 38, height: 22, borderRadius: radius.pill, background: checked ? color.success : color.line2, transition: 'background 120ms ease' }}>
          <span style={{ width: 18, height: 18, borderRadius: radius.pill, background: '#fff', transform: checked ? 'translateX(18px)' : 'translateX(2px)', transition: 'transform 120ms ease', boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }} />
        </span>
      </span>
      <span style={{ color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>{body}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: checked ? color.success : color.ghost, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {checked ? <ShieldCheck size={12} /> : <Lock size={12} />}
        {checked ? 'Enabled' : 'Locked'}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.currentTarget.checked)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        aria-label={title}
      />
    </label>
  )
}

function UsageMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: 'success' | 'warn' | 'danger' | 'info'
}) {
  const toneColor = tone === 'success' ? color.success : tone === 'warn' ? color.warn : tone === 'danger' ? color.danger : color.info
  return (
    <div style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[4], minHeight: 98 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[3] }}>
        <span style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: t.weight.semibold }}>{label}</span>
        <Icon size={15} style={{ color: toneColor }} />
      </div>
      <div style={{ color: color.ink, fontSize: t.size.h3, fontWeight: 650, lineHeight: 1.1 }}>{value}</div>
      <div style={{ color: color.faint, fontSize: t.size.micro, marginTop: space[2] }}>{detail}</div>
    </div>
  )
}

function UsageTable({ rows }: { rows: GenerationUsageRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${color.line}` }}>
            {['When', 'Operation', 'Provider', 'Model', 'Meter', 'Key'].map(label => (
              <th key={label} style={{ textAlign: 'left', padding: `${space[2]} ${space[3]}`, color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: t.weight.semibold }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const metadata = safeMetadata(row.usage_metadata)
            const keySource = typeof metadata.key_source === 'string' ? metadata.key_source : 'unknown'
            return (
              <tr key={row.id} style={{ borderBottom: `1px solid ${color.line}` }}>
                <td style={cellStyle}>{formatDateTime(row.created_at)}</td>
                <td style={cellStyle}>{formatOperation(row.operation)}</td>
                <td style={cellStyle}>{providerLabel(row.provider ?? '')}</td>
                <td style={{ ...cellStyle, maxWidth: 220 }}>
                  <span title={row.model_used ?? ''} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: t.family.mono }}>
                    {row.model_used ?? 'unknown'}
                  </span>
                </td>
                <td style={cellStyle}>{formatMeter(row, metadata)}</td>
                <td style={cellStyle}>
                  <span style={{ color: keySource === 'client' ? color.success : keySource === 'platform' ? color.warn : color.ghost, fontWeight: t.weight.semibold }}>
                    {formatKeySource(keySource)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  padding: `${space[3]} ${space[3]}`,
  color: color.ink2,
  fontSize: t.size.cap,
  verticalAlign: 'middle',
}

function summarizeUsage(rows: GenerationUsageRow[]) {
  return rows.reduce(
    (summary, row) => {
      const metadata = safeMetadata(row.usage_metadata)
      const operation = row.operation ?? ''
      const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
      summary.events += 1
      summary.tokens += tokens
      if (operation === 'chat.message') summary.chatEvents += 1
      if (operation.startsWith('image.')) {
        summary.imageEvents += 1
        summary.images += numberFromMetadata(metadata.num_images, 1)
      }
      if (operation.startsWith('video.')) {
        summary.videoEvents += 1
        summary.videos += 1
      }
      if (metadata.key_source === 'client') summary.clientKeyEvents += 1
      if (metadata.key_source === 'platform') summary.platformKeyEvents += 1
      if (typeof row.cost_usd === 'number') {
        summary.knownCost += row.cost_usd
        summary.hasKnownCost = true
        if (metadata.cost_estimate_source) summary.estimatedCostEvents += 1
      }
      return summary
    },
    {
      events: 0,
      tokens: 0,
      chatEvents: 0,
      images: 0,
      imageEvents: 0,
      videos: 0,
      videoEvents: 0,
      clientKeyEvents: 0,
      platformKeyEvents: 0,
      knownCost: 0,
      hasKnownCost: false,
      estimatedCostEvents: 0,
    },
  )
}

function safeMetadata(value: UsageMetadata | null): UsageMetadata {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function parseAiPolicy(value: unknown): AiPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_AI_POLICY
  const raw = value as Record<string, unknown>
  return {
    images_enabled: typeof raw.images_enabled === 'boolean' ? raw.images_enabled : DEFAULT_AI_POLICY.images_enabled,
    standard_video_enabled: typeof raw.standard_video_enabled === 'boolean' ? raw.standard_video_enabled : DEFAULT_AI_POLICY.standard_video_enabled,
    premium_media_enabled: typeof raw.premium_media_enabled === 'boolean' ? raw.premium_media_enabled : DEFAULT_AI_POLICY.premium_media_enabled,
  }
}

function numberFromMetadata(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatMeter(row: GenerationUsageRow, metadata: UsageMetadata) {
  const operation = row.operation ?? ''
  if (operation === 'chat.message') {
    return `${formatNumber((row.input_tokens ?? 0) + (row.output_tokens ?? 0))} tokens`
  }
  if (operation.startsWith('image.')) {
    return `${formatNumber(numberFromMetadata(metadata.num_images, 1))} image${numberFromMetadata(metadata.num_images, 1) === 1 ? '' : 's'}`
  }
  if (operation.startsWith('video.')) {
    const estimate = typeof metadata.estimate === 'string' ? metadata.estimate : null
    return estimate ?? '1 submit'
  }
  if (row.duration_ms) return `${Math.round(row.duration_ms / 100) / 10}s`
  return 'Recorded'
}

function formatOperation(value: string | null) {
  if (!value) return 'Unknown'
  return value.split('.').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function formatKeySource(value: string) {
  if (value === 'client') return 'Client'
  if (value === 'platform') return 'Platform'
  return 'Unknown'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function CapabilityCard({
  icon: Icon,
  title,
  ready,
  body,
}: {
  icon: LucideIcon
  title: string
  ready: boolean
  body: string
}) {
  return (
    <div style={{ background: ready ? 'var(--success-tint)' : color.surface, border: `1px solid ${ready ? 'var(--success-line)' : color.line}`, borderRadius: radius.lg, padding: space[4], minHeight: 132 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[3] }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
          <Icon size={16} />
          {title}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ready ? color.success : color.ghost, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {ready ? <CheckCircle2 size={12} /> : <Lock size={12} />}
          {ready ? 'Ready' : 'Locked'}
        </span>
      </div>
      <p style={{ color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5, margin: 0 }}>{body}</p>
    </div>
  )
}
