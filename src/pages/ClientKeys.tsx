// Per-client API keys. A client manages its OWN provider keys inside its OWN
// space (scoped to the active project), rather than the agency-wide /clients
// shelf. Saving goes through the client-secrets function (which authorizes via
// canManageProject — the space owner / org admins); listing + revoking are
// direct, gated by client_api_keys RLS (can_project_manage).
import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCircle2, Clapperboard, ImagePlus, KeyRound, Lock, Trash2, type LucideIcon } from 'lucide-react'
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

const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter (text + images)' },
  { value: 'anthropic', label: 'Anthropic (text)' },
  { value: 'openai', label: 'OpenAI (images)' },
  { value: 'fal', label: 'FAL (images + video)' },
]
const providerLabel = (v: string) => PROVIDERS.find(p => p.value === v)?.label ?? v

export default function ClientKeys() {
  const { activeProject } = useProject()
  const { session } = useAuth()
  const { push } = useToast()
  const [keys, setKeys] = useState<ClientApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState('openrouter')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [config, setConfig] = useState('')
  const [saving, setSaving] = useState(false)

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
      ready: activeProviders.has('openrouter') || activeProviders.has('openai') || activeProviders.has('fal'),
      body: activeProviders.has('openrouter')
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
      ready: activeProviders.has('fal') || activeProviders.has('fal_ai'),
      body: activeProviders.has('fal') || activeProviders.has('fal_ai')
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
