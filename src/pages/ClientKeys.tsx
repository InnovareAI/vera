// Per-client API keys. A client manages its OWN provider keys inside its OWN
// space (scoped to the active project), rather than the agency-wide /clients
// shelf. Saving goes through the client-secrets function (which authorizes via
// canManageProject — the space owner / org admins); listing + revoking are
// direct, gated by client_api_keys RLS (can_project_manage).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BookOpen, Bot, CheckCircle2, Clapperboard, Clock3, Crown, DollarSign, ImagePlus, KeyRound, Lock, RefreshCw, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useProject } from '../lib/projectContext'
import {
  IMAGE_MODEL_OPTIONS,
  IMAGE_VIDEO_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
  buildModelRecommendations,
  imageSpendEstimate,
  imageModelProvider,
  imageModelProviderLabel,
  isPremiumImageModel,
  latestPricingReviewDate,
  modelLabel,
  textSpendEstimate,
  videoSpendEstimate,
  type ModelRecommendation,
  type ModelPricingGuide,
  type SpendEstimate,
} from '../lib/modelEconomics'
import { useModelPricingCatalog, type ModelPricingCatalogSource } from '../lib/useModelPricingCatalog'
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

type UsageCostDriver = {
  key: string
  operation: string
  provider: string
  model: string
  keySource: string
  events: number
  tokens: number
  images: number
  videos: number
  cost: number
  knownCostEvents: number
  latestAt: string
}

type AiPolicy = {
  images_enabled: boolean
  standard_video_enabled: boolean
  premium_media_enabled: boolean
  platform_media_keys_enabled: boolean
  budget_guard_enabled: boolean
  budget_guard_mode: 'warn' | 'enforce'
  monthly_budget_usd: number | null
  default_text_model: string | null
  default_image_model: string
  default_video_model: string
  default_image_video_model: string
}

const DEFAULT_AI_POLICY: AiPolicy = {
  images_enabled: true,
  standard_video_enabled: false,
  premium_media_enabled: false,
  platform_media_keys_enabled: false,
  budget_guard_enabled: true,
  budget_guard_mode: 'warn',
  monthly_budget_usd: null,
  default_text_model: null,
  default_image_model: 'nano-banana',
  default_video_model: 'hailuo',
  default_image_video_model: 'hailuo-i2v',
}

const SUCCESS_TINT = 'rgba(45, 122, 59, 0.08)'
const SUCCESS_LINE = 'rgba(45, 122, 59, 0.28)'
const WARN_TINT = 'rgba(176, 122, 12, 0.09)'
const DANGER_TINT = 'rgba(185, 28, 28, 0.08)'

const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter (text + images)' },
  { value: 'anthropic', label: 'Anthropic (text)' },
  { value: 'openai', label: 'OpenAI (images + embeddings)' },
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
  const [budgetDraft, setBudgetDraft] = useState('')
  const [modelDraft, setModelDraft] = useState({
    default_text_model: '',
    default_image_model: DEFAULT_AI_POLICY.default_image_model,
    default_video_model: DEFAULT_AI_POLICY.default_video_model,
    default_image_video_model: DEFAULT_AI_POLICY.default_image_video_model,
  })
  const [policySaving, setPolicySaving] = useState(false)
  const { catalog: pricingCatalog, source: pricingSource, rowCount: pricingRowCount } = useModelPricingCatalog()

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
    const since = usageQueryStartIso()
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
    const next = parseAiPolicy(activeProject?.ai_policy)
    setAiPolicy(next)
    setBudgetDraft(next.monthly_budget_usd === null ? '' : String(next.monthly_budget_usd))
    setModelDraft({
      default_text_model: next.default_text_model ?? '',
      default_image_model: next.default_image_model,
      default_video_model: next.default_video_model,
      default_image_video_model: next.default_image_video_model,
    })
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
    push({ kind: 'success', title: 'Generation policy updated' })
  }

  function togglePolicy(key: 'images_enabled' | 'standard_video_enabled' | 'premium_media_enabled' | 'budget_guard_enabled', value: boolean) {
    if (value && key === 'images_enabled') {
      const route = imageModelProvider(aiPolicy.default_image_model, { hasOpenRouter, hasOpenAI, hasFal })
      if (!route) {
        push({
          kind: 'warn',
          title: 'Image route is not ready',
          body: `${modelLabel(aiPolicy.default_image_model)} does not match this space's active keys. Add OpenRouter for Nano Banana, FAL for Seedream/Qwen/FAL routes, or OpenAI for OpenAI Image Gen 2.`,
        })
        return
      }
    }
    if (value && key === 'standard_video_enabled' && !hasFal) {
      push({
        kind: 'warn',
        title: 'Add space FAL first',
        body: 'Standard video can only be enabled when this space has its own active FAL key.',
      })
      return
    }
    if (value && (key === 'standard_video_enabled' || key === 'premium_media_enabled') && !aiPolicy.monthly_budget_usd) {
      push({ kind: 'warn', title: 'Set a generation cap first', body: 'Video and premium media require an explicit space generation cap.' })
      return
    }
    void saveAiPolicy({ ...aiPolicy, [key]: value })
  }

  function saveBudgetGuardMode(mode: 'warn' | 'enforce') {
    void saveAiPolicy({ ...aiPolicy, budget_guard_mode: mode, budget_guard_enabled: true })
  }

  function saveBudgetCap() {
    const raw = budgetDraft.trim()
    const nextBudget = raw === '' ? null : Number(raw)
    if (nextBudget !== null && (!Number.isFinite(nextBudget) || nextBudget < 0)) {
      push({ kind: 'warn', title: 'Enter a valid generation cap' })
      return
    }
    const normalized = nextBudget !== null && nextBudget > 0
      ? Math.round(nextBudget * 100) / 100
      : null
    if (normalized === null && (aiPolicy.standard_video_enabled || aiPolicy.premium_media_enabled)) {
      push({ kind: 'warn', title: 'Keep a cap for paid media', body: 'Turn off video and premium media before clearing the generation cap.' })
      return
    }
    setBudgetDraft(normalized === null ? '' : String(normalized))
    void saveAiPolicy({ ...aiPolicy, monthly_budget_usd: normalized })
  }

  function saveModelDefaults() {
    const next: AiPolicy = {
      ...aiPolicy,
      default_text_model: modelDraft.default_text_model.trim() || null,
      default_image_model: modelDraft.default_image_model || DEFAULT_AI_POLICY.default_image_model,
      default_video_model: modelDraft.default_video_model || DEFAULT_AI_POLICY.default_video_model,
      default_image_video_model: modelDraft.default_image_video_model || DEFAULT_AI_POLICY.default_image_video_model,
    }
    const imageRoute = imageModelProvider(next.default_image_model, { hasOpenRouter, hasOpenAI, hasFal })
    if (next.images_enabled && !imageRoute) {
      push({
        kind: 'warn',
        title: 'Selected image model cannot run',
        body: `${modelLabel(next.default_image_model)} does not match this space's active keys. Use Nano Banana with OpenRouter, Seedream/Qwen/FAL routes with FAL, or OpenAI Image Gen 2 with OpenAI.`,
      })
      return
    }
    if (isPremiumImageModel(next.default_image_model) && !next.premium_media_enabled) {
      push({
        kind: 'warn',
        title: 'Premium media is locked',
        body: `${modelLabel(next.default_image_model)} is a premium image model. Enable Premium media with a generation cap before making it the default.`,
      })
      return
    }
    if (isPremiumImageModel(next.default_image_model) && !next.monthly_budget_usd) {
      push({
        kind: 'warn',
        title: 'Set a generation cap first',
        body: 'Premium image defaults require an explicit space generation cap.',
      })
      return
    }
    if ((next.standard_video_enabled || next.premium_media_enabled) && !hasFal && (next.default_video_model || next.default_image_video_model)) {
      push({
        kind: 'warn',
        title: 'Video defaults need space FAL',
        body: 'Real video rendering is space-funded only. Add a space-owned FAL key before saving video defaults for an enabled video policy.',
      })
      return
    }
    void saveAiPolicy(next)
  }

  const usageSummary = useMemo(() => summarizeUsage(usageRows), [usageRows])
  const costDrivers = useMemo(() => buildUsageCostDrivers(usageRows), [usageRows])

  if (!activeProject) return null
  const active = keys.filter(k => k.status === 'active')
  const activeProviders = new Set(active.map(k => k.provider))
  const hasOpenRouter = activeProviders.has('openrouter')
  const hasAnthropic = activeProviders.has('anthropic')
  const hasOpenAI = activeProviders.has('openai')
  const hasFal = activeProviders.has('fal') || activeProviders.has('fal_ai')
  const defaultImageRoute = imageModelProvider(aiPolicy.default_image_model, { hasOpenRouter, hasOpenAI, hasFal })
  const defaultImageReady = aiPolicy.images_enabled && !!defaultImageRoute
  const modelRecommendations = buildModelRecommendations({
    textReady: hasOpenRouter || hasAnthropic,
    imageReady: defaultImageReady,
    videoReady: aiPolicy.standard_video_enabled && hasFal,
    hasOpenRouter,
    hasAnthropic,
    hasOpenAI,
    hasFal,
    imagesEnabled: aiPolicy.images_enabled,
    standardVideoEnabled: aiPolicy.standard_video_enabled,
    premiumMediaEnabled: aiPolicy.premium_media_enabled,
    defaultTextModel: aiPolicy.default_text_model,
    defaultImageModel: aiPolicy.default_image_model,
    defaultVideoModel: aiPolicy.default_video_model,
    defaultImageVideoModel: aiPolicy.default_image_video_model,
    monthlyBudgetUsd: aiPolicy.monthly_budget_usd,
  }, pricingCatalog)
  const clientCapabilities = [
    {
      icon: Bot,
      title: 'Text engine',
      ready: hasOpenRouter || hasAnthropic,
      body: hasOpenRouter
        ? 'OpenRouter is active for chat, content generation, and model testing.'
        : hasAnthropic
          ? 'Anthropic is active for chat and content generation.'
          : 'Add OpenRouter or Anthropic before relying on space-owned text generation.',
    },
    {
      icon: ImagePlus,
      title: 'Image generation',
      ready: defaultImageReady,
      body: !aiPolicy.images_enabled
        ? 'Locked by policy. Vera will not generate images for this space.'
        : defaultImageRoute
          ? `${modelLabel(aiPolicy.default_image_model)} can run through ${imageModelProviderLabel(defaultImageRoute).replace('Client ', 'the space ')} key.`
          : `${modelLabel(aiPolicy.default_image_model)} does not match the active image keys. Add OpenRouter for Nano Banana, FAL for Seedream/Qwen/FAL routes, or OpenAI for OpenAI Image Gen 2.`,
    },
    {
      icon: BookOpen,
      title: 'Searchable knowledge',
      ready: hasOpenAI,
      body: hasOpenAI
        ? 'OpenAI embeddings are active. Uploaded and pasted knowledge can become searchable for this space.'
        : 'Add a space OpenAI key before ingesting searchable knowledge sources.',
    },
    {
      icon: Clapperboard,
      title: 'Video rendering',
      ready: aiPolicy.standard_video_enabled && hasFal,
      body: !aiPolicy.standard_video_enabled
        ? 'Locked by policy. Vera will use storyboards and briefs instead of real video renders.'
        : hasFal
          ? 'Space-owned FAL is active. Video rendering can run from this space budget.'
        : 'Locked. Real video rendering requires a space-owned FAL key. Vera will use storyboards and briefs instead.',
    },
    {
      icon: ShieldCheck,
      title: 'Platform fallback',
      ready: aiPolicy.platform_media_keys_enabled,
      body: aiPolicy.platform_media_keys_enabled
        ? 'Operator-only InnovareAI media fallback is enabled for this project. Keep this limited to internal production work.'
        : 'Locked. This space cannot use InnovareAI platform media keys, even if an operator has an entitlement.',
    },
  ]
  const spendGuard = buildSpendGuard(aiPolicy, activeProviders, usageSummary)
  const routingRows = buildRoutingRows(aiPolicy, activeProviders, pricingCatalog)
  const pricingReviewDate = latestPricingReviewDate(pricingCatalog)
  const pricingStatus = pricingCatalogStatus(pricingSource, pricingRowCount)

  const card: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }
  const statusColor = (s: string) => s === 'active' ? color.success : s === 'invalid' ? color.danger : color.ghost

  return (
    <div style={{ padding: `${space[8]} ${space[8]} ${space[10]}`, maxWidth: 820 }}>
      <PageHeader
        eyebrow={activeProject.name}
        title="API keys"
        subtitle="Connect this space to its own AI provider keys. Keys are stored encrypted and used only for this space. OpenRouter covers text and supported image models. OpenAI covers searchable knowledge embeddings. FAL is required for space-owned video generation."
      />

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

      <section style={{ marginBottom: space[8] }}>
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

      <GenerationControlScopePanel
        aiPolicy={aiPolicy}
        hasTextKey={hasOpenRouter || hasAnthropic}
        hasImageRoute={!!defaultImageRoute}
        hasFal={hasFal}
        hasOpenAI={hasOpenAI}
      />

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Space-owned capabilities</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: space[3] }}>
          {clientCapabilities.map(item => (
            <CapabilityCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel
          style={{ marginBottom: space[3] }}
          action={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>{spendGuard.action}</span>
              <span style={{ padding: '3px 7px', borderRadius: radius.pill, border: `1px solid ${pricingStatus.border}`, color: pricingStatus.color, background: color.paper2, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
                {pricingStatus.label}
              </span>
            </span>
          }
        >
          Spend guard
        </SectionLabel>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: space[3], marginBottom: space[5] }}>
            {spendGuard.metrics.map(item => (
              <GuardMetric key={item.label} {...item} />
            ))}
          </div>
          <div style={{ display: 'grid', gap: space[2] }}>
            {routingRows.map(row => (
              <RouteRow key={row.label} {...row} />
            ))}
          </div>
          <div style={{ marginTop: space[5], borderTop: `1px solid ${color.line}`, paddingTop: space[4] }}>
            <SectionLabel style={{ marginBottom: space[3] }}>Recommended model route</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: space[3] }}>
              {modelRecommendations.map(item => (
                <RecommendationCard key={item.role} item={item} />
              ))}
            </div>
          </div>
          <p style={{ fontSize: t.size.micro, color: color.faint, margin: `${space[4]} 0 0`, lineHeight: 1.5 }}>
            Vera should default to cheap and fast prototype paths. Premium media stays locked unless this space has a cap and an explicit policy toggle.{' '}
            Pricing guide reviewed {pricingReviewDate}. {pricingStatus.label}. Estimates are planning guides and final billing comes from provider usage logs.
          </p>
        </div>
      </section>

      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }} action={policySaving ? 'Saving...' : 'Auto-save'}>Generation policy</SectionLabel>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: space[3] }}>
            <PolicyToggle
              icon={ShieldCheck}
              title="Generation budget guard"
              body="Warn across paid generation work. Enforce mode blocks over-cap production generation spend, while research, onboarding, analytics, and knowledge workflows keep moving."
              checked={aiPolicy.budget_guard_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('budget_guard_enabled', value)}
            />
            <PolicyToggle
              icon={ImagePlus}
              title="Image generation"
              body="Allow standard image generation through space-owned OpenRouter, FAL, or OpenAI keys."
              checked={aiPolicy.images_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('images_enabled', value)}
            />
            <PolicyToggle
              icon={Clapperboard}
              title="Standard video"
              body="Allow real video renders only when this space also has its own active FAL key."
              checked={aiPolicy.standard_video_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('standard_video_enabled', value)}
            />
            <PolicyToggle
              icon={Crown}
              title="Premium media"
              body="Allow premium image and video models only for space budgets that explicitly cover them."
              checked={aiPolicy.premium_media_enabled}
              disabled={policySaving}
              onChange={value => togglePolicy('premium_media_enabled', value)}
              danger
            />
          </div>
          <p style={{ fontSize: t.size.micro, color: color.faint, margin: `${space[3]} 0 0`, lineHeight: 1.5 }}>
            Text generation stays available through the selected text provider. Video still requires a space-owned FAL key even when enabled here.
          </p>
          <div style={{ marginTop: space[5], borderTop: `1px solid ${color.line}`, paddingTop: space[4] }}>
            <SectionLabel style={{ marginBottom: space[3] }}>Model defaults</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: space[3] }}>
              <Field
                label="Text model"
                helper="Blank uses the provider default. OpenRouter accepts provider/model slugs."
              >
                <Input
                  value={modelDraft.default_text_model}
                  onChange={event => setModelDraft(prev => ({ ...prev, default_text_model: event.target.value }))}
                  placeholder="anthropic/claude-sonnet-4.6"
                />
              </Field>
              <Field label="Image model">
                <Select
                  value={modelDraft.default_image_model}
                  onChange={event => setModelDraft(prev => ({ ...prev, default_image_model: event.target.value }))}
                >
                  {IMAGE_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </Field>
              <Field label="Video model">
                <Select
                  value={modelDraft.default_video_model}
                  onChange={event => setModelDraft(prev => ({ ...prev, default_video_model: event.target.value }))}
                >
                  {VIDEO_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </Field>
              <Field label="Image-to-video model">
                <Select
                  value={modelDraft.default_image_video_model}
                  onChange={event => setModelDraft(prev => ({ ...prev, default_image_video_model: event.target.value }))}
                >
                  {IMAGE_VIDEO_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: space[3] }}>
              <Button variant="secondary" leading={<Bot size={14} />} onClick={saveModelDefaults} disabled={policySaving}>
                Save defaults
              </Button>
            </div>
            <p style={{ fontSize: t.size.micro, color: color.faint, margin: `${space[3]} 0 0`, lineHeight: 1.5 }}>
              Premium image defaults still require Premium media plus a generation cap. OpenAI Image Gen 2 should stay a premium override, not the normal default.
            </p>
          </div>
          <div style={{ marginTop: space[5], borderTop: `1px solid ${color.line}`, paddingTop: space[4], display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: space[3], alignItems: 'end' }}>
            <Field
              label="Generation cap (USD)"
              helper="Blank means no cap. This covers generated content, media renders, and future paid social generation spend."
            >
              <Input
                value={budgetDraft}
                onChange={event => setBudgetDraft(event.target.value)}
                inputMode="decimal"
                placeholder="No cap"
              />
            </Field>
            <Field
              label="Guard mode"
              helper={aiPolicy.budget_guard_enabled ? 'Warn keeps everything running. Enforce blocks over-cap production generation only.' : 'Budget guard is off.'}
            >
              <Select
                value={aiPolicy.budget_guard_mode}
                onChange={event => saveBudgetGuardMode(event.target.value === 'enforce' ? 'enforce' : 'warn')}
                disabled={policySaving || !aiPolicy.budget_guard_enabled}
              >
                <option value="warn">Warn only</option>
                <option value="enforce">Enforce cap</option>
              </Select>
            </Field>
            <Button variant="secondary" leading={<Clock3 size={14} />} onClick={saveBudgetCap} disabled={policySaving}>
              Save cap
            </Button>
            <p style={{ gridColumn: '1 / -1', fontSize: t.size.micro, color: color.faint, margin: 0, lineHeight: 1.5 }}>
              Current month: {formatMoney(usageSummary.currentMonthCost)}
              {aiPolicy.monthly_budget_usd ? ` of ${formatMoney(aiPolicy.monthly_budget_usd)}` : ''}
              {aiPolicy.budget_guard_enabled ? `, guard ${aiPolicy.budget_guard_mode === 'enforce' ? 'enforces production generation' : 'warns only'}` : ', guard off'}
            </p>
            <p style={{ gridColumn: '1 / -1', fontSize: t.size.micro, color: color.faint, margin: 0, lineHeight: 1.5 }}>
              Connector reads, analytics imports, login, and publishing actions are not governed by this cap unless they invoke paid generation.
            </p>
          </div>
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
            <UsageMetric icon={BookOpen} label="Knowledge" value={formatNumber(usageSummary.knowledgeEvents)} detail={`${formatNumber(usageSummary.embeddingEvents)} embeds`} tone="info" />
            <UsageMetric icon={ImagePlus} label="Images" value={formatNumber(usageSummary.images)} detail={`${formatNumber(usageSummary.imageEvents)} image events`} tone="warn" />
            <UsageMetric icon={Clapperboard} label="Videos" value={formatNumber(usageSummary.videos)} detail={`${formatNumber(usageSummary.videoEvents)} submits`} tone="danger" />
            <UsageMetric icon={KeyRound} label="Space key" value={formatNumber(usageSummary.clientKeyEvents)} detail={`${formatNumber(usageSummary.platformKeyEvents)} platform-backed`} tone="success" />
            <UsageMetric icon={Clock3} label="Estimated spend" value={formatMoney(usageSummary.knownCost)} detail={usageSummary.hasKnownCost ? `${formatNumber(usageSummary.estimatedCostEvents)} estimated rows` : 'Provider billing pending'} tone="info" />
          </div>

          {costDrivers.length > 0 && (
            <div style={{ marginBottom: space[5] }}>
              <SectionLabel style={{ marginBottom: space[3] }}>Cost drivers</SectionLabel>
              <div style={{ display: 'grid', gap: space[2] }}>
                {costDrivers.slice(0, 6).map(driver => (
                  <CostDriverRow key={driver.key} driver={driver} />
                ))}
              </div>
            </div>
          )}

          {usageError ? (
            <div style={{ border: `1px solid ${color.danger}`, borderRadius: radius.md, padding: space[4], color: color.danger, fontSize: t.size.cap }}>
              Usage could not load: {usageError}
            </div>
          ) : usageLoading ? (
            <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0 }}>Loading usage...</p>
          ) : usageRows.length === 0 ? (
            <div style={{ border: `1px dashed ${color.line}`, borderRadius: radius.md, padding: space[5], textAlign: 'center' }}>
              <p style={{ fontSize: t.size.cap, color: color.ghost, margin: 0 }}>No usage recorded in the last 30 days. Completed chat, knowledge, image, and video runs will appear here.</p>
            </div>
          ) : (
            <UsageTable rows={usageRows.slice(0, 12)} />
          )}
        </div>
      </section>

    </div>
  )
}

type SpendGuardMetric = {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: 'success' | 'warn' | 'danger' | 'info'
}

type RoutingRow = {
  icon: LucideIcon
  label: string
  status: string
  detail: string
  estimate?: SpendEstimate
  tone: 'success' | 'warn' | 'danger' | 'info'
}

function GenerationControlScopePanel({
  aiPolicy,
  hasTextKey,
  hasImageRoute,
  hasFal,
  hasOpenAI,
}: {
  aiPolicy: AiPolicy
  hasTextKey: boolean
  hasImageRoute: boolean
  hasFal: boolean
  hasOpenAI: boolean
}) {
  const budgetLabel = !aiPolicy.budget_guard_enabled
    ? 'Guard off'
    : aiPolicy.monthly_budget_usd
      ? `${aiPolicy.budget_guard_mode === 'enforce' ? 'Enforce' : 'Warn'} at ${formatMoney(aiPolicy.monthly_budget_usd)}`
      : 'Warn, no cap'
  return (
    <section style={{ marginBottom: space[8] }}>
      <SectionLabel style={{ marginBottom: space[3] }}>Project generation control</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4] }}>
        <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], marginBottom: space[4] }}>
            <span style={{ width: 34, height: 34, borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ink, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ShieldCheck size={16} />
            </span>
            <div>
              <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold }}>What this page controls</h2>
              <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.55 }}>
                These controls are project-level guardrails for paid production generation and future paid social generation spend. They should not stop research, onboarding, analytics, source pulls, knowledge work, login, or publishing actions that do not invoke paid generation.
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: space[3] }}>
            <ScopeCard
              icon={Bot}
              title="Budget can enforce"
              body="Chat-backed content generation, campaign planning, image generation, video submit, and future paid social or ad generation operations."
              tone="warn"
            />
            <ScopeCard
              icon={BookOpen}
              title="Budget should not block"
              body="Research, onboarding, analytics sync, source ingestion, searchable knowledge, integrations, and publish actions that are not paid generation."
              tone="success"
            />
            <ScopeCard
              icon={Clapperboard}
              title="Video is gated"
              body="Real clips require Standard video on, a monthly generation cap, and this project's own active FAL key. Storyboards stay available."
              tone={aiPolicy.standard_video_enabled && hasFal ? 'success' : 'info'}
            />
            <ScopeCard
              icon={Crown}
              title="Premium is never default"
              body="OpenAI Image Gen 2 and premium video models stay locked until Premium media and a project cap are explicitly enabled."
              tone={aiPolicy.premium_media_enabled ? 'warn' : 'success'}
            />
          </div>
        </div>
        <div style={{ background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }}>
          <SectionLabel style={{ marginBottom: space[3] }}>Live policy state</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <ScopeStatusRow label="Budget guard" value={budgetLabel} tone={!aiPolicy.budget_guard_enabled ? 'warn' : aiPolicy.budget_guard_mode === 'enforce' ? 'success' : 'info'} />
            <ScopeStatusRow label="Text route" value={hasTextKey ? 'Space key ready' : 'Missing text key'} tone={hasTextKey ? 'success' : 'danger'} />
            <ScopeStatusRow label="Image route" value={!aiPolicy.images_enabled ? 'Locked by policy' : hasImageRoute ? modelLabel(aiPolicy.default_image_model) : 'No matching key'} tone={!aiPolicy.images_enabled ? 'info' : hasImageRoute ? 'success' : 'danger'} />
            <ScopeStatusRow label="Video route" value={aiPolicy.standard_video_enabled && hasFal ? 'Space FAL ready' : 'Storyboard first'} tone={aiPolicy.standard_video_enabled && hasFal ? 'success' : 'info'} />
            <ScopeStatusRow label="Knowledge embeddings" value={hasOpenAI ? 'OpenAI key ready' : 'Needs space OpenAI'} tone={hasOpenAI ? 'success' : 'warn'} />
            <ScopeStatusRow label="Platform media fallback" value={aiPolicy.platform_media_keys_enabled ? 'Operator exception' : 'Locked'} tone={aiPolicy.platform_media_keys_enabled ? 'danger' : 'success'} />
          </div>
          <p style={{ margin: `${space[4]} 0 0`, color: color.faint, fontSize: t.size.micro, lineHeight: 1.45 }}>
            Client spaces should normally run on their own provider keys. Shared InnovareAI media fallback is an exception path, not a default funding route.
          </p>
        </div>
      </div>
    </section>
  )
}

function ScopeCard({ icon: Icon, title, body, tone }: { icon: LucideIcon; title: string; body: string; tone: 'success' | 'warn' | 'danger' | 'info' }) {
  const toneColor = tone === 'success' ? color.success : tone === 'warn' ? color.warn : tone === 'danger' ? color.danger : color.info
  const bg = tone === 'success' ? SUCCESS_TINT : tone === 'warn' ? WARN_TINT : tone === 'danger' ? DANGER_TINT : color.paper2
  return (
    <div style={{ background: bg, border: `1px solid ${toneColor === color.info ? color.line : toneColor}`, borderRadius: radius.md, padding: space[4], minHeight: 138 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
        <Icon size={15} style={{ color: toneColor }} />
        {title}
      </div>
      <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>{body}</p>
    </div>
  )
}

function ScopeStatusRow({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warn' | 'danger' | 'info' }) {
  const toneColor = tone === 'success' ? color.success : tone === 'warn' ? color.warn : tone === 'danger' ? color.danger : color.info
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], padding: `${space[3]} 0`, borderBottom: `1px solid ${color.line}` }}>
      <span style={{ color: color.ink2, fontSize: t.size.cap }}>{label}</span>
      <span style={{ color: toneColor, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function RecommendationCard({ item }: { item: ModelRecommendation }) {
  const Icon = item.role === 'Text' ? Bot : item.role === 'Image' ? ImagePlus : Clapperboard
  const toneColor = item.tone === 'success' ? color.success : item.tone === 'warn' ? color.warn : item.tone === 'danger' ? color.danger : color.info
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], padding: space[4], borderRadius: radius.md, border: `1px solid ${toneColor}`, background: color.paper2, minHeight: 190 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3] }}>
        <span style={{ width: 32, height: 32, borderRadius: radius.pill, background: color.surface, color: toneColor, border: `1px solid ${color.line}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{item.role}</span>
          <span style={{ display: 'block', color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4 }}>{item.task}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: toneColor, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          {item.status}
        </span>
      </div>
      <div>
        <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{item.model}</div>
        <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 2 }}>{item.provider}</div>
      </div>
      <div style={{ color: color.faint, fontSize: t.size.micro, lineHeight: 1.4 }}>
        {item.estimate.label}. {item.estimate.detail}
      </div>
      <div style={{ color: color.ink2, fontSize: t.size.micro, lineHeight: 1.45 }}>
        {item.reason}
      </div>
      <div style={{ marginTop: 'auto', color: color.ghost, fontSize: t.size.micro, lineHeight: 1.45 }}>
        {item.escalation}
      </div>
    </div>
  )
}

function GuardMetric({ icon: Icon, label, value, detail, tone }: SpendGuardMetric) {
  const toneColor = tone === 'success' ? color.success : tone === 'warn' ? color.warn : tone === 'danger' ? color.danger : color.info
  return (
    <div style={{ minHeight: 92, padding: space[4], borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[3] }}>
        <span style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: t.weight.semibold }}>{label}</span>
        <Icon size={15} style={{ color: toneColor }} />
      </div>
      <div style={{ color: color.ink, fontSize: t.size.h3, fontWeight: 650, lineHeight: 1.1 }}>{value}</div>
      <div style={{ color: color.faint, fontSize: t.size.micro, marginTop: space[2], lineHeight: 1.35 }}>{detail}</div>
    </div>
  )
}

function RouteRow({ icon: Icon, label, status, detail, estimate, tone }: RoutingRow) {
  const toneColor = tone === 'success' ? color.success : tone === 'warn' ? color.warn : tone === 'danger' ? color.danger : color.info
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr) auto', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.paper2 }}>
      <span style={{ width: 32, height: 32, borderRadius: radius.pill, background: color.surface, color: toneColor, border: `1px solid ${color.line}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{label}</span>
        <span style={{ display: 'block', color: color.ghost, fontSize: t.size.cap, lineHeight: 1.4, marginTop: 1 }}>{detail}</span>
        {estimate && (
          <span style={{ display: 'block', color: color.faint, fontSize: t.size.micro, lineHeight: 1.35, marginTop: 4 }}>
            {estimate.label}. {estimate.detail}
          </span>
        )}
      </span>
      <span style={{ color: toneColor, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
        {status}
      </span>
    </div>
  )
}

function buildSpendGuard(aiPolicy: AiPolicy, activeProviders: Set<string>, usageSummary: ReturnType<typeof summarizeUsage>): {
  action: string
  metrics: SpendGuardMetric[]
} {
  const budget = aiPolicy.monthly_budget_usd
  const used = usageSummary.currentMonthCost
  const remaining = budget ? Math.max(0, budget - used) : null
  const budgetPct = budget ? Math.min(100, Math.round((used / budget) * 100)) : null
  const premiumDefault = isPremiumImageModel(aiPolicy.default_image_model)
  const hasOpenRouter = activeProviders.has('openrouter')
  const hasAnthropic = activeProviders.has('anthropic')
  const hasOpenAI = activeProviders.has('openai')
  const hasFal = activeProviders.has('fal') || activeProviders.has('fal_ai')
  const hasClientText = hasOpenRouter || hasAnthropic
  const hasClientMedia = !!imageModelProvider(aiPolicy.default_image_model, { hasOpenRouter, hasOpenAI, hasFal })
  const hasClientVideo = hasFal
  const alerts = [
    !hasClientText ? 'text key missing' : '',
    aiPolicy.images_enabled && !hasClientMedia ? 'image route locked' : '',
    aiPolicy.standard_video_enabled && !hasClientVideo ? 'video key missing' : '',
    premiumDefault && !aiPolicy.premium_media_enabled ? 'premium default locked' : '',
    aiPolicy.platform_media_keys_enabled ? 'platform fallback enabled' : '',
    !aiPolicy.budget_guard_enabled ? 'budget guard off' : '',
    aiPolicy.budget_guard_enabled && aiPolicy.budget_guard_mode === 'warn' ? 'warn-only budget guard' : '',
    budgetPct !== null && budgetPct >= 90 ? 'budget near cap' : '',
    usageSummary.platformKeyEvents > 0 ? 'platform usage seen' : '',
  ].filter(Boolean)

  return {
    action: alerts.length ? `${alerts.length} watch item${alerts.length === 1 ? '' : 's'}` : 'Healthy',
    metrics: [
      {
        icon: Clock3,
        label: 'Generation cap',
        value: !aiPolicy.budget_guard_enabled ? 'Off' : budget ? `${budgetPct}%` : 'No cap',
        detail: !aiPolicy.budget_guard_enabled
          ? 'Generation spend is logged, but generation cap warnings and blocks are disabled.'
          : budget
            ? `${formatMoney(used)} used, ${formatMoney(remaining ?? 0)} left. ${aiPolicy.budget_guard_mode === 'enforce' ? 'Production generation enforcement is on.' : 'Warn-only mode keeps workflows running.'}`
            : 'Set a cap before video or premium media.',
        tone: !aiPolicy.budget_guard_enabled ? 'info' : !budget ? 'warn' : budgetPct !== null && budgetPct >= 90 ? 'danger' : budgetPct !== null && budgetPct >= 70 ? 'warn' : 'success',
      },
      {
        icon: KeyRound,
        label: 'Funding route',
        value: usageSummary.platformKeyEvents > 0 ? 'Mixed' : usageSummary.clientKeyEvents > 0 ? 'Space' : 'Pending',
        detail: `${formatNumber(usageSummary.clientKeyEvents)} space-backed, ${formatNumber(usageSummary.platformKeyEvents)} platform-backed events.`,
        tone: usageSummary.platformKeyEvents > 0 ? 'warn' : usageSummary.clientKeyEvents > 0 ? 'success' : 'info',
      },
      {
        icon: premiumDefault ? AlertTriangle : ShieldCheck,
        label: 'Premium risk',
        value: premiumDefault ? 'Review' : 'Low',
        detail: premiumDefault ? `${modelLabel(aiPolicy.default_image_model)} is a premium image default.` : 'Default image path stays in the standard prototype tier.',
        tone: premiumDefault ? 'warn' : 'success',
      },
      {
        icon: Clapperboard,
        label: 'Video path',
        value: aiPolicy.standard_video_enabled ? 'Enabled' : 'Briefs',
        detail: aiPolicy.standard_video_enabled
          ? hasClientVideo ? 'Space FAL key is required and present.' : 'Enabled by policy, but no active space FAL key.'
          : 'Storyboards and production briefs are the default.',
        tone: aiPolicy.standard_video_enabled ? (hasClientVideo ? 'success' : 'danger') : 'info',
      },
    ],
  }
}

function pricingCatalogStatus(source: ModelPricingCatalogSource, rowCount: number) {
  if (source === 'catalog') return { label: `Live catalog, ${rowCount} rows`, color: color.success, border: color.success }
  if (source === 'fallback') return { label: 'Fallback guide', color: color.warn, border: color.warn }
  return { label: 'Loading guide', color: color.ghost, border: color.line }
}

function buildRoutingRows(aiPolicy: AiPolicy, activeProviders: Set<string>, pricingCatalog?: ModelPricingGuide[]): RoutingRow[] {
  const hasOpenRouter = activeProviders.has('openrouter')
  const hasAnthropic = activeProviders.has('anthropic')
  const hasOpenAI = activeProviders.has('openai')
  const hasFal = activeProviders.has('fal') || activeProviders.has('fal_ai')
  const imageIsPremium = isPremiumImageModel(aiPolicy.default_image_model)
  const hasClientText = hasOpenRouter || hasAnthropic
  const imageRoute = imageModelProvider(aiPolicy.default_image_model, { hasOpenRouter, hasOpenAI, hasFal })
  const hasClientMedia = !!imageRoute
  const hasClientVideo = hasFal
  return [
    {
      icon: Bot,
      label: 'Text generation',
      status: hasClientText ? 'Space' : 'Missing',
      estimate: textSpendEstimate(aiPolicy.default_text_model, !hasClientText ? 'missing' : hasOpenRouter ? 'openrouter' : 'anthropic', pricingCatalog),
      detail: hasOpenRouter
        ? `Runs through the space OpenRouter key${aiPolicy.default_text_model ? ` using ${aiPolicy.default_text_model}` : ' with provider default routing'}.`
        : hasAnthropic
          ? `Runs through the space Anthropic key${aiPolicy.default_text_model ? ` using ${aiPolicy.default_text_model}` : ''}.`
          : 'Add OpenRouter or Anthropic so chat does not depend on platform keys.',
      tone: hasClientText ? 'success' : 'danger',
    },
    {
      icon: ImagePlus,
      label: 'Image generation',
      status: !aiPolicy.images_enabled ? 'Locked' : hasClientMedia ? 'Space' : 'Missing',
      estimate: imageSpendEstimate(aiPolicy.default_image_model, aiPolicy.images_enabled, hasClientMedia, imageIsPremium, pricingCatalog),
      detail: !aiPolicy.images_enabled
        ? 'Disabled by policy. Vera should provide prompts or briefs only.'
        : imageRoute
          ? `${modelLabel(aiPolicy.default_image_model)} can use ${imageModelProviderLabel(imageRoute).replace('Client ', 'the space ')} route.`
          : `${modelLabel(aiPolicy.default_image_model)} does not match the active image keys. Add OpenRouter, FAL, or OpenAI for the selected model.`,
      tone: !aiPolicy.images_enabled ? 'info' : hasClientMedia ? (imageIsPremium ? 'warn' : 'success') : 'danger',
    },
    {
      icon: Crown,
      label: 'Premium media',
      status: aiPolicy.premium_media_enabled ? 'Enabled' : 'Locked',
      detail: aiPolicy.premium_media_enabled
        ? aiPolicy.monthly_budget_usd ? 'Premium models are allowed with a generation cap. Use only for approved production work.' : 'Premium is enabled, but the generation cap is missing.'
        : 'OpenAI Image Gen 2, Imagen 4, Recraft, Ideogram, Kling, Sora, Veo, and Seedance stay approval-gated.',
      tone: aiPolicy.premium_media_enabled ? (aiPolicy.monthly_budget_usd ? 'warn' : 'danger') : 'success',
    },
    {
      icon: Clapperboard,
      label: 'Video rendering',
      status: aiPolicy.standard_video_enabled && hasClientVideo ? 'Space' : 'Storyboard',
      estimate: videoSpendEstimate(aiPolicy.default_video_model, aiPolicy.standard_video_enabled && hasClientVideo, aiPolicy.premium_media_enabled, pricingCatalog),
      detail: aiPolicy.standard_video_enabled
        ? hasClientVideo ? `${modelLabel(aiPolicy.default_video_model)} and ${modelLabel(aiPolicy.default_image_video_model)} run only through the space FAL key.` : 'Policy allows standard video, but Vera still needs a space FAL key.'
        : 'Real clips are locked. Vera should create storyboards, prompts, and production briefs.',
      tone: aiPolicy.standard_video_enabled ? (hasClientVideo ? 'success' : 'danger') : 'info',
    },
  ]
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: space[3], background: checked ? SUCCESS_TINT : color.paper2, border: `1px solid ${checked ? SUCCESS_LINE : color.line}`, borderRadius: radius.md, padding: space[4], minHeight: 154, cursor: disabled ? 'wait' : 'pointer' }}>
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

function CostDriverRow({ driver }: { driver: UsageCostDriver }) {
  const keyTone = driver.keySource === 'client' ? color.success : driver.keySource === 'platform' ? color.warn : color.ghost
  const meter = driver.videos > 0
    ? `${formatNumber(driver.videos)} video${driver.videos === 1 ? '' : 's'}`
    : driver.images > 0
      ? `${formatNumber(driver.images)} image${driver.images === 1 ? '' : 's'}`
      : driver.tokens > 0
        ? `${formatNumber(driver.tokens)} tokens`
        : `${formatNumber(driver.events)} event${driver.events === 1 ? '' : 's'}`
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr) auto', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.paper2 }}>
      <span style={{ width: 32, height: 32, borderRadius: radius.pill, background: color.surface, color: driver.cost > 0 ? color.warn : color.info, border: `1px solid ${color.line}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <DollarSign size={15} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: space[2], minWidth: 0 }}>
          <span style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatOperation(driver.operation)}
          </span>
          <span style={{ color: keyTone, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
            {formatKeySource(driver.keySource)}
          </span>
        </span>
        <span style={{ display: 'block', color: color.ghost, fontSize: t.size.cap, lineHeight: 1.4, marginTop: 1 }}>
          {providerLabel(driver.provider)} · {driver.model} · {meter} · {formatNumber(driver.events)} event{driver.events === 1 ? '' : 's'}
        </span>
        <span style={{ display: 'block', color: color.faint, fontSize: t.size.micro, lineHeight: 1.35, marginTop: 3 }}>
          Latest {formatDateTime(driver.latestAt)} · {driver.knownCostEvents ? `${formatNumber(driver.knownCostEvents)} costed row${driver.knownCostEvents === 1 ? '' : 's'}` : 'cost pending'}
        </span>
      </span>
      <span style={{ color: driver.cost > 0 ? color.ink : color.ghost, fontSize: t.size.body, fontWeight: t.weight.semibold, whiteSpace: 'nowrap' }}>
        {driver.cost > 0 ? formatMoney(driver.cost) : 'Pending'}
      </span>
    </div>
  )
}

function UsageTable({ rows }: { rows: GenerationUsageRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${color.line}` }}>
            {['When', 'Operation', 'Provider', 'Model', 'Meter', 'Cost', 'Key'].map(label => (
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
                <td style={cellStyle}>{typeof row.cost_usd === 'number' ? formatMoney(row.cost_usd) : 'pending'}</td>
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
      if (operation.startsWith('knowledge.')) {
        summary.knowledgeEvents += 1
        if (operation === 'knowledge.embed') summary.embeddingEvents += 1
      }
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
        if (isInCurrentMonth(row.created_at)) summary.currentMonthCost += row.cost_usd
        if (metadata.cost_estimate_source) summary.estimatedCostEvents += 1
      }
      return summary
    },
    {
      events: 0,
      tokens: 0,
      chatEvents: 0,
      knowledgeEvents: 0,
      embeddingEvents: 0,
      images: 0,
      imageEvents: 0,
      videos: 0,
      videoEvents: 0,
      clientKeyEvents: 0,
      platformKeyEvents: 0,
      knownCost: 0,
      currentMonthCost: 0,
      hasKnownCost: false,
      estimatedCostEvents: 0,
    },
  )
}

function buildUsageCostDrivers(rows: GenerationUsageRow[]): UsageCostDriver[] {
  const map = new Map<string, UsageCostDriver>()

  for (const row of rows) {
    const metadata = safeMetadata(row.usage_metadata)
    const operation = row.operation ?? 'unknown'
    const provider = row.provider ?? 'unknown'
    const model = row.model_used ?? 'unknown'
    const keySource = typeof metadata.key_source === 'string' ? metadata.key_source : 'unknown'
    const key = `${operation}:${provider}:${model}:${keySource}`
    const current = map.get(key) ?? {
      key,
      operation,
      provider,
      model,
      keySource,
      events: 0,
      tokens: 0,
      images: 0,
      videos: 0,
      cost: 0,
      knownCostEvents: 0,
      latestAt: row.created_at,
    }

    current.events += 1
    current.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
    if (operation.startsWith('image.')) current.images += numberFromMetadata(metadata.num_images, 1)
    if (operation.startsWith('video.')) current.videos += 1
    if (typeof row.cost_usd === 'number') {
      current.cost += row.cost_usd
      current.knownCostEvents += 1
    }
    if (new Date(row.created_at).getTime() > new Date(current.latestAt).getTime()) {
      current.latestAt = row.created_at
    }
    map.set(key, current)
  }

  return [...map.values()].sort((a, b) =>
    b.cost - a.cost ||
    b.videos - a.videos ||
    b.images - a.images ||
    b.tokens - a.tokens ||
    b.events - a.events ||
    new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
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
    platform_media_keys_enabled: typeof raw.platform_media_keys_enabled === 'boolean' ? raw.platform_media_keys_enabled : DEFAULT_AI_POLICY.platform_media_keys_enabled,
    budget_guard_enabled: typeof raw.budget_guard_enabled === 'boolean' ? raw.budget_guard_enabled : DEFAULT_AI_POLICY.budget_guard_enabled,
    budget_guard_mode: raw.budget_guard_mode === 'enforce' ? 'enforce' : DEFAULT_AI_POLICY.budget_guard_mode,
    monthly_budget_usd: typeof raw.monthly_budget_usd === 'number' && Number.isFinite(raw.monthly_budget_usd) && raw.monthly_budget_usd > 0 ? raw.monthly_budget_usd : null,
    default_text_model: typeof raw.default_text_model === 'string' && raw.default_text_model.trim() ? raw.default_text_model.trim() : null,
    default_image_model: typeof raw.default_image_model === 'string' && raw.default_image_model.trim() ? raw.default_image_model.trim() : DEFAULT_AI_POLICY.default_image_model,
    default_video_model: typeof raw.default_video_model === 'string' && raw.default_video_model.trim() ? raw.default_video_model.trim() : DEFAULT_AI_POLICY.default_video_model,
    default_image_video_model: typeof raw.default_image_video_model === 'string' && raw.default_image_video_model.trim() ? raw.default_image_video_model.trim() : DEFAULT_AI_POLICY.default_image_video_model,
  }
}

function isInCurrentMonth(value: string) {
  const date = new Date(value)
  const now = new Date()
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth()
}

function usageQueryStartIso() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const now = new Date()
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  return new Date(Math.min(thirtyDaysAgo, monthStart)).toISOString()
}

function numberFromMetadata(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatMeter(row: GenerationUsageRow, metadata: UsageMetadata) {
  const operation = row.operation ?? ''
  if (operation === 'chat.message' || operation.startsWith('knowledge.')) {
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
  if (value === 'client') return 'Space'
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
    <div style={{ background: ready ? SUCCESS_TINT : color.surface, border: `1px solid ${ready ? SUCCESS_LINE : color.line}`, borderRadius: radius.lg, padding: space[4], minHeight: 132 }}>
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
