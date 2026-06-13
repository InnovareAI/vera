// VERA — the one DOING surface (/p/:slug/vera). The Claude 3-pane:
// rail (Layout) · conversation (center, here) · draft artifact (right rail).
//
// One composer drives both chat and drafting: vera-chat decides, and when
// the operator briefs a post it calls run_pipeline → the 9-agent pipeline
// streams calm step captions → the finished draft arrives as a `draft`
// event and opens in the right-hand artifact panel with Approve / Tweak /
// Regenerate. Images (generate_image) and videos (generate_video) attach
// to the artifact. This matches SAM's chat+artifact model.

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Square, Sparkles, Check, RefreshCw, Pencil, Send, PenLine, Megaphone, Lightbulb, ImagePlus, Clapperboard, Zap, CalendarDays, Paperclip, FileText, Plus, Link2, Copy, Pin, X, Target, Share2, Network, KeyRound, Lock, TrendingUp, BarChart3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Post } from '../lib/supabase'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import { useAuth } from '../lib/auth'
import { useRightRail } from '../lib/rightRailContext'
import { useToast } from '../design'
import { color, space, type as t, radius } from '../design'
import { PlatformPostPreview } from '../components/PlatformPostPreview'
import Markdown from '../components/Markdown'
import { downloadMarkdown } from '../lib/exportDoc'
import { markdownToText } from '../lib/mdToText'
import { hasBusinessContext, parseProjectInstructions, type BusinessContext, type BusinessContextKey } from '../lib/businessContext'
import {
  DEFAULT_DEMAND_OPERATING_MODEL,
  DEMAND_PLATFORM_DEFINITIONS,
  DEMAND_SOURCE_KEYS,
  demandChannelMatrixPrompt,
  demandChannelsFromContext,
} from '../lib/demandModel'
import {
  buildModelRecommendations,
  imageModelProvider,
  latestPricingReviewDate,
  type ModelPricingGuide,
  type SpendEstimate,
} from '../lib/modelEconomics'
import { useModelPricingCatalog, type ModelPricingCatalogSource } from '../lib/useModelPricingCatalog'

const SUPA = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const HISTORY_LIMIT = 40
const MAX_ATTACHMENTS = 6
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TEXT_DOCUMENT_CHARS = 120_000
const ACCEPTED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.pdf',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
].join(',')

type ImageAttachment = { kind: 'image'; dataUrl: string; name: string; mime: string; size: number }
type DocumentBlock = {
  type: 'document'
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
  title: string
  context?: string
}

type ObservationNotice = {
  id: string
  title: string
  proposed_action: string | null
  kind: string
  severity: 'low' | 'medium' | 'high'
  detail: string | null
  action_kind: string | null
  action_payload: Record<string, unknown> | null
}

type WeeklyLearningSummary = {
  measuredPosts?: number
  comments?: number
  shares?: number
  clicks?: number
  qualifiedTraffic?: number
  buyerQuestions?: number
  meetingRequests?: number
  demandSignals?: number
  buyerIntent?: number
}

type WeeklyLearningPayload = {
  route?: string
  week_key?: string
  current?: WeeklyLearningSummary
  previous?: WeeklyLearningSummary
  top_assets?: Array<{ post_id?: string; title?: string; channel?: string; score?: number; evidence?: string }>
  skill_proposals?: Array<{ id?: string; name?: string; confidence?: string | null; created_at?: string }>
  sam_handoff_candidates?: Array<{ post_id?: string; title?: string; channel?: string; score?: number; triggers?: string[] }>
}
type DocumentAttachment = { kind: 'document'; document: DocumentBlock; name: string; mime: string; size: number; truncated?: boolean }
type ComposerAttachment = ImageAttachment | DocumentAttachment
type MessageFile = { name: string; mime: string; size: number }
type ProviderCapabilities = {
  loaded: boolean
  isMaster: boolean
  hasAnthropic: boolean
  hasOpenRouter: boolean
  hasOpenAI: boolean
  hasFal: boolean
  imagesEnabled: boolean
  standardVideoEnabled: boolean
  premiumMediaEnabled: boolean
  hasPlatformImageEntitlement: boolean
  hasPlatformVideoEntitlement: boolean
  textReady: boolean
  imageReady: boolean
  videoReady: boolean
  needsTextKey: boolean
  defaultTextModel: string | null
  defaultImageModel: string
  defaultVideoModel: string
  defaultImageVideoModel: string
  monthlyBudgetUsd: number | null
}
type StoredAttachment =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'file'; name: string; mime: string; size: number }
  | { kind: 'document'; name: string; mime: string; size: number }
type WireContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | DocumentBlock

const DEFAULT_CLIENT_AI_POLICY = {
  imagesEnabled: true,
  standardVideoEnabled: false,
  premiumMediaEnabled: false,
  defaultTextModel: null as string | null,
  defaultImageModel: 'nano-banana',
  defaultVideoModel: 'hailuo',
  defaultImageVideoModel: 'hailuo-i2v',
  monthlyBudgetUsd: null as number | null,
}

const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  loaded: false,
  isMaster: false,
  hasAnthropic: false,
  hasOpenRouter: false,
  hasOpenAI: false,
  hasFal: false,
  imagesEnabled: DEFAULT_CLIENT_AI_POLICY.imagesEnabled,
  standardVideoEnabled: DEFAULT_CLIENT_AI_POLICY.standardVideoEnabled,
  premiumMediaEnabled: DEFAULT_CLIENT_AI_POLICY.premiumMediaEnabled,
  hasPlatformImageEntitlement: false,
  hasPlatformVideoEntitlement: false,
  textReady: false,
  imageReady: false,
  videoReady: false,
  needsTextKey: false,
  defaultTextModel: DEFAULT_CLIENT_AI_POLICY.defaultTextModel,
  defaultImageModel: DEFAULT_CLIENT_AI_POLICY.defaultImageModel,
  defaultVideoModel: DEFAULT_CLIENT_AI_POLICY.defaultVideoModel,
  defaultImageVideoModel: DEFAULT_CLIENT_AI_POLICY.defaultImageVideoModel,
  monthlyBudgetUsd: DEFAULT_CLIENT_AI_POLICY.monthlyBudgetUsd,
}

function parseClientAiPolicy(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_CLIENT_AI_POLICY
  }
  const policy = value as Record<string, unknown>
  return {
    imagesEnabled: typeof policy.images_enabled === 'boolean' ? policy.images_enabled : true,
    standardVideoEnabled: typeof policy.standard_video_enabled === 'boolean' ? policy.standard_video_enabled : false,
    premiumMediaEnabled: typeof policy.premium_media_enabled === 'boolean' ? policy.premium_media_enabled : false,
    defaultTextModel: typeof policy.default_text_model === 'string' && policy.default_text_model.trim() ? policy.default_text_model.trim() : null,
    defaultImageModel: typeof policy.default_image_model === 'string' && policy.default_image_model.trim() ? policy.default_image_model.trim() : DEFAULT_CLIENT_AI_POLICY.defaultImageModel,
    defaultVideoModel: typeof policy.default_video_model === 'string' && policy.default_video_model.trim() ? policy.default_video_model.trim() : DEFAULT_CLIENT_AI_POLICY.defaultVideoModel,
    defaultImageVideoModel: typeof policy.default_image_video_model === 'string' && policy.default_image_video_model.trim() ? policy.default_image_video_model.trim() : DEFAULT_CLIENT_AI_POLICY.defaultImageVideoModel,
    monthlyBudgetUsd: typeof policy.monthly_budget_usd === 'number' && Number.isFinite(policy.monthly_budget_usd) ? policy.monthly_budget_usd : null,
  }
}

function extension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function attachmentMime(file: File) {
  const mime = file.type || ''
  if (mime) return mime
  const ext = extension(file.name)
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'json') return 'application/json'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  if (ext === 'xml') return 'text/xml'
  if (ext === 'yaml' || ext === 'yml') return 'text/yaml'
  if (ext === 'txt') return 'text/plain'
  return 'application/octet-stream'
}

function isSupportedImage(mime: string) {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp'
}

function isTextDocument(file: File, mime: string) {
  if (mime.startsWith('text/')) return true
  if (mime === 'application/json' || mime === 'application/xml' || mime === 'application/x-yaml' || mime === 'application/yaml') return true
  return ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'xml', 'yaml', 'yml'].includes(extension(file.name))
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function bytesHuman(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function hexToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

type ApprovalWebhookError = Error & { status?: number }

function attachmentPrompt(attachments: ComposerAttachment[]) {
  const images = attachments.filter(a => a.kind === 'image').length
  const documents = attachments.filter(a => a.kind === 'document').length
  if (images && documents) return `Use the attached ${documents} document${documents === 1 ? '' : 's'} and ${images} image${images === 1 ? '' : 's'}.`
  if (documents) return `Use the attached ${documents} document${documents === 1 ? '' : 's'}.`
  return `Use the attached ${images} image${images === 1 ? '' : 's'}.`
}

interface ToolEvent { id?: string; tool: string; status: 'running' | 'done'; message?: string }
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  tools?: ToolEvent[]
  images?: string[]
  files?: MessageFile[]
  videos?: string[]
  videoPending?: boolean   // a fal video job is rendering in the background
  carouselPending?: { done: number; total: number }  // carousel frames rendering
}

function chatHistoryKey(projectId: string, sessionId: string) {
  return `vera-chat-history:${projectId}:${sessionId}`
}

function chatSessionMetaKey(projectId: string, sessionId: string) {
  return `vera-chat-session:${projectId}:${sessionId}`
}

function titleFromMessages(messages: Message[]) {
  const firstUser = messages.find(message => message.role === 'user' && message.content.trim())
  const firstAny = messages.find(message => message.content.trim())
  return (firstUser?.content || firstAny?.content || 'Untitled chat').replace(/\s+/g, ' ').trim()
}

function saveLocalChatMessages(projectId: string, sessionId: string, messages: Message[]) {
  const keep = persistableMessages(messages)
  localStorage.setItem(chatHistoryKey(projectId, sessionId), JSON.stringify(keep))
  if (keep.length > 0) {
    localStorage.setItem(chatSessionMetaKey(projectId, sessionId), JSON.stringify({
      session_id: sessionId,
      title: titleFromMessages(keep),
      last_at: new Date().toISOString(),
      message_count: keep.length,
    }))
  }
}

function parseStoredMessages(raw: string | null): Message[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Message[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.id === 'string')
      .map(m => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        images: Array.isArray(m.images) ? m.images.filter(Boolean) : undefined,
        videos: Array.isArray(m.videos) ? m.videos.filter(Boolean) : undefined,
        files: Array.isArray(m.files) ? m.files.filter(f => f?.name) : undefined,
      }))
  } catch {
    return []
  }
}

function messageFingerprint(message: Message) {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    images: message.images ?? [],
    videos: message.videos ?? [],
    files: message.files ?? [],
  })
}

function mergeMessages(primary: Message[], fallback: Message[]) {
  const seenIds = new Set<string>()
  const seenFingerprints = new Set<string>()
  const merged: Message[] = []
  for (const message of [...primary, ...fallback]) {
    if (seenIds.has(message.id)) continue
    const fingerprint = messageFingerprint(message)
    if (seenFingerprints.has(fingerprint)) continue
    seenIds.add(message.id)
    seenFingerprints.add(fingerprint)
    merged.push(message)
  }
  return merged
}

function splitStoredAttachments(attachments: StoredAttachment[] | null | undefined) {
  const atts = Array.isArray(attachments) ? attachments : []
  const images = atts.filter((a): a is { kind: 'image'; url: string } => a.kind === 'image' && !!a.url).map(a => a.url)
  const videos = atts.filter((a): a is { kind: 'video'; url: string } => a.kind === 'video' && !!a.url).map(a => a.url)
  const files = atts
    .filter((a): a is { kind: 'file' | 'document'; name: string; mime: string; size: number } => (
      (a.kind === 'file' || a.kind === 'document') && !!a.name
    ))
    .map(a => ({ name: a.name, mime: a.mime ?? 'application/octet-stream', size: Number(a.size ?? 0) }))
  return { images, videos, files }
}

function rowToMessage(row: { id: string; role: 'user' | 'assistant'; content: string | null; attachments?: StoredAttachment[] | null }): Message {
  const { images, videos, files } = splitStoredAttachments(row.attachments)
  return {
    id: row.id,
    role: row.role,
    content: row.content ?? '',
    images: images.length ? images : undefined,
    videos: videos.length ? videos : undefined,
    files: files.length ? files : undefined,
  }
}

function serializeMessageAttachments(message: Message): StoredAttachment[] {
  return [
    ...(message.images ?? []).filter(Boolean).map(url => ({ kind: 'image' as const, url })),
    ...(message.videos ?? []).filter(Boolean).map(url => ({ kind: 'video' as const, url })),
    ...(message.files ?? []).filter(file => file?.name).map(file => ({
      kind: 'file' as const,
      name: file.name,
      mime: file.mime || 'application/octet-stream',
      size: Number(file.size ?? 0),
    })),
  ]
}

function persistableMessages(messages: Message[]) {
  return messages
    .filter(message => !message.pending)
    .filter(message => message.content.trim() || serializeMessageAttachments(message).length > 0)
    .slice(-HISTORY_LIMIT)
}

// A campaign = a batch of scheduled posts produced by the agent's plan_campaign
// capability (one ask → the whole arc). Rendered as a calendar in the right rail.
interface CampaignPost {
  id: string
  title: string | null
  copy: string
  channel: string
  status: string
  scheduled_at: string | null
  hashtags?: string[] | null
  image_prompt?: string | null
  campaign_id?: string
  media_url?: string
  media_type?: string
}
interface CampaignData {
  id: string
  name: string
  theme: string | null
  channel: string
  channels?: string[]
  cadence: string
  count: number
  posts: CampaignPost[]
}

type DemandPlanSnapshot = {
  completeness: number
  sourceCount: number
  sourceTotal: number
  objective: string
  conversionPath: string
  channels: string[]
  formats: string[]
  signals: string
  handoff: string
  speakers: string[]
  tone: string[]
  approvals: string[]
  learning: string[]
  missing: string[]
}

const DEMAND_PLAN_FIELDS: Array<{ key: BusinessContextKey; label: string }> = [
  { key: 'demandObjective', label: 'Demand objective' },
  { key: 'offer', label: 'Offer' },
  { key: 'audience', label: 'ICP' },
  { key: 'speakerStrategy', label: 'Speaker strategy' },
  { key: 'platformToneOfVoice', label: 'Platform TOV' },
  { key: 'channelStrategy', label: 'Channel strategy' },
  { key: 'contentFormats', label: 'Content formats' },
  { key: 'approvalModel', label: 'Approval model' },
  { key: 'approvalStakeholders', label: 'Approval stakeholders' },
  { key: 'engagementSignals', label: 'Engagement signals' },
  { key: 'samHandoffRules', label: 'SAM handoff' },
]

function splitList(value: string, max = 5) {
  return value
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

const DEFAULT_FIRST_WAVE_CHANNELS = DEMAND_PLATFORM_DEFINITIONS.map(platform => platform.label)
const DEFAULT_SPEAKER_ITEMS = ['Brand account', 'Named founder or expert', 'Team voice when sourced']
const DEFAULT_TONE_ITEMS = ['Shared brand core', 'Channel-native TOV', 'Medium-specific structure']
const DEFAULT_APPROVAL_ITEMS = ['Case based', 'One named owner', 'All stakeholders for high-risk work']
const DEFAULT_LEARNING_ITEMS = ['Weekly performance review', 'Refresh platform best practices', 'Turn wins into reusable skills']

function buildDemandPlanSnapshot(context: BusinessContext): DemandPlanSnapshot {
  const filled = DEMAND_PLAN_FIELDS.filter(field => context[field.key].trim()).length
  const sourceCount = DEMAND_SOURCE_KEYS.filter(key => context[key].trim()).length
  const missing = DEMAND_PLAN_FIELDS
    .filter(field => !context[field.key].trim())
    .map(field => field.label)
    .slice(0, 4)
  const sourceChannels = demandChannelsFromContext(context, 8)
  const strategyChannels = splitList(context.channelStrategy, 6)
  const formats = splitList(context.contentFormats, 5)
  const speakerItems = splitList(context.speakerStrategy, 3)
  const toneItems = splitList(context.platformToneOfVoice, 3)
  const approvalItems = splitList(context.approvalStakeholders || context.approvalModel, 3)
  const learningItems = splitList(context.learningCadence, 3)
  return {
    completeness: Math.round((filled / DEMAND_PLAN_FIELDS.length) * 100),
    sourceCount,
    sourceTotal: DEMAND_SOURCE_KEYS.length,
    objective: context.demandObjective.trim() || context.contentGoals.trim() || DEFAULT_DEMAND_OPERATING_MODEL.demandObjective,
    conversionPath: context.conversionPath.trim() || DEFAULT_DEMAND_OPERATING_MODEL.conversionPath,
    channels: sourceChannels.length ? sourceChannels.slice(0, 8) : (strategyChannels.length ? strategyChannels.slice(0, 8) : DEFAULT_FIRST_WAVE_CHANNELS),
    formats: formats.length ? formats : ['Posts', 'Carousels', 'Video storyboards', 'Long form'],
    signals: context.engagementSignals.trim() || DEFAULT_DEMAND_OPERATING_MODEL.engagementSignals,
    handoff: context.samHandoffRules.trim() || DEFAULT_DEMAND_OPERATING_MODEL.samHandoffRules,
    speakers: speakerItems.length ? speakerItems : DEFAULT_SPEAKER_ITEMS,
    tone: toneItems.length ? toneItems : DEFAULT_TONE_ITEMS,
    approvals: approvalItems.length ? approvalItems : DEFAULT_APPROVAL_ITEMS,
    learning: learningItems.length ? learningItems : DEFAULT_LEARNING_ITEMS,
    missing,
  }
}

const TOOL_LABEL: Record<string, string> = {
  run_pipeline: 'Drafting with the team',
  generate_image: 'Generating image',
  generate_infographic: 'Generating infographic',
  generate_video_storyboard: 'Building storyboard',
  generate_video: 'Generating video',
  web_search: 'Searching the web',
  kb_search: 'Checking knowledge',
  remember: 'Saving to memory',
}

export default function VeraThread() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const { user } = useAuth()
  const { push } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [draft, setDraft] = useState<Post | null>(null)
  const [draftHistory, setDraftHistory] = useState<Post[]>([])
  const [campaign, setCampaign] = useState<CampaignData | null>(null)
  const [approving, setApproving] = useState(false)
  const [observations, setObservations] = useState<ObservationNotice[]>([])
  const [weeklyActionKey, setWeeklyActionKey] = useState<string | null>(null)
  const [stats, setStats] = useState<{ pending: number; campaigns: number }>({ pending: 0, campaigns: 0 })
  const [sessionId, setSessionId] = useState<string>('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [setup, setSetup] = useState<{ business: boolean; audience: boolean; voice: boolean; categories: boolean; knowledge: boolean } | null>(null)

  useEffect(() => {
    setDraft(null)
    setDraftHistory([])
    setCampaign(null)
  }, [activeProject?.id])

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function functionHeaders() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    const token = data.session?.access_token
    if (!token) throw new Error('Sign in again before using Vera.')
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: ANON,
    }
  }

  // Establish the active chat session per client (persisted in localStorage).
  useEffect(() => {
    const pid = activeProject?.id
    if (!pid) { setSessionId(''); return }
    const key = `vera-session:${pid}`
    const stored = localStorage.getItem(key)
    if (stored) { setSessionId(stored); return }
    // No active-session pointer (new browser, cleared storage, or after a
    // logout/login). Reopen the project's MOST RECENT session instead of a blank
    // new chat, so a refresh never buries the last conversation in history.
    // Scoped to project_id, so it only ever surfaces this client's own sessions.
    let cancelled = false
    supabase.from('chat_messages')
      .select('session_id')
      .eq('project_id', pid)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return
        const recent = (data as Array<{ session_id: string }> | null)?.[0]?.session_id
        const sid = recent ?? crypto.randomUUID()
        try { localStorage.setItem(key, sid) } catch { /* ignore */ }
        setSessionId(sid)
      }, () => {
        if (cancelled) return
        const sid = crypto.randomUUID()
        try { localStorage.setItem(key, sid) } catch { /* ignore */ }
        setSessionId(sid)
      })
    return () => { cancelled = true }
  }, [activeProject?.id])

  // Load the current session's messages (re-runs on session switch / New chat).
  useEffect(() => {
    if (!activeProject?.id || !sessionId) { setMessages([]); setHistoryLoaded(!!activeProject?.id); return }
    let cancelled = false
    setHistoryLoaded(false)
    const key = chatHistoryKey(activeProject.id, sessionId)
    const cached = parseStoredMessages(localStorage.getItem(key))
    setMessages(cached)
    supabase.from('chat_messages')
      .select('id, role, content, attachments, created_at')
      .eq('project_id', activeProject.id)
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as Array<{ id: string; role: 'user' | 'assistant'; content: string | null; attachments?: StoredAttachment[] | null }>
        const stored = rows.reverse().map(rowToMessage)
        // The project-scoped DB query is the source of truth for this
        // (project, session). Keep only still-pending local messages and drop
        // cached content — so a cross-project localStorage cache can never keep
        // another client's chat on screen when the DB has nothing here. Purge
        // the stale key so it can't flash on the next load either.
        setMessages(prev => mergeMessages(stored, prev.filter(m => m.pending)))
        if (!stored.length) { try { localStorage.removeItem(key) } catch { /* ignore */ } }
        setHistoryLoaded(true)
      }, () => {
        if (!cancelled) setHistoryLoaded(true)
      })
    return () => { cancelled = true }
  }, [activeProject?.id, sessionId])

  useEffect(() => {
    if (!activeProject?.id) return
    const key = `vera-command-prefill:${activeProject.id}`
    const prefill = sessionStorage.getItem(key)
    if (!prefill) return
    sessionStorage.removeItem(key)
    setInput(current => current.trim() ? current : prefill)
    setTimeout(() => taRef.current?.focus(), 0)
  }, [activeProject?.id])

  useEffect(() => {
    if (!activeProject?.id || !sessionId || !historyLoaded) return
    try {
      saveLocalChatMessages(activeProject.id, sessionId, messages)
    } catch {
      // Local storage can fill up when image previews are large. Database
      // persistence still handles the durable copy.
    }
  }, [activeProject?.id, sessionId, historyLoaded, messages])

  // Restore the open draft on load — but ONLY the draft that belongs to THIS
  // session. The card is client state that a refresh wipes, so a mid-work
  // refresh should bring it back. The earlier version reopened the latest post
  // for the whole client, which surfaced a STALE draft in a brand-new chat
  // (and made Vera talk about "this draft" the operator never created). We now
  // key the open draft to the session via localStorage: a fresh chat has no
  // key → no draft → nothing phantom for Vera to reference.
  useEffect(() => {
    if (!activeProject?.id || !sessionId) return
    let did: string | null = null
    try { did = localStorage.getItem(`vera-draft:${sessionId}`) } catch { /* ignore */ }
    if (!did) return  // this session never opened a draft — don't surface a stale one
    let cancelled = false
    supabase.from('content_posts')
      .select('*')
      .eq('id', did)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        setDraft(prev => prev ?? (data as Post))
        setDraftHistory(prev => (prev.length ? prev : [data as Post]))
      })
    return () => { cancelled = true }
  }, [activeProject?.id, sessionId])

  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapabilities>(DEFAULT_PROVIDER_CAPABILITIES)
  const { catalog: pricingCatalog, source: pricingSource, rowCount: pricingRowCount } = useModelPricingCatalog()
  const demandPlan = useMemo(() => {
    const parsed = parseProjectInstructions(activeProject?.instructions ?? '')
    return buildDemandPlanSnapshot(parsed.businessContext)
  }, [activeProject?.instructions])

  useEffect(() => {
    if (!activeOrg?.id || !activeProject?.id) {
      setProviderCapabilities(DEFAULT_PROVIDER_CAPABILITIES)
      return
    }
    let cancelled = false
    void (async () => {
      const [{ data: org }, { data: rows }, { data: project }, { data: entitlements }] = await Promise.all([
        supabase.from('organizations').select('is_master').eq('id', activeOrg.id).maybeSingle(),
        supabase.from('client_api_keys').select('provider').eq('project_id', activeProject.id).eq('status', 'active').in('provider', ['anthropic', 'openrouter', 'openai', 'fal', 'fal_ai']),
        supabase.from('projects').select('ai_policy').eq('id', activeProject.id).maybeSingle(),
        user?.id
          ? supabase.from('ai_user_entitlements')
            .select('org_id, project_id, capability, expires_at')
            .eq('user_id', user.id)
            .in('capability', ['platform_fal_video', 'platform_fal_image'])
            .eq('enabled', true)
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return
      const isMaster = !!(org as { is_master?: boolean } | null)?.is_master
      const aiPolicy = parseClientAiPolicy((project as { ai_policy?: unknown } | null)?.ai_policy)
      const providers = new Set(((rows ?? []) as Array<{ provider: string | null }>).map(row => row.provider).filter(Boolean) as string[])
      const platformMediaProject = isMaster && activeProject.slug === 'innovareai-brand'
      const hasAnthropic = providers.has('anthropic')
      const hasOpenRouter = providers.has('openrouter')
      const hasOpenAI = providers.has('openai')
      const hasFal = providers.has('fal') || providers.has('fal_ai')
      const entitlementRows = (entitlements ?? []) as Array<{ org_id?: string | null; project_id?: string | null; capability?: string | null; expires_at?: string | null }>
      const entitlementApplies = (row: { org_id?: string | null; project_id?: string | null; expires_at?: string | null }) => {
          if (!platformMediaProject) return false
          if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false
          if (row.project_id) return row.project_id === activeProject.id
          if (row.org_id) return row.org_id === activeOrg.id
          return true
      }
      const hasPlatformImageEntitlement = entitlementRows.some(row => row.capability === 'platform_fal_image' && entitlementApplies(row))
      const hasPlatformVideoEntitlement = entitlementRows.some(row => row.capability === 'platform_fal_video' && entitlementApplies(row))
      const clientImageRoute = imageModelProvider(aiPolicy.defaultImageModel, { hasOpenRouter, hasOpenAI, hasFal })
      const platformImageRoute = platformMediaProject && hasPlatformImageEntitlement
        ? imageModelProvider(aiPolicy.defaultImageModel, { hasOpenRouter: true, hasOpenAI: true, hasFal: false })
        : null
      setProviderCapabilities({
        loaded: true,
        isMaster,
        hasAnthropic,
        hasOpenRouter,
        hasOpenAI,
        hasFal,
        imagesEnabled: aiPolicy.imagesEnabled,
        standardVideoEnabled: aiPolicy.standardVideoEnabled,
        premiumMediaEnabled: aiPolicy.premiumMediaEnabled,
        hasPlatformImageEntitlement,
        hasPlatformVideoEntitlement,
        textReady: platformMediaProject || hasAnthropic || hasOpenRouter,
        imageReady: aiPolicy.imagesEnabled && (!!clientImageRoute || !!platformImageRoute),
        videoReady: (hasFal && (aiPolicy.standardVideoEnabled || aiPolicy.premiumMediaEnabled)) || hasPlatformVideoEntitlement,
        needsTextKey: !platformMediaProject && !hasAnthropic && !hasOpenRouter,
        defaultTextModel: aiPolicy.defaultTextModel,
        defaultImageModel: aiPolicy.defaultImageModel,
        defaultVideoModel: aiPolicy.defaultVideoModel,
        defaultImageVideoModel: aiPolicy.defaultImageVideoModel,
        monthlyBudgetUsd: aiPolicy.monthlyBudgetUsd,
      })
    })()
    return () => { cancelled = true }
  }, [activeOrg?.id, activeProject?.id, activeProject?.slug, user?.id])

  // Resume any in-flight video renders on load. A render that was still going
  // when the page was refreshed / closed used to be lost forever (its fal
  // request_id only lived in the poll loop). Now it's recorded in video_jobs,
  // so we pick up every 'rendering' job for this client and keep polling until
  // the clip lands — it writes through to the post + the message attachment, so
  // the video appears whether or not the operator is still on the same thread.
  // Age-capped at 30 min so a genuinely stuck job doesn't retry on every load.
  const resumedJobs = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!activeProject?.id) return
    let cancelled = false
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    supabase.from('video_jobs')
      .select('request_id, slug, post_id, message_id')
      .eq('project_id', activeProject.id)
      .eq('status', 'rendering')
      .gte('created_at', cutoff)
      .then(({ data }) => {
        if (cancelled || !data) return
        for (const job of data as Array<{ request_id: string; slug: string | null; post_id: string | null; message_id: string | null }>) {
          if (resumedJobs.current.has(job.request_id)) continue
          resumedJobs.current.add(job.request_id)
          if (job.message_id) setMessages(prev => prev.map(m => m.id === job.message_id ? { ...m, videoPending: true } : m))
          void pollVideo(job.request_id, job.slug ?? 'hailuo', job.message_id ?? crypto.randomUUID(), { postId: job.post_id })
        }
      })
    return () => { cancelled = true }
  }, [activeProject?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Resume watching any server-side carousel job still processing on load — the
  // render keeps going on the server even if the tab was closed, so re-attach
  // and show it filling in.
  const watchedCarousels = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!activeProject?.id) return
    let cancelled = false
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    supabase.from('media_jobs')
      .select('post_id, spec')
      .eq('project_id', activeProject.id)
      .eq('kind', 'carousel')
      .eq('status', 'processing')
      .gte('created_at', cutoff)
      .then(({ data }) => {
        if (cancelled || !data) return
        for (const job of data as Array<{ post_id: string | null; spec: { frames?: unknown[] } | null }>) {
          if (!job.post_id || watchedCarousels.current.has(job.post_id)) continue
          const total = Array.isArray(job.spec?.frames) ? job.spec!.frames!.length : 0
          void watchCarousel(job.post_id, total, crypto.randomUUID())
        }
      })
    return () => { cancelled = true }
  }, [activeProject?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // "VERA wants to" — open observations, surfaced in the launcher (moved here
  // from the old Home/Dashboard so nothing is lost when Home goes away).
  useEffect(() => {
    if (!activeOrg?.id) { setObservations([]); return }
    let q = supabase.from('agent_observations')
      .select('id, title, proposed_action, kind, severity, detail, action_kind, action_payload')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .neq('kind', 'stale_audit')
      .order('created_at', { ascending: false })
      .limit(4)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    q.then(({ data }) => {
      // Dedupe by title — duplicate/same-named campaigns can fire the same
      // nudge more than once; show each only once.
      const seen = new Set<string>()
      const deduped = ((data ?? []) as ObservationNotice[])
        .filter(o => (seen.has(o.title) ? false : (seen.add(o.title), true)))
      setObservations(deduped)
    })
  }, [activeOrg?.id, activeProject?.id])

  // Live counts for the launcher quick-action descriptions (SAM-style).
  useEffect(() => {
    if (!activeOrg?.id) { setStats({ pending: 0, campaigns: 0 }); return }
    let pq = supabase.from('content_posts').select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id).in('status', ['Pending Review', 'pending', 'Draft', 'draft'])
    if (activeProject?.id) pq = pq.eq('project_id', activeProject.id)
    const cq = supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('org_id', activeOrg.id)
    Promise.all([pq, cq]).then(([pr, cr]) =>
      setStats({ pending: pr.error ? 0 : (pr.count ?? 0), campaigns: cr.error ? 0 : (cr.count ?? 0) }))
  }, [activeOrg?.id, activeProject?.id])

  // Brain readiness — VERA writes sharper when the client's brain is set up, so
  // when it's thin we make "set up the brain" the obvious first step (the spine
  // starts at the brain, persona-first). Cheap count probes per client; guards
  // on errors so a missing table reads as "not done" rather than crashing idle.
  useEffect(() => {
    if (!activeProject?.id || !activeOrg?.id) { setSetup(null); return }
    let cancelled = false
    const pid = activeProject.id, oid = activeOrg.id
    const instr = (activeProject.instructions ?? '').trim()
    Promise.all([
      supabase.from('audiences').select('id', { count: 'exact', head: true }).eq('org_id', oid),
      supabase.from('brand_voice').select('tone, system_prompt, sample_posts').or(`project_id.eq.${pid},and(project_id.is.null,org_id.eq.${oid})`).limit(6),
      supabase.from('content_categories').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('project_knowledge').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ]).then(([aud, voice, cat, kb]) => {
      if (cancelled) return
      const vr = (voice.data ?? []) as { tone?: string[] | null; system_prompt?: string | null; sample_posts?: string[] | null }[]
      const voiceReady = vr.some(v => (v.tone?.length ?? 0) > 0 || (v.system_prompt ?? '').trim().length > 0 || (v.sample_posts?.length ?? 0) > 0)
      const parsedInstructions = parseProjectInstructions(instr)
      setSetup({
        business: hasBusinessContext(parsedInstructions.businessContext),
        audience: !aud.error && (aud.count ?? 0) > 0,
        voice: voiceReady,
        categories: !cat.error && (cat.count ?? 0) > 0,
        knowledge: (!kb.error && (kb.count ?? 0) > 0) || instr.length > 0,
      })
    })
    return () => { cancelled = true }
  }, [activeProject?.id, activeOrg?.id, activeProject?.instructions])

  // Auto-scroll
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const persistChatMessage = useCallback(async (message: Message) => {
    if (!activeOrg?.id || !activeProject?.id || !sessionId || message.pending) return
    const attachmentsForStorage = serializeMessageAttachments(message)
    if (!message.content.trim() && attachmentsForStorage.length === 0) return

    try {
      const key = chatHistoryKey(activeProject.id, sessionId)
      const cached = parseStoredMessages(localStorage.getItem(key))
      saveLocalChatMessages(activeProject.id, sessionId, mergeMessages(cached, [message]).slice(-HISTORY_LIMIT))
    } catch {
      // The database write below is the durable copy when local storage is full.
    }

    const { error } = await supabase.from('chat_messages').upsert({
      id: message.id,
      org_id: activeOrg.id,
      project_id: activeProject.id,
      session_id: sessionId,
      role: message.role,
      content: message.content,
      attachments: attachmentsForStorage,
    }, { onConflict: 'id' })

    if (error) {
      console.warn('chat history save failed', error.message)
      return
    }
    window.dispatchEvent(new CustomEvent('vera:session', { detail: { sid: sessionId } }))
  }, [activeOrg?.id, activeProject?.id, sessionId])

  // Auto-grow composer
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    const minHeight = messages.length === 0 ? 118 : 100
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), 240)}px`
  }, [input, messages.length])

  // "Go home" — clicking the Vera item in the rail (while already here) returns
  // to the launcher, the way people expect the logo/home to behave. The prior
  // chat is saved (Recents/History). A ref keeps the latest closure so the
  // listener never goes stale.
  const newChatRef = useRef<() => void>(() => {})
  useEffect(() => { newChatRef.current = newChat })
  useEffect(() => {
    const h = () => newChatRef.current()
    window.addEventListener('vera:home', h)
    return () => window.removeEventListener('vera:home', h)
  }, [])

  // Resume a chat from the rail's Recents (when already mounted on Vera).
  const pickSessionRef = useRef<(sid: string) => void>(() => {})
  useEffect(() => { pickSessionRef.current = pickSession })
  // Track the live session id for the listener below (its effect has [] deps,
  // so a captured `sessionId` would be stale).
  const sessionIdRef = useRef(sessionId)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => {
    const h = (e: Event) => {
      const sid = (e as CustomEvent).detail?.sid
      // Only switch for a DIFFERENT session. persistChatMessage fires this event
      // on every save (to refresh the rail's Recents) with the CURRENT session —
      // pickSession on that would clear the open draft, making the rail vanish on
      // every message. Ignore same-session pings.
      if (sid && sid !== sessionIdRef.current) pickSessionRef.current(sid)
    }
    window.addEventListener('vera:session', h)
    return () => window.removeEventListener('vera:session', h)
  }, [])

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim()
    if ((!text && attachments.length === 0) || streaming || !activeOrg?.id) return

    const atts = attachments
    const imageAtts = atts.filter((a): a is ImageAttachment => a.kind === 'image')
    const docAtts = atts.filter((a): a is DocumentAttachment => a.kind === 'document')
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      images: imageAtts.length ? imageAtts.map(a => a.dataUrl) : undefined,
      files: docAtts.length ? docAtts.map(a => ({ name: a.name, mime: a.mime, size: a.size })) : undefined,
    }
    const assistantId = crypto.randomUUID()
    // The draft created earlier in THIS stream (save_draft → draft event), so a
    // video_pending later in the same stream can be filed against the right
    // post. The closure's `draft` state is stale (null at send time), so we
    // track it locally as the stream's events arrive.
    let streamDraftId: string | null = draft?.id ?? null
    const placeholder: Message = { id: assistantId, role: 'assistant', content: '', pending: true }
    const next = [...messages, userMsg]
    setMessages([...next, placeholder])
    setInput('')
    setAttachments([])
    setStreaming(true)
    void persistChatMessage(userMsg)

    const wire: Array<{ role: string; content: unknown }> = next.map(m => ({ role: m.role, content: m.content }))
    // Compose the outgoing user turn: typed text + the open draft as context
    // (so "tweak the draft" doesn't force a re-paste) + any attachments as
    // content blocks. Only the outgoing turn is enriched; the thread copy
    // stays clean.
    if (wire.length) {
      let outText = text
      if (draft?.copy) {
        outText += `\n\n---\n[The draft currently open in the preview${draft.id ? ` (id: ${draft.id})` : ''}. If I ask you to tweak, edit, refine, shorten, or change "the draft/copy/post", revise THIS exact text in place and return the full updated post. Do not ask me to paste it again:]\n${draft.copy}`
      }
      const contentBlocks: WireContentBlock[] = [
        ...docAtts.map(a => a.document),
        ...imageAtts.map(a => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: a.mime, data: a.dataUrl.split(',')[1] ?? '' },
        })),
        { type: 'text', text: outText || attachmentPrompt(atts) },
      ]
      wire[wire.length - 1] = atts.length
        ? { role: 'user', content: contentBlocks }
        : { role: 'user', content: outText }
    }
    const controller = new AbortController()
    abortRef.current = controller
    let acc = ''
    const assistantImages: string[] = []
    const assistantVideos: string[] = []

    try {
      const res = await fetch(`${SUPA}/functions/v1/vera-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: await functionHeaders(),
        body: JSON.stringify({
          messages: wire,
          org_id: activeOrg.id,
          user_id: user?.id ?? null,
          project_id: activeProject?.id ?? null,
          session_id: sessionId || null,
          // Share the client-generated ids so the edge writes the SAME row the
          // frontend upserts — one row per message, not two with different ids
          // (the duplicate rows were what made a refresh drop the last message).
          user_message_id: userMsg.id,
          assistant_message_id: assistantId,
          route: location.pathname,
        }),
      })
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${err.slice(0, 160)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx); buffer = buffer.slice(idx + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let ev: Record<string, unknown>
          try { ev = JSON.parse(line.slice(6)) } catch { continue }

          if (ev.type === 'delta' && typeof ev.text === 'string') {
            acc += ev.text
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: acc } : m))
          } else if (ev.type === 'tool_start') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: [...(m.tools ?? []), { id: ev.id as string, tool: ev.tool as string, status: 'running' }] } : m))
          } else if (ev.type === 'tool_progress') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: (m.tools ?? []).map(tl => tl.tool === ev.tool && tl.status === 'running' ? { ...tl, message: ev.status as string } : tl) } : m))
          } else if (ev.type === 'tool_end') {
            setMessages(prev => prev.map(m => m.id === assistantId
              ? { ...m, tools: (m.tools ?? []).map(tl => tl.id === ev.id ? { ...tl, status: 'done' } : tl) } : m))
          } else if (ev.type === 'budget_warning') {
            const warning = ev.warning as Record<string, unknown> | undefined
            const message = typeof warning?.message === 'string' ? warning.message : 'This generation request needs an AI budget review.'
            push({
              kind: 'warn',
              title: 'AI budget warning',
              body: message,
              duration: 9000,
            })
          } else if (ev.type === 'image' && typeof ev.url === 'string') {
            const url = ev.url as string
            assistantImages.push(url)
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, images: [...(m.images ?? []), url] } : m))
            // attach to the open draft if there is one
            setDraft(prev => prev ? { ...prev, media_url: url, media_type: 'image' } : prev)
          } else if (ev.type === 'video' && typeof ev.url === 'string') {
            const vurl = ev.url as string
            assistantVideos.push(vurl)
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, videos: [...(m.videos ?? []), vurl] } : m))
            // attach to the open draft if there is one
            setDraft(prev => prev ? { ...prev, media_url: vurl, media_type: 'video' } : prev)
          } else if (ev.type === 'video_pending' && typeof ev.request_id === 'string') {
            // Video renders for 60-120s — too long to hold this connection open.
            // The backend already submitted the fal job; poll for the result
            // with short requests so nothing times out. Fire-and-forget: this
            // keeps running after the SSE stream below closes.
            setMessages(prev => prev.map(m => m.id === assistantId ? {
              ...m, videoPending: true,
              // Don't let the tool flip to ✓ — it's still rendering. Keep it
              // "running" so the caption + pulse match reality (tester saw a
              // misleading checkmark on a video that couldn't play yet).
              tools: (m.tools ?? []).map(tl => tl.tool === 'generate_video' ? { ...tl, status: 'running' as const } : tl),
            } : m))
            // Record the render durably so it survives a refresh / tab close.
            // The request_id used to live only in this poll loop — losing the
            // page lost the clip with no id to recover it. Now any 'rendering'
            // job is resumed on load (see the resume effect below).
            const reqId = ev.request_id as string
            const vslug = (ev.slug as string) ?? 'hailuo'
            if (activeProject?.id) {
              void supabase.from('video_jobs').upsert({
                request_id: reqId, slug: vslug, post_id: streamDraftId,
                project_id: activeProject.id, session_id: sessionId, message_id: assistantId,
                status: 'rendering', prompt: typeof ev.prompt === 'string' ? ev.prompt : null,
              }, { onConflict: 'request_id' })
            }
            void pollVideo(reqId, vslug, assistantId, { postId: streamDraftId })
          } else if (ev.type === 'carousel_job') {
            // The server (generate-carousel + media_jobs) is rendering the frames
            // in the background. We don't do the work — just watch the post fill
            // in. Survives a closed tab; resumes on reload (see resume effect).
            void watchCarousel((ev.post_id as string) ?? streamDraftId, (ev.total as number) ?? 0, assistantId)
          } else if (ev.type === 'draft' && ev.post) {
            const post = ev.post as Post
            streamDraftId = (post.id as string) ?? streamDraftId
            setDraft(post)
            // Remember this is THIS session's open draft, so a refresh restores
            // it (and a fresh chat doesn't surface someone else's stale draft).
            if (post.id && sessionId) { try { localStorage.setItem(`vera-draft:${sessionId}`, post.id as string) } catch { /* ignore */ } }
            // Keep every version so the operator can flip back through drafts
            // (tester: tweaking made the previous draft vanish).
            setDraftHistory(prev => [...prev, post])
            // Reveal the rail so the new draft is visible even if collapsed.
            window.dispatchEvent(new CustomEvent('vera:rail-open'))
          } else if (ev.type === 'campaign' && ev.campaign) {
            // The agent ran plan_campaign — a whole batch of scheduled posts.
            // Show the calendar in the rail; clicking a post opens it.
            const meta = ev.campaign as Record<string, unknown>
            const posts = (ev.posts as CampaignPost[]) ?? []
            setDraft(null)
            setCampaign({
              id: meta.id as string,
              name: (meta.name as string) ?? 'Campaign',
              theme: (meta.theme as string) ?? null,
              channel: (meta.channel as string) ?? 'LinkedIn',
              channels: Array.isArray(meta.channels) ? meta.channels.map(String).filter(Boolean) : undefined,
              cadence: (meta.cadence as string) ?? 'weekly',
              count: posts.length,
              posts,
            })
            window.dispatchEvent(new CustomEvent('vera:rail-open'))
          } else if (ev.type === 'error') {
            throw new Error((ev.message as string) ?? 'stream error')
          }
        }
      }
      const finalAssistant: Message = {
        id: assistantId,
        role: 'assistant',
        content: acc,
        images: assistantImages.length ? assistantImages : undefined,
        videos: assistantVideos.length ? assistantVideos : undefined,
      }
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, pending: false } : m))
      void persistChatMessage(finalAssistant)
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const stoppedAssistant: Message = { id: assistantId, role: 'assistant', content: acc }
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, pending: false } : m))
        void persistChatMessage(stoppedAssistant)
      } else {
        const errorContent = acc || `Warning: ${(e as Error).message}`
        const failedAssistant: Message = { id: assistantId, role: 'assistant', content: errorContent }
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, pending: false, content: m.content || errorContent } : m))
        void persistChatMessage(failedAssistant)
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
    // pollVideo and watchCarousel are long-running stream helpers. Keep send bound
    // to route, session, and message state so active streams do not churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, activeOrg?.id, activeProject?.id, user?.id, messages, location.pathname, sessionId, draft, attachments, push, persistChatMessage])

  // Poll a backgrounded fal video job (submitted by vera-chat) until the MP4
  // is ready, then drop it into the chat and the open draft. Short polling
  // requests only — nothing is held open long enough for the gateway to kill
  // it, which is what produced the "network error" at ~47s. Runs after the
  // chat SSE stream has already closed.
  async function pollVideo(requestId: string, slug: string, assistantId: string, opts?: { postId?: string | null }) {
    const postId = opts?.postId ?? null
    const INTERVAL = 5000
    const MAX_TRIES = 72 // 72 × 5s = 6 min ceiling
    for (let i = 0; i < MAX_TRIES; i++) {
      await new Promise(r => setTimeout(r, INTERVAL))
      let data: { status?: string; video_url?: string | null }
      try {
        const res = await fetch(`${SUPA}/functions/v1/generate-video`, {
          method: 'POST',
          headers: await functionHeaders(),
          body: JSON.stringify({ action: 'status', request_id: requestId, slug, project_id: activeProject?.id ?? null }),
        })
        if (!res.ok) continue
        data = await res.json()
      } catch { continue } // transient blip — keep polling

      if (data.status === 'COMPLETED' && data.video_url) {
        const vurl = data.video_url
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, videoPending: false, videos: [...(m.videos ?? []), vurl], tools: (m.tools ?? []).map(tl => tl.tool === 'generate_video' ? { ...tl, status: 'done' as const } : tl) } : m))
        // Write to the post by its known id (deterministic — works on a resume
        // after refresh where there's no in-memory draft), and reflect it on the
        // open card if it's the same post. BACKSTOP: if we never got a post id
        // (the draft context was lost / out-of-order tool calls), find the most
        // recent media-less draft for this client and attach the clip there, so
        // a rendered video can NEVER end up orphaned in the chat with no post.
        let targetPostId = postId ?? draft?.id ?? null
        if (!targetPostId && activeProject?.id) {
          const { data: orphan } = await supabase.from('content_posts')
            .select('id').eq('project_id', activeProject.id).is('media_url', null)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          targetPostId = (orphan as { id?: string } | null)?.id ?? null
        }
        if (targetPostId) void supabase.from('content_posts').update({ media_url: vurl, media_type: 'video' }).eq('id', targetPostId)
        setDraft(prev => (prev && (!targetPostId || prev.id === targetPostId)) ? { ...prev, media_url: vurl, media_type: 'video' } : prev)
        // The job is done — stop it being resumed on the next load.
        void supabase.from('video_jobs').update({ status: 'completed', video_url: vurl, updated_at: new Date().toISOString() }).eq('request_id', requestId)
        // Persist the clip so it survives a refresh: it finishes AFTER the
        // assistant message was saved, so it isn't in attachments yet. Append
        // it to this session's latest assistant message.
        if (activeProject?.id && sessionId) {
          void (async () => {
            const { data: last } = await supabase.from('chat_messages')
              .select('id, attachments')
              .eq('project_id', activeProject.id).eq('session_id', sessionId).eq('role', 'assistant')
              .order('created_at', { ascending: false }).limit(1).maybeSingle()
            if (last) {
              const prevAtts = Array.isArray((last as { attachments?: unknown }).attachments) ? (last as { attachments: unknown[] }).attachments : []
              await supabase.from('chat_messages')
                .update({ attachments: [...prevAtts, { kind: 'video', url: vurl }] })
                .eq('id', (last as { id: string }).id)
            }
          })()
        }
        return
      }
      if (data.status === 'FAILED' || data.status === 'CANCELLED' || data.status === 'ERROR') {
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, videoPending: false, content: (m.content ? m.content + '\n\n' : '') + `⚠ Video rendering failed (${(data.status ?? '').toLowerCase()}). Try again or tweak the prompt.` } : m))
        void supabase.from('video_jobs').update({ status: 'failed', error: (data.status ?? 'failed').toLowerCase(), updated_at: new Date().toISOString() }).eq('request_id', requestId)
        return
      }
      // IN_QUEUE / IN_PROGRESS → keep polling
    }
    setMessages(prev => prev.map(m => m.id === assistantId
      ? { ...m, videoPending: false, content: (m.content ? m.content + '\n\n' : '') + '⚠ Video is taking longer than usual. It may still be rendering. Try again shortly.' } : m))
  }

  // Watch a server-side carousel job fill in. generate-carousel renders frames
  // in the background (EdgeRuntime.waitUntil) and writes them onto the post as
  // each lands; we poll the post for progress and reflect it on the draft card.
  // The browser does NO generation — the render survives a closed tab, and the
  // resume effect re-attaches to any still-processing job on reload.
  async function watchCarousel(postId: string | null, total: number, assistantId: string) {
    let target = postId
    if (!target && activeProject?.id) {
      const { data } = await supabase.from('content_posts').select('id').eq('project_id', activeProject.id).is('media_url', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      target = (data as { id?: string } | null)?.id ?? null
    }
    if (!target) return
    if (watchedCarousels.current.has(target)) return
    watchedCarousels.current.add(target)
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, carouselPending: { done: 0, total } } : m))
    const INTERVAL = 4000
    const MAX_TRIES = 105 // 7 min ceiling
    for (let i = 0; i < MAX_TRIES; i++) {
      await new Promise(r => setTimeout(r, INTERVAL))
      const { data: post } = await supabase.from('content_posts').select('*').eq('id', target).maybeSingle()
      const frames = post ? (post as unknown as { media_metadata?: { frames?: Array<{ url: string }> } }).media_metadata?.frames : undefined
      const done = frames?.length ?? 0
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, carouselPending: { done, total: total || done } } : m))
      if (post && done > 0) setDraft(prev => (!prev || prev.id === target) ? (post as Post) : prev)
      const { data: job } = await supabase.from('media_jobs').select('status').eq('post_id', target).eq('kind', 'carousel').order('created_at', { ascending: false }).limit(1).maybeSingle()
      const status = (job as { status?: string } | null)?.status
      if (status === 'completed' || status === 'failed' || (total > 0 && done >= total)) {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, carouselPending: undefined } : m))
        if (post) { setDraft(prev => (!prev || prev.id === target) ? (post as Post) : prev); setDraftHistory(prev => prev.some(p => p.id === target) ? prev : [...prev, post as Post]) }
        window.dispatchEvent(new CustomEvent('vera:rail-open'))
        watchedCarousels.current.delete(target)
        if (status === 'failed' && done === 0) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: (m.content ? m.content + '\n\n' : '') + '⚠ Carousel generation failed on the server. Say "retry the carousel".' } : m))
        }
        return
      }
    }
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, carouselPending: undefined } : m))
    watchedCarousels.current.delete(target)
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // New chat — start a fresh session (new id). The load effect clears the
  // thread; the AI's context resets because we only send this session's msgs.
  function newChat() {
    if (streaming) abortRef.current?.abort()
    const sid = crypto.randomUUID()
    if (activeProject?.id) { try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ } }
    setDraft(null); setDraftHistory([]); setCampaign(null); setInput('')
    setMessages([]); setSessionId(sid)
    setTimeout(() => taRef.current?.focus(), 0)
  }

  // "Pin to new chat" — start a fresh conversation carrying this result in as
  // context. We persist the pinned text as the new session's first message so
  // the session-load effect (which would otherwise wipe in-memory messages on
  // session switch) rehydrates it; the next turn then has it in context.
  async function pinToNewChat(content: string) {
    if (!activeOrg?.id || !activeProject?.id || !content) return
    if (streaming) abortRef.current?.abort()
    const sid = crypto.randomUUID()
    const pinned = `📌 **Pinned from a previous chat**\n\n${content}`
    const { error } = await supabase.from('chat_messages').insert({
      org_id: activeOrg.id,
      project_id: activeProject.id,
      user_id: user?.id ?? null,
      session_id: sid,
      role: 'assistant',
      content: pinned,
      route: location.pathname,
    })
    if (error) {
      push({ kind: 'danger', title: "Couldn't pin result", body: error.message })
      return
    }
    try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ }
    setDraft(null); setDraftHistory([]); setCampaign(null); setInput('')
    setSessionId(sid)   // load effect fetches the pinned message into the new thread
    window.dispatchEvent(new CustomEvent('vera:session', { detail: { sid } }))  // refresh Recents
    setTimeout(() => taRef.current?.focus(), 0)
  }

  function pickSession(sid: string) {
    if (activeProject?.id) { try { localStorage.setItem(`vera-session:${activeProject.id}`, sid) } catch { /* ignore */ } }
    setDraft(null); setDraftHistory([]); setCampaign(null); setSessionId(sid)
  }

  // Attachments: images become vision blocks, PDFs and text files become
  // document blocks for the current turn.
  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true)
    const picked: ComposerAttachment[] = []
    let skippedLarge = 0
    let skippedUnsupported = 0
    let skippedUnreadable = 0
    let skippedLimit = 0
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length)
    if (!remaining) {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
      push({ kind: 'warn', title: 'Attachment limit reached', body: `Remove a file before adding another. Limit: ${MAX_ATTACHMENTS}.` })
      return
    }
    for (const f of Array.from(files)) {
      if (picked.length >= remaining) { skippedLimit++; continue }
      const mime = attachmentMime(f)
      if (f.size > MAX_ATTACHMENT_BYTES) { skippedLarge++; continue }
      try {
        if (isSupportedImage(mime)) {
          const dataUrl = await readAsDataUrl(f)
          picked.push({ kind: 'image', dataUrl, name: f.name, mime, size: f.size })
        } else if (mime === 'application/pdf') {
          const dataUrl = await readAsDataUrl(f)
          picked.push({
            kind: 'document',
            name: f.name,
            mime,
            size: f.size,
            document: {
              type: 'document',
              title: f.name,
              context: `${mime} · ${bytesHuman(f.size)}`,
              source: { type: 'base64', media_type: 'application/pdf', data: dataUrl.split(',')[1] ?? '' },
            },
          })
        } else if (isTextDocument(f, mime)) {
          const raw = await readAsText(f)
          const truncated = raw.length > MAX_TEXT_DOCUMENT_CHARS
          const text = truncated ? `${raw.slice(0, MAX_TEXT_DOCUMENT_CHARS)}\n\n[Document truncated in chat upload at ${MAX_TEXT_DOCUMENT_CHARS.toLocaleString()} characters.]` : raw
          picked.push({
            kind: 'document',
            name: f.name,
            mime,
            size: f.size,
            truncated,
            document: {
              type: 'document',
              title: f.name,
              context: `${mime} · ${bytesHuman(f.size)}${truncated ? ' · truncated' : ''}`,
              source: { type: 'text', media_type: 'text/plain', data: text },
            },
          })
        } else {
          skippedUnsupported++
        }
      } catch { skippedUnreadable++ }
    }
    if (picked.length) setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS))
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    const issues: string[] = []
    if (skippedUnsupported) issues.push(`${skippedUnsupported} unsupported`)
    if (skippedLarge) issues.push(`${skippedLarge} over ${bytesHuman(MAX_ATTACHMENT_BYTES)}`)
    if (skippedUnreadable) issues.push(`${skippedUnreadable} unreadable`)
    if (skippedLimit) issues.push(`${skippedLimit} over the ${MAX_ATTACHMENTS} file limit`)
    if (issues.length) push({ kind: 'warn', title: 'Some files were skipped', body: issues.join(', ') })
  }
  function removeAttachment(i: number) { setAttachments(prev => prev.filter((_, idx) => idx !== i)) }

  function onComposerDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    void handleFiles(e.dataTransfer.files)
  }

  function onComposerDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  // Dismiss a "VERA wants to" nudge — clears every dupe of it (by title).
  async function dismissObservation(o: { title: string }) {
    setObservations(prev => prev.filter(x => x.title !== o.title))
    if (!activeOrg?.id) return
    let q = supabase.from('agent_observations').update({ status: 'dismissed' })
      .eq('org_id', activeOrg.id).eq('title', o.title)
    if (activeProject?.id) q = q.eq('project_id', activeProject.id)
    await q
  }

  async function runWeeklyLearningAction(o: ObservationNotice, action: 'skills' | 'handoff' | 'complete') {
    const payload = parseWeeklyLearningPayload(o.action_payload)
    const body: Record<string, unknown> = { observation_id: o.id }
    const actionKey = `${o.id}:${action}`

    if (action === 'skills') {
      const skillIds = (payload.skill_proposals ?? [])
        .map(skill => skill.id)
        .filter((id): id is string => Boolean(id))
      if (skillIds.length === 0) {
        push({ kind: 'warn', title: 'No skill proposals', body: 'There are no proposed learning skills on this review.' })
        return
      }
      body.activate_skill_ids = skillIds
    }

    if (action === 'handoff') {
      const handoffs = (payload.sam_handoff_candidates ?? []).filter(item => item.post_id)
      if (handoffs.length === 0) {
        push({ kind: 'warn', title: 'No SAM handoffs', body: 'There are no scored handoff candidates on this review.' })
        return
      }
      body.queue_all_handoffs = true
    }

    if (action === 'complete') body.complete_review = true

    setWeeklyActionKey(actionKey)
    try {
      const headers = await functionHeaders()
      const res = await fetch(`${SUPA}/functions/v1/weekly-learning-review`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null) as {
        error?: string
        activated_skills?: Array<{ id: string; name?: string | null }>
        queued_handoff_ids?: string[]
        skipped_duplicate_handoff_count?: number
      } | null
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      if (action === 'skills') {
        push({ kind: 'success', title: 'Skills enabled', body: `${data?.activated_skills?.length ?? 0} learning proposal(s) are now active.` })
      } else if (action === 'handoff') {
        const queued = data?.queued_handoff_ids?.length ?? 0
        const skipped = data?.skipped_duplicate_handoff_count ?? 0
        push({ kind: 'success', title: 'SAM handoffs queued', body: skipped ? `${queued} queued, ${skipped} already existed.` : `${queued} handoff action(s) queued.` })
      } else {
        setObservations(prev => prev.filter(item => item.id !== o.id))
        push({ kind: 'success', title: 'Review complete', body: 'Weekly learning was marked as reviewed.' })
      }
    } catch (e) {
      push({ kind: 'danger', title: 'Review action failed', body: (e as Error).message })
    } finally {
      setWeeklyActionKey(null)
    }
  }

  // ─── Draft actions ──────────────────────────────────────────────
  function ensureDraftInActiveProject(post: Post) {
    if (!activeProject?.id || post.project_id !== activeProject.id) {
      throw new Error('This draft belongs to another client. Reopen the draft in the active client workspace.')
    }
  }

  async function callApprovalWebhook(payload: Record<string, unknown>, bearer: string) {
    const res = await fetch(`${SUPA}/functions/v1/approval-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${bearer}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null) as { post?: Post; error?: string } | null
    if (!res.ok) {
      const err = new Error(data?.error ?? `HTTP ${res.status}`) as ApprovalWebhookError
      err.status = res.status
      throw err
    }
    return data?.post ?? null
  }

  async function approveDraft() {
    if (!draft?.id) return
    setApproving(true)
    try {
      ensureDraftInActiveProject(draft)
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      const reviewedBy = user?.email ?? user?.id ?? 'VERA operator'
      let updated: Post | null = null

      if (session?.access_token) {
        try {
          updated = await callApprovalWebhook({ post_id: draft.id, action: 'approved', reviewed_by: reviewedBy }, session.access_token)
        } catch (e) {
          const err = e as ApprovalWebhookError
          if (err.status !== 401) throw err
        }
      }

      if (!updated) {
        const reviewToken = draft.review_token ?? await ensureReviewToken(draft)
        updated = await callApprovalWebhook({ review_token: reviewToken, action: 'approved', reviewed_by: reviewedBy }, ANON)
      }

      if (!updated) throw new Error('Sign in again to approve directly, or generate a sharing link and approve from the review page.')
      push({ kind: 'success', title: 'Approved', body: 'Moved to the review queue as approved.' })
      setDraft(prev => prev?.id === draft.id ? { ...prev, ...updated } : prev)
      setDraftHistory(prev => prev.map(p => p.id === draft.id ? { ...p, ...updated } : p))
    } catch (e) {
      push({ kind: 'danger', title: 'Approve failed', body: (e as Error).message })
    } finally {
      setApproving(false)
    }
  }
  // "Send for approval" pins the completed post into the approval queue
  // (status 'pending' = Awaiting approval, what the Review queue surfaces) and
  // opens the reviewer's approval page with the link copied to share. The
  // reviewer approves there; "Approve directly" is the skip-the-reviewer path.
  // This is the explicit "completed → in approval" move.
  const [sending, setSending] = useState(false)
  async function ensureReviewToken(post: Post): Promise<string> {
    if (!post.id) throw new Error('Draft has no post id.')
    ensureDraftInActiveProject(post)
    let token = post.review_token ?? null
    if (!token) {
      const { data, error } = await supabase
        .from('content_posts')
        .select('review_token')
        .eq('id', post.id)
        .eq('project_id', activeProject!.id)
        .maybeSingle()
      if (error) throw error
      token = (data as { review_token?: string | null } | null)?.review_token ?? null
      if (token) {
        setDraft(prev => prev?.id === post.id ? { ...prev, review_token: token } : prev)
        setDraftHistory(prev => prev.map(p => p.id === post.id ? { ...p, review_token: token } : p))
      }
    }
    if (!token) {
      token = hexToken()
      const { data, error } = await supabase
        .from('content_posts')
        .update({ review_token: token, review_token_revoked_at: null })
        .eq('id', post.id)
        .eq('project_id', activeProject!.id)
        .select('review_token')
        .single()
      if (error) throw error
      token = (data as { review_token?: string | null } | null)?.review_token ?? token
      setDraft(prev => prev?.id === post.id ? { ...prev, review_token: token } : prev)
      setDraftHistory(prev => prev.map(p => p.id === post.id ? { ...p, review_token: token } : p))
    }
    if (!token) throw new Error('This post does not have a review token yet.')
    return token
  }
  async function reviewUrlForDraft(post: Post): Promise<string> {
    const token = await ensureReviewToken(post)
    return `${window.location.origin}/r/${token}`
  }
  async function sendForApproval() {
    if (!draft?.id) return
    setSending(true)
    try {
      ensureDraftInActiveProject(draft)
      const url = await reviewUrlForDraft(draft)
      const { error } = await supabase.from('content_posts')
        .update({ status: 'pending' })
        .eq('id', draft.id)
        .eq('project_id', activeProject!.id)
      if (error) throw error
      setDraft(prev => prev ? { ...prev, status: 'pending' } : prev)
      try { void navigator.clipboard?.writeText(url) } catch { /* ignore */ }
      window.open(url, '_blank', 'noopener')
      push({ kind: 'success', title: 'Sent for approval', body: 'In the approval queue (Review → Pending Review). Link copied to share.' })
    } catch (e) {
      push({ kind: 'danger', title: "Couldn't send for approval", body: (e as Error).message })
    } finally {
      setSending(false)
    }
  }
  function tweakDraft() {
    setInput(`Tweak the draft: `)
    setTimeout(() => taRef.current?.focus(), 0)
  }
  function regenerateDraft() {
    setInput('Regenerate that draft. Same brief, fresh take.')
    setTimeout(() => taRef.current?.focus(), 0)
  }

  // Push the draft artifact into the right rail
  const draftIdx = draft ? draftHistory.indexOf(draft) : -1
  useRightRail(
    draft ? (
      <DraftArtifact
        draft={draft}
        approving={approving}
        sending={sending}
        onApprove={approveDraft}
        onSendForApproval={sendForApproval}
        onCopyShareLink={async () => {
          try {
            const url = await reviewUrlForDraft(draft)
            try { await navigator.clipboard?.writeText(url) } catch { /* ignore */ }
            push({ kind: 'success', title: 'Sharing link copied', body: 'Public review link copied to the clipboard.' })
          } catch (e) {
            push({ kind: 'danger', title: "Couldn't generate sharing link", body: (e as Error).message })
            throw e
          }
        }}
        onTweak={tweakDraft}
        onRegenerate={regenerateDraft}
        onBack={campaign ? () => setDraft(null) : undefined}
        versionIdx={draftIdx}
        versionTotal={draftHistory.length}
        onPrevVersion={draftIdx > 0 ? () => setDraft(draftHistory[draftIdx - 1]) : undefined}
        onNextVersion={draftIdx >= 0 && draftIdx < draftHistory.length - 1 ? () => setDraft(draftHistory[draftIdx + 1]) : undefined}
      />
    ) : campaign ? (
      <CampaignArtifact campaign={campaign} onOpenPost={p => { const post = p as unknown as Post; if (post.id && sessionId) { try { localStorage.setItem(`vera-draft:${sessionId}`, post.id) } catch { /* ignore */ } } setDraft(post) }} />
    ) : <ArtifactEmpty />,
    [draft?.id, draft?.media_url, draft?.media_metadata, draft?.review_token, draft?.status, approving, sending, campaign?.id, campaign?.posts?.length, draftIdx, draftHistory.length, user?.id, user?.email],
    // Wide, readable artifact panel — this is the working surface, not a
    // skinny sidebar. ~42vw, clamped so it stays sane on small + huge screens.
    'clamp(420px, 42vw, 660px)',
  )

  const hasThread = messages.length > 0
  const renderComposer = (placement: 'idle' | 'thread') => {
    const idle = placement === 'idle'
    return (
      <div style={{ maxWidth: idle ? 760 : 720, margin: '0 auto', width: '100%' }}>
        <div onDrop={onComposerDrop} onDragOver={onComposerDragOver} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: space[2],
          padding: idle ? `${space[4]} ${space[5]}` : `${space[3]} ${space[4]}`,
          background: color.surface,
          border: `1px solid ${idle ? 'var(--accent-line)' : color.line2}`,
          borderRadius: idle ? radius.lg : radius.lg,
          boxShadow: idle ? 'var(--shadow-modal)' : 'var(--shadow-pop)',
        }}>
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2] }}>
              {attachments.map((a, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, fontSize: t.size.micro, color: color.ink2 }}>
                  {a.kind === 'image'
                    ? <img src={a.dataUrl} alt="" style={{ width: 26, height: 26, borderRadius: radius.sm, objectFit: 'cover', display: 'block' }} />
                    : <FileText size={15} style={{ color: color.ghost }} />}
                  <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  {a.kind === 'document' && a.truncated && <span title="Truncated for this chat turn" style={{ color: color.ghost }}>trimmed</span>}
                  <button onClick={() => removeAttachment(i)} title="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.ghost, display: 'inline-flex', padding: 0 }}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Ask Vera anything..."
            disabled={!activeProject}
            style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: t.family.sans, fontSize: idle ? t.size.h4 : t.size.lg, lineHeight: 1.5, color: color.ink, minHeight: idle ? 118 : 100, maxHeight: 240, paddingTop: 2 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
            <input ref={fileRef} type="file" accept={ACCEPTED_ATTACHMENT_TYPES} multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading || !activeProject} title="Attach images or documents"
              style={{ width: 32, height: 32, borderRadius: '50%', border: `1px solid ${color.line}`, background: color.surface, color: color.ghost, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'default' : 'pointer', flexShrink: 0 }}>
              <Paperclip size={15} />
            </button>
            <div style={{ flex: 1 }} />
            {streaming ? (
              <button onClick={() => abortRef.current?.abort()} title="Stop"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: radius.pill, border: 'none', cursor: 'pointer', background: color.ink, color: '#fff', fontSize: t.size.sm, fontWeight: t.weight.medium }}>
                <Square size={11} fill="currentColor" /> Stop
              </button>
            ) : (
              <button onClick={() => send()} disabled={(!input.trim() && attachments.length === 0) || !activeProject} title="Send"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: idle ? '8px 16px' : '7px 14px', borderRadius: radius.pill, border: 'none', cursor: (input.trim() || attachments.length) ? 'pointer' : 'not-allowed', background: (input.trim() || attachments.length) ? color.accent : color.paper2, color: (input.trim() || attachments.length) ? '#fff' : color.ghost, fontSize: t.size.sm, fontWeight: t.weight.medium, boxShadow: (input.trim() || attachments.length) ? 'var(--shadow-glow)' : 'none', transition: 'background 120ms, box-shadow 120ms' }}>
                <Send size={14} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: color.paper, position: 'relative' }}>
      <button onClick={newChat} disabled={!activeProject} title="Start a new session"
        style={{ position: 'absolute', top: space[5], right: space[6], zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.surface, color: activeProject ? color.ink2 : color.ghost, boxShadow: 'var(--shadow-pop)', cursor: activeProject ? 'pointer' : 'default', fontSize: t.size.cap, fontWeight: t.weight.medium }}>
        <Plus size={14} /> New session
      </button>
      {/* thread (no header bar — SAM-clean; rail identifies "Vera", Recents
          lists past chats, the Vera rail item starts a new chat) */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: `${space[6]} 0 ${space[7]}` }}>
        {!historyLoaded ? (
          <Centered>Loading thread…</Centered>
        ) : messages.length === 0 ? (
          <Idle onRun={pr => send(pr)} observations={observations} actions={buildLaunchActions(stats)} onDismiss={dismissObservation}
            onWeeklyReviewAction={runWeeklyLearningAction}
            weeklyActionKey={weeklyActionKey}
            setup={setup} projectName={activeProject?.name ?? 'this client'}
            onOpenBrain={() => { if (activeProject?.slug) navigate(`/p/${activeProject.slug}/brain`) }}
            onOpenLearning={() => { if (activeProject?.slug) navigate(`/p/${activeProject.slug}/learning`) }}
            onOpenSkills={() => navigate('/skills?view=skills&scope=client&q=learning-proposal')}
            providerCapabilities={providerCapabilities}
            onAddKey={() => activeProject?.slug ? navigate(`/p/${activeProject.slug}/keys`) : navigate('/clients')}
            pricingCatalog={pricingCatalog}
            pricingSource={pricingSource}
            pricingRowCount={pricingRowCount}
            demandPlan={demandPlan}
            composer={renderComposer('idle')} />
        ) : (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: `0 ${space[8]}`, display: 'flex', flexDirection: 'column', gap: space[7] }}>
            {messages.map(m => <Bubble key={m.id} m={m} onPin={pinToNewChat} />)}
          </div>
        )}
      </div>

      {hasThread && (
        <div style={{ padding: `${space[5]} ${space[8]} ${space[7]}` }}>
          {renderComposer('thread')}
        </div>
      )}
    </div>
  )
}

// ─── message bubble ─────────────────────────────────────────────────
function Bubble({ m, onPin }: { m: Message; onPin?: (content: string) => void }) {
  const [copied, setCopied] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const actBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: 'none', background: 'transparent', color: color.ghost, fontSize: t.size.cap, fontWeight: t.weight.medium, cursor: 'pointer', borderRadius: radius.sm }
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: space[2] }}>
        {m.images && m.images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], justifyContent: 'flex-end', maxWidth: '78%' }}>
            {m.images.map((src, i) => (
              <img key={i} src={src} alt="" style={{ maxWidth: 160, maxHeight: 160, borderRadius: radius.md, border: `1px solid ${color.line}`, objectFit: 'cover', display: 'block' }} />
            ))}
          </div>
        )}
        {m.files && m.files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2], justifyContent: 'flex-end', maxWidth: '78%' }}>
            {m.files.map((file, i) => (
              <span key={`${file.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 10px', background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, fontSize: t.size.cap, color: color.ink2, maxWidth: 260 }}>
                <FileText size={14} style={{ color: color.ghost, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                <span style={{ color: color.ghost, flexShrink: 0 }}>{bytesHuman(file.size)}</span>
              </span>
            ))}
          </div>
        )}
        {m.content && (
          <div style={{ maxWidth: '78%', padding: `10px 15px`, background: color.paper2, borderRadius: 14, borderTopRightRadius: radius.sm, fontSize: t.size.lg, lineHeight: 1.5, color: color.ink, whiteSpace: 'pre-wrap' }}>
            {m.content}
          </div>
        )}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: space[3] }}>
      <span style={{ marginTop: 2, display: 'inline-flex', flexShrink: 0 }}><VeraAvatar size={40} /></span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: space[3] }}>
        {/* Floating, ephemeral commentary — shown only while the turn is
            working, then it vanishes so the thread keeps just the result.
            Light text, no boxes (Gemini-style). */}
        {m.pending && m.tools && m.tools.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignSelf: 'flex-start' }}>
            {m.tools.map((tl, i) => (
              <div key={`${tl.id ?? tl.tool}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: t.size.cap, color: color.ghost }}>
                {tl.status === 'running'
                  ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.accent, animation: 'vera-pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                  : <Check size={12} style={{ color: color.accent, flexShrink: 0 }} />}
                <span style={{ color: color.ink2 }}>{TOOL_LABEL[tl.tool] ?? tl.tool}</span>
                {tl.message && <span>· {tl.message}</span>}
              </div>
            ))}
          </div>
        )}
        {m.images?.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', maxWidth: 320, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
            <img src={url} alt="" style={{ width: '100%', display: 'block' }} />
          </a>
        ))}
        {m.videos?.map((url, i) => (
          <video key={i} src={url} controls autoPlay muted loop playsInline style={{ display: 'block', maxWidth: 320, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }} />
        ))}
        {m.videoPending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, padding: '12px 14px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, color: color.ink2, fontSize: t.size.sm }}>
            <Clapperboard size={15} style={{ color: color.accent }} />
            <span>Rendering video… this runs in the background (~1–2 min) and will appear here automatically.</span>
            <span style={{ marginLeft: 'auto', width: 9, height: 9, borderRadius: '50%', background: color.accent, animation: 'vera-pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
          </div>
        )}
        {m.carouselPending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 340, padding: '12px 14px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, color: color.ink2, fontSize: t.size.sm }}>
            <ImagePlus size={15} style={{ color: color.accent }} />
            <span>Rendering carousel… {m.carouselPending.done}/{m.carouselPending.total} frames. They land on the draft card as each finishes.</span>
            <span style={{ marginLeft: 'auto', width: 9, height: 9, borderRadius: '50%', background: color.accent, animation: 'vera-pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
          </div>
        )}
        {(m.content || m.pending) && (
          m.content
            ? <Markdown content={m.content} />
            : <div style={{ fontSize: t.size.lg, lineHeight: 1.62, color: color.ink }}><Dots /></div>
        )}
        {/* result actions — Claude-style, under a completed answer */}
        {m.content && !m.pending && (
          <div style={{ display: 'flex', gap: 2, marginTop: -2 }}>
            <button title="Copy as plain text, keeps bold, drops Markdown symbols" style={actBtn}
              onClick={() => { try { void navigator.clipboard?.writeText(markdownToText(m.content)) } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
            {onPin && (
              <button title="Start a new conversation seeded with this result" style={actBtn}
                onClick={() => onPin(m.content)}>
                <Pin size={13} /> Pin to new chat
              </button>
            )}
            <button title="Download as Markdown (text + any video links)" style={actBtn}
              onClick={() => downloadMarkdown(m.content, m.videos ?? [])}>
              <FileText size={13} /> .md
            </button>
            <button title="Download as PDF: selectable text, images embedded, videos as clickable links" style={actBtn} disabled={pdfBusy}
              onClick={async () => { setPdfBusy(true); try { const { downloadPdf } = await import('../lib/exportPdf'); await downloadPdf(m.content, m.images ?? [], m.videos ?? []) } catch { /* ignore */ } finally { setPdfBusy(false) } }}>
              <FileText size={13} /> {pdfBusy ? 'PDF…' : '.pdf'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── right rail: a FULL preview of the post, as it will appear once live ──
// A realistic LinkedIn-style card (author, body, media, reaction bar) so the
// operator sees the actual post — plus the approve / tweak / regenerate bar.
function DraftArtifact({ draft, approving, sending, onApprove, onSendForApproval, onCopyShareLink, onTweak, onRegenerate, onBack, versionIdx, versionTotal, onPrevVersion, onNextVersion }: {
  draft: Post; approving: boolean; sending: boolean; onApprove: () => void; onSendForApproval: () => void; onCopyShareLink: () => Promise<void>; onTweak: () => void; onRegenerate: () => void; onBack?: () => void
  versionIdx: number; versionTotal: number; onPrevVersion?: () => void; onNextVersion?: () => void
}) {
  const isApproved = (draft.status ?? '').toLowerCase() === 'approved'
  const channel = (draft.channel ?? 'LinkedIn') as string
  // "Generate sharing link" — just copy the public, no-login review URL. No
  // status change, no opening the page; purely "give me the link to share".
  const [linkCopied, setLinkCopied] = useState(false)
  const copyShareLink = async () => {
    if (!draft.id) return
    try {
      await onCopyShareLink()
      setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800)
    } catch { /* parent toast handles the send path; copy failure can be retried */ }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar — label + the decision actions, always in reach. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], padding: `${space[5]} ${space[5]} ${space[3]}`, flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} title="Back to the campaign calendar" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: t.size.cap, fontWeight: t.weight.medium, color: color.ink2, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer' }}>
            ← Calendar
          </button>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: isApproved ? color.success : color.accent }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isApproved ? color.success : color.accent }} />
          {isApproved ? 'Approved' : 'Awaiting approval'} · {channel}
        </span>
        {versionTotal > 1 && versionIdx >= 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: space[2] }}>
            <button onClick={onPrevVersion} disabled={!onPrevVersion} title="Previous version"
              style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: color.surface, color: onPrevVersion ? color.ink2 : color.faint, cursor: onPrevVersion ? 'pointer' : 'default', fontSize: 14, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: t.size.micro, color: color.ghost, fontWeight: t.weight.medium, minWidth: 32, textAlign: 'center' }} title="Draft version, flip back through edits">v{versionIdx + 1}/{versionTotal}</span>
            <button onClick={onNextVersion} disabled={!onNextVersion} title="Next version"
              style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: color.surface, color: onNextVersion ? color.ink2 : color.faint, cursor: onNextVersion ? 'pointer' : 'default', fontSize: 14, lineHeight: 1 }}>›</button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!isApproved && draft.id && (
          <button onClick={onSendForApproval} disabled={sending} title="Put this in the approval queue and open the reviewer's approval page (link copied to share)" style={{ ...btn(color.accent, '#fff', sending), boxShadow: sending ? 'none' : 'var(--shadow-glow)' }}>
            {sending ? '…' : <><Send size={13} strokeWidth={2.25} /> Send for approval</>}
          </button>
        )}
      </div>

      {/* The post preview card. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${space[5]} ${space[5]}` }}>
        <PlatformPostPreview post={draft} density="standard" autoplayMedia />

        {/* secondary actions under the preview */}
        <div style={{ display: 'flex', gap: space[2], marginTop: space[4] }}>
          <button onClick={onTweak} style={{ ...btn(color.paper2, color.ink, false), flex: 1, justifyContent: 'center', border: `1px solid ${color.line}` }}><Pencil size={12} /> Tweak</button>
          <button onClick={onRegenerate} style={{ ...btn(color.paper2, color.ink, false), flex: 1, justifyContent: 'center', border: `1px solid ${color.line}` }}><RefreshCw size={12} /> Regenerate</button>
        </div>
        {draft.id && (
          <button onClick={copyShareLink} title="Copy a public, no-login link to this post for sharing"
            style={{ ...btn(color.paper2, linkCopied ? color.success : color.ink, false), width: '100%', justifyContent: 'center', border: `1px solid ${linkCopied ? color.success : color.line}`, marginTop: space[2] }}>
            {linkCopied ? <><Check size={12} /> Sharing link copied</> : <><Link2 size={12} /> Generate sharing link</>}
          </button>
        )}
        {!isApproved && (
          <button onClick={onApprove} disabled={approving} title="Skip the reviewer and approve this yourself"
            style={{ ...btn(color.paper2, color.ink2, approving), width: '100%', justifyContent: 'center', border: `1px solid ${color.line}`, marginTop: space[2] }}>
            {approving ? '…' : <><Check size={12} /> Approve directly</>}
          </button>
        )}
      </div>
    </div>
  )
}

function btn(bg: string, fg: string, busy: boolean): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: t.size.cap, fontWeight: t.weight.medium, borderRadius: radius.sm, border: 'none', cursor: busy ? 'default' : 'pointer', background: bg, color: fg, opacity: busy ? 0.6 : 1 }
}

// The campaign calendar — the artifact for a plan_campaign batch. A header
// (name · theme · count) over a dated list of post cards; click one to open it
// in the draft preview for Approve / Tweak / Regenerate.
function CampaignArtifact({ campaign, onOpenPost }: {
  campaign: CampaignData; onOpenPost: (p: CampaignPost) => void
}) {
  const fmt = (iso: string | null) => {
    if (!iso) return { dow: '', md: '' }
    const d = new Date(iso)
    if (isNaN(d.getTime())) return { dow: '', md: '' }
    return {
      dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
      md: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  }
  const posts = [...campaign.posts].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  const channelLabel = campaign.channels?.length ? campaign.channels.join(', ') : campaign.channel
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: `${space[5]} ${space[5]} ${space[3]}`, flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent }}>
          <CalendarDays size={13} /> Campaign · {channelLabel}
        </div>
        <h2 style={{ fontSize: t.size.lg, fontWeight: t.weight.semibold, color: color.ink, margin: `${space[2]} 0 2px`, lineHeight: 1.25 }}>{campaign.name}</h2>
        {campaign.theme && <p style={{ fontSize: t.size.cap, color: color.ink2, margin: 0, lineHeight: 1.45 }}>{campaign.theme}</p>}
        <p style={{ fontSize: t.size.micro, color: color.ghost, margin: `${space[2]} 0 0` }}>{posts.length} posts · {campaign.cadence} · all pending review</p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${space[5]} ${space[5]}`, display: 'flex', flexDirection: 'column', gap: space[2] }}>
        {posts.map((p, i) => {
          const d = fmt(p.scheduled_at)
          return (
            <button key={p.id ?? i} onClick={() => onOpenPost(p)}
              style={{ textAlign: 'left', display: 'flex', gap: space[3], padding: space[3], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.md, cursor: 'pointer', width: '100%' }}>
              <div style={{ flexShrink: 0, width: 46, textAlign: 'center' }}>
                <div style={{ fontSize: t.size.micro, fontWeight: t.weight.semibold, color: color.accent, lineHeight: 1.2 }}>{d.dow}</div>
                <div style={{ fontSize: t.size.cap, color: color.ink, fontWeight: t.weight.medium }}>{d.md}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: 2 }}>
                  <div style={{ fontSize: t.size.cap, fontWeight: t.weight.semibold, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title || `Post ${i + 1}`}</div>
                  <span style={{ flexShrink: 0, fontSize: '10px', lineHeight: 1, fontWeight: t.weight.semibold, color: color.accent, background: color.accentSoft, border: `1px solid ${color.accentLine}`, borderRadius: radius.pill, padding: '3px 6px' }}>{p.channel}</span>
                </div>
                <div style={{ fontSize: t.size.micro, color: color.ink2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.copy}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ArtifactEmpty() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: space[7], gap: space[3] }}>
      <Sparkles size={20} strokeWidth={1.5} style={{ color: color.faint }} />
      <p style={{ fontSize: t.size.cap, color: color.ghost, lineHeight: 1.5, maxWidth: '26ch' }}>
        Brief a post in the thread. A draft with copy, image, or video opens here, ready to approve.
      </p>
    </div>
  )
}

// ─── launcher quick actions (SAM-style) — dynamic, count-aware, send-on-click ──
// Mirrors SAM's welcome actions: each is a complete prompt that RUNS on click
// (not a fill-the-box starter), and descriptions carry live workspace counts.
type LaunchAction = { icon: React.ElementType; title: string; sub: string; prompt: string; action?: 'brain' }
// SAM-clean: a tight, fixed set of six core content jobs. State-aware subtexts,
// no overflowing grid. Less-common moves (variations, repurpose, hooks-to-post,
// add-knowledge) are reachable by just typing in the composer.
function buildLaunchActions(stats: { pending: number; campaigns: number }): LaunchAction[] {
  const a: LaunchAction[] = []
  a.push(stats.campaigns > 0
    ? { icon: Megaphone, title: 'Improve Demand Campaign', sub: `${stats.campaigns} active campaign${stats.campaigns === 1 ? '' : 's'}`, prompt: "Review this client's active campaigns and suggest the highest-impact improvement to ICP, pain point, offer, CTA, cadence, and channel mix. Prioritize top-of-funnel demand creation." }
    : { icon: Megaphone, title: 'Plan Demand Campaign', sub: 'B2B TOF series', prompt: 'Plan a B2B top-of-funnel demand campaign for this client. Define ICP, pain point, offer, funnel goal, channels, success metric, and draft the first content batch.' })
  a.push({ icon: PenLine, title: 'LinkedIn Demand Post', sub: 'ICP, pain, CTA', prompt: 'Draft a LinkedIn post that creates B2B top-of-funnel demand. Include ICP, pain point, market insight, proof angle, soft CTA, and the SAM follow-up signal to watch for.' })
  a.push({ icon: ImagePlus, title: 'Visual Asset', sub: 'Carousel or image', prompt: 'Create a platform-native visual asset for a B2B demand post. Recommend carousel, infographic, quote card, or custom image, then build the prompt and ask before rendering.' })
  a.push({ icon: Clapperboard, title: 'Video Storyboard', sub: 'Scenes and cost', prompt: 'Create a storyboard for a short B2B demand video. Include scene beats, timing, camera notes, caption, model recommendation, and estimated prototype cost. Do not render until I explicitly approve the paid generation.' })
  a.push({ icon: Zap, title: 'Repurpose Across Channels', sub: 'YT, Medium, Quora, Reddit, X', prompt: 'Turn one core B2B demand idea into platform-native versions for LinkedIn, YouTube, Medium, Quora, Reddit, Instagram, Facebook, blog, email, and X where relevant. Keep each version native to the channel and identify which ones should be manual, connected, or read-only.' })
  a.push(stats.campaigns > 0
    ? { icon: Lightbulb, title: 'SAM Handoff Angles', sub: 'Comments, shares, traffic', prompt: 'Find content topics and engagement signals that should hand off to SAM. Turn comments, shares, clicks, and objections into sales research angles.' }
    : { icon: Lightbulb, title: 'Demand Angles', sub: 'Fresh market hooks', prompt: "Give me 5 B2B demand angles grounded in this client's offer, ICP, buyer pains, proof points, and current market conversations." })
  return a.slice(0, 6)
}

type ModelRouteRecommendation = {
  icon: React.ElementType
  label: string
  status: string
  cost: string
  estimate: SpendEstimate
  body: string
  tone: 'success' | 'warn' | 'danger' | 'info'
}

function modelRouteRecommendations(capabilities: ProviderCapabilities, pricingCatalog?: ModelPricingGuide[]): ModelRouteRecommendation[] {
  return buildModelRecommendations({
    textReady: capabilities.textReady,
    imageReady: capabilities.imageReady,
    videoReady: capabilities.videoReady,
    hasOpenRouter: capabilities.hasOpenRouter,
    hasAnthropic: capabilities.hasAnthropic,
    hasOpenAI: capabilities.hasOpenAI,
    hasFal: capabilities.hasFal,
    imagesEnabled: capabilities.imagesEnabled,
    standardVideoEnabled: capabilities.standardVideoEnabled,
    premiumMediaEnabled: capabilities.premiumMediaEnabled,
    defaultTextModel: capabilities.defaultTextModel,
    defaultImageModel: capabilities.defaultImageModel,
    defaultVideoModel: capabilities.defaultVideoModel,
    defaultImageVideoModel: capabilities.defaultImageVideoModel,
    monthlyBudgetUsd: capabilities.monthlyBudgetUsd,
  }, pricingCatalog).map(item => ({
    icon: item.role === 'Text' ? KeyRound : item.role === 'Image' ? ImagePlus : Clapperboard,
    label: item.role,
    status: item.status,
    cost: item.provider,
    estimate: item.estimate,
    body: `${item.reason} ${item.escalation}`,
    tone: item.tone,
  }))
}

function routeToneStyle(tone: ModelRouteRecommendation['tone']) {
  if (tone === 'success') return { border: color.success, bg: color.surface, fg: color.success }
  if (tone === 'warn') return { border: color.warn, bg: color.surface, fg: color.warn }
  if (tone === 'danger') return { border: color.danger, bg: color.surface, fg: color.danger }
  return { border: color.line, bg: color.surface, fg: color.info }
}

function ProviderCapabilityNotice({ capabilities, onAddKey }: { capabilities: ProviderCapabilities; onAddKey?: () => void }) {
  const needsText = capabilities.needsTextKey
  const imageLocked = !capabilities.imageReady
  const videoLocked = !capabilities.videoReady
  const title = needsText ? 'Provider key needed' : imageLocked ? 'Media rendering locked' : 'Video rendering locked'
  const notes: string[] = []
  if (needsText) notes.push('Add OpenRouter or Anthropic before Vera can run client text generation in this space.')
  if (imageLocked) {
    notes.push(capabilities.imagesEnabled
      ? 'Image and carousel rendering needs a client OpenRouter, OpenAI, or FAL key, or an operator platform image entitlement inside an approved InnovareAI media project.'
      : 'Image and carousel rendering is disabled in this client AI policy.')
  }
  if (videoLocked) {
    notes.push(capabilities.hasFal
      ? 'Video rendering is disabled in this client AI policy.'
      : 'Video rendering requires a client-owned FAL key. Platform video entitlements only apply to approved platform media projects.')
  }
  const textBody = notes.join(' ')
  const rows = [
    { icon: KeyRound, label: 'Text', ready: capabilities.textReady },
    { icon: ImagePlus, label: 'Images', ready: capabilities.imageReady },
    { icon: Clapperboard, label: 'Video', ready: capabilities.videoReady },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 680, marginBottom: space[5], padding: space[5], background: 'var(--accent-tint)', border: `1px solid var(--accent-line)`, borderRadius: radius.lg, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink, marginBottom: 5 }}>
            <Lock size={15} />
            {title}
          </div>
          <p style={{ fontSize: t.size.cap, color: color.ink2, lineHeight: 1.6, margin: 0 }}>
            {textBody} If the operator asks for locked media now, Vera will create a storyboard, production brief, or reusable prompt instead of rendering a paid asset.
          </p>
        </div>
        {onAddKey && (
          <button onClick={onAddKey} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: radius.pill, border: 'none', background: color.accent, color: '#fff', fontSize: t.size.cap, fontWeight: t.weight.semibold, cursor: 'pointer' }}>
            <KeyRound size={13} />
            Provider keys
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: space[4] }}>
        {rows.map(row => {
          const Icon = row.icon
          return (
            <span key={row.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: radius.pill, border: `1px solid ${row.ready ? color.success : color.accentLine}`, background: color.surface, color: row.ready ? color.success : color.ink2, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
              <Icon size={12} />
              {row.label}: {row.ready ? 'ready' : 'locked'}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function pricingCatalogBadge(source: ModelPricingCatalogSource = 'loading', rowCount = 0) {
  if (source === 'catalog') return { label: `Live catalog, ${rowCount} rows`, color: color.success, border: color.success }
  if (source === 'fallback') return { label: 'Fallback guide', color: color.warn, border: color.warn }
  return { label: 'Loading guide', color: color.ghost, border: color.line }
}

function ModelRoutingPanel({ capabilities, onAddKey, pricingCatalog, pricingSource, pricingRowCount }: {
  capabilities: ProviderCapabilities
  onAddKey?: () => void
  pricingCatalog?: ModelPricingGuide[]
  pricingSource?: ModelPricingCatalogSource
  pricingRowCount?: number
}) {
  const routes = modelRouteRecommendations(capabilities, pricingCatalog)
  const reviewedOn = latestPricingReviewDate(pricingCatalog)
  const pricingStatus = pricingCatalogBadge(pricingSource, pricingRowCount)
  const budget = capabilities.monthlyBudgetUsd
    ? `Monthly cap: $${capabilities.monthlyBudgetUsd.toFixed(0)}`
    : 'No monthly cap set'

  return (
    <section style={{ width: '100%', maxWidth: 760, marginTop: space[4], padding: space[4], background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], marginBottom: space[3] }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: color.accent, fontSize: t.size.micro, fontWeight: t.weight.semibold, textTransform: 'uppercase', letterSpacing: 0 }}>
            <KeyRound size={12} />
            Model routing
          </div>
          <div style={{ color: color.ghost, fontSize: t.size.cap, lineHeight: 1.45, marginTop: 3 }}>
            Client keys first. Standard models by default. Premium and platform spend need explicit approval.
            <br />
            Pricing guide reviewed {reviewedOn}. {pricingStatus.label}. Estimates are planning guides.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ padding: '4px 8px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${pricingStatus.border}`, color: pricingStatus.color, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>
            {pricingStatus.label}
          </span>
          <span style={{ padding: '4px 8px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.medium }}>
            {budget}
          </span>
          {onAddKey && (
            <button onClick={onAddKey} style={{ padding: '6px 10px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.paper2, color: color.ink2, fontSize: t.size.cap, fontWeight: t.weight.semibold, cursor: 'pointer' }}>
              Provider keys
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: space[2] }}>
        {routes.map(route => {
          const Icon = route.icon
          const tone = routeToneStyle(route.tone)
          return (
            <div key={route.label} style={{ padding: space[3], borderRadius: radius.md, background: tone.bg, border: `1px solid ${tone.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <Icon size={13} style={{ color: tone.fg, flexShrink: 0 }} />
                <span style={{ color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>{route.label}</span>
                <span style={{ marginLeft: 'auto', color: tone.fg, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{route.status}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.medium, marginBottom: 6 }}>
                {route.cost}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
                <span style={{ color: color.ink, fontSize: t.size.micro, fontWeight: t.weight.semibold }}>{route.estimate.label}</span>
                <span style={{ color: color.ghost, fontSize: t.size.micro, lineHeight: 1.35 }}>{route.estimate.detail}</span>
              </div>
              <div style={{ color: color.ink2, fontSize: t.size.micro, lineHeight: 1.45 }}>
                {route.body}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Idle({ onRun, observations, actions, onDismiss, onWeeklyReviewAction, weeklyActionKey, setup, projectName, onOpenBrain, onOpenLearning, onOpenSkills, providerCapabilities, onAddKey, pricingCatalog, pricingSource, pricingRowCount, demandPlan, composer }: {
  onRun: (prompt: string) => void
  observations: ObservationNotice[]
  actions: LaunchAction[]
  onDismiss: (o: { title: string }) => void
  onWeeklyReviewAction: (o: ObservationNotice, action: 'skills' | 'handoff' | 'complete') => void
  weeklyActionKey: string | null
  setup: { business: boolean; audience: boolean; voice: boolean; categories: boolean; knowledge: boolean } | null
  projectName: string
  onOpenBrain: () => void
  onOpenLearning: () => void
  onOpenSkills: () => void
  providerCapabilities: ProviderCapabilities
  onAddKey?: () => void
  pricingCatalog?: ModelPricingGuide[]
  pricingSource?: ModelPricingCatalogSource
  pricingRowCount?: number
  demandPlan: DemandPlanSnapshot
  composer: ReactNode
}) {
  const setupDone = !!setup && setup.business && setup.audience && setup.voice && setup.categories && setup.knowledge
  // Persona-first, SAM-clean: when the brain is thin, the FIRST card is "set up
  // the client" (routes to Brain). No separate checklist block.
  const setupCard: LaunchAction = { icon: Sparkles, title: `Set up ${projectName}`, sub: 'URL, ICP, offer, proof', prompt: '', action: 'brain' }
  const grid = (setup && !setupDone ? [setupCard, ...actions] : actions).slice(0, 6)
  const weeklyObservations = observations.filter(o => o.kind === 'weekly_learning')
  const otherObservations = observations.filter(o => o.kind !== 'weekly_learning')
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: space[8] }}>
      <span style={{ marginBottom: space[5], display: 'inline-flex' }}><VeraAvatar size={56} hero /></span>
      <h1 style={{ fontSize: t.size.h2, fontWeight: t.weight.semibold, color: color.ink, marginBottom: space[2], textAlign: 'center' }}>
        Create B2B demand for {projectName}
      </h1>
      <p style={{ fontSize: t.size.body, color: color.ghost, marginBottom: space[5], textAlign: 'center', maxWidth: '44ch' }}>
        Turn client knowledge into campaigns, posts, visuals, storyboards, and demand signals that SAM can use.
      </p>

      {providerCapabilities.loaded && (providerCapabilities.needsTextKey || !providerCapabilities.imageReady || !providerCapabilities.videoReady) && (
        <ProviderCapabilityNotice capabilities={providerCapabilities} onAddKey={onAddKey} />
      )}

      {composer}

      {providerCapabilities.loaded && (
        <ModelRoutingPanel capabilities={providerCapabilities} onAddKey={onAddKey} pricingCatalog={pricingCatalog} pricingSource={pricingSource} pricingRowCount={pricingRowCount} />
      )}

      <DemandPlanPanel plan={demandPlan} projectName={projectName} onRun={onRun} onOpenBrain={onOpenBrain} />

      {/* "VERA wants to" — proactive observations (moved from the old Home). */}
      {observations.length > 0 && (
        <div style={{ width: '100%', maxWidth: 760, marginTop: space[6], marginBottom: space[5] }}>
          <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: t.weight.semibold, color: color.accent, marginBottom: space[3] }}>VERA wants to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
            {weeklyObservations.map(o => (
              <WeeklyLearningNoticeCard
                key={o.id}
                observation={o}
                projectName={projectName}
                onRun={onRun}
                onOpenLearning={onOpenLearning}
                onOpenSkills={onOpenSkills}
                onReviewAction={onWeeklyReviewAction}
                busyActionKey={weeklyActionKey}
                onDismiss={() => onDismiss(o)}
              />
            ))}
            {otherObservations.map(o => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'stretch', background: 'var(--accent-tint)', border: `1px solid var(--accent-line)`, borderRadius: radius.md, overflow: 'hidden' }}>
                <button onClick={() => onRun(o.proposed_action || o.title)} title="Ask VERA to handle this"
                  style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: space[3], textAlign: 'left', padding: `${space[3]} ${space[4]}`, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: t.family.sans, color: color.ink, fontSize: t.size.sm }}>
                  <Sparkles size={15} style={{ color: color.accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{o.title}</span>
                  <ArrowUp size={13} style={{ color: color.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
                </button>
                <button onClick={() => onDismiss(o)} title="Dismiss"
                  style={{ flexShrink: 0, padding: `0 ${space[3]}`, background: 'transparent', border: 'none', borderLeft: `1px solid var(--accent-line)`, cursor: 'pointer', color: color.ghost, display: 'flex', alignItems: 'center' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: space[3], width: '100%', maxWidth: 760, marginTop: observations.length > 0 ? 0 : space[5] }}>
        {grid.map(c => {
          const Icn = c.icon
          return (
            <button key={c.title} onClick={() => c.action === 'brain' ? onOpenBrain() : onRun(c.prompt)}
              style={{ flex: '1 1 220px', maxWidth: 248, minHeight: 50, display: 'inline-flex', alignItems: 'center', gap: space[3], textAlign: 'left', padding: `${space[3]} ${space[4]}`, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.pill, cursor: 'pointer', fontFamily: t.family.sans, transition: 'border-color 120ms, box-shadow 120ms' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.boxShadow = 'var(--shadow-pop)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none' }}>
              <span style={{ width: 32, height: 32, borderRadius: radius.pill, background: 'var(--accent-tint)', color: color.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icn size={17} strokeWidth={1.9} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: t.size.sm, fontWeight: t.weight.semibold, color: color.ink }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: t.size.cap, color: color.ghost, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeeklyLearningNoticeCard({
  observation,
  projectName,
  onRun,
  onOpenLearning,
  onOpenSkills,
  onReviewAction,
  busyActionKey,
  onDismiss,
}: {
  observation: ObservationNotice
  projectName: string
  onRun: (prompt: string) => void
  onOpenLearning: () => void
  onOpenSkills: () => void
  onReviewAction: (o: ObservationNotice, action: 'skills' | 'handoff' | 'complete') => void
  busyActionKey: string | null
  onDismiss: () => void
}) {
  const payload = parseWeeklyLearningPayload(observation.action_payload)
  const current = payload.current ?? {}
  const previousSignals = payload.previous?.demandSignals ?? 0
  const currentSignals = current.demandSignals ?? 0
  const delta = currentSignals - previousSignals
  const topAssets = (payload.top_assets ?? []).slice(0, 2)
  const skills = payload.skill_proposals ?? []
  const handoffs = payload.sam_handoff_candidates ?? []
  const busy = busyActionKey?.startsWith(`${observation.id}:`) ?? false
  const busyFor = (action: 'skills' | 'handoff' | 'complete') => busyActionKey === `${observation.id}:${action}`
  const actionStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: radius.pill,
    border: `1px solid var(--accent-line)`,
    background: color.surface,
    color: color.ink,
    fontSize: t.size.cap,
    fontWeight: t.weight.medium,
    cursor: 'pointer',
  }

  return (
    <article style={{ background: color.surface, border: `1px solid var(--accent-line)`, borderRadius: radius.lg, overflow: 'hidden', boxShadow: 'var(--shadow-pop)' }}>
      <div style={{ padding: space[4], borderBottom: `1px solid ${color.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginBottom: space[2] }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: color.accent, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>
            <TrendingUp size={13} />
            Weekly Learning
          </span>
          {payload.week_key && <span style={{ color: color.ghost, fontSize: t.size.micro }}>{payload.week_key}</span>}
        </div>
        <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.35 }}>{observation.title}</div>
        {observation.detail && (
          <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: 1.45 }}>{observation.detail}</p>
        )}
      </div>

      <div style={{ padding: space[4], display: 'grid', gap: space[3] }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))', gap: space[2] }}>
          <WeeklyLearningStat icon={BarChart3} label="Measured" value={current.measuredPosts ?? 0} detail="assets" />
          <WeeklyLearningStat icon={Sparkles} label="Signals" value={currentSignals} detail={formatLearningDelta(delta)} />
          <WeeklyLearningStat icon={Lightbulb} label="Buyer intent" value={current.buyerIntent ?? 0} detail={`${current.buyerQuestions ?? 0} q, ${current.meetingRequests ?? 0} mtg`} />
          <WeeklyLearningStat icon={Zap} label="Skills" value={skills.length} detail="proposals" />
        </div>

        {topAssets.length > 0 && (
          <div style={{ display: 'grid', gap: 5 }}>
            {topAssets.map(asset => (
              <div key={asset.post_id ?? asset.title ?? 'asset'} style={{ color: color.ghost, fontSize: t.size.micro, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b style={{ color: color.ink2 }}>{asset.title ?? 'Untitled asset'}</b> · {asset.channel ?? 'Unassigned'} · score {asset.score ?? 0}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          <button onClick={onOpenLearning} style={{ ...actionStyle, background: color.accent, color: '#fff', borderColor: color.accent }}>
            <TrendingUp size={13} /> Review Learning
          </button>
          <button onClick={onOpenSkills} style={actionStyle}>
            <Zap size={13} /> Review skills
          </button>
          <button onClick={() => onReviewAction(observation, 'skills')} disabled={busy || skills.length === 0}
            style={{ ...actionStyle, opacity: busy || skills.length === 0 ? 0.55 : 1, cursor: busy || skills.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Check size={13} /> {busyFor('skills') ? 'Enabling...' : 'Enable proposals'}
          </button>
          <button onClick={() => onRun(buildWeeklyNextBriefPrompt(projectName, payload, observation.detail))} style={actionStyle}>
            <Send size={13} /> Brief next move
          </button>
          <button onClick={() => onReviewAction(observation, 'handoff')} disabled={busy || handoffs.length === 0}
            style={{ ...actionStyle, opacity: busy || handoffs.length === 0 ? 0.55 : 1, cursor: busy || handoffs.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Sparkles size={13} /> {busyFor('handoff') ? 'Queuing...' : 'Queue SAM'}
          </button>
          <button onClick={() => onRun(buildWeeklySamPrompt(projectName, payload, observation.detail))} disabled={handoffs.length === 0}
            style={{ ...actionStyle, opacity: handoffs.length === 0 ? 0.55 : 1, cursor: handoffs.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Send size={13} /> Brief SAM
          </button>
          <button onClick={() => onReviewAction(observation, 'complete')} disabled={busy}
            style={{ ...actionStyle, opacity: busy ? 0.55 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
            <Check size={13} /> {busyFor('complete') ? 'Saving...' : 'Done'}
          </button>
          <button onClick={onDismiss} title="Dismiss" style={{ ...actionStyle, color: color.ghost, borderColor: color.line }}>
            <X size={13} /> Dismiss
          </button>
        </div>
      </div>
    </article>
  )
}

function WeeklyLearningStat({ icon: Icon, label, value, detail }: { icon: typeof BarChart3; label: string; value: number; detail: string }) {
  return (
    <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.paper2, padding: space[3] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ color: color.ghost, fontSize: t.size.micro }}>{label}</span>
        <Icon size={12} style={{ color: color.accent }} />
      </div>
      <div style={{ marginTop: 5, color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 2, color: color.ghost, fontSize: t.size.micro }}>{detail}</div>
    </div>
  )
}

function parseWeeklyLearningPayload(value: Record<string, unknown> | null): WeeklyLearningPayload {
  if (!value || typeof value !== 'object') return {}
  return value as WeeklyLearningPayload
}

function formatLearningDelta(value: number) {
  if (value > 0) return `+${value} vs last week`
  if (value < 0) return `${value} vs last week`
  return 'flat vs last week'
}

function buildWeeklyNextBriefPrompt(projectName: string, payload: WeeklyLearningPayload, detail: string | null) {
  const topAssets = (payload.top_assets ?? [])
    .slice(0, 3)
    .map(asset => `- ${asset.title ?? 'Untitled'} (${asset.channel ?? 'unassigned'}, score ${asset.score ?? 0}): ${asset.evidence ?? 'measured signal'}`)
    .join('\n')
  const skills = (payload.skill_proposals ?? [])
    .slice(0, 5)
    .map(skill => `- ${skill.name ?? 'Learning proposal'} (${skill.confidence ?? 'medium'})`)
    .join('\n')
  return [
    `Use the weekly VERA learning review to brief the next demand move for ${projectName}.`,
    ``,
    detail ? `Weekly summary: ${detail}` : '',
    payload.week_key ? `Week: ${payload.week_key}` : '',
    ``,
    topAssets ? `Top assets:\n${topAssets}` : '',
    skills ? `Pending learning skill proposals:\n${skills}` : '',
    ``,
    `Return:`,
    `1. what changed`,
    `2. the next content brief`,
    `3. the platform mix`,
    `4. the approval route`,
    `5. what VERA should measure next`,
  ].filter(Boolean).join('\n')
}

function buildWeeklySamPrompt(projectName: string, payload: WeeklyLearningPayload, detail: string | null) {
  const handoffs = (payload.sam_handoff_candidates ?? [])
    .slice(0, 6)
    .map(item => `- ${item.title ?? 'Untitled'} (${item.channel ?? 'unassigned'}, score ${item.score ?? 0}): ${(item.triggers ?? []).join(', ')}`)
    .join('\n')
  return [
    `Create SAM handoff actions from the weekly VERA learning review for ${projectName}.`,
    ``,
    detail ? `Weekly summary: ${detail}` : '',
    payload.week_key ? `Week: ${payload.week_key}` : '',
    ``,
    handoffs ? `Handoff candidates:\n${handoffs}` : 'No handoff candidates are listed yet. Explain what signal is missing before SAM should act.',
    ``,
    `Return:`,
    `1. the best handoff candidate`,
    `2. likely buyer pain or intent`,
    `3. accounts or people SAM should research`,
    `4. outreach angle and objection to prepare for`,
    `5. the next VERA content asset to create more of this signal`,
  ].filter(Boolean).join('\n')
}

function DemandPlanPanel({ plan, projectName, onRun, onOpenBrain }: {
  plan: DemandPlanSnapshot
  projectName: string
  onRun: (prompt: string) => void
  onOpenBrain: () => void
}) {
  const ready = plan.completeness >= 70
  const actionStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 11px',
    borderRadius: radius.pill,
    border: `1px solid ${color.line}`,
    background: color.surface,
    color: color.ink,
    fontSize: t.size.cap,
    fontWeight: t.weight.medium,
    cursor: 'pointer',
  }
  const planCampaignPrompt = `Use the saved Demand Brain and operating model for ${projectName} to plan the next B2B top-of-funnel demand campaign. Include ICP, pain, offer, conversion path, approval model, channel roles, content formats, success signals, SAM handoff rules, and the first content batch.`
  const channelMatrixPrompt = demandChannelMatrixPrompt(projectName)
  const handoffPrompt = `Create a SAM handoff plan for ${projectName}. Define which comments, shares, clicks, objections, questions, accounts, and traffic signals should become sales research or follow-up, and how VERA should label them.`
  return (
    <section style={{ width: '100%', maxWidth: 760, marginTop: space[5], padding: space[5], background: color.surface, border: `1px solid ${ready ? 'var(--accent-line)' : color.line}`, borderRadius: radius.lg, textAlign: 'left', boxShadow: ready ? 'var(--shadow-pop)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[4], justifyContent: 'space-between', marginBottom: space[4] }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], color: color.accent, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>
            <Target size={13} />
            Demand plan
          </div>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, marginTop: space[2], lineHeight: 1.4 }}>{plan.objective}</div>
          <div style={{ color: color.ghost, fontSize: t.size.cap, lineHeight: 1.5, marginTop: 3 }}>{plan.conversionPath}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space[3] }}>
            <PlanPill tone={ready ? 'accent' : 'neutral'}>{ready ? 'Client model active' : 'Demand baseline active'}</PlanPill>
            <PlanPill>{plan.sourceCount}/{plan.sourceTotal} sources connected</PlanPill>
            <PlanPill>Sellable workspace model</PlanPill>
          </div>
        </div>
        <button onClick={onOpenBrain} title="Open Demand Brain" style={{ flexShrink: 0, padding: '6px 10px', borderRadius: radius.pill, border: `1px solid ${ready ? 'var(--accent-line)' : color.line}`, background: ready ? 'var(--accent-tint)' : color.paper2, color: ready ? color.accent : color.ink2, fontSize: t.size.cap, fontWeight: t.weight.semibold, cursor: 'pointer' }}>
          {plan.completeness}% ready
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: space[3], marginBottom: space[4] }}>
        <PlanCluster icon={Network} label="Channels" items={plan.channels.length ? plan.channels : ['Add channels in Brain']} max={8} />
        <PlanCluster icon={PenLine} label="Speakers" items={plan.speakers} />
        <PlanCluster icon={Sparkles} label="Tone by medium" items={plan.tone} />
        <PlanCluster icon={FileText} label="Formats" items={plan.formats} />
        <PlanCluster icon={Share2} label="Signals" items={splitList(plan.signals, 4)} />
        <PlanCluster icon={Check} label="Approvals" items={plan.approvals} />
        <PlanCluster icon={RefreshCw} label="Learning" items={plan.learning} />
      </div>

      {plan.missing.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginBottom: space[4] }}>
          <span style={{ color: color.ghost, fontSize: t.size.cap }}>Missing:</span>
          {plan.missing.map(item => (
            <button key={item} onClick={onOpenBrain} style={{ padding: '4px 9px', borderRadius: radius.pill, border: `1px solid ${color.line}`, background: color.paper2, color: color.ink2, fontSize: t.size.micro, cursor: 'pointer' }}>{item}</button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
        <button onClick={() => onRun(planCampaignPrompt)} style={actionStyle}><Megaphone size={13} /> Plan campaign</button>
        <button onClick={() => onRun(channelMatrixPrompt)} style={actionStyle}><Zap size={13} /> Channel matrix</button>
        <button onClick={() => onRun(handoffPrompt)} style={actionStyle}><Share2 size={13} /> SAM handoff</button>
      </div>
    </section>
  )
}

function PlanPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 22,
      padding: '3px 8px',
      borderRadius: radius.pill,
      border: `1px solid ${tone === 'accent' ? 'var(--accent-line)' : color.line}`,
      background: tone === 'accent' ? 'var(--accent-tint)' : color.paper2,
      color: tone === 'accent' ? color.accent : color.ghost,
      fontSize: t.size.micro,
      fontWeight: t.weight.medium,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function PlanCluster({ icon: Icon, label, items, max = 5 }: { icon: React.ElementType; label: string; items: string[]; max?: number }) {
  const visibleItems = items.slice(0, max)
  const overflow = Math.max(0, items.length - visibleItems.length)
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.medium, marginBottom: space[2] }}>
        <Icon size={12} />
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {visibleItems.map(item => (
          <span key={item} style={{ maxWidth: '100%', padding: '4px 8px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ink2, fontSize: t.size.micro, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item}</span>
        ))}
        {overflow > 0 && (
          <span style={{ padding: '4px 8px', borderRadius: radius.pill, background: color.paper2, border: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.micro }}>+{overflow}</span>
        )}
      </div>
    </div>
  )
}


// Vera's face — served from /vera-avatar.png; falls back to the "V" monogram
// if the asset is missing so the UI never shows a broken image. Drop the file
// in content-studio/public/ to give her a face everywhere she appears.
function VeraAvatar({ size, hero = false }: { size: number; hero?: boolean }) {
  const [broken, setBroken] = useState(false)
  const frame: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  if (broken) {
    return (
      <span style={{ ...frame, background: hero ? 'var(--accent-tint)' : color.ink, color: hero ? color.accent : color.surface, fontSize: hero ? 24 : 11, fontWeight: hero ? 700 : 600 }}>V</span>
    )
  }
  return (
    <span style={{ ...frame, background: hero ? 'var(--accent-tint)' : color.paper2 }}>
      <img src="/vera-avatar.png" alt="Vera" onError={() => setBroken(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: t.size.cap, color: color.faint }}>{children}</div>
}
function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {[0, 150, 300].map(d => <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: color.faint, animation: `vera-pulse 1.2s ease-in-out ${d}ms infinite` }} />)}
    </span>
  )
}
