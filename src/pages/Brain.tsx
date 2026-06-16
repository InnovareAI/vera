// Brain — the per-client ground truth VERA reasons from (/p/:slug/brain).
//
// · Custom instructions — per project; vera-chat reads them EVERY turn. The
//   single highest-leverage per-client lever.
// · Brand voice — tone, rules, forbidden phrases, persona (space-scoped, with
//   a workspace fallback only as a starter draft).
// · Audiences — who VERA writes toward for this space.
// · Knowledge — link to the space's searchable sources (managed in Knowledge;
//   brand-kit files live in Artifacts).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ElementType } from 'react'
import { Link } from 'react-router-dom'
import { Brain as BrainIcon, BookOpen, Check, Link2, Plus, Target, X, Loader2, Trash2, Sparkles, Upload, FileText, RefreshCw, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { BrandVoice, Audience, ContentMetricSnapshot, Post } from '../lib/supabase'
import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import { useAuth } from '../lib/auth'
import { useRightRail } from '../lib/rightRailContext'
import { SectionLabel, Field, Input, Textarea, Select, Button, EmptyState, Chip, color, space, type as t, radius } from '../design'
import { BrainUpload } from '../components/BrainUpload'
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
  DEMAND_SOURCE_PULL_DEPTHS,
  DEFAULT_DEMAND_OPERATING_MODEL,
  applyDemandDefaults,
  demandActiveChannelKeysFromText,
  demandHasExplicitChannelSelection,
  demandSourcePullDepthItems,
  normalizeDemandSourcePullDepth,
  defaultDemandChannelPolicies,
  demandChannelPoliciesFromText,
  demandChannelPolicyHasOverride,
  demandChannelPolicyOverrideCount,
  demandPlatformIsMentioned,
  demandPlatformSourceValue,
  serializeDemandActiveChannels,
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
type SourcePullReport = {
  label?: string
  url?: string
  ok?: boolean
  items?: number
  requestedItems?: number
  depth?: string
  source?: string
  error?: string
  knowledgeStatus?: 'stored' | 'updated' | 'stored_unindexed' | 'updated_unindexed' | 'failed'
  knowledgeId?: string
  knowledgeError?: string
}

type SourceKnowledgeSummary = {
  stored?: number
  updated?: number
  unindexed?: number
  failed?: number
  error?: string
}

type SourceKnowledgeRow = {
  id: string
  title: string
  summary: string | null
  source_kind: string
  source_url: string | null
  kind: string | null
  extracted: unknown
  created_at: string
  updated_at: string
}

type AuditAudienceProposal = {
  name: string
  title: string
  pain_points: string[]
  goals: string[]
  is_primary: boolean
}

type AuditSkillType = 'platform' | 'content' | 'brand' | 'persona' | 'enrichment' | 'tool'
type AuditSkillAgent = 'strategist' | 'writer' | 'brand_guard' | 'publisher' | 'all'
type AuditSkillProposal = {
  name: string
  type: AuditSkillType
  description: string
  prompt_module: string
  injected_into: AuditSkillAgent
}

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

const AUDIT_SKILL_TYPES: AuditSkillType[] = ['platform', 'content', 'brand', 'persona', 'enrichment', 'tool']
const AUDIT_SKILL_AGENTS: AuditSkillAgent[] = ['strategist', 'writer', 'brand_guard', 'publisher', 'all']

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

function cleanText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function cleanMultilineText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').trim()
}

function cleanTextList(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/\n|;|,/)
      .map(cleanText)
      .filter(Boolean)
  }
  return []
}

function cleanAuditAudienceProposals(raw: unknown): AuditAudienceProposal[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(item => {
      const source = (item && typeof item === 'object') ? item as Record<string, unknown> : {}
      const name = cleanText(source.name)
      const title = cleanText(source.title)
      return {
        name: name || title,
        title,
        pain_points: cleanTextList(source.pain_points),
        goals: cleanTextList(source.goals),
        is_primary: source.is_primary === true,
      }
    })
    .filter(item => item.name)
    .slice(0, 8)
}

function cleanAuditSkillType(value: unknown): AuditSkillType {
  const normalized = cleanText(value).toLowerCase()
  return AUDIT_SKILL_TYPES.includes(normalized as AuditSkillType) ? normalized as AuditSkillType : 'content'
}

function cleanAuditSkillAgent(value: unknown): AuditSkillAgent {
  const normalized = cleanText(value).toLowerCase()
  return AUDIT_SKILL_AGENTS.includes(normalized as AuditSkillAgent) ? normalized as AuditSkillAgent : 'writer'
}

function cleanAuditSkillProposals(raw: unknown): AuditSkillProposal[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(item => {
      const source = (item && typeof item === 'object') ? item as Record<string, unknown> : {}
      const name = cleanText(source.name)
      const description = cleanMultilineText(source.description)
      const promptModule = cleanMultilineText(source.prompt_module) || [
        `Apply this Brain skill: ${name || 'Space-specific content skill'}.`,
        description || 'Use the client audit evidence to improve content quality, platform fit, and campaign performance.',
      ].join('\n')
      return {
        name,
        type: cleanAuditSkillType(source.type),
        description: description || `Space-specific ${cleanAuditSkillType(source.type)} skill drafted from the content audit.`,
        prompt_module: promptModule,
        injected_into: cleanAuditSkillAgent(source.injected_into),
      }
    })
    .filter(item => item.name && item.prompt_module)
    .slice(0, 10)
}

const AUDIT_CONTEXT_KEYS: BusinessContextKey[] = [
  'companyName',
  'industry',
  ...DEMAND_FACT_KEYS,
  ...(Object.keys(DEFAULT_DEMAND_OPERATING_MODEL) as BusinessContextKey[]),
]

function normalizeAuditBusinessContext(raw: unknown): Partial<BusinessContext> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Partial<BusinessContext> = {}
  for (const key of AUDIT_CONTEXT_KEYS) {
    const value = source[key]
    if (key === 'channelOperatingPolicies' && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = JSON.stringify(value, null, 2)
    } else if (Array.isArray(value)) {
      const joined = value.map(item => String(item).trim()).filter(Boolean).join(', ')
      if (joined) out[key] = joined
    } else if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim()
    }
  }
  return out
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

function sourceConnectorLabel(source: string | undefined) {
  if (source === 'unipile') return 'Unipile'
  if (source === 'apify') return 'Apify'
  if (source === 'direct') return 'Direct'
  return 'Connector'
}

function sourceItemLabel(report: SourcePullReport) {
  const items = report.items ?? 0
  if (report.requestedItems && report.requestedItems > 0) return `${items}/${report.requestedItems} items`
  return `${items} item${items === 1 ? '' : 's'}`
}

function sourceKnowledgeLabel(report: SourcePullReport) {
  if (report.knowledgeStatus === 'stored') return 'Stored'
  if (report.knowledgeStatus === 'updated') return 'Updated'
  if (report.knowledgeStatus === 'stored_unindexed') return 'Stored, no embedding'
  if (report.knowledgeStatus === 'updated_unindexed') return 'Updated, no embedding'
  if (report.knowledgeStatus === 'failed') return 'Storage failed'
  return ''
}

function sourceKnowledgeExtracted(row: SourceKnowledgeRow) {
  const extracted = row.extracted && typeof row.extracted === 'object' ? row.extracted as Record<string, unknown> : {}
  return {
    source: typeof extracted.source === 'string' ? extracted.source : undefined,
    items: typeof extracted.items === 'number' ? extracted.items : undefined,
    requestedItems: typeof extracted.requestedItems === 'number' ? extracted.requestedItems : undefined,
    indexed: typeof extracted.indexed === 'boolean' ? extracted.indexed : undefined,
    collectedAt: typeof extracted.collectedAt === 'string' ? extracted.collectedAt : undefined,
  }
}

function sourceKnowledgeHost(url: string | null) {
  if (!url) return 'No URL'
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function sourceKnowledgeTitle(row: SourceKnowledgeRow) {
  return row.title.replace(/\s+source pull$/i, '').trim() || 'Source'
}

function sourceKnowledgeDate(value: string | null | undefined) {
  if (!value) return 'Not refreshed yet'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Not refreshed yet'
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function SourcePullReportPanel({ reports }: { reports: SourcePullReport[] }) {
  if (!reports.length) return null
  const okCount = reports.filter(report => report.ok).length
  const failedCount = reports.length - okCount
  const storedCount = reports.filter(report => report.knowledgeStatus === 'stored' || report.knowledgeStatus === 'updated').length
  const unindexedCount = reports.filter(report => report.knowledgeStatus === 'stored_unindexed' || report.knowledgeStatus === 'updated_unindexed').length
  const storageFailedCount = reports.filter(report => report.knowledgeStatus === 'failed').length
  const sorted = [...reports].sort((a, b) => Number(b.ok) - Number(a.ok) || String(a.label ?? '').localeCompare(String(b.label ?? '')))
  return (
    <div style={{ padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginBottom: space[2] }}>
        <div style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>Source pull report</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip dot={okCount ? color.success : color.ghost}>{okCount} pulled</Chip>
          {storedCount > 0 && <Chip dot={color.success}>{storedCount} indexed</Chip>}
          {unindexedCount > 0 && <Chip dot={color.warn}>{unindexedCount} raw</Chip>}
          {storageFailedCount > 0 && <Chip dot={color.danger}>{storageFailedCount} storage failed</Chip>}
          {failedCount > 0 && <Chip dot={color.danger}>{failedCount} failed</Chip>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 7, maxHeight: 230, overflowY: 'auto', paddingRight: 2 }}>
        {sorted.map((report, index) => (
          <div
            key={`${report.label ?? 'source'}-${index}`}
            title={report.knowledgeError || report.error || report.url || report.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: space[2],
              alignItems: 'center',
              padding: `${space[2]} ${space[3]}`,
              borderRadius: radius.sm,
              border: `1px solid ${report.ok ? color.line : color.danger}`,
              background: report.ok ? color.paper2 : color.surface,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: report.ok ? color.success : color.danger, flexShrink: 0 }} />
                <span style={{ color: color.ink, fontSize: t.size.micro, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {report.label ?? 'Source'}
                </span>
              </div>
              <div style={{ marginTop: 3, color: report.ok ? color.ghost : color.danger, fontSize: t.size.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {report.ok
                  ? `${sourceConnectorLabel(report.source)} · ${sourceItemLabel(report)}${sourceKnowledgeLabel(report) ? ` · ${sourceKnowledgeLabel(report)}` : ''}`
                  : report.error ?? 'Source pull failed'}
              </div>
            </div>
            <Chip dot={report.ok ? color.success : color.danger}>{report.ok ? 'OK' : 'Failed'}</Chip>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceKnowledgePanel({
  rows,
  loading,
  error,
  onRefresh,
}: {
  rows: SourceKnowledgeRow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const indexedCount = rows.filter(row => sourceKnowledgeExtracted(row).indexed === true).length
  const rawCount = rows.filter(row => sourceKnowledgeExtracted(row).indexed === false).length
  return (
    <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[4], display: 'grid', gap: space[3] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <div>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Source knowledge</div>
          <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 2 }}>
            {rows.length ? `${rows.length} pulled sources · ${indexedCount} indexed${rawCount ? ` · ${rawCount} raw` : ''}` : 'No pulled sources stored yet'}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 size={13} /> : <RefreshCw size={13} />}
        </Button>
      </div>

      {error && (
        <div style={{ color: color.danger, fontSize: t.size.cap, lineHeight: 1.45 }}>
          {error}
        </div>
      )}

      {!rows.length && !loading && !error && (
        <div style={{ color: color.ghost, fontSize: t.size.cap, lineHeight: 1.5 }}>
          Pull sources to store the website and social material VERA can use in chat.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'grid', gap: 7, maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
          {rows.map(row => {
            const meta = sourceKnowledgeExtracted(row)
            const isIndexed = meta.indexed === true
            const isRaw = meta.indexed === false
            const connector = sourceConnectorLabel(meta.source)
            const items = typeof meta.items === 'number'
              ? meta.requestedItems ? `${meta.items}/${meta.requestedItems}` : String(meta.items)
              : '0'
            return (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: space[3],
                  alignItems: 'center',
                  padding: `${space[2]} 0`,
                  borderBottom: `1px solid ${color.line}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: isIndexed ? color.success : isRaw ? color.warn : color.ghost, flexShrink: 0 }} />
                    <span style={{ color: color.ink, fontSize: t.size.micro, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sourceKnowledgeTitle(row)}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, color: color.ghost, fontSize: t.size.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {connector} · {items} item{items === '1' ? '' : 's'} · {isIndexed ? 'semantic indexed' : isRaw ? 'raw fallback' : 'stored'} · {sourceKnowledgeDate(meta.collectedAt ?? row.updated_at)}
                  </div>
                  <div style={{ marginTop: 2, color: color.ghost, fontSize: t.size.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sourceKnowledgeHost(row.source_url)}
                  </div>
                </div>
                {row.source_url ? (
                  <a
                    href={row.source_url}
                    target="_blank"
                    rel="noreferrer"
                    title={row.source_url}
                    style={{ color: color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
                  >
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <span />
                )}
              </div>
            )
          })}
        </div>
      )}
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

function orderedDemandPlatforms(context: BusinessContext) {
  const selectedKeys = demandActiveChannelKeysFromText(context.activeChannels)
  return [...DEMAND_PLATFORM_DEFINITIONS].sort((a, b) => {
    const aSelected = selectedKeys.includes(a.key) ? 1 : 0
    const bSelected = selectedKeys.includes(b.key) ? 1 : 0
    if (aSelected !== bSelected) return bSelected - aSelected
    const aSource = demandPlatformSourceValue(a, context) ? 1 : 0
    const bSource = demandPlatformSourceValue(b, context) ? 1 : 0
    if (aSource !== bSource) return bSource - aSource
    const aMention = demandPlatformIsMentioned(a, context) ? 1 : 0
    const bMention = demandPlatformIsMentioned(b, context) ? 1 : 0
    if (aMention !== bMention) return bMention - aMention
    return a.label.localeCompare(b.label)
  })
}

function activeDemandPlatforms(context: BusinessContext) {
  const selectedKeys = demandActiveChannelKeysFromText(context.activeChannels)
  if (selectedKeys.length) {
    return DEMAND_PLATFORM_DEFINITIONS.filter(platform => selectedKeys.includes(platform.key))
  }
  const active = DEMAND_PLATFORM_DEFINITIONS.filter(platform => (
    Boolean(demandPlatformSourceValue(platform, context)) || demandPlatformIsMentioned(platform, context)
  ))
  return active
}

function sourceGapPlatforms(context: BusinessContext) {
  const selectedKeys = demandActiveChannelKeysFromText(context.activeChannels)
  const source = selectedKeys.length
    ? DEMAND_PLATFORM_DEFINITIONS.filter(platform => selectedKeys.includes(platform.key))
    : DEMAND_PLATFORM_DEFINITIONS
  return source
    .filter(platform => platform.sourceKey && !demandPlatformSourceValue(platform, context))
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
  if (metric.buyerQuestions || metric.meetingRequests) signals.push('intent signal')
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
  projectName,
  context,
  policies,
  sourceCount,
  factCount,
  operatingCount,
  channelEvidence,
  learningLoading,
  learningError,
  sourceKnowledgeCount,
  onDraft,
  drafting,
  draftStatus,
  onPullSources,
  pullingSources,
  onSave,
  saving,
  saved,
}: {
  projectName: string
  context: BusinessContext
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>
  sourceCount: number
  factCount: number
  operatingCount: number
  channelEvidence: Map<DemandPlatformKey, BrainChannelEvidence>
  learningLoading: boolean
  learningError: string | null
  sourceKnowledgeCount: number
  onDraft: () => void
  drafting: boolean
  draftStatus: string
  onPullSources: () => void
  pullingSources: boolean
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  const evidenceValues = Array.from(channelEvidence.values())
  const activeEvidenceKeys = new Set(evidenceValues.filter(item => item.posts > 0).map(item => item.key))
  const activePlatforms = DEMAND_PLATFORM_DEFINITIONS.filter(platform => (
    activeEvidenceKeys.has(platform.key) || activeDemandPlatforms(context).some(activePlatform => activePlatform.key === platform.key)
  ))
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
    .filter(row => row.evidence?.posts || demandPlatformSourceValue(row.platform, context) || demandPlatformIsMentioned(row.platform, context))
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
  const activeKeys = new Set(activePlatforms.map(platform => platform.key))
  const sourceRows = DEMAND_PLATFORM_DEFINITIONS
    .filter(platform => (
      activeKeys.has(platform.key) ||
      demandPlatformSourceValue(platform, context) ||
      demandPlatformIsMentioned(platform, context) ||
      (channelEvidence.get(platform.key)?.posts ?? 0) > 0
    ))
    .slice(0, 8)
  const sourceDisplay = sourceRows.length ? sourceRows : DEMAND_PLATFORM_DEFINITIONS.slice(0, 6)
  const toneItems = cleanTextList(context.platformToneOfVoice).slice(0, 4)
  const recommendation = sourceCount === 0
    ? {
      title: 'Start with the company URL.',
      body: 'Add the website first, then pull owned and social sources so VERA can build strategy from evidence instead of guesses.',
      tone: color.warn,
    }
    : readiness < 70
      ? {
        title: 'Close the strategy gaps before scaling generation.',
        body: gaps.length ? `Add source context for ${gaps.map(platform => platform.label).join(', ')} and save the missing strategy fields.` : 'Fill the missing audience, offer, proof, approval, and learning fields before scaling content production.',
        tone: color.warn,
      }
      : measuredPosts === 0
        ? {
          title: 'Create or import measured content next.',
          body: 'The strategy model is usable. VERA now needs content and performance signals to learn what works for this space.',
          tone: color.accent,
        }
        : {
          title: strongestPlatform ? `Use ${strongestPlatform.label} learning to brief the next move.` : 'Turn learning evidence into the next content move.',
          body: strongestEvidence?.demandSignals.length ? `Recent demand signals: ${strongestEvidence.demandSignals.slice(0, 3).join(', ')}.` : 'Use the measured posts and channel policies to decide what to create, repurpose, or hand off next.',
          tone: color.success,
        }
  const assumptionRows = [
    { label: 'Goal', value: context.demandObjective || context.contentGoals || DEFAULT_DEMAND_OPERATING_MODEL.demandObjective },
    { label: 'Audience', value: context.audience || 'Audience needs review.' },
    { label: 'Tone by medium', value: toneItems[0] || DEFAULT_DEMAND_OPERATING_MODEL.platformToneOfVoice },
    { label: 'Follow-up rule', value: context.samHandoffRules || DEFAULT_DEMAND_OPERATING_MODEL.samHandoffRules },
  ]

  return (
    <section style={{ marginBottom: space[8], display: 'grid', gap: space[4] }}>
      <div style={{ padding: space[6], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: space[6], alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.accent, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, marginBottom: space[3] }}>
              <BrainIcon size={14} />
              Strategy Canvas
            </div>
            <h1 style={{ margin: 0, color: color.ink, fontSize: t.size.h2, fontWeight: t.weight.semibold, lineHeight: 1.18 }}>
              {projectName}
            </h1>
            <p style={{ margin: `${space[3]} 0 0`, maxWidth: 720, color: color.ink2, fontSize: t.size.body, lineHeight: 1.58 }}>
              This is the strategy model VERA uses to choose channels, adapt tone by medium, route approvals, measure traction, and decide which assumptions deserve follow-up.
            </p>
            <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginTop: space[4] }}>
              <Chip tone={readiness >= 70 ? 'accent' : 'default'} size="md">{readiness}% ready</Chip>
              <Chip dot={sourceKnowledgeCount ? color.success : color.warn}>{sourceKnowledgeCount} indexed sources</Chip>
              <Chip dot={measuredPosts ? color.success : color.warn}>{measuredPosts} measured posts</Chip>
              <Chip dot={customPolicies ? color.accent : color.ghost}>{customPolicies} custom policies</Chip>
            </div>
          </div>

          <aside style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, padding: space[4], display: 'grid', gap: space[3] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: recommendation.tone, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>
              <Sparkles size={13} />
              VERA recommendation
            </div>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.4 }}>{recommendation.title}</div>
            <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>{recommendation.body}</p>
            <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={onDraft} disabled={drafting}>
                {drafting ? <><Loader2 size={13} className="animate-spin" /> Drafting...</> : <><Sparkles size={13} /> Draft with VERA</>}
              </Button>
              <Button variant="secondary" size="sm" onClick={onPullSources} disabled={pullingSources || sourceCount === 0}>
                {pullingSources ? <Loader2 size={13} /> : <RefreshCw size={13} />}
                {pullingSources ? 'Pulling...' : 'Pull sources'}
              </Button>
              <Button variant="primary" size="sm" onClick={onSave} disabled={saving} style={{ background: color.ink, color: color.surface }}>
                {saving ? <Loader2 size={13} /> : <Check size={13} />}
                {saved ? 'Saved' : 'Save'}
              </Button>
            </div>
            {draftStatus && <p style={{ margin: 0, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.45 }}>{draftStatus}</p>}
          </aside>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: space[3] }}>
        <ReadinessTile icon={Link2} label="Sources" value={`${sourceCount}/${DEMAND_SOURCE_KEYS.length}`} detail="Website and channel evidence" tone={sourceCount ? color.success : color.warn} />
        <ReadinessTile icon={BrainIcon} label="Context" value={`${factCount}/${DEMAND_FACT_KEYS.length}`} detail="Offer, audience, proof, constraints" tone={factCount >= 6 ? color.success : color.warn} />
        <ReadinessTile icon={Sparkles} label="Operating fields" value={`${operatingCount}/${Object.keys(DEFAULT_DEMAND_OPERATING_MODEL).length}`} detail="Objectives, formats, signals, learning" tone={operatingCount >= 5 ? color.success : color.warn} />
        <ReadinessTile icon={RefreshCw} label="Measured assets" value={`${measuredPosts}/${totalPosts || 0}`} detail="Posts with metric signals" tone={measuredPosts ? color.success : color.warn} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: space[4], alignItems: 'start' }}>
        <section style={{ padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], marginBottom: space[4], flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Knowledge and source map</div>
              <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.45 }}>Website, social channels, and content hubs VERA can use as evidence.</p>
            </div>
            <Chip dot={gaps.length ? color.warn : color.success}>{gaps.length ? `${gaps.length} source gaps` : 'Sources covered'}</Chip>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: space[2] }}>
            {sourceDisplay.map(platform => (
              <StrategySourceCard
                key={platform.key}
                platform={platform}
                context={context}
                evidence={channelEvidence.get(platform.key)}
                active={activeKeys.has(platform.key)}
              />
            ))}
          </div>
        </section>

        <section style={{ display: 'grid', gap: space[4] }}>
          <div style={{ padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginBottom: space[3] }}>Current assumptions</div>
            <div style={{ display: 'grid', gap: space[2] }}>
              {assumptionRows.map(row => <StrategyAssumption key={row.label} label={row.label} value={row.value} />)}
            </div>
          </div>

          <div style={{ padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap', marginBottom: space[3] }}>
              <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Active channels</div>
              <Chip dot={measuredChannels ? color.success : color.ghost}>{measuredChannels} learning</Chip>
            </div>
            <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
              {activePlatforms.length ? activePlatforms.slice(0, 8).map(platform => (
                <StrategyChannelPill key={platform.key} platform={platform} evidence={channelEvidence.get(platform.key)} policy={policies[platform.key] ?? DEMAND_CHANNEL_OPERATING_POLICIES[platform.key]} />
              )) : <Chip dot={color.warn}>No active channel selected</Chip>}
            </div>
          </div>
        </section>
      </div>

      <div style={{ padding: space[4], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap', marginBottom: space[3] }}>
          <div>
            <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Learning evidence</div>
            <p style={{ margin: `${space[1]} 0 0`, color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4 }}>Posts and metrics VERA can use to improve channel strategy.</p>
          </div>
          <Chip dot={signalScore ? color.accent : color.ghost}>signal score {signalScore}</Chip>
        </div>
        {learningLoading ? (
          <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap }}>Loading learning evidence...</p>
        ) : learningError ? (
          <p style={{ margin: 0, color: color.danger, fontSize: t.size.cap }}>{learningError}</p>
        ) : totalPosts === 0 ? (
          <p style={{ margin: 0, color: color.ink2, fontSize: t.size.cap }}>No channel posts found yet. Once content is created or imported, this panel will show where VERA has evidence.</p>
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

function BrainStudioNav({
  sourceCount,
  indexedCount,
  activeChannelCount,
  audienceCount,
  categoryCount,
  voiceReady,
}: {
  sourceCount: number
  indexedCount: number
  activeChannelCount: number
  audienceCount: number
  categoryCount: number
  voiceReady: boolean
}) {
  const items = [
    { id: 'brain-context', icon: Target, label: 'Context', meta: 'Business facts' },
    { id: 'brain-sources', icon: Link2, label: 'Sources', meta: `${sourceCount} URLs` },
    { id: 'brain-channels', icon: RefreshCw, label: 'Channels', meta: `${activeChannelCount} active` },
    { id: 'brain-assumptions', icon: Sparkles, label: 'Assumptions', meta: 'Operating model' },
    { id: 'brain-voice', icon: BrainIcon, label: 'Voice', meta: voiceReady ? 'Ready' : 'Needs tone' },
    { id: 'brain-audiences', icon: Target, label: 'Audiences', meta: `${audienceCount}` },
    { id: 'brain-categories', icon: FileText, label: 'Taxonomy', meta: `${categoryCount} categories` },
    { id: 'brain-knowledge', icon: BookOpen, label: 'Knowledge', meta: `${indexedCount} indexed` },
  ]
  return (
    <nav aria-label="Brain sections" style={{ position: 'sticky', top: 0, zIndex: 6, margin: `-${space[2]} 0 ${space[5]}`, padding: `${space[2]} 0`, background: color.paper }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], overflowX: 'auto', padding: `${space[2]} ${space[1]}`, border: `1px solid ${color.line}`, borderRadius: radius.lg, background: color.surface }}>
        {items.map(item => {
          const Icon = item.icon
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{
                minWidth: 132,
                minHeight: 44,
                display: 'grid',
                gridTemplateColumns: '18px minmax(0, 1fr)',
                gap: space[2],
                alignItems: 'center',
                padding: `${space[2]} ${space[3]}`,
                borderRadius: radius.md,
                color: color.ink,
                textDecoration: 'none',
                background: color.paper2,
                border: `1px solid ${color.line}`,
                flexShrink: 0,
              }}
            >
              <Icon size={15} style={{ color: color.accent }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{item.label}</span>
                <span style={{ display: 'block', color: color.ghost, fontSize: t.size.micro, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.meta}</span>
              </span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}

function StrategySourceCard({ platform, context, evidence, active }: {
  platform: DemandPlatformDefinition
  context: BusinessContext
  evidence?: BrainChannelEvidence
  active: boolean
}) {
  const source = demandPlatformSourceValue(platform, context)
  const mentioned = demandPlatformIsMentioned(platform, context)
  const posts = evidence?.posts ?? 0
  const measured = evidence?.measured ?? 0
  const state = source ? 'Source' : posts ? 'Content' : mentioned ? 'Planned' : 'Candidate'
  const tone = source ? color.success : posts ? color.accent : mentioned ? color.info : color.ghost
  return (
    <div style={{ padding: space[3], border: `1px solid ${active ? color.line2 : color.line}`, borderRadius: radius.md, background: active ? color.paper : color.paper2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
        <span style={{ width: 26, height: 26, borderRadius: radius.xs, background: active ? color.accentSoft : color.surface, color: active ? color.accent : color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{platform.initials}</span>
        <span style={{ minWidth: 0, color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.label}</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: space[2] }}>
        <Chip dot={tone}>{state}</Chip>
        {measured > 0 ? <Chip dot={color.success}>{measured} measured</Chip> : posts > 0 ? <Chip>{posts} posts</Chip> : null}
      </div>
      <div title={source || platform.workflow} style={{ color: color.ghost, fontSize: t.size.micro, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {source || platform.publishing}
      </div>
    </div>
  )
}

function StrategyAssumption({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: space[3], alignItems: 'start', padding: `${space[2]} 0`, borderBottom: `1px solid ${color.line}` }}>
      <span style={{ color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.medium }}>{label}</span>
      <span style={{ color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{value}</span>
    </div>
  )
}

function StrategyChannelPill({ platform, evidence, policy }: { platform: DemandPlatformDefinition; evidence?: BrainChannelEvidence; policy: DemandChannelOperatingPolicy }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 30, padding: '5px 9px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.paper2, color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.medium }}>
      <span style={{ color: color.accent, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{platform.initials}</span>
      {platform.label}
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: evidence?.measured ? color.success : riskTone(policy.risk), flexShrink: 0 }} />
    </span>
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

function ActiveChannelSelector({
  context,
  channelEvidence,
  onChange,
}: {
  context: BusinessContext
  channelEvidence: Map<DemandPlatformKey, BrainChannelEvidence>
  onChange: (value: string) => void
}) {
  const explicit = demandHasExplicitChannelSelection(context)
  const activeKeys = demandActiveChannelKeysFromText(context.activeChannels)
  const inferredKeys = DEMAND_PLATFORM_DEFINITIONS
    .filter(platform => (
      demandPlatformSourceValue(platform, context) ||
      demandPlatformIsMentioned(platform, context) ||
      (channelEvidence.get(platform.key)?.posts ?? 0) > 0
    ))
    .map(platform => platform.key)
  const selectedKeys = explicit ? activeKeys : inferredKeys

  function toggle(key: DemandPlatformKey) {
    const base = explicit ? activeKeys : inferredKeys
    const next = base.includes(key)
      ? base.filter(item => item !== key)
      : [...base, key]
    onChange(serializeDemandActiveChannels(next))
  }

  return (
    <div style={{ gridColumn: '1 / -1', padding: space[4], border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], marginBottom: space[3], flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Active channels</div>
          <p style={{ margin: `${space[1]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45, maxWidth: 680 }}>
            These are the channels Vera can treat as strategy-valid for this space. If none are saved, Vera infers from source URLs, strategy text, and content history.
          </p>
        </div>
        <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip dot={explicit ? color.accent : color.ghost}>{explicit ? `${activeKeys.length} saved` : 'Inferring'}</Chip>
          {explicit && (
            <Button variant="ghost" size="sm" onClick={() => onChange('')}>
              Clear
            </Button>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 154px), 1fr))', gap: space[2] }}>
        {DEMAND_PLATFORM_DEFINITIONS.map(platform => {
          const selected = selectedKeys.includes(platform.key)
          const source = demandPlatformSourceValue(platform, context)
          const mentioned = demandPlatformIsMentioned(platform, context)
          const evidence = channelEvidence.get(platform.key)
          const evidencePosts = evidence?.posts ?? 0
          const hint = source ? 'Source' : evidencePosts ? `${evidencePosts} posts` : mentioned ? 'Mentioned' : platform.publishing
          return (
            <button
              key={platform.key}
              type="button"
              onClick={() => toggle(platform.key)}
              title={platform.role}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px minmax(0, 1fr)',
                gap: space[2],
                alignItems: 'center',
                textAlign: 'left',
                padding: `${space[2]} ${space[3]}`,
                borderRadius: radius.sm,
                border: `1px solid ${selected ? color.accent : color.line}`,
                background: selected ? color.accentSoft : color.surface,
                color: color.ink,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <span style={{ width: 24, height: 24, borderRadius: radius.xs, background: selected ? color.accent : color.paper2, color: selected ? color.surface : color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
                {platform.initials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: t.size.cap, fontWeight: t.weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.label}</span>
                <span style={{ display: 'block', marginTop: 1, fontSize: t.size.micro, color: selected ? color.accent : color.ghost, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>
              </span>
            </button>
          )
        })}
      </div>
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
  const configured = platforms.filter(platform => demandPlatformSourceValue(platform, context)).length
  const measured = platforms.filter(platform => (channelEvidence.get(platform.key)?.measured ?? 0) > 0).length
  const explicitChannels = demandHasExplicitChannelSelection(context)
  const selectedKeys = demandActiveChannelKeysFromText(context.activeChannels)

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
          const source = demandPlatformSourceValue(platform, context)
          const mentioned = demandPlatformIsMentioned(platform, context)
          const evidence = channelEvidence.get(platform.key)
          const hasEvidence = (evidence?.posts ?? 0) > 0
          const selected = selectedKeys.includes(platform.key)
          const active = explicitChannels ? selected : !!source || mentioned || hasEvidence
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
                  <div style={{ color: color.ghost, fontSize: t.size.micro, marginTop: 2 }}>{active ? source ? 'Source configured' : selected ? 'Brain-selected channel' : evidence?.measured ? 'Learning from metrics' : hasEvidence ? 'Content tracked' : 'In channel strategy' : 'Not active'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginBottom: space[3] }}>
                <Chip dot={publishingTone(platform.publishing)}>{publishingLabel(platform.publishing)}</Chip>
                <Chip dot={riskTone(policy.risk)}>{riskLabel(policy.risk)}</Chip>
                {selected && <Chip dot={color.accent}>Brain-selected</Chip>}
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
                <PolicyLine label="Follow-up" value={policy.samTrigger} />
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
            These rules become part of this Strategy Brain. Vera uses them when choosing a speaker, routing approval, deciding whether work can publish, and deciding which signals need follow-up.
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
            <Field label="Follow-up trigger">
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
  const [sourceReports, setSourceReports] = useState<SourcePullReport[]>([])
  const [sourceKnowledge, setSourceKnowledge] = useState<SourceKnowledgeRow[]>([])
  const [sourceKnowledgeLoading, setSourceKnowledgeLoading] = useState(false)
  const [sourceKnowledgeError, setSourceKnowledgeError] = useState<string | null>(null)
  const [selectedPolicyKey, setSelectedPolicyKey] = useState<DemandPlatformKey>('blog')
  const [learningPosts, setLearningPosts] = useState<Post[]>([])
  const [learningSnapshots, setLearningSnapshots] = useState<ContentMetricSnapshot[]>([])
  const [learningLoading, setLearningLoading] = useState(false)
  const [learningError, setLearningError] = useState<string | null>(null)

  const loadSourceKnowledge = useCallback(async () => {
    if (!activeProject?.id) {
      setSourceKnowledge([])
      setSourceKnowledgeError(null)
      setSourceKnowledgeLoading(false)
      return
    }
    setSourceKnowledgeLoading(true)
    setSourceKnowledgeError(null)
    const { data, error } = await supabase
      .from('project_knowledge')
      .select('id, title, summary, source_kind, source_url, kind, extracted, created_at, updated_at')
      .eq('project_id', activeProject.id)
      .eq('kind', 'source_pull')
      .order('updated_at', { ascending: false })
      .limit(24)
    if (error) {
      setSourceKnowledge([])
      setSourceKnowledgeError(error.message)
    } else {
      setSourceKnowledge((data ?? []) as SourceKnowledgeRow[])
    }
    setSourceKnowledgeLoading(false)
  }, [activeProject?.id])

  useEffect(() => {
    const parsed = parseProjectInstructions(activeProject?.instructions ?? '')
    setInstr(parsed.customInstructions)
    setSourceStatus('')
    setSourceError(null)
    setSourceReports([])
    setBusiness({
      ...EMPTY_BUSINESS_CONTEXT,
      ...parsed.businessContext,
      website: parsed.businessContext.website || ((activeProject?.description ?? '').startsWith('http') ? activeProject?.description ?? '' : ''),
      companyName: parsed.businessContext.companyName || activeProject?.name || '',
    })
  }, [activeProject?.id, activeProject?.instructions, activeProject?.name, activeProject?.description])

  useEffect(() => {
    void loadSourceKnowledge()
  }, [loadSourceKnowledge])

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
    setSourceReports([])
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
        knowledge?: SourceKnowledgeSummary
      }
      if (!res.ok) throw new Error(data.error ?? `Source pull failed with HTTP ${res.status}`)
      setBusiness(prev => mergeExtractedContext(prev, data.context ?? {}))
      const reports = data.sources ?? []
      setSourceReports(reports)
      const okCount = reports.filter(item => item.ok).length
      const total = reports.length || DEMAND_SOURCE_KEYS.filter(key => business[key].trim()).length
      const pulledItems = reports.filter(item => item.ok).reduce((sum, item) => sum + (item.items ?? 0), 0)
      const requestedItems = reports.filter(item => item.ok).reduce((sum, item) => sum + (item.requestedItems ?? 0), 0)
      const depth = normalizeDemandSourcePullDepth(business.sourcePullDepth)
      const depthLabel = DEMAND_SOURCE_PULL_DEPTHS.find(item => item.value === depth)?.label ?? 'Standard'
      const itemPart = requestedItems > 0
        ? `${pulledItems}/${requestedItems} items`
        : `${pulledItems} items`
      const knowledge = data.knowledge
      const indexedCount = (knowledge?.stored ?? 0) + (knowledge?.updated ?? 0) - (knowledge?.unindexed ?? 0)
      const rawCount = knowledge?.unindexed ?? 0
      const knowledgePart = knowledge
        ? ` Brain: ${Math.max(0, indexedCount)} indexed${rawCount ? `, ${rawCount} raw` : ''}${knowledge.failed ? `, ${knowledge.failed} failed` : ''}.`
        : ''
      setSourceStatus(`${depthLabel} pull: ${okCount}/${total} sources, ${itemPart}.${knowledgePart} Review and save.`)
      void loadSourceKnowledge()
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
  // proposes Brain fields plus brand voice. The operator reviews and
  // saves. Agentic-first means the brain should not start as a blank form. ──
  const [drafting, setDrafting] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  const [draftAudienceProposals, setDraftAudienceProposals] = useState<AuditAudienceProposal[]>([])
  const [draftSkillProposals, setDraftSkillProposals] = useState<AuditSkillProposal[]>([])
  const [proposalSaving, setProposalSaving] = useState<string | null>(null)
  const [proposalStatus, setProposalStatus] = useState('')
  const [proposalError, setProposalError] = useState('')
  useEffect(() => {
    setDraftAudienceProposals([])
    setDraftSkillProposals([])
    setProposalStatus('')
    setProposalError('')
  }, [activeProject?.id])

  async function addAudienceProposal(proposal: AuditAudienceProposal, index: number) {
    if (!activeOrg?.id || !activeProject?.id) return
    setProposalSaving(`audience:${index}`)
    setProposalError('')
    setProposalStatus('')
    const { error } = await supabase.from('audiences').insert({
      org_id: activeOrg.id,
      project_id: activeProject.id,
      kind: 'buyer_persona',
      name: proposal.name,
      is_primary: proposal.is_primary,
      pain_points: proposal.pain_points,
      goals: proposal.goals,
      attributes: {
        title: proposal.title,
        source: 'content-audit',
      },
      notes: proposal.title ? `Drafted from content audit. Title: ${proposal.title}` : 'Drafted from content audit.',
    })
    setProposalSaving(null)
    if (error) {
      setProposalError(error.message)
      return
    }
    setDraftAudienceProposals(prev => prev.filter((_, i) => i !== index))
    setProposalStatus(`Added audience: ${proposal.name}`)
    reloadAudiences()
  }

  async function addSkillProposal(proposal: AuditSkillProposal, index: number) {
    if (!activeOrg?.id || !activeProject?.id) return
    setProposalSaving(`skill:${index}`)
    setProposalError('')
    setProposalStatus('')
    const { error } = await supabase.from('skills').insert({
      org_id: activeOrg.id,
      project_id: activeProject.id,
      type: proposal.type,
      name: proposal.name,
      description: proposal.description,
      injected_into: proposal.injected_into,
      trigger_description: 'Use when generating, refining, reviewing, or publishing content for this space.',
      trigger_when: {
        source: 'demand_brain_audit',
        client_id: activeProject.id,
      },
      prompt_module: proposal.prompt_module,
      gotchas: [],
      good_examples: [],
      bad_examples: [],
      source_refs: [{ label: 'Brain audit', text: 'Drafted from space source audit.' }],
      confidence: 'medium',
      performance_notes: 'Created from Brain audit proposal. Validate against future content outcomes.',
      tags: ['strategy-brain', 'audit-proposal'],
      is_system: false,
      is_active: true,
      last_reviewed_at: new Date().toISOString(),
    })
    setProposalSaving(null)
    if (error) {
      setProposalError(error.message)
      return
    }
    setDraftSkillProposals(prev => prev.filter((_, i) => i !== index))
    setProposalStatus(`Added skill: ${proposal.name}`)
  }

  async function runDraft() {
    if (!activeOrg?.id || !activeProject?.id || drafting) return
    if (!session?.access_token) {
      setDraftStatus('Sign in again before drafting the Strategy Brain.')
      return
    }
    setDrafting(true); setDraftStatus("Reading this space's content...")
    setDraftAudienceProposals([])
    setDraftSkillProposals([])
    setProposalStatus('')
    setProposalError('')
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
          let ev: { event?: string; message?: string; proposal?: { brand_voice?: Record<string, string[] | string>; business_context?: unknown; personas?: unknown[]; skills?: unknown[] } }
          try { ev = JSON.parse(json) } catch { continue }
          if (ev.event === 'started' || ev.event === 'fetching') setDraftStatus("Reading this space's content...")
          else if (ev.event === 'synthesising') setDraftStatus('Drafting the Strategy Brain...')
          else if (ev.event === 'done') {
            const v = ev.proposal?.brand_voice ?? {}
            const contextPatch = normalizeAuditBusinessContext(ev.proposal?.business_context)
            const contextCount = Object.values(contextPatch).filter(value => typeof value === 'string' && value.trim()).length
            const audienceProposals = cleanAuditAudienceProposals(ev.proposal?.personas)
            const skillProposals = cleanAuditSkillProposals(ev.proposal?.skills)
            const n = audienceProposals.length
            const skillCount = skillProposals.length
            setBv(prev => ({
              ...prev,
              tone: Array.isArray(v.tone) ? v.tone : prev.tone,
              writing_rules: Array.isArray(v.writing_rules) ? v.writing_rules : prev.writing_rules,
              forbidden_phrases: Array.isArray(v.forbidden_phrases) ? v.forbidden_phrases : prev.forbidden_phrases,
              required_phrases: Array.isArray(v.required_phrases) ? v.required_phrases : prev.required_phrases,
            }))
            if (contextCount) setBusiness(prev => mergeExtractedContext(prev, contextPatch))
            setDraftAudienceProposals(audienceProposals)
            setDraftSkillProposals(skillProposals)
            setBvInherited(false)
            setDraftStatus(`Drafted from this space's content. Review the Strategy Brain and Save.${contextCount ? ` ${contextCount} strategy field${contextCount === 1 ? '' : 's'} updated.` : ''}${n ? ` ${n} audience proposal${n === 1 ? '' : 's'} ready.` : ''}${skillCount ? ` ${skillCount} skill proposal${skillCount === 1 ? '' : 's'} ready.` : ''}`)
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
    if (!activeProject?.id) { setAudiences([]); return }
    supabase.from('audiences').select('*').eq('project_id', activeProject.id).order('created_at').then(({ data }) => setAudiences((data ?? []) as Audience[]))
  }, [activeProject?.id])
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
    return <div style={{ padding: space[8], maxWidth: 760 }}><EmptyState icon={<BrainIcon size={22} strokeWidth={1.5} />} title="No active project" body="Pick a space in the left rail to set its brain: instructions, voice, audiences." /></div>
  }

  const sourceCount = DEMAND_SOURCE_KEYS
    .filter(key => business[key].trim()).length
  const sourcePullDepth = normalizeDemandSourcePullDepth(business.sourcePullDepth)
  const sourcePullItems = demandSourcePullDepthItems(sourcePullDepth)
  const operatingKeys = Object.keys(DEFAULT_DEMAND_OPERATING_MODEL) as BusinessContextKey[]
  const factCount = DEMAND_FACT_KEYS.filter(key => business[key].trim()).length
  const operatingCount = operatingKeys.filter(key => business[key].trim()).length
  const activeBrainChannelCount = Math.max(
    activeDemandPlatforms(business).length,
    Array.from(channelEvidence.values()).filter(item => item.posts > 0).length,
  )
  const voiceReady = Boolean(
    (bv.system_prompt ?? '').trim() ||
    ((bv.tone as string[] | undefined)?.length ?? 0) > 0 ||
    ((bv.writing_rules as string[] | undefined)?.length ?? 0) > 0,
  )
  const applyStrategyDefaults = () => {
    setBusiness(prev => applyDemandDefaults(prev))
    setSourceStatus('Neutral strategy defaults added. Review and save.')
  }

  return (
    <div style={{ padding: `clamp(${space[6]}, 3vw, ${space[8]})`, paddingBottom: 0, maxWidth: 1180, width: '100%' }}>
      <BrainReadinessPanel
        projectName={activeProject.name}
        context={business}
        policies={channelPolicies}
        sourceCount={sourceCount}
        factCount={factCount}
        operatingCount={operatingCount}
        channelEvidence={channelEvidence}
        learningLoading={learningLoading}
        learningError={learningError}
        sourceKnowledgeCount={sourceKnowledge.length}
        onDraft={runDraft}
        drafting={drafting}
        draftStatus={draftStatus}
        onPullSources={pullBusinessSources}
        pullingSources={pullingSources}
        onSave={saveInstr}
        saving={instrSaving}
        saved={instrSaved}
      />

      <BrainStudioNav
        sourceCount={sourceCount}
        indexedCount={sourceKnowledge.length}
        activeChannelCount={activeBrainChannelCount}
        audienceCount={audiences.length}
        categoryCount={categories.length}
        voiceReady={voiceReady}
      />

      <BrainUpload onUploaded={() => { void loadSourceKnowledge() }} />

      {(draftAudienceProposals.length > 0 || draftSkillProposals.length > 0 || proposalStatus || proposalError) && (
        <AuditProposalPanel
          audiences={draftAudienceProposals}
          skills={draftSkillProposals}
          saving={proposalSaving}
          status={proposalStatus}
          error={proposalError}
          onAddAudience={addAudienceProposal}
          onDismissAudience={index => setDraftAudienceProposals(prev => prev.filter((_, i) => i !== index))}
          onAddSkill={addSkillProposal}
          onDismissSkill={index => setDraftSkillProposals(prev => prev.filter((_, i) => i !== index))}
        />
      )}

      {/* Business context */}
      <section id="brain-context" style={{ marginBottom: space[9], scrollMarginTop: space[12] }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[3] }}>
          <div>
            <SectionLabel>Demand context</SectionLabel>
            <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `${space[2]} 0 0` }}>
              Start with the company URL, then add the social sources and facts VERA should use for strategy and content creation.
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

          <div id="brain-sources" style={{ padding: space[5], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[4], scrollMarginTop: space[12] }}>
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
            <Field
              label="Source pull depth"
              helper={`${sourcePullItems} posts or items per social network where the connector supports it.`}
            >
              <Select value={sourcePullDepth} onChange={e => updateBusiness('sourcePullDepth', e.target.value)}>
                {DEMAND_SOURCE_PULL_DEPTHS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}: {option.itemsPerNetwork} per network
                  </option>
                ))}
              </Select>
            </Field>
            <ActiveChannelSelector
              context={business}
              channelEvidence={channelEvidence}
              onChange={value => updateBusiness('activeChannels', value)}
            />
            {(extractStatus || extractError || sourceStatus || sourceError) && (
              <p style={{ margin: 0, fontSize: t.size.cap, color: (extractError || sourceError) ? color.danger : color.success, lineHeight: 1.5 }}>
                {extractError || sourceError || extractStatus || sourceStatus}
              </p>
            )}
            <SourcePullReportPanel reports={sourceReports} />
            <SourceKnowledgePanel
              rows={sourceKnowledge}
              loading={sourceKnowledgeLoading}
              error={sourceKnowledgeError}
              onRefresh={() => { void loadSourceKnowledge() }}
            />
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

        <div id="brain-channels" style={{ scrollMarginTop: space[12] }}>
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
        </div>

        <div id="brain-assumptions" style={{ marginTop: space[4], padding: space[5], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, scrollMarginTop: space[12] }}>
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
              <Textarea value={business.customerProblems} onChange={e => updateBusiness('customerProblems', e.target.value)} rows={3} placeholder="Pain points, unmet needs, intent triggers, risks, objections." />
            </Field>
            <Field label="Differentiators">
              <Textarea value={business.differentiators} onChange={e => updateBusiness('differentiators', e.target.value)} rows={3} placeholder="Positioning, category, why this space is different, proof of advantage." />
            </Field>
            <Field label="Competitors">
              <Textarea value={business.competitors} onChange={e => updateBusiness('competitors', e.target.value)} rows={2} placeholder="Named competitors, alternatives, comparison points." />
            </Field>
            <Field label="Proof points">
              <Textarea value={business.proofPoints} onChange={e => updateBusiness('proofPoints', e.target.value)} rows={3} placeholder="Metrics, case studies, customer names, credentials, testimonials, awards." />
            </Field>
            <Field label="Content goals">
              <Textarea value={business.contentGoals} onChange={e => updateBusiness('contentGoals', e.target.value)} rows={3} placeholder="Awareness, trust, traffic, community, leads, sales, recruiting, launches, events, campaign themes." />
            </Field>
            <Field label="Speaker strategy">
              <Textarea value={business.speakerStrategy} onChange={e => updateBusiness('speakerStrategy', e.target.value)} rows={3} placeholder="Who VERA can write as: brand, founder, creator, product expert, client team, or a named person. Define when each voice should be used." />
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
              <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>Strategy assumptions</div>
              <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>The rules for what VERA creates, who approves it, what counts as traction, and which signals need follow-up.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={applyStrategyDefaults}>Use neutral defaults</Button>
              {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved.</span>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: space[3], marginBottom: space[4] }}>
            <DemandDefaultPanel title="Content jobs" items={DEMAND_CONTENT_JOBS} />
            <DemandDefaultPanel title="Approval modes" items={DEMAND_APPROVAL_MODES} />
            <DemandDefaultPanel title="Outcome signals" items={DEMAND_OUTCOME_SIGNALS} />
            <DemandDefaultPanel title="Growth outcomes" items={DEMAND_GROWTH_OUTCOMES} />
            <DemandDefaultPanel title="Operating guardrails" items={DEMAND_COMMERCIAL_REQUIREMENTS} />
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
            <Field label="Content objective">
              <Textarea value={business.demandObjective} onChange={e => updateBusiness('demandObjective', e.target.value)} rows={3} placeholder="What this content should prove or create: awareness, trust, audience growth, traffic, leads, sales, recruiting, education, or community." />
            </Field>
            <Field label="Conversion path">
              <Textarea value={business.conversionPath} onChange={e => updateBusiness('conversionPath', e.target.value)} rows={3} placeholder="Where attention should go next: comments, DMs, landing page, newsletter, event, product page, store, booking, community, or follow-up queue." />
            </Field>
            <Field label="Channel strategy">
              <Textarea value={business.channelStrategy} onChange={e => updateBusiness('channelStrategy', e.target.value)} rows={3} placeholder="Role of each valid channel: website and blog for owned depth, YouTube for explanation, Instagram and TikTok for visual reach, Medium for essays, Quora and Reddit for questions, LinkedIn for authority when evidence supports it, X for speed." />
            </Field>
            <Field label="Content formats">
              <Textarea value={business.contentFormats} onChange={e => updateBusiness('contentFormats', e.target.value)} rows={3} placeholder="Posts, carousels, video storyboards, Shorts, long-form articles, answers, comments, founder POV, case breakdowns." />
            </Field>
            <Field label="Approval model">
              <Textarea value={business.approvalModel} onChange={e => updateBusiness('approvalModel', e.target.value)} rows={3} placeholder="Who approves what: operator-only, space owner, legal, all stakeholders, or case-by-case based on topic, claim, or channel." />
            </Field>
            <Field label="Engagement signals">
              <Textarea value={business.engagementSignals} onChange={e => updateBusiness('engagementSignals', e.target.value)} rows={3} placeholder="What counts: comments, shares, saves, clicks, traffic quality, objections, intent signals, purchases, inquiries, community joins, meeting requests." />
            </Field>
            <Field label="Follow-up rules">
              <Textarea value={business.samHandoffRules} onChange={e => updateBusiness('samHandoffRules', e.target.value)} rows={3} placeholder="When engagement needs action: named people or accounts, purchase intent, objections, useful comments, repeated topic demand, inbound questions, or support requests." />
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
      <section id="brain-instructions" style={{ marginBottom: space[9], scrollMarginTop: space[12] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Custom instructions</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          The standing brief VERA reads <strong style={{ color: color.ink }}>every turn</strong> for {activeProject.name}: tone, do/don't, positioning, recurring CTAs, in plain language.
        </p>
        <Textarea value={instr} onChange={e => setInstr(e.target.value)} rows={7}
          placeholder={`e.g. Write in a confident, practical voice for experienced operators. Lead with a concrete observation or real failure mode, never a hypothetical. Avoid "leverage", "synergy", "game-changer". Close with one sharp question when the channel supports it.`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginTop: space[3] }}>
          <Button variant="primary" size="md" onClick={saveInstr} disabled={instrSaving} style={{ background: color.ink, color: color.surface }}>
            {instrSaving ? <Loader2 size={14} /> : <Check size={14} />} Save instructions
          </Button>
          {instrSaved && <span style={{ fontSize: t.size.cap, color: color.success }}>Saved. VERA uses this from the next turn.</span>}
        </div>
      </section>

      {/* Brand voice */}
      <section id="brain-voice" style={{ marginBottom: space[9], scrollMarginTop: space[12] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Brand voice</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[4]}` }}>
          The persona, tone, and rules VERA writes by for {activeProject.name}.{' '}
          {bvInherited
            ? <span style={{ color: color.ghost }}>Showing the workspace default. Saving creates a voice specific to this space.</span>
            : <span style={{ color: color.ghost }}>Specific to this space.</span>}
        </p>
        <div style={{ display: 'grid', gap: space[4] }}>
          <Field label="Persona name"><Input value={bv.persona_name ?? ''} onChange={e => setBv(f => ({ ...f, persona_name: e.target.value }))} placeholder="e.g. Alex" /></Field>
          <Field label="Persona descriptor"><Input value={bv.persona_descriptor ?? ''} onChange={e => setBv(f => ({ ...f, persona_descriptor: e.target.value }))} placeholder="A sharp, empathetic content strategist" /></Field>
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
      <section id="brain-audiences" style={{ marginBottom: space[9], scrollMarginTop: space[12] }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] }}>
          <SectionLabel>Audiences</SectionLabel>
          {activeOrg?.id && activeProject?.id && !addingAudience && (
            <Button variant="secondary" size="sm" onClick={() => setAddingAudience(true)}><Plus size={13} /> Add audience</Button>
          )}
        </div>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Who VERA writes toward, driving register, proof points, and which pains to hit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {addingAudience && activeOrg?.id && activeProject?.id && (
            <AudienceEditor initial={{}} orgId={activeOrg.id} projectId={activeProject.id} onSaved={() => { setAddingAudience(false); reloadAudiences() }} onCancel={() => setAddingAudience(false)} />
          )}
          {audiences.map(a => <AudienceEditor key={a.id} initial={a} orgId={activeOrg?.id ?? ''} projectId={activeProject?.id ?? ''} onSaved={reloadAudiences} />)}
          {audiences.length === 0 && !addingAudience && (
            <p style={{ fontSize: t.size.cap, color: color.ghost }}>No audiences yet. Add one so VERA writes toward a specific reader.</p>
          )}
        </div>
      </section>

      {/* Content categories */}
      <section id="brain-categories" style={{ marginBottom: space[9], scrollMarginTop: space[12] }}>
        <SectionLabel style={{ marginBottom: space[2] }}>Content categories</SectionLabel>
        <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.5, margin: `0 0 ${space[3]}` }}>
          Reusable buckets for this space's content. Vera tags every post with one; Calendar &amp; Artifacts filter by them.
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
      <section id="brain-knowledge" style={{ marginBottom: space[8], scrollMarginTop: space[12] }}>
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

function AuditProposalPanel({
  audiences,
  skills,
  saving,
  status,
  error,
  onAddAudience,
  onDismissAudience,
  onAddSkill,
  onDismissSkill,
}: {
  audiences: AuditAudienceProposal[]
  skills: AuditSkillProposal[]
  saving: string | null
  status: string
  error: string
  onAddAudience: (proposal: AuditAudienceProposal, index: number) => void
  onDismissAudience: (index: number) => void
  onAddSkill: (proposal: AuditSkillProposal, index: number) => void
  onDismissSkill: (index: number) => void
}) {
  const busy = !!saving
  return (
    <section style={{ marginBottom: space[8], padding: space[5], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.lg }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], flexWrap: 'wrap', marginBottom: space[4] }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
            <Sparkles size={15} style={{ color: color.accent }} />
            Audit proposals
          </div>
          <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
            Add useful findings to this Brain. Dismiss anything that does not fit the saved strategy.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {audiences.length > 0 && <Chip>{audiences.length} audience{audiences.length === 1 ? '' : 's'}</Chip>}
          {skills.length > 0 && <Chip>{skills.length} skill{skills.length === 1 ? '' : 's'}</Chip>}
        </div>
      </div>

      {(status || error) && (
        <p style={{ margin: `0 0 ${space[4]}`, color: error ? color.danger : color.success, fontSize: t.size.cap }}>
          {error || status}
        </p>
      )}

      {audiences.length > 0 && (
        <div style={{ marginBottom: skills.length ? space[5] : 0 }}>
          <div style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
            Audiences
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: space[3] }}>
            {audiences.map((proposal, index) => {
              const key = `${proposal.name}:${index}`
              const savingThis = saving === `audience:${index}`
              return (
                <div key={key} style={{ padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[2], marginBottom: space[2] }}>
                    <Target size={15} style={{ color: color.accent, marginTop: 2, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>{proposal.name}</div>
                      {proposal.title && <div style={{ fontSize: t.size.micro, color: color.ghost, marginTop: 2 }}>{proposal.title}</div>}
                    </div>
                  </div>
                  <ProposalList label="Pains" items={proposal.pain_points} />
                  <ProposalList label="Goals" items={proposal.goals} />
                  <div style={{ display: 'flex', gap: space[2], marginTop: space[3], flexWrap: 'wrap' }}>
                    <Button variant="primary" size="sm" onClick={() => onAddAudience(proposal, index)} disabled={busy} style={{ background: color.ink, color: color.surface }}>
                      {savingThis ? <Loader2 size={13} /> : <Check size={13} />} Add audience
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDismissAudience(index)} disabled={busy}>
                      <X size={13} /> Dismiss
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div>
          <div style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
            Skills
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: space[3] }}>
            {skills.map((proposal, index) => {
              const key = `${proposal.name}:${index}`
              const savingThis = saving === `skill:${index}`
              return (
                <div key={key} style={{ padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2], marginBottom: space[2] }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: t.size.sm, color: color.ink, fontWeight: t.weight.semibold }}>{proposal.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                        <span style={{ padding: '3px 7px', borderRadius: radius.pill, background: color.accentSoft, color: color.accent, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{proposal.type}</span>
                        <span style={{ padding: '3px 7px', borderRadius: radius.pill, background: color.paper2, color: color.ink2, fontSize: t.size.micro }}>Agent: {proposal.injected_into}</span>
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: `0 0 ${space[3]}`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.5 }}>
                    {proposal.description}
                  </p>
                  <pre style={{ margin: 0, padding: space[3], maxHeight: 136, overflow: 'auto', whiteSpace: 'pre-wrap', background: color.paper2, color: color.ink2, border: `1px solid ${color.line}`, borderRadius: radius.sm, fontSize: t.size.micro, fontFamily: t.family.mono, lineHeight: 1.5 }}>
                    {proposal.prompt_module}
                  </pre>
                  <div style={{ display: 'flex', gap: space[2], marginTop: space[3], flexWrap: 'wrap' }}>
                    <Button variant="primary" size="sm" onClick={() => onAddSkill(proposal, index)} disabled={busy} style={{ background: color.ink, color: color.surface }}>
                      {savingThis ? <Loader2 size={13} /> : <Check size={13} />} Add skill
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDismissSkill(index)} disabled={busy}>
                      <X size={13} /> Dismiss
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function ProposalList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div style={{ marginTop: space[2] }}>
      <div style={{ fontSize: t.size.micro, color: color.ghost, fontWeight: t.weight.semibold, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {items.slice(0, 4).map(item => (
          <span key={item} style={{ padding: '3px 7px', borderRadius: radius.pill, background: color.paper2, color: color.ink2, border: `1px solid ${color.line}`, fontSize: t.size.micro, lineHeight: 1.2 }}>
            {item}
          </span>
        ))}
        {items.length > 4 && (
          <span style={{ padding: '3px 7px', color: color.ghost, fontSize: t.size.micro }}>+{items.length - 4}</span>
        )}
      </div>
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
function AudienceEditor({ initial, orgId, projectId, onSaved, onCancel }: {
  initial: Partial<Audience>; orgId: string; projectId: string; onSaved: () => void; onCancel?: () => void
}) {
  const [a, setA] = useState<Partial<Audience>>(initial)
  const [saving, setSaving] = useState(false)
  const addArr = (key: 'pain_points' | 'goals', v: string) => { if (v.trim()) setA(p => ({ ...p, [key]: [...((p[key] as string[]) || []), v.trim()] })) }
  const rmArr = (key: 'pain_points' | 'goals', i: number) => setA(p => ({ ...p, [key]: ((p[key] as string[]) || []).filter((_, x) => x !== i) }))
  async function save() {
    if (!a.name?.trim() || !orgId || !projectId) return
    setSaving(true)
    const payload = { org_id: orgId, project_id: projectId, name: a.name.trim(), kind: a.kind || 'audience', is_primary: !!a.is_primary, pain_points: a.pain_points ?? [], goals: a.goals ?? [] }
    if (a.id) await supabase.from('audiences').update(payload).eq('id', a.id).eq('project_id', projectId)
    else await supabase.from('audiences').insert(payload)
    setSaving(false); onSaved()
  }
  async function del() {
    if (!a.id) { onCancel?.(); return }
    if (!confirm(`Delete audience "${a.name}"?`)) return
    await supabase.from('audiences').delete().eq('id', a.id).eq('project_id', projectId); onSaved()
  }
  return (
    <div style={{ padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <div style={{ display: 'flex', gap: space[3], alignItems: 'center' }}>
        <Input value={a.name ?? ''} placeholder="Audience name (e.g. returning customers)" onChange={e => setA(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.cap, color: color.ink2, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={!!a.is_primary} onChange={e => setA(p => ({ ...p, is_primary: e.target.checked }))} /> Primary
        </label>
      </div>
      <TagInput label="Pain points" placeholder="e.g. hard to choose the right product" items={(a.pain_points as string[]) ?? []} onAdd={v => addArr('pain_points', v)} onRemove={i => rmArr('pain_points', i)} />
      <TagInput label="Goals" placeholder="e.g. build trust, drive visits, grow community" items={(a.goals as string[]) ?? []} onAdd={v => addArr('goals', v)} onRemove={i => rmArr('goals', i)} />
      <div style={{ display: 'flex', gap: space[2] }}>
        <Button variant="primary" size="sm" onClick={save} disabled={saving || !a.name?.trim()} style={{ background: color.ink, color: color.surface }}>{saving ? <Loader2 size={13} /> : <Check size={13} />} Save</Button>
        <Button variant="ghost" size="sm" onClick={del}><Trash2 size={13} /> {a.id ? 'Delete' : 'Cancel'}</Button>
      </div>
    </div>
  )
}
