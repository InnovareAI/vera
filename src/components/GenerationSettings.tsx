// Editable generation policy for the active space: image/video/premium toggles,
// model defaults, and the generation budget cap. Lives in Settings → Brain &
// Models. The API-keys page stays focused on credentials; this reads + writes
// projects.ai_policy and validates choices against the space's active keys.
import { useCallback, useEffect, useState } from 'react'
import { Bot, Clapperboard, Clock3, Crown, ImagePlus, Lock, ShieldCheck, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import {
  IMAGE_MODEL_OPTIONS,
  IMAGE_VIDEO_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
  imageModelProvider,
  isPremiumImageModel,
  modelLabel,
} from '../lib/modelEconomics'
import { SectionLabel, Button, Field, Input, Select, color, space, type as t, radius, useToast } from '../design'

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

export default function GenerationSettings() {
  const { activeProject, refetch } = useProject()
  const { push } = useToast()
  const [activeProviders, setActiveProviders] = useState<Set<string>>(new Set())
  const [aiPolicy, setAiPolicy] = useState<AiPolicy>(DEFAULT_AI_POLICY)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [modelDraft, setModelDraft] = useState({
    default_text_model: '',
    default_image_model: DEFAULT_AI_POLICY.default_image_model,
    default_video_model: DEFAULT_AI_POLICY.default_video_model,
    default_image_video_model: DEFAULT_AI_POLICY.default_image_video_model,
  })
  const [policySaving, setPolicySaving] = useState(false)

  const loadKeys = useCallback(async () => {
    if (!activeProject?.id) { setActiveProviders(new Set()); return }
    const { data } = await supabase
      .from('client_api_keys')
      .select('provider, status')
      .eq('project_id', activeProject.id)
      .eq('status', 'active')
    setActiveProviders(new Set((data ?? []).map(k => k.provider as string)))
  }, [activeProject?.id])

  useEffect(() => { void loadKeys() }, [loadKeys])

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

  const hasOpenRouter = activeProviders.has('openrouter')
  const hasOpenAI = activeProviders.has('openai')
  const hasFal = activeProviders.has('fal') || activeProviders.has('fal_ai')

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

  if (!activeProject) return null

  const card: React.CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[5] }

  return (
    <section>
      <SectionLabel style={{ marginBottom: space[3] }} action={policySaving ? 'Saving…' : 'Auto-save'}>Generation policy</SectionLabel>
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
            Connector reads, analytics imports, login, and publishing actions are not governed by this cap unless they invoke paid generation.
          </p>
        </div>
      </div>
    </section>
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
