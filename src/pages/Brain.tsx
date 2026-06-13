// Brain — the per-client ground truth VERA reasons from (/p/:slug/brain).
//
// · Custom instructions — per project; vera-chat reads them EVERY turn. The
//   single highest-leverage per-client lever.
// · Brand voice — tone, rules, forbidden phrases, persona (workspace-level for
//   now; shared across the client's projects, same row vera-chat reads).
// · Audiences — who VERA writes toward (read view for now).
// · Knowledge — link to the client's searchable sources (managed in Knowledge;
//   brand-kit files live in Artifacts).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ElementType } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Brain as BrainIcon, BookOpen, Check, Link2, Plus, ShieldCheck, Target, X, Loader2, Trash2, Sparkles, Upload, FileText, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, Audience, ContentMetricSnapshot, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useAuth } from '../lib/auth'
import { useRightRail } from '../lib/rightRailContext'
import { PageHeader, SectionLabel, Field, Input, Textarea, Select, Button, EmptyState, Chip, color, space, type as t, radius } from '../design'
import {
  EMPTY_BUSINESS_CONTEXT,
  compactProjectDescription,
  mergeProjectInstructions,
  parseProjectInstructions,
  type BusinessContext,
  type BusinessContextKey,
} from '../lib/businessContext'
import {
  DEMAND_APPROVAL_MODES,
  DEMAND_CHANNEL_OPERATING_POLICIES,
  DEMAND_COMMERCIAL_REQUIREMENTS,
  DEMAND_CONTENT_JOBS,
  DEMAND_GROWTH_OUTCOMES,
  DEMAND_LEARNING_LOOP,
  DEMAND_OUTCOME_SIGNALS,
  DEMAND_PLATFORM_DEFINITIONS,
  DEMAND_SOURCE_KEYS,
  DEFAULT_DEMAND_OPERATING_MODEL,
  applyDemandDefaults,
  defaultDemandChannelPolicies,
  demandChannelPoliciesFromText,
  demandChannelPolicyHasOverride,
  demandChannelPolicyOverrideCount,
  serializeDemandChannelPolicies,
  type DemandChannelOperatingPolicy,
  type DemandPlatformDefinition,
  type DemandPlatformKey,
  type DemandChannelRisk,
} from '../lib/demandModel'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const BUSINESS_DOC_ACCEPT = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.html',
  '.htm',
].join(',')
const MAX_BUSINESS_DOC_BYTES = 20 * 1024 * 1024
type SourcePullReport = { label?: string; ok?: boolean; items?: number; error?: string }

const DEMAND_FACT_KEYS: BusinessContextKey[] = [
  'offer',
  'audience',
  'customerProblems',
  'differentiators',
  'competitors',
  'proofPoints',
  'contentGoals',
  'speakerStrategy',
  'platformToneOfVoice',
  'approvalStakeholders',
  'constraints',
]

type BrainLearningMetric = {
  postId: string
  provider: string
  views: number
  engagements: number
  comments: number
  shares: number
  clicks: number
  saves: number
  qualifiedTraffic: number
  buyerQuestions: number
  meetingRequests: number
  pulledAt: string | null
}

type BrainChannelEvidence = {
  key: DemandPlatformKey
  posts: number
  measured: number
  score: number
  lastSignalAt: string | null
  demandSignals: string[]
}

const BRAIN_DEMAND_METRICS = new Set([
  'views',
  'impressions',
  'reach',
  'engagements',
  'likes',
  'reactions',
  'comments',
  'shares',
  'clicks',
  'saves',
  'qualified_traffic',
  'buyer_questions',
  'meeting_requests',
])

function fileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function businessDocMime(file: File) {
  if (file.type) return file.type
  const ext = fileExtension(file.name)
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === 'json') return 'application/json'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  return 'text/plain'
}

function isTextBusinessDoc(file: File, mime: string) {
  if (mime.startsWith('text/')) return true
  if (mime === 'application/json') return true
  return ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'].includes(fileExtension(file.name))
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function mergeExtractedContext(current: BusinessContext, extracted: Partial<BusinessContext>) {
  const next = { ...current }
  for (const key of Object.keys(EMPTY_BUSINESS_CONTEXT) as BusinessContextKey[]) {
    const value = extracted[key]
    if (typeof value === 'string' && value.trim()) next[key] = value.trim()
  }
  return next
}

function DemandDefaultPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ padding: space[4], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, minWidth: 0 }}>
      <div style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, marginBottom: space[2] }}>{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.slice(0, 7).map(item => (
          <span key={item} style={{ padding: '4px 8px', borderRadius: radius.pill, background: color.surface, border: `1px solid ${color.line}`, color: color.ink2, fontSize: t.size.micro, lineHeight: 1.2 }}>
            {item}
          </span>
        ))}
        {items.length > 7 && (
          <span style={{ padding: '4px 8px', borderRadius: radius.pill, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.2 }}>
            +{items.length - 7}
          </span>
        )}
      </div>
    </div>
  )
}

function publishingTone(mode: DemandPlatformDefinition['publishing']) {
  if (mode === 'connected') return color.success
  if (mode === 'cms') return color.dotBlue
  if (mode === 'read-only') return color.warn
  return color.ghost
}

function publishingLabel(mode: DemandPlatformDefinition['publishing']) {
  if (mode === 'connected') return 'Connected when authorized'
  if (mode === 'cms') return 'CMS or handoff'
  if (mode === 'read-only') return 'Read-only'
  return 'Manual-first'
}

function riskTone(risk: DemandChannelRisk) {
  if (risk === 'high') return color.danger
  if (risk === 'medium') return color.warn
  return color.success
}

function riskLabel(risk: DemandChannelRisk) {
  if (risk === 'high') return 'High approval care'
  if (risk === 'medium') return 'Approval aware'
  return 'Standard review'
}

function platformSourceValue(platform: DemandPlatformDefinition, context: BusinessContext) {
  if (!platform.sourceKey) return ''
  return context[platform.sourceKey].trim()
}

function platformIsMentioned(platform: DemandPlatformDefinition, context: BusinessContext) {
  const haystack = [
    context.channelStrategy,
    context.contentFormats,
    context.platformToneOfVoice,
    context.demandObjective,
  ].join(' ').toLowerCase()
  const needles = [
    platform.key,
    platform.label.toLowerCase(),
    ...(platform.key === 'x' ? ['twitter'] : []),
    ...(platform.key === 'email' ? ['newsletter', 'nurture'] : []),
    ...(platform.key === 'blog' ? ['website', 'seo', 'article'] : []),
  ]
  return needles.some(needle => haystack.includes(needle))
}

function orderedDemandPlatforms(context: BusinessContext) {
  return [...DEMAND_PLATFORM_DEFINITIONS].sort((a, b) => {
    const aSource = platformSourceValue(a, context) ? 1 : 0
    const bSource = platformSourceValue(b, context) ? 1 : 0
    if (aSource !== bSource) return bSource - aSource
    const aMention = platformIsMentioned(a, context) ? 1 : 0
    const bMention = platformIsMentioned(b, context) ? 1 : 0
    if (aMention !== bMention) return bMention - aMention
    return a.label.localeCompare(b.label)
  })
}

function activeDemandPlatforms(context: BusinessContext) {
  const active = DEMAND_PLATFORM_DEFINITIONS.filter(platform => (
    Boolean(platformSourceValue(platform, context)) || platformIsMentioned(platform, context)
  ))
  return active.length ? active : DEMAND_PLATFORM_DEFINITIONS
}

function sourceGapPlatforms(context: BusinessContext) {
  return DEMAND_PLATFORM_DEFINITIONS
    .filter(platform => platform.sourceKey && !platformSourceValue(platform, context))
    .slice(0, 6)
}

function brainPlatformKeyForPost(post: Post, metric?: BrainLearningMetric): DemandPlatformKey | null {
  const value = [post.channel, post.provider, metric?.provider]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!value) return null
  if (value.includes('linkedin') || value.includes('unipile')) return 'linkedin'
  if (value.includes('youtube') || value.includes('youtu.be')) return 'youtube'
  if (value.includes('medium')) return 'medium'
  if (value.includes('quora')) return 'quora'
  if (value.includes('reddit')) return 'reddit'
  if (value === 'x' || value.includes('twitter') || value.includes('x.com')) return 'x'
  if (value.includes('instagram') || value.includes('meta_instagram')) return 'instagram'
  if (value.includes('facebook') || value.includes('meta_facebook')) return 'facebook'
  if (value.includes('blog') || value.includes('wordpress') || value.includes('cms')) return 'blog'
  if (value.includes('email') || value.includes('newsletter')) return 'email'
  return null
}

function buildBrainMetrics(rows: ContentMetricSnapshot[]) {
  const latestRows = new Map<string, ContentMetricSnapshot>()
  for (const row of rows) {
    if (!row.post_id) continue
    const name = row.metric_name.toLowerCase()
    const key = `${row.post_id}:${name}`
    const current = latestRows.get(key)
    if (!current || new Date(row.pulled_at).getTime() > new Date(current.pulled_at).getTime()) {
      latestRows.set(key, row)
    }
  }

  const byPost = new Map<string, BrainLearningMetric>()
  for (const row of latestRows.values()) {
    if (!row.post_id) continue
    const metric = byPost.get(row.post_id) ?? {
      postId: row.post_id,
      provider: String(row.provider ?? ''),
      views: 0,
      engagements: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      saves: 0,
      qualifiedTraffic: 0,
      buyerQuestions: 0,
      meetingRequests: 0,
      pulledAt: row.pulled_at ?? null,
    }
    const value = Number(row.metric_value ?? 0)
    const name = row.metric_name.toLowerCase()
    if (name === 'views' || name === 'impressions' || name === 'reach') metric.views = Math.max(metric.views, value)
    else if (name === 'engagements' || name === 'likes' || name === 'reactions') metric.engagements += value
    else if (name === 'comments') metric.comments += value
    else if (name === 'shares') metric.shares += value
    else if (name === 'clicks') metric.clicks += value
    else if (name === 'saves') metric.saves += value
    else if (name === 'qualified_traffic') metric.qualifiedTraffic += value
    else if (name === 'buyer_questions') metric.buyerQuestions += value
    else if (name === 'meeting_requests') metric.meetingRequests += value
    if (!metric.pulledAt || row.pulled_at > metric.pulledAt) metric.pulledAt = row.pulled_at
    byPost.set(row.post_id, metric)
  }
  return byPost
}

function brainHasLearningSignal(metric: BrainLearningMetric) {
  return !!(
    metric.views ||
    metric.engagements ||
    metric.comments ||
    metric.shares ||
    metric.clicks ||
    metric.saves ||
    metric.qualifiedTraffic ||
    metric.buyerQuestions ||
    metric.meetingRequests
  )
}

function brainDemandScore(metric: BrainLearningMetric) {
  return Math.round(
    metric.meetingRequests * 20 +
    metric.buyerQuestions * 12 +
    metric.qualifiedTraffic * 7 +
    metric.comments * 6 +
    metric.shares * 5 +
    metric.clicks * 4 +
    metric.saves * 3 +
    metric.engagements +
    metric.views * 0.01,
  )
}

function brainMetricSignals(metric: BrainLearningMetric) {
  const signals: string[] = []
  if (metric.comments || metric.shares || metric.engagements) signals.push('engagement')
  if (metric.clicks || metric.qualifiedTraffic) signals.push('traffic')
  if (metric.buyerQuestions || metric.meetingRequests) signals.push('lead intent')
  if (metric.saves) signals.push('saved')
  if (metric.views) signals.push('reach')
  return signals
}

function buildBrainChannelEvidence(posts: Post[], metrics: Map<string, BrainLearningMetric>) {
  const byChannel = new Map<DemandPlatformKey, BrainChannelEvidence>()
  for (const post of posts) {
    const metric = metrics.get(post.id)
    const key = brainPlatformKeyForPost(post, metric)
    if (!key) continue
    const current = byChannel.get(key) ?? {
      key,
      posts: 0,
      measured: 0,
      score: 0,
      lastSignalAt: null,
      demandSignals: [],
    }
    current.posts += 1
    if (metric && brainHasLearningSignal(metric)) {
      current.measured += 1
      current.score += brainDemandScore(metric)
      if (metric.pulledAt && (!current.lastSignalAt || metric.pulledAt > current.lastSignalAt)) {
        current.lastSignalAt = metric.pulledAt
      }
      current.demandSignals = Array.from(new Set([...current.demandSignals, ...brainMetricSignals(metric)]))
    }
    byChannel.set(key, current)
  }
  return byChannel
}

function formatLearningDate(value: string | null) {
  if (!value) return 'No metric pull yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Metric pull recorded'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function BrainReadinessPanel({
  context,
  policies,
  sourceCount,
  factCount,
  operatingCount,
  channelEvidence,
  learningLoading,
  learningError,
}: {
  context: BusinessContext
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>
  sourceCount: number
  factCount: number
  operatingCount: number
  channelEvidence: Map<DemandPlatformKey, BrainChannelEvidence>
  learningLoading: boolean
  learningError: string | null
}) {
  const evidenceValues = Array.from(channelEvidence.values())
  const activeEvidenceKeys = new Set(evidenceValues.filter(item => item.posts > 0).map(item => item.key))
  const activePlatforms = DEMAND_PLATFORM_DEFINITIONS.filter(platform => (
    activeEvidenceKeys.has(platform.key) || activeDemandPlatforms(context).some(activePlatform => activePlatform.key === platform.key)
  ))
  const plannedChannels = activePlatforms.filter(platform => !platformSourceValue(platform, context) && platformIsMentioned(platform, context)).length
  const highCareChannels = activePlatforms.filter(platform => (policies[platform.key] ?? DEMAND_CHANNEL_OPERATING_POLICIES[platform.key]).risk === 'high').length
  const customPolicies = demandChannelPolicyOverrideCount(policies)
  const gaps = sourceGapPlatforms(context)
  const totalPosts = evidenceValues.reduce((sum, item) => sum + item.posts, 0)
  const measuredPosts = evidenceValues.reduce((sum, item) => sum + item.measured, 0)
  const measuredChannels = evidenceValues.filter(item => item.measured > 0).length
  const signalScore = evidenceValues.reduce((sum, item) => sum + item.score, 0)
  const strongestEvidence = [...evidenceValues].sort((a, b) => b.score - a.score)[0]
  const strongestPlatform = strongestEvidence ? DEMAND_PLATFORM_DEFINITIONS.find(platform => platform.key === strongestEvidence.key) : null
  const evidenceRows = DEMAND_PLATFORM_DEFINITIONS
    .map(platform => ({ platform, evidence: channelEvidence.get(platform.key) }))
    .filter(row => row.evidence?.posts || platformSourceValue(row.platform, context) || platformIsMentioned(row.platform, context))
    .sort((a, b) => {
      const aEvidence = a.evidence
      const bEvidence = b.evidence
      return (bEvidence?.score ?? 0) - (aEvidence?.score ?? 0) ||
        (bEvidence?.measured ?? 0) - (aEvidence?.measured ?? 0) ||
        (bEvidence?.posts ?? 0) - (aEvidence?.posts ?? 0)
    })
    .slice(0, 6)
  const totalFields = DEMAND_FACT_KEYS.length + Object.keys(DEFAULT_DEMAND_OPERATING_MODEL).length + DEMAND_SOURCE_KEYS.length
  const filledFields = factCount + operatingCount + sourceCount
  const readiness = Math.round((filledFields / totalFields) * 100)

  return (
    <section style={{ marginBottom: space[8], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[4] }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>
            <Target size={16} color={color.accent} />
            Demand operating readiness
          </div>
          <p style={{ margin: `${space[2]} 0 0`, maxWidth: 720, color: color.ink2, fontSize: t.size.sm, lineHeight: 1.5 }}>
            This is the client model VERA uses to plan content, route approvals, measure traction, and decide what should move to SAM.
          </p>
        </div>
        <Chip tone={readiness >= 70 ? 'accent' : 'default'} size="md">{readiness}% ready</Chip>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: space[3] }}>
        <ReadinessTile icon={Link2} label="Sources" value={`${sourceCount}/${DEMAND_SOURCE_KEYS.length}`} detail="Website and channel evidence" tone={sourceCount ? color.success : color.warn} />
        <ReadinessTile icon={BrainIcon} label="Context" value={`${factCount}/${DEMAND_FACT_KEYS.length}`} detail="Offer, ICP, proof, constraints" tone={factCount >= 6 ? color.success : color.warn} />
        <ReadinessTile icon={Sparkles} label="Operating fields" value={`${operatingCount}/${Object.keys(DEFAULT_DEMAND_OPERATING_MODEL).length}`} detail="Demand, formats, signals, learning" tone={operatingCount >= 5 ? color.success : color.warn} />
        <ReadinessTile icon={ShieldCheck} label="Custom policies" value={customPolicies} detail="Channel rules beyond defaults" tone={customPolicies ? color.accent : color.ghost} />
        <ReadinessTile icon={AlertTriangle} label="High-care channels" value={highCareChannels} detail="Approval-sensitive surfaces" tone={highCareChannels ? color.danger : color.success} />
        <ReadinessTile icon={Target} label="Planned channels" value={plannedChannels} detail="Mentioned but no source URL yet" tone={plannedChannels ? color.info : color.ghost} />
        <ReadinessTile icon={BookOpen} label="Content assets" value={totalPosts} detail="Posts available for learning" tone={totalPosts ? color.success : color.ghost} />
        <ReadinessTile icon={RefreshCw} label="Measured assets" value={`${measuredPosts}/${totalPosts || 0}`} detail="Posts with metric signals" tone={measuredPosts ? color.success : color.warn} />
        <ReadinessTile icon={Target} label="Learning channels" value={measuredChannels} detail={strongestPlatform ? `Strongest: ${strongestPlatform.label}` : 'No channel has measured traction'} tone={measuredChannels ? color.accent : color.ghost} />
        <ReadinessTile icon={Sparkles} label="Signal score" value={signalScore} detail="Weighted demand signal total" tone={signalScore ? color.accent : color.ghost} />
      </div>

      <div style={{ marginTop: space[4], display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
        <span style={{ color: color.ghost, fontSize: t.size.cap, marginRight: space[1] }}>Source gaps</span>
        {gaps.length ? gaps.map(platform => (
          <Chip key={platform.key} dot={platformIsMentioned(platform, context) ? color.info : color.ghost}>{platform.label}</Chip>
        )) : <Chip dot={color.success}>All demand sources configured</Chip>}
      </div>

      <div style={{ marginTop: space[4], padding: space[4], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap', marginBottom: space[3] }}>
          <div>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Learning evidence</div>
            <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4 }}>
              Posts and metrics VERA can use to improve channel strategy and decide what should move to SAM.
            </p>
          </div>
          <Chip dot={measuredPosts ? color.success : color.warn}>{measuredPosts} measured</Chip>
        </div>
        {learningLoading ? (
          <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap }}>Loading learning evidence...</p>
        ) : learningError ? (
          <p style={{ margin: 0, color: color.danger, fontSize: t.size.cap }}>{learningError}</p>
        ) : totalPosts === 0 ? (
          <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap }}>
            No channel posts found yet. Once content is created or imported, this panel will show where VERA has evidence.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: space[3] }}>
            {evidenceRows.map(({ platform, evidence }) => (
              <div key={platform.key} style={{ padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.sm }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
                  <span style={{ width: 24, height: 24, borderRadius: radius.xs, background: evidence?.measured ? color.accentSoft : color.paper2, color: evidence?.measured ? color.accent : color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
                    {platform.initials}
                  </span>
                  <span style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>{platform.label}</span>
                </div>
                <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginBottom: space[2] }}>
                  <Chip>{evidence?.posts ?? 0} posts</Chip>
                  <Chip dot={evidence?.measured ? color.success : color.warn}>{evidence?.measured ?? 0} measured</Chip>
                  <Chip dot={evidence?.score ? color.accent : color.ghost}>score {evidence?.score ?? 0}</Chip>
                </div>
                <div style={{ color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4 }}>
                  {evidence?.demandSignals.length ? evidence.demandSignals.slice(0, 3).join(', ') : formatLearningDate(evidence?.lastSignalAt ?? null)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ReadinessTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ElementType
  label: string
  value: string | number
  detail: string
  tone: string
}) {
  return (
    <div style={{ padding: space[4], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, minHeight: 104 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <span style={{ color: color.ghost, fontSize: t.size.cap, fontWeight: t.weight.medium }}>{label}</span>
        <Icon size={15} color={tone} />
      </div>
      <div style={{ marginTop: space[2], color: color.ink, fontSize: t.size.h3, fontWeight: t.weight.semibold, lineHeight: 1.1 }}>{value}</div>
      <p style={{ margin: `${space[2]} 0 0`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4 }}>{detail}</p>
    </div>
  )
}

function DemandChannelMatrix({
  context,
  policies,
  channelEvidence,
  onEditPolicy,
}: {
  context: BusinessContext
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>
  channelEvidence: Map<DemandPlatformKey, BrainChannelEvidence>
  onEditPolicy: (key: DemandPlatformKey) => void
}) {
  const platforms = orderedDemandPlatforms(context)
  const configured = platforms.filter(platform => platformSourceValue(platform, context)).length
  const measured = platforms.filter(platform => (channelEvidence.get(platform.key)?.measured ?? 0) > 0).length

  return (
    <div style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[4] }}>
        <div>
          <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Channel operating matrix</div>
          <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `${space[2]} 0 0`, maxWidth: 660 }}>
            VERA uses this map to decide what each channel is for, how content should be handled, what signals matter, and when work stays manual.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <Chip tone="accent">{configured}/{platforms.length} sources configured</Chip>
          <Chip dot={measured ? color.success : color.ghost}>{measured} measured channels</Chip>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: space[3] }}>
        {platforms.map(platform => {
          const source = platformSourceValue(platform, context)
          const mentioned = platformIsMentioned(platform, context)
          const evidence = channelEvidence.get(platform.key)
          const hasEvidence = (evidence?.posts ?? 0) > 0
          const active = !!source || mentioned || hasEvidence
          const policy = policies[platform.key] ?? DEMAND_CHANNEL_OPERATING_POLICIES[platform.key]
          const customized = demandChannelPolicyHasOverride(platform.key, policy)
          return (
            <div key={platform.key} style={{
              padding: space[4],
              borderRadius: radius.md,
              border: `1px solid ${active ? color.line2 : color.line}`,
              background: active ? color.paper : color.paper2,
              minWidth: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[3] }}>
                <span style={{ width: 30, height: 30, borderRadius: radius.sm, background: active ? color.accentSoft : color.surface, color: active ? color.accent : color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.cap, fontWeight: t.weight.semibold, flexShrink: 0 }}>
                  {platform.initials}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.label}</div>
                  <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 2 }}>{source ? 'Source configured' : evidence?.measured ? 'Learning from metrics' : hasEvidence ? 'Content tracked' : active ? 'In channel strategy' : 'Available'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginBottom: space[3] }}>
                <Chip dot={publishingTone(platform.publishing)}>{publishingLabel(platform.publishing)}</Chip>
                <Chip dot={riskTone(policy.risk)}>{riskLabel(policy.risk)}</Chip>
                {source && <Chip dot={color.success}>Source</Chip>}
                {!source && mentioned && <Chip dot={color.info}>Planned</Chip>}
                {hasEvidence && <Chip dot={evidence?.measured ? color.success : color.warn}>{evidence?.posts ?? 0} posts</Chip>}
                {evidence?.measured ? <Chip dot={color.accent}>{evidence.measured} measured</Chip> : null}
                {customized && <Chip dot={color.accent}>Custom</Chip>}
              </div>
              {source && (
                <div title={source} style={{ fontSize: t.size.micro, color: color.ghost, padding: `${space[2]} ${space[3]}`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: space[3] }}>
                  {source}
                </div>
              )}
              <p style={{ margin: `0 0 ${space[3]}`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{platform.role}</p>
              <p style={{ margin: `0 0 ${space[3]}`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.45 }}>{platform.workflow}</p>
              <div style={{ display: 'grid', gap: space[2], marginBottom: space[3] }}>
                <PolicyLine label="Speaker" value={policy.speakerMode} />
                <PolicyLine label="Approval" value={policy.approvalMode} />
                <PolicyLine label="Guard" value={policy.publishGuard} />
                <PolicyLine label="SAM" value={policy.samTrigger} />
              </div>
              <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
                {platform.outcomeSignals.map(signal => <Chip key={signal}>{signal}</Chip>)}
              </div>
              <p style={{ margin: `${space[3]} 0 0`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.45 }}>
                Measures: {policy.measurementFocus}
              </p>
              <Button variant="ghost" size="sm" onClick={() => onEditPolicy(platform.key)} style={{ marginTop: space[3], paddingLeft: 0, paddingRight: 0 }}>
                Edit policy
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PolicyLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr)', gap: space[2], alignItems: 'start' }}>
      <span style={{ color: color.faint, fontSize: t.size.micro, lineHeight: 1.35 }}>{label}</span>
      <span style={{ color: color.ink2, fontSize: t.size.micro, lineHeight: 1.35 }}>{value}</span>
    </div>
  )
}

function DemandChannelPolicyEditor({
  policies,
  selected,
  onSelect,
  onChange,
  onReset,
  onSave,
  saving,
  saved,
}: {
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>
  selected: DemandPlatformKey
  onSelect: (key: DemandPlatformKey) => void
  onChange: (key: DemandPlatformKey, patch: Partial<DemandChannelOperatingPolicy>) => void
  onReset: (key: DemandPlatformKey) => void
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  const platform = DEMAND_PLATFORM_DEFINITIONS.find(item => item.key === selected) ?? DEMAND_PLATFORM_DEFINITIONS[0]
  const policy = policies[platform.key] ?? DEMAND_CHANNEL_OPERATING_POLICIES[platform.key]
  const overrideCount = demandChannelPolicyOverrideCount(policies)
  const customized = demandChannelPolicyHasOverride(platform.key, policy)

  return (
    <div style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[4] }}>
        <div>
          <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Channel policy editor</div>
          <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `${space[2]} 0 0`, maxWidth: 700 }}>
            These rules become part of this client's Demand Brain. Vera uses them when choosing a speaker, routing approval, deciding whether work can publish, and deciding which signals move to SAM.
          </p>
        </div>
        <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip tone={overrideCount ? 'accent' : 'default'}>{overrideCount} custom channels</Chip>
          {saved && <Chip dot={color.success}>Saved</Chip>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4], alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: space[2] }}>
          {DEMAND_PLATFORM_DEFINITIONS.map(item => {
            const active = item.key === platform.key
            const itemCustomized = demandChannelPolicyHasOverride(item.key, policies[item.key] ?? DEMAND_CHANNEL_OPERATING_POLICIES[item.key])
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                style={{
                  width: '100%',
                  minHeight: 38,
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[3],
                  padding: `${space[2]} ${space[3]}`,
                  borderRadius: radius.sm,
                  border: `1px solid ${active ? color.accentLine : color.line}`,
                  background: active ? color.accentSoft : color.paper2,
                  color: active ? color.accent : color.ink2,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: t.size.sm,
                  fontWeight: active ? t.weight.semibold : t.weight.medium,
                }}
              >
                <span style={{ width: 24, height: 24, borderRadius: radius.xs, background: active ? color.surface : color.paper, color: active ? color.accent : color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.micro, flexShrink: 0 }}>
                  {item.initials}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                {itemCustomized && <span style={{ width: 6, height: 6, borderRadius: 999, background: color.accent, flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gap: space[4], minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
                <span style={{ color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>{platform.label}</span>
                <Chip dot={riskTone(policy.risk)}>{riskLabel(policy.risk)}</Chip>
                {customized ? <Chip dot={color.accent}>Custom</Chip> : <Chip>Default</Chip>}
              </div>
              <p style={{ color: color.ghost, fontSize: t.size.cap, lineHeight: 1.45, margin: `${space[2]} 0 0` }}>{platform.role}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onReset(platform.key)} disabled={!customized}>
              Reset channel
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: space[4] }}>
            <Field label="Speaker mode">
              <Textarea rows={3} value={policy.speakerMode} onChange={e => onChange(platform.key, { speakerMode: e.target.value })} />
            </Field>
            <Field label="Approval path">
              <Textarea rows={3} value={policy.approvalMode} onChange={e => onChange(platform.key, { approvalMode: e.target.value })} />
            </Field>
            <Field label="Publishing guard">
              <Textarea rows={3} value={policy.publishGuard} onChange={e => onChange(platform.key, { publishGuard: e.target.value })} />
            </Field>
            <Field label="Measurement focus">
              <Textarea rows={3} value={policy.measurementFocus} onChange={e => onChange(platform.key, { measurementFocus: e.target.value })} />
            </Field>
            <Field label="SAM handoff trigger">
              <Textarea rows={3} value={policy.samTrigger} onChange={e => onChange(platform.key, { samTrigger: e.target.value })} />
            </Field>
            <Field label="Approval risk" helper="This affects the visible policy badge. Publishing enforcement remains controlled by integrations and approvals.">
              <Select value={policy.risk} onChange={e => onChange(platform.key, { risk: e.target.value as DemandChannelRisk })}>
                <option value="low">Standard review</option>
                <option value="medium">Approval aware</option>
                <option value="high">High approval care</option>
              </Select>
            </Field>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
            <Button variant="primary" size="md" onClick={onSave} disabled={saving} style={{ background: color.ink, color: color.surface }}>
              {saving ? <Loader2 size={14} /> : <Check size={14} />} Save channel policies
            </Button>
            <span style={{ color: color.ghost, fontSize: t.size.cap }}>
              Saved policies are injected into Vera's project instructions from the next turn.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Brain() {
  const { activeProject, refetch } = useProject()
  const { activeOrg } = useOrg()
  const { session } = useAuth()
  useRightRail(null, []) // full canvas

  // ── business context + custom instructions (project.instructions) ──
  const businessFileRef = useRef<HTMLInputElement>(null)
  const [business, setBusiness] = useState<BusinessContext>({ ...EMPTY_BUSINESS_CONTEXT })
  const [instr, setInstr] = useState('')
  const [instrSaving, setInstrSaving] = useState(false)
  const [instrSaved, setInstrSaved] = useState(false)
  const [extractingContext, setExtractingContext] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [extractError, setExtractError] = useState<string | null>(null)
  const [pullingSources, setPullingSources] = useState(false)
  const [sourceStatus, setSourceStatus] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [selectedPolicyKey, setSelectedPolicyKey] = useState<DemandPlatformKey>('linkedin')
  const [learningPosts, setLearningPosts] = useState<Post[]>([])
  const [learningSnapshots, setLearningSnapshots] = useState<ContentMetricSnapshot[]>([])
  const [learningLoading, setLearningLoading] = useState(false)
  const [learningError, setLearningError] = useState<string | null>(null)

  useEffect(() => {
    const parsed = parseProjectInstructions(activeProject?.instructions ?? '')
    setInstr(parsed.customInstructions)
    setBusiness({
      ...EMPTY_BUSINESS_CONTEXT,
      ...parsed.businessContext,
      website: parsed.businessContext.website || ((activeProject?.description ?? '').startsWith('http') ? activeProject?.description ?? '' : ''),
      companyName: parsed.businessContext.companyName || activeProject?.name || '',
    })
  }, [activeProject?.id, activeProject?.instructions, activeProject?.name, activeProject?.description])

  const channelPolicies = useMemo(
    () => demandChannelPoliciesFromText(business.channelOperatingPolicies),
    [business.channelOperatingPolicies],
  )
  const brainMetrics = useMemo(() => buildBrainMetrics(learningSnapshots), [learningSnapshots])
  const channelEvidence = useMemo(() => buildBrainChannelEvidence(learningPosts, brainMetrics), [learningPosts, brainMetrics])

  useEffect(() => {
    let cancelled = false
    if (!activeProject?.id) {
      setLearningPosts([])
      setLearningSnapshots([])
      setLearningLoading(false)
      setLearningError(null)
      return () => { cancelled = true }
    }

    setLearningLoading(true)
    setLearningError(null)
    ;(async () => {
      const [postRes, metricRes] = await Promise.all([
        supabase
          .from('content_posts')
          .select('*')
          .eq('project_id', activeProject.id)
          .order('created_at', { ascending: false })
          .limit(250),
        supabase
          .from('content_metric_snapshots')
          .select('id, org_id, project_id, post_id, provider, provider_account_id, provider_object_id, object_type, metric_name, metric_value, metric_period, metric_time, pulled_at, raw, created_at')
          .eq('project_id', activeProject.id)
          .in('metric_name', Array.from(BRAIN_DEMAND_METRICS))
          .order('pulled_at', { ascending: false })
          .limit(1500),
      ])
      if (cancelled) return
      const firstError = postRes.error ?? metricRes.error
      if (firstError) {
        setLearningError(firstError.message)
        setLearningPosts([])
        setLearningSnapshots([])
      } else {
        setLearningPosts((postRes.data ?? []) as Post[])
        setLearningSnapshots((metricRes.data ?? []) as ContentMetricSnapshot[])
      }
      setLearningLoading(false)
    })().catch(error => {
      if (cancelled) return
      setLearningError(error instanceof Error ? error.message : 'Could not load learning evidence.')
      setLearningPosts([])
      setLearningSnapshots([])
      setLearningLoading(false)
    })

    return () => { cancelled = true }
  }, [activeProject?.id])

  async function saveInstr() {
    if (!activeProject?.id) return
    setInstrSaving(true)
    const context = {
      ...business,
      companyName: business.companyName.trim() || activeProject.name,
      channelOperatingPolicies: business.channelOperatingPolicies || serializeDemandChannelPolicies(channelPolicies),
    }
    await supabase.from('projects').update({
      instructions: mergeProjectInstructions(instr, context),
      description: compactProjectDescription(context) ?? activeProject.description ?? null,
    }).eq('id', activeProject.id)
    setInstrSaving(false); setInstrSaved(true); setTimeout(() => setInstrSaved(false), 2500)
    refetch()
  }

  function updateBusiness(key: BusinessContextKey, value: string) {
    setBusiness(prev => ({ ...prev, [key]: value }))
  }

  function updateChannelPolicy(key: DemandPlatformKey, patch: Partial<DemandChannelOperatingPolicy>) {
    const next = {
      ...channelPolicies,
      [key]: {
        ...channelPolicies[key],
        ...patch,
      },
    }
    setBusiness(prev => ({ ...prev, channelOperatingPolicies: serializeDemandChannelPolicies(next) }))
  }

  function resetChannelPolicy(key: DemandPlatformKey) {
    const defaults = defaultDemandChannelPolicies()
    const next = {
      ...channelPolicies,
      [key]: defaults[key],
    }
    setBusiness(prev => ({ ...prev, channelOperatingPolicies: serializeDemandChannelPolicies(next) }))
  }

  async function extractBusinessContext(files: FileList | null) {
    const file = files?.[0]
    if (!file || !activeProject?.id) return
    setExtractError(null)
    setExtractStatus('')
    if (!session?.access_token) {
      setExtractError('Sign in before extracting business context.')
      return
    }
    if (file.size > MAX_BUSINESS_DOC_BYTES) {
      setExtractError('Use a document under 20 MB.')
      return
    }

    setExtractingContext(true)
    try {
      const mime = businessDocMime(file)
      const payload: Record<string, unknown> = {
        project_id: activeProject.id,
        project_name: activeProject.name,
        file_name: file.name,
        mime_type: mime,
        existing_context: business,
      }
      if (mime === 'application/pdf' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileExtension(file.name) === 'pdf' || fileExtension(file.name) === 'docx') {
        const dataUrl = await readFileAsDataUrl(file)
        payload.data_base64 = dataUrl.split(',')[1] ?? ''
      } else if (isTextBusinessDoc(file, mime)) {
        payload.text = await readFileAsText(file)
      } else {
        throw new Error('Use PDF, DOCX, TXT, Markdown, CSV, JSON, or HTML.')
      }

      const res = await fetch(`${SUPA}/functions/v1/extract-business-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; context?: Partial<BusinessContext>; source?: string }
      if (!res.ok) throw new Error(data.error ?? `Extraction failed with HTTP ${res.status}`)
      setBusiness(prev => mergeExtractedContext(prev, data.context ?? {}))
      setExtractStatus(`Extracted from ${data.source ?? file.name}. Review and save.`)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : 'Could not extract this document.')
    } finally {
      setExtractingContext(false)
      if (businessFileRef.current) businessFileRef.current.value = ''
    }
  }

  async function pullBusinessSources() {
    if (!activeProject?.id) return
    setSourceError(null)
    setSourceStatus('')
    if (!session?.access_token) {
      setSourceError('Sign in before pulling sources.')
      return
    }
    if (!DEMAND_SOURCE_KEYS.some(key => business[key].trim())) {
      setSourceError('Add at least one source URL first.')
      return
    }

    setPullingSources(true)
    try {
      const res = await fetch(`${SUPA}/functions/v1/extract-business-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: activeProject.id,
          project_name: activeProject.name,
          existing_context: business,
          pull_sources: true,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string
        context?: Partial<BusinessContext>
        sources?: SourcePullReport[]
      }
      if (!res.ok) throw new Error(data.error ?? `Source pull failed with HTTP ${res.status}`)
      setBusiness(prev => mergeExtractedContext(prev, data.context ?? {}))
      const reports = data.sources ?? []
      const okCount = reports.filter(item => item.ok).length
      const total = reports.length || DEMAND_SOURCE_KEYS.filter(key => business[key].trim()).length
      setSourceStatus(`Pulled ${okCount}/${total} sources. Review and save.`)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'Could not pull these sources.')
    } finally {
      setPullingSources(false)
    }
  }

  // ── brand voice (per-client — vera-chat now reads the project row first) ──
  const [bv, setBv] = useState<Partial<BrandVoice>>({})
  const [bvInherited, setBvInherited] = useState(false) // showing workspace default (no client row yet)
  const [bvSaving, setBvSaving] = useState(false)
  const [bvSaved, setBvSaved] = useState(false)
  useEffect(() => {
    if (!activeProject?.id || !activeOrg?.id) return
    let cancelled = false
    ;(async () => {
      // a client-specific row?
      const { data: proj } = await supabase.from('brand_voice').select('*').eq('project_id', activeProject.id).limit(1)
      if (cancelled) return
      if (proj && proj.length) { setBv(proj[0] as BrandVoice); setBvInherited(false); return }
      // none yet — pre-fill from the workspace default (project_id null) so the
      // editor isn't blank; drop id so Save creates a client-specific row.
      const { data: org } = await supabase.from('brand_voice').select('*').eq('org_id', activeOrg.id).order('project_id', { nullsFirst: true }).limit(1)
      if (cancelled) return
      if (org && org.length) { setBv({ ...(org[0] as BrandVoice), id: undefined }); setBvInherited(true) }
      else { setBv({}); setBvInherited(false) }
    })()
    return () => { cancelled = true }
  }, [activeProject?.id, activeOrg?.id])
  async function saveBv() {
    if (!activeOrg?.id || !activeProject?.id) return
    setBvSaving(true)
    const payload = { ...bv, org_id: activeOrg.id, project_id: activeProject.id }
    if (bv.id) await supabase.from('brand_voice').update(payload).eq('id', bv.id)
    else { const { data } = await supabase.from('brand_voice').insert(payload).select().single(); if (data) setBv(data as BrandVoice) }
    setBvSaving(false); setBvInherited(false); setBvSaved(true); setTimeout(() => setBvSaved(false), 2500)
  }
  const addTo = (key: keyof BrandVoice, val: string) => { if (val.trim()) setBv(p => ({ ...p, [key]: [...((p[key] as string[]) || []), val.trim()] })) }
  const rmFrom = (key: keyof BrandVoice, i: number) => setBv(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))

  // ── agentic draft: Vera reads the client's content (content-audit) and
  // proposes the brand voice; the operator reviews + Saves (HITL). Chat/
  // agentic-first — the brain shouldn't start as a blank form. ──
  const [drafting, setDrafting] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  async function runDraft() {
    if (!activeOrg?.id || !activeProject?.id || drafting) return
    if (!session?.access_token) {
      setDraftStatus('Sign in again before drafting the brand voice.')
      return
    }
    setDrafting(true); setDraftStatus("Reading this client's content…")
    try {
      const res = await fetch(`${SUPA}/functions/v1/content-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ org_id: activeOrg.id, project_id: activeProject.id }),
      })
      if (!res.body) throw new Error('no response from the audit')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim(); if (!json) continue
          let ev: { event?: string; message?: string; proposal?: { brand_voice?: Record<string, string[]>; personas?: unknown[] } }
          try { ev = JSON.parse(json) } catch { continue }
          if (ev.event === 'started' || ev.event === 'fetching') setDraftStatus("Reading this client's content…")
          else if (ev.event === 'synthesising') setDraftStatus('Drafting the brand voice…')
          else if (ev.event === 'done') {
            const v = ev.proposal?.brand_voice ?? {}
            const n = ev.proposal?.personas?.length ?? 0
            setBv(prev => ({
              ...prev,
              tone: v.tone ?? prev.tone,
              writing_rules: v.writing_rules ?? prev.writing_rules,
              forbidden_phrases: v.forbidden_phrases ?? prev.forbidden_phrases,
              required_phrases: v.required_phrases ?? prev.required_phrases,
            }))
            setBvInherited(false)
            setDraftStatus(`Drafted from this client's content. Review the brand voice below and Save.${n ? ` Vera also spotted ${n} audience${n === 1 ? '' : 's'}; add the ones that fit.` : ''}`)
          }
          else if (ev.event === 'error') throw new Error(ev.message ?? 'audit failed')
        }
      }
    } catch (e) {
      setDraftStatus(`Couldn't draft automatically (${(e as Error).message}). You can still fill the brain by hand below.`)
    } finally {
      setDrafting(false)
    }
  }

  // ── audiences (editable) ──
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [addingAudience, setAddingAudience] = useState(false)
  const reloadAudiences = useCallback(() => {
    if (!activeOrg?.id) return
    supabase.from('audiences').select('*').eq('org_id', activeOrg.id).order('created_at').then(({ data }) => setAudiences((data ?? []) as Audience[]))
  }, [activeOrg?.id])
  useEffect(() => { reloadAudiences() }, [reloadAudiences])

  // ── content categories (per-client buckets — Vera tags posts, Calendar/Artifacts filter) ──
  const [categories, setCategories] = useState<{ id: string; name: string; color: string | null }[]>([])
  const [catName, setCatName] = useState('')
  const reloadCategories = useCallback(() => {
    if (!activeProject?.id) return
    supabase.from('content_categories').select('id, name, color').eq('project_id', activeProject.id).order('sort_order')
      .then(({ data }) => setCategories((data ?? []) as { id: string; name: string; color: string | null }[]))
  }, [activeProject?.id])
  useEffect(() => { reloadCategories() }, [reloadCategories])
  const CAT_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#EF6A6A', '#d97706', '#db2777', '#0891b2', '#65a30d']
  async function addCategory(name: string) {
    if (!name.trim() || !activeProject?.id) return
    await supabase.from('content_categories').insert({ project_id: activeProject.id, org_id: activeOrg?.id ?? null, name: name.trim(), color: CAT_COLORS[categories.length % CAT_COLORS.length], sort_order: categories.length })
    setCatName(''); reloadCategories()
  }
  async function deleteCategory(id: string) { await supabase.from('content_categories').delete().eq('id', id); reloadCategories() }
  async function seedDefaultCategories() {
    if (!activeProject?.id) return
    const defaults = ['Evergreen', 'Educational', 'Product', 'Founder POV', 'News', 'Engagement']
    await supabase.from('content_categories').insert(defaults.map((name, i) => ({ project_id: activeProject.id, org_id: activeOrg?.id ?? null, name, color: CAT_COLORS[i % CAT_COLORS.length], sort_order: i })))
    reloadCategories()
  }

  if (!activeProject) {
    return <div style={{ padding: space[8], maxWidth: 760 }}><EmptyState icon={<BrainIcon size={22} strokeWidth={1.5} />} title="No active project" body="Pick a client in the left rail to set its brain: instructions, voice, audiences." /></div>
  }

  const sourceCount = DEMAND_SOURCE_KEYS
    .filter(key => business[key].trim()).length
  const operatingKeys = Object.keys(DEFAULT_DEMAND_OPERATING_MODEL) as BusinessContextKey[]
  const factCount = DEMAND_FACT_KEYS.filter(key => business[key].trim()).length
  const operatingCount = operatingKeys.filter(key => business[key].trim()).length
  const applyLeadGenDefaults = () => {
    setBusiness(prev => applyDemandDefaults(prev))
    setSourceStatus('Lead-gen operating defaults added. Review and save.')
  }

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 1040 }}>
      <PageHeader eyebrow={activeProject.name} title="Demand Brain"
        subtitle="The client demand intelligence VERA uses every turn: ICP, offer, buyer pains, proof, voice, sources, and constraints." />

      <BrainReadinessPanel
        context={business}
        policies={channelPolicies}
        sourceCount={sourceCount}
        factCount={factCount}
        operatingCount={operatingCount}
        channelEvidence={channelEvidence}
        learningLoading={learningLoading}
        learningError={learningError}
      />

      {/* Agentic-first: let Vera draft the brain from the client's content
          instead of starting blank. Prefills the brand voice for review. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap', marginBottom: space[8], padding: `${space[4]} ${space[5]}`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
        <Button variant="secondary" size="sm" onClick={runDraft} disabled={drafting || !activeOrg}>
          {drafting ? <><Loader2 size={14} className="animate-spin" /> Drafting…</> : <><Sparkles size={14} /> Draft this brain with Vera</>}
        </Button>
        <span style={{ flex: 1, minWidth: 200, fontSize: t.size.cap, color: draftStatus ? color.ink2 : color.ghost, lineHeight: 1.5 }}>
          {draftStatus || "Vera reads this client's content and drafts the brand voice. You review and save. Beats filling a blank form."}
        </span>
      </div>

      {/* Business context */}
      <section style={{ marginBottom: space[9] }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[3] }}>
          <div>
            <SectionLabel>Demand context</SectionLabel>
            <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `${space[2]} 0 0` }}>
              Start with the company URL, then add the social sources and facts VERA should use for demand creation.
            </p>
          </div>
          <span style={{ fontSize: t.size.cap, color: color.ghost }}>
            {sourceCount}/{DEMAND_SOURCE_KEYS.length} sources · {factCount}/11 context fields · {operatingCount}/{operatingKeys.length} operating fields
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4], alignItems: 'start' }}>
          <div style={{ padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: space[4] }}>
              <Field label="Company URL" helper="Primary source for extraction and verification.">
                <Input value={business.website} onChange={e => updateBusiness('website', e.target.value)} placeholder="https://company.com" />
              </Field>
              <Field label="Company name">
                <Input value={business.companyName} onChange={e => updateBusiness('companyName', e.target.value)} placeholder={activeProject.name} />
              </Field>
              <Field label="LinkedIn company page">
                <Input value={business.linkedinCompany} onChange={e => updateBusiness('linkedinCompany', e.target.value)} placeholder="https://linkedin.com/company/company-name" />
              </Field>
              <Field label="LinkedIn profile">
                <Input value={business.linkedinProfile} onChange={e => updateBusiness('linkedinProfile', e.target.value)} placeholder="https://linkedin.com/in/person-name" />
              </Field>
              <Field label="LinkedIn events">
                <Input value={business.linkedinEvents} onChange={e => updateBusiness('linkedinEvents', e.target.value)} placeholder="https://linkedin.com/events/event-name" />
              </Field>
              <Field label="LinkedIn newsletter">
                <Input value={business.linkedinNewsletter} onChange={e => updateBusiness('linkedinNewsletter', e.target.value)} placeholder="https://linkedin.com/newsletters/newsletter-name" />
              </Field>
              <Field label="Instagram">
                <Input value={business.instagram} onChange={e => updateBusiness('instagram', e.target.value)} placeholder="https://instagram.com/brand" />
              </Field>
              <Field label="YouTube">
                <Input value={business.youtube} onChange={e => updateBusiness('youtube', e.target.value)} placeholder="https://youtube.com/@brand" />
              </Field>
              <Field label="Medium">
                <Input value={business.medium} onChange={e => updateBusiness('medium', e.target.value)} placeholder="https://medium.com/@brand" />
              </Field>
              <Field label="Quora">
                <Input value={business.quora} onChange={e => updateBusiness('quora', e.target.value)} placeholder="https://quora.com/profile/person-or-brand" />
              </Field>
              <Field label="Reddit">
                <Input value={business.reddit} onChange={e => updateBusiness('reddit', e.target.value)} placeholder="https://reddit.com/r/community or https://reddit.com/user/name" />
              </Field>
              <Field label="Facebook page">
                <Input value={business.facebook} onChange={e => updateBusiness('facebook', e.target.value)} placeholder="https://facebook.com/brand" />
              </Field>
              <Field label="X profile">
                <Input value={business.x} onChange={e => updateBusiness('x', e.target.value)} placeholder="https://x.com/brand" />
              </Field>
              <Field label="Industry">
                <Input value={business.industry} onChange={e => updateBusiness('industry', e.target.value)} placeholder="Fashion, hospitality, SaaS, healthcare" />
              </Field>
            </div>
          </div>

          <div style={{ padding: space[5], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[4] }}>
            <input
              ref={businessFileRef}
              type="file"
              accept={BUSINESS_DOC_ACCEPT}
              style={{ display: 'none' }}
              onChange={e => { void extractBusinessContext(e.target.files) }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
                <FileText size={15} />
                Extract from document
              </div>
              <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
                Upload a PDF, DOCX, brief, proposal, or brand deck. VERA extracts the fields, then you review and save.
              </p>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
                <RefreshCw size={15} />
                Pull website and socials
              </div>
              <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
                Pull the website, LinkedIn, Instagram, YouTube, Medium, Quora, Reddit, Facebook, X, events, and newsletters. Innovare handles public scraping; connected LinkedIn and Instagram use Unipile.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {DEMAND_PLATFORM_DEFINITIONS.map(platform => (
                <div key={platform.key} title={platform.role} style={{ padding: '7px 8px', borderRadius: radius.sm, border: `1px solid ${color.line}`, background: color.surface }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: t.size.micro, color: color.ink, fontWeight: t.weight.semibold }}>
                    <span style={{ width: 22, height: 22, borderRadius: radius.sm, background: color.accentSoft, color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{platform.initials}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.label}</span>
                  </div>
                  <div style={{ marginTop: 3, color: color.ghost, fontSize: t.size.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {platform.publishing}
                  </div>
                </div>
              ))}
            </div>
            {(extractStatus || extractError || sourceStatus || sourceError) && (
              <p style={{ margin: 0, fontSize: t.size.cap, color: (extractError || sourceError) ? color.danger : color.success, lineHeight: 1.5 }}>
                {extractError || sourceError || extractStatus || sourceStatus}
              </p>
            )}
            <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={() => businessFileRef.current?.click()} disabled={extractingContext}>
                {extractingContext ? <Loader2 size={13} /> : <Upload size={13} />}
                {extractingContext ? 'Extracting...' : 'Upload'}
              </Button>
              <Button variant="secondary" size="sm" onClick={pullBusinessSources} disabled={pullingSources}>
                {pullingSources ? <Loader2 size={13} /> : <RefreshCw size={13} />}
                {pullingSources ? 'Pulling...' : 'Pull sources'}
              </Button>
              <Button variant="primary" size="sm" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
                {instrSaving ? <Loader2 size={13} /> : <Check size={13} />} Save
              </Button>
            </div>
          </div>
        </div>

        <DemandChannelMatrix
          context={business}
          policies={channelPolicies}
          channelEvidence={channelEvidence}
          onEditPolicy={key => setSelectedPolicyKey(key)}
        />

        <DemandChannelPolicyEditor
          policies={channelPolicies}
          selected={selectedPolicyKey}
          onSelect={setSelectedPolicyKey}
          onChange={updateChannelPolicy}
          onReset={resetChannelPolicy}
          onSave={saveInstr}
          saving={instrSaving}
          saved={instrSaved}
        />

        <div style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[4] }}>
            <div>
              <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Business facts</div>
              <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>The strategy layer VERA uses for content, campaigns, and answers.</div>
            </div>
            {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved.</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4] }}>
            <Field label="Offer">
              <Textarea value={business.offer} onChange={e => updateBusiness('offer', e.target.value)} rows={3} placeholder="Products, services, pricing model, flagship offer, core value proposition." />
            </Field>
            <Field label="Target audience">
              <Textarea value={business.audience} onChange={e => updateBusiness('audience', e.target.value)} rows={3} placeholder="Who buys, who uses it, decision makers, industries, regions, customer segments." />
            </Field>
            <Field label="Customer problems">
              <Textarea value={business.customerProblems} onChange={e => updateBusiness('customerProblems', e.target.value)} rows={3} placeholder="Pain points, unmet needs, buying triggers, risks, objections." />
            </Field>
            <Field label="Differentiators">
              <Textarea value={business.differentiators} onChange={e => updateBusiness('differentiators', e.target.value)} rows={3} placeholder="Positioning, category, why this client is different, proof of advantage." />
            </Field>
            <Field label="Competitors">
              <Textarea value={business.competitors} onChange={e => updateBusiness('competitors', e.target.value)} rows={2} placeholder="Named competitors, alternatives, comparison points." />
            </Field>
            <Field label="Proof points">
              <Textarea value={business.proofPoints} onChange={e => updateBusiness('proofPoints', e.target.value)} rows={3} placeholder="Metrics, case studies, customer names, credentials, testimonials, awards." />
            </Field>
            <Field label="Content goals">
              <Textarea value={business.contentGoals} onChange={e => updateBusiness('contentGoals', e.target.value)} rows={3} placeholder="Awareness, lead generation, recruiting, trust, launches, events, campaign themes." />
            </Field>
            <Field label="Speaker strategy">
              <Textarea value={business.speakerStrategy} onChange={e => updateBusiness('speakerStrategy', e.target.value)} rows={3} placeholder="Who VERA can write as: brand, founder, sales lead, product expert, client team, or a named person. Define when each voice should be used." />
            </Field>
            <Field label="Platform tone of voice">
              <Textarea value={business.platformToneOfVoice} onChange={e => updateBusiness('platformToneOfVoice', e.target.value)} rows={3} placeholder="What changes by medium: LinkedIn authority, YouTube explainer, Medium essay, Quora answer, Reddit community-safe, Instagram visual proof, X concise POV." />
            </Field>
            <Field label="Approval stakeholders">
              <Textarea value={business.approvalStakeholders} onChange={e => updateBusiness('approvalStakeholders', e.target.value)} rows={3} placeholder="Named approvers and routing: one owner for low-risk drafts, all stakeholders for named-person posts, sensitive claims, compliance topics, or publishing." />
            </Field>
            <Field label="Constraints">
              <Textarea value={business.constraints} onChange={e => updateBusiness('constraints', e.target.value)} rows={2} placeholder="Legal, compliance, forbidden claims, regions, tone limits, approval rules." />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
            <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
              {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save business context
            </Button>
            {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>VERA uses this from the next turn.</span>}
          </div>
        </div>

        <div style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[4] }}>
            <div>
              <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Demand operating model</div>
              <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>The rules for what VERA creates, who approves it, what counts as traction, and what moves to SAM.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={applyLeadGenDefaults}>Use lead-gen defaults</Button>
              {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved.</span>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: space[3], marginBottom: space[4] }}>
            <DemandDefaultPanel title="Content jobs" items={DEMAND_CONTENT_JOBS} />
            <DemandDefaultPanel title="Approval modes" items={DEMAND_APPROVAL_MODES} />
            <DemandDefaultPanel title="Outcome signals" items={DEMAND_OUTCOME_SIGNALS} />
            <DemandDefaultPanel title="Growth outcomes" items={DEMAND_GROWTH_OUTCOMES} />
            <DemandDefaultPanel title="Product guardrails" items={DEMAND_COMMERCIAL_REQUIREMENTS} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: space[3], marginBottom: space[4] }}>
            {DEMAND_LEARNING_LOOP.map(step => (
              <div key={step.title} style={{ padding: space[4], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{step.title}</div>
                <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{step.body}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: space[4] }}>
            <Field label="Demand objective">
              <Textarea value={business.demandObjective} onChange={e => updateBusiness('demandObjective', e.target.value)} rows={3} placeholder="Top-of-funnel goal, e.g. category awareness, founder trust, lead-gen for a specific offer, or market education." />
            </Field>
            <Field label="Conversion path">
              <Textarea value={business.conversionPath} onChange={e => updateBusiness('conversionPath', e.target.value)} rows={3} placeholder="Where attention should go next: comments, DMs, landing page, newsletter, webinar, sales call, SAM research queue." />
            </Field>
            <Field label="Channel strategy">
              <Textarea value={business.channelStrategy} onChange={e => updateBusiness('channelStrategy', e.target.value)} rows={3} placeholder="Role of each channel: LinkedIn for authority, YouTube for depth, Medium for SEO, Quora and Reddit for problem-aware demand, X for speed." />
            </Field>
            <Field label="Content formats">
              <Textarea value={business.contentFormats} onChange={e => updateBusiness('contentFormats', e.target.value)} rows={3} placeholder="Posts, carousels, video storyboards, Shorts, long-form articles, answers, comments, founder POV, case breakdowns." />
            </Field>
            <Field label="Approval model">
              <Textarea value={business.approvalModel} onChange={e => updateBusiness('approvalModel', e.target.value)} rows={3} placeholder="Who approves what: operator-only, client lead, legal, all stakeholders, or case-by-case based on topic, claim, or channel." />
            </Field>
            <Field label="Engagement signals">
              <Textarea value={business.engagementSignals} onChange={e => updateBusiness('engagementSignals', e.target.value)} rows={3} placeholder="What counts: comments, shares, saves, clicks, traffic quality, objections, buying triggers, competitor mentions, meeting requests." />
            </Field>
            <Field label="SAM handoff rules">
              <Textarea value={business.samHandoffRules} onChange={e => updateBusiness('samHandoffRules', e.target.value)} rows={3} placeholder="When engagement becomes sales research: named accounts, buying intent, objections, warm commenters, repeated topic demand, inbound questions." />
            </Field>
            <Field label="Learning cadence">
              <Textarea value={business.learningCadence} onChange={e => updateBusiness('learningCadence', e.target.value)} rows={3} placeholder="How often VERA should review performance, refresh best practices, recommend experiments, and update channel-specific tone of voice." />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
            <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
              {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save operating model
            </Button>
            {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>VERA uses this from the next turn.</span>}
          </div>
        </div>
      </section>

      {/* Custom instructions */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Custom instructions</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          The standing brief VERA reads <strong style={{ color: color.ink }}>every turn</strong> for {activeProject.name}: tone, do/don't, positioning, recurring CTAs, in plain language.
        </p>
        <Textarea value={instr} onChange={e => setInstr(e.target.value)} rows={7}
          placeholder={`e.g. Write in a confident, peer-to-peer voice for B2B founders. Lead with a concrete number or a real failure mode, never a hypothetical. Avoid "leverage", "synergy", "game-changer". Always close with one sharp question.`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[3] }}>
          <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
            {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save instructions
          </Button>
          {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved. VERA uses this from the next turn.</span>}
        </div>
      </section>

      {/* Brand voice */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Brand voice</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[4]}` }}>
          The persona, tone, and rules VERA writes by for {activeProject.name}.{' '}
          {bvInherited
            ? <span style={{ color: color.ghost }}>Showing the workspace default. Saving creates a voice specific to this client.</span>
            : <span style={{ color: color.ghost }}>Specific to this client.</span>}
        </p>
        <div style={{ display: 'grid', gap: space[4] }}>
          <Field label="Persona name"><Input value={bv.persona_name ?? ''} onChange={e => setBv(f => ({ ...f, persona_name: e.target.value }))} placeholder="e.g. Alex" /></Field>
          <Field label="Persona descriptor"><Input value={bv.persona_descriptor ?? ''} onChange={e => setBv(f => ({ ...f, persona_descriptor: e.target.value }))} placeholder="A sharp, empathetic B2B strategist" /></Field>
          <Field label="User tone of voice" helper="How the person or brand should sound when VERA writes for them.">
            <Textarea value={bv.system_prompt ?? ''} onChange={e => setBv(f => ({ ...f, system_prompt: e.target.value }))} rows={4} placeholder="Direct, practical, warm, lightly opinionated. Uses short sentences, concrete examples, and avoids hype." />
          </Field>
          <TagInput label="Tone words" placeholder="confident, direct…" items={(bv.tone as string[]) ?? []} onAdd={v => addTo('tone', v)} onRemove={i => rmFrom('tone', i)} />
          <TagInput label="Writing rules" placeholder="Always use the Oxford comma" items={(bv.writing_rules as string[]) ?? []} onAdd={v => addTo('writing_rules', v)} onRemove={i => rmFrom('writing_rules', i)} />
          <TagInput label="Forbidden phrases" placeholder="leverage, synergy…" items={(bv.forbidden_phrases as string[]) ?? []} onAdd={v => addTo('forbidden_phrases', v)} onRemove={i => rmFrom('forbidden_phrases', i)} danger />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[4] }}>
          <Button variant="primary" size="md" onClick={saveBv} disabled={bvSaving} style={{ background: color.ink, color: color.surface }}>
            {bvSaving ? <Loader2 size={14} /> : <Check size={14} />} Save brand voice
          </Button>
          {bvSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved</span>}
        </div>
      </section>

      {/* Audiences (editable) */}
      <section style={{ marginBottom: space[9] }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] }}>
          <SectionLabel>Audiences</SectionLabel>
          {activeOrg?.id && !addingAudience && (
            <Button variant="secondary" size="sm" onClick={() => setAddingAudience(true)}><Plus size={13} /> Add audience</Button>
          )}
        </div>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Who VERA writes toward, driving register, proof points, and which pains to hit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {addingAudience && activeOrg?.id && (
            <AudienceEditor initial={{}} orgId={activeOrg.id} onSaved={() => { setAddingAudience(false); reloadAudiences() }} onCancel={() => setAddingAudience(false)} />
          )}
          {audiences.map(a => <AudienceEditor key={a.id} initial={a} orgId={activeOrg?.id ?? ''} onSaved={reloadAudiences} />)}
          {audiences.length === 0 && !addingAudience && (
            <p style={{ fontSize: t.size.cap, color: color.ghost }}>No audiences yet. Add one so VERA writes toward a specific reader.</p>
          )}
        </div>
      </section>

      {/* Content categories */}
      <section style={{ marginBottom: space[9] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Content categories</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Reusable buckets for this client's content. Vera tags every post with one; Calendar &amp; Artifacts filter by them.
        </p>
        {categories.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[3] }}>
            <span style={{ fontSize: t.size.cap, color: color.ghost }}>No categories yet.</span>
            <Button variant="secondary" size="sm" onClick={seedDefaultCategories}><Plus size={13} /> Add a starter set</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: space[3] }}>
            {categories.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', fontSize: t.size.cap, color: color.ink, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color ?? color.ghost, flexShrink: 0 }} />
                {c.name}
                <button onClick={() => deleteCategory(c.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.faint, display: 'flex', padding: 0 }}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: space[2], maxWidth: 360 }}>
          <Input value={catName} placeholder="Add a category (e.g. Case study)" onChange={e => setCatName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(catName) } }} />
          <Button variant="secondary" size="md" onClick={() => addCategory(catName)}><Plus size={14} /></Button>
        </div>
      </section>

      {/* Knowledge link */}
      <section style={{ marginBottom: space[8] }}>
        <SectionLabel style={{ marginBottom: space[3] }}>Knowledge sources</SectionLabel>
        <Link to={`/p/${activeProject.slug}/knowledge`} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, textDecoration: 'none' }}>
          <BookOpen size={18} style={{ color: color.accent, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink }}>Manage knowledge sources →</div>
            <div style={{ fontSize: t.size.micro, color: color.ghost }}>Paste, URLs, and docs VERA can search and cite. Brand-kit files, logos, guidelines, now live in Artifacts.</div>
          </div>
        </Link>
      </section>

      <div style={{ height: space[8] }} />
    </div>
  )
}

// token-styled tag input (chips + add)
function TagInput({ label, placeholder, items, onAdd, onRemove, danger }: {
  label: string; placeholder?: string; items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void; danger?: boolean
}) {
  const [val, setVal] = useState('')
  const chip = danger ? color.danger : color.accent
  const commit = () => { onAdd(val); setVal('') }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      <span style={{ fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2 }}>{label}</span>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((it, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: t.size.micro, color: chip, background: color.surface, border: `1px solid ${chip}`, borderRadius: radius.pill }}>
              {it}<button onClick={() => onRemove(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: chip, display: 'flex', padding: 0 }}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: space[2] }}>
        <Input value={val} placeholder={placeholder} onChange={e => setVal(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
        <Button variant="secondary" size="md" onClick={commit}><Plus size={14} /></Button>
      </div>
    </div>
  )
}

// Inline editor for one audience — name, primary flag, pain points, goals.
function AudienceEditor({ initial, orgId, onSaved, onCancel }: {
  initial: Partial<Audience>; orgId: string; onSaved: () => void; onCancel?: () => void
}) {
  const [a, setA] = useState<Partial<Audience>>(initial)
  const [saving, setSaving] = useState(false)
  const addArr = (key: 'pain_points' | 'goals', v: string) => { if (v.trim()) setA(p => ({ ...p, [key]: [...((p[key] as string[]) || []), v.trim()] })) }
  const rmArr = (key: 'pain_points' | 'goals', i: number) => setA(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))
  async function save() {
    if (!a.name?.trim() || !orgId) return
    setSaving(true)
    const payload = { org_id: orgId, name: a.name.trim(), kind: a.kind || 'audience', is_primary: !!a.is_primary, pain_points: a.pain_points ?? [], goals: a.goals ?? [] }
    if (a.id) await supabase.from('audiences').update(payload).eq('id', a.id)
    else await supabase.from('audiences').insert(payload)
    setSaving(false); onSaved()
  }
  async function del() {
    if (!a.id) { onCancel?.(); return }
    if (!confirm(`Delete audience "${a.name}"?`)) return
    await supabase.from('audiences').delete().eq('id', a.id); onSaved()
  }
  return (
    <div style={{ padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <div style={{ display: 'flex', gap: space[3], alignItems: 'center' }}>
        <Input value={a.name ?? ''} placeholder="Audience name (e.g. VP of Sales)" onChange={e => setA(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.cap, color: color.ink2, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={!!a.is_primary} onChange={e => setA(p => ({ ...p, is_primary: e.target.checked }))} /> Primary
        </label>
      </div>
      <TagInput label="Pain points" placeholder="e.g. Forecast credibility with the board" items={(a.pain_points as string[]) ?? []} onAdd={v => addArr('pain_points', v)} onRemove={i => rmArr('pain_points', i)} />
      <TagInput label="Goals" placeholder="e.g. Hit pipeline targets without more headcount" items={(a.goals as string[]) ?? []} onAdd={v => addArr('goals', v)} onRemove={i => rmArr('goals', i)} />
      <div style={{ display: 'flex', gap: space[2] }}>
        <Button variant="primary" size="sm" onClick={save} disabled={saving || !a.name?.trim()} style={{ background: color.ink, color: color.surface }}>{saving ? <Loader2 size={13} /> : <Check size={13} />} Save</Button>
        <Button variant="ghost" size="sm" onClick={del}><Trash2 size={13} /> {a.id ? 'Delete' : 'Cancel'}</Button>
      </div>
    </div>
  )
}
