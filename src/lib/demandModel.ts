import type { BusinessContext, BusinessContextKey } from './businessContext'

export type DemandPlatformKey =
  | 'linkedin'
  | 'youtube'
  | 'medium'
  | 'quora'
  | 'reddit'
  | 'x'
  | 'instagram'
  | 'facebook'
  | 'blog'
  | 'email'

export type DemandPlatformDefinition = {
  key: DemandPlatformKey
  label: string
  sourceKey?: BusinessContextKey
  initials: string
  role: string
  workflow: string
  outcomeSignals: string[]
  publishing: 'connected' | 'manual-first' | 'read-only' | 'cms'
}

export type DemandChannelRisk = 'low' | 'medium' | 'high'

export type DemandChannelOperatingPolicy = {
  speakerMode: string
  approvalMode: string
  publishGuard: string
  measurementFocus: string
  samTrigger: string
  risk: DemandChannelRisk
}

const DEMAND_CHANNEL_POLICY_FIELDS = [
  'speakerMode',
  'approvalMode',
  'publishGuard',
  'measurementFocus',
  'samTrigger',
  'risk',
] as const

export const DEMAND_PLATFORM_DEFINITIONS: DemandPlatformDefinition[] = [
  {
    key: 'linkedin',
    label: 'LinkedIn',
    sourceKey: 'linkedinCompany',
    initials: 'Li',
    role: 'Authority, founder voice, ICP pain, and relationship-led demand.',
    workflow: 'Use Unipile for connected profiles and company pages. Draft personal, company, event, and newsletter angles separately.',
    outcomeSignals: ['comments', 'shares', 'profile visits', 'warm accounts'],
    publishing: 'connected',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    sourceKey: 'youtube',
    initials: 'YT',
    role: 'Depth, proof, explainers, Shorts, and durable discovery.',
    workflow: 'Plan storyboards, scripts, titles, descriptions, chapters, Shorts cuts, and upload handoff.',
    outcomeSignals: ['views', 'watch time', 'subscribers', 'traffic'],
    publishing: 'connected',
  },
  {
    key: 'medium',
    label: 'Medium',
    sourceKey: 'medium',
    initials: 'Me',
    role: 'Long-form POV, search-adjacent essays, and reusable campaign anchors.',
    workflow: 'Manual-first publishing with article drafts, canonical links, and referral tracking.',
    outcomeSignals: ['reads', 'claps', 'responses', 'referrals'],
    publishing: 'manual-first',
  },
  {
    key: 'quora',
    label: 'Quora',
    sourceKey: 'quora',
    initials: 'Qu',
    role: 'Problem-aware demand, buyer questions, objections, and answer-led traffic.',
    workflow: 'Research questions, draft useful answers, keep CTAs restrained, and require human posting.',
    outcomeSignals: ['views', 'upvotes', 'comments', 'clicks'],
    publishing: 'manual-first',
  },
  {
    key: 'reddit',
    label: 'Reddit',
    sourceKey: 'reddit',
    initials: 'Rd',
    role: 'Market listening, language mining, objection discovery, and community-safe drafts.',
    workflow: 'Read-first. Draft only when community rules and human approval are clear.',
    outcomeSignals: ['comments', 'upvotes', 'objections', 'traffic intent'],
    publishing: 'read-only',
  },
  {
    key: 'x',
    label: 'X',
    sourceKey: 'x',
    initials: 'X',
    role: 'Fast POV testing, timely takes, conversation entry, and lightweight traffic.',
    workflow: 'Keep optional and manual-first until the API economics justify deeper integration.',
    outcomeSignals: ['replies', 'reposts', 'link clicks', 'profile visits'],
    publishing: 'manual-first',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    sourceKey: 'instagram',
    initials: 'IG',
    role: 'Visual proof, lifestyle fit, carousels, Reels hooks, and audience warmth.',
    workflow: 'Use Meta when connected. Keep visual assets platform-native and approval-gated.',
    outcomeSignals: ['comments', 'shares', 'saves', 'reach'],
    publishing: 'connected',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    sourceKey: 'facebook',
    initials: 'FB',
    role: 'Community trust, local or Page audiences, and longer social proof.',
    workflow: 'Use Meta Pages when connected. Keep engagement management separate from ad workflows.',
    outcomeSignals: ['comments', 'shares', 'page reach', 'traffic'],
    publishing: 'connected',
  },
  {
    key: 'blog',
    label: 'Blog',
    sourceKey: 'website',
    initials: 'Bl',
    role: 'SEO, product education, owned demand capture, and canonical campaign assets.',
    workflow: 'Publish through WordPress or CMS adapters when configured, otherwise draft for handoff.',
    outcomeSignals: ['organic traffic', 'assisted conversions', 'time on page', 'internal clicks'],
    publishing: 'cms',
  },
  {
    key: 'email',
    label: 'Email',
    initials: 'Em',
    role: 'Nurture, reuse, event follow-up, and owned audience conversion.',
    workflow: 'Draft newsletters and nurture sequences. Sending must stay approval-gated.',
    outcomeSignals: ['clicks', 'replies', 'traffic', 'meetings'],
    publishing: 'manual-first',
  },
]

export const DEMAND_CHANNEL_OPERATING_POLICIES: Record<DemandPlatformKey, DemandChannelOperatingPolicy> = {
  linkedin: {
    speakerMode: 'Company, founder, or named expert, chosen per post.',
    approvalMode: 'Named-person content goes to that person. Company posts go to the client owner.',
    publishGuard: 'Publish only through a project-scoped Unipile profile or company page.',
    measurementFocus: 'Comments, shares, profile visits, warm accounts, and qualified clicks.',
    samTrigger: 'Senior ICP commenters, repeated objections, shares by target accounts, or direct buying questions.',
    risk: 'medium',
  },
  youtube: {
    speakerMode: 'Host, expert, or brand voice, chosen from the storyboard.',
    approvalMode: 'Approve storyboard, title, description, and thumbnail before upload.',
    publishGuard: 'Analytics first. Upload requires an approved channel connection.',
    measurementFocus: 'Watch time, retention, subscribers, comments, traffic, and assisted conversions.',
    samTrigger: 'High-intent comments, topic requests, demo questions, or traffic to offer pages.',
    risk: 'medium',
  },
  medium: {
    speakerMode: 'Founder, expert, or brand essay voice.',
    approvalMode: 'One owner for POV drafts. Extra review for claims, comparisons, or customer stories.',
    publishGuard: 'Manual-first with canonical link and tracking note.',
    measurementFocus: 'Reads, responses, claps, referrals, and owned-site traffic.',
    samTrigger: 'Responses with buyer questions, referral spikes, or themes that repeat in sales calls.',
    risk: 'low',
  },
  quora: {
    speakerMode: 'Helpful expert voice, not a sales account.',
    approvalMode: 'Human approval before posting because answer quality and restraint matter.',
    publishGuard: 'Manual-first. Draft useful answers and keep promotional CTAs restrained.',
    measurementFocus: 'Views, upvotes, comments, shares, and click-through to owned proof.',
    samTrigger: 'Recurring buyer questions, objections, competitor comparisons, or intent-rich topics.',
    risk: 'medium',
  },
  reddit: {
    speakerMode: 'Community-safe human voice, usually research-only.',
    approvalMode: 'No posting without operator and client approval plus community rule check.',
    publishGuard: 'Read-first by default. Vera listens, summarizes, and drafts only for human use.',
    measurementFocus: 'Comments, upvotes, objections, language patterns, and traffic intent.',
    samTrigger: 'Repeated pain language, named vendor complaints, buying research threads, or competitor mentions.',
    risk: 'high',
  },
  x: {
    speakerMode: 'Named person or concise brand POV.',
    approvalMode: 'Manual approval for timely takes, sensitive topics, and threaded POV.',
    publishGuard: 'Manual-first until API economics and client plan justify deeper integration.',
    measurementFocus: 'Replies, reposts, link clicks, profile visits, and fast topic validation.',
    samTrigger: 'ICP replies, reposts by target accounts, objection clusters, or useful conversation entry points.',
    risk: 'medium',
  },
  instagram: {
    speakerMode: 'Visual brand voice, creator, founder, or product proof.',
    approvalMode: 'Approve caption and asset together, especially Reels, carousels, and claims.',
    publishGuard: 'Publish only through project-scoped Meta access with approved media.',
    measurementFocus: 'Comments, shares, saves, reach, profile actions, and link traffic.',
    samTrigger: 'High-save proof assets, DM-style comments, repeated questions, or traffic from story links.',
    risk: 'medium',
  },
  facebook: {
    speakerMode: 'Page voice, local community voice, or founder proof.',
    approvalMode: 'Client owner approval for Page posts and community replies.',
    publishGuard: 'Publish only through project-scoped Meta Page access.',
    measurementFocus: 'Comments, shares, reach, page actions, and referral traffic.',
    samTrigger: 'Community questions, share spikes, inbound requests, or objection-heavy threads.',
    risk: 'medium',
  },
  blog: {
    speakerMode: 'Brand authority, founder POV, or expert byline.',
    approvalMode: 'Approve outline, claims, SEO angle, and final draft before CMS publishing.',
    publishGuard: 'Publish only through a project-scoped CMS publisher or manual handoff.',
    measurementFocus: 'Organic traffic, assisted conversions, time on page, internal clicks, and query growth.',
    samTrigger: 'High-intent search queries, conversion-path visits, article comments, or sales-relevant topics.',
    risk: 'low',
  },
  email: {
    speakerMode: 'Brand, founder, or campaign owner.',
    approvalMode: 'Approve audience, offer, send segment, and final copy before any send.',
    publishGuard: 'Draft-only in Vera until a dedicated ESP integration and sending approval exist.',
    measurementFocus: 'Clicks, replies, traffic, meetings, and content reuse.',
    samTrigger: 'Replies, warm clicks, meeting requests, objections, or high-fit account engagement.',
    risk: 'medium',
  },
}

function isDemandChannelRisk(value: unknown): value is DemandChannelRisk {
  return value === 'low' || value === 'medium' || value === 'high'
}

function cloneDemandChannelPolicy(policy: DemandChannelOperatingPolicy): DemandChannelOperatingPolicy {
  return { ...policy }
}

export function defaultDemandChannelPolicies(): Record<DemandPlatformKey, DemandChannelOperatingPolicy> {
  return Object.fromEntries(
    DEMAND_PLATFORM_DEFINITIONS.map(platform => [
      platform.key,
      cloneDemandChannelPolicy(DEMAND_CHANNEL_OPERATING_POLICIES[platform.key]),
    ]),
  ) as Record<DemandPlatformKey, DemandChannelOperatingPolicy>
}

function normalizeDemandChannelPolicy(
  key: DemandPlatformKey,
  raw: unknown,
): DemandChannelOperatingPolicy {
  const base = DEMAND_CHANNEL_OPERATING_POLICIES[key]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cloneDemandChannelPolicy(base)
  const candidate = raw as Partial<Record<keyof DemandChannelOperatingPolicy, unknown>>
  return {
    speakerMode: typeof candidate.speakerMode === 'string' && candidate.speakerMode.trim() ? candidate.speakerMode.trim() : base.speakerMode,
    approvalMode: typeof candidate.approvalMode === 'string' && candidate.approvalMode.trim() ? candidate.approvalMode.trim() : base.approvalMode,
    publishGuard: typeof candidate.publishGuard === 'string' && candidate.publishGuard.trim() ? candidate.publishGuard.trim() : base.publishGuard,
    measurementFocus: typeof candidate.measurementFocus === 'string' && candidate.measurementFocus.trim() ? candidate.measurementFocus.trim() : base.measurementFocus,
    samTrigger: typeof candidate.samTrigger === 'string' && candidate.samTrigger.trim() ? candidate.samTrigger.trim() : base.samTrigger,
    risk: isDemandChannelRisk(candidate.risk) ? candidate.risk : base.risk,
  }
}

export function demandChannelPoliciesFromText(raw: string | null | undefined): Record<DemandPlatformKey, DemandChannelOperatingPolicy> {
  const source = raw?.trim()
  if (!source) return defaultDemandChannelPolicies()
  try {
    const parsed = JSON.parse(source) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultDemandChannelPolicies()
    const record = parsed as Partial<Record<DemandPlatformKey, unknown>>
    return Object.fromEntries(
      DEMAND_PLATFORM_DEFINITIONS.map(platform => [
        platform.key,
        normalizeDemandChannelPolicy(platform.key, record[platform.key]),
      ]),
    ) as Record<DemandPlatformKey, DemandChannelOperatingPolicy>
  } catch {
    return defaultDemandChannelPolicies()
  }
}

export function serializeDemandChannelPolicies(
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>,
): string {
  const normalized = Object.fromEntries(
    DEMAND_PLATFORM_DEFINITIONS.map(platform => [
      platform.key,
      normalizeDemandChannelPolicy(platform.key, policies[platform.key]),
    ]),
  )
  return JSON.stringify(normalized, null, 2)
}

export function demandChannelPolicyHasOverride(
  key: DemandPlatformKey,
  policy: DemandChannelOperatingPolicy,
): boolean {
  const base = DEMAND_CHANNEL_OPERATING_POLICIES[key]
  return DEMAND_CHANNEL_POLICY_FIELDS.some(field => policy[field] !== base[field])
}

export function demandChannelPolicyOverrideCount(
  policies: Record<DemandPlatformKey, DemandChannelOperatingPolicy>,
): number {
  return DEMAND_PLATFORM_DEFINITIONS.filter(platform => demandChannelPolicyHasOverride(platform.key, policies[platform.key])).length
}

const DEMAND_PROVIDER_PLATFORM: Record<string, DemandPlatformKey> = {
  linkedin: 'linkedin',
  youtube: 'youtube',
  medium: 'medium',
  quora: 'quora',
  reddit: 'reddit',
  x: 'x',
  meta_instagram: 'instagram',
  meta_facebook_pages: 'facebook',
  wordpress: 'blog',
  webflow: 'blog',
  contentful: 'blog',
  sanity: 'blog',
  strapi: 'blog',
  hubspot_cms: 'blog',
  ghost: 'blog',
  shopify_blog: 'blog',
  custom_cms: 'blog',
}

export function demandPlatformForProvider(provider: string): DemandPlatformDefinition | null {
  const key = DEMAND_PROVIDER_PLATFORM[provider]
  if (!key) return null
  return DEMAND_PLATFORM_DEFINITIONS.find(platform => platform.key === key) ?? null
}

export const DEMAND_SOURCE_KEYS: BusinessContextKey[] = [
  'website',
  'linkedinCompany',
  'linkedinProfile',
  'linkedinEvents',
  'linkedinNewsletter',
  'instagram',
  'youtube',
  'medium',
  'quora',
  'reddit',
  'facebook',
  'x',
]

export const DEMAND_CONTENT_JOBS = [
  'Campaigns',
  'Posts',
  'Carousels',
  'Images',
  'Video storyboards',
  'Short clips',
  'YouTube scripts',
  'YouTube descriptions',
  'Long-form articles',
  'Medium essays',
  'Quora answers',
  'Reddit research briefs',
  'X POV tests',
  'Comments and replies',
  'Newsletters',
  'SAM handoff briefs',
]

export const DEMAND_APPROVAL_MODES = [
  'Single named approver',
  'Operator only',
  'Client lead',
  'All stakeholders',
  'Legal or compliance',
  'Case based by person, channel, topic, campaign, or claim risk',
]

export const DEMAND_OUTCOME_SIGNALS = [
  'comments',
  'shares',
  'saves',
  'clicks',
  'qualified traffic',
  'objections',
  'buying triggers',
  'warm accounts',
  'meeting requests',
]

export const DEMAND_GROWTH_OUTCOMES = [
  'comments that reveal pain or intent',
  'shares that expand account reach',
  'qualified traffic to owned pages',
  'buyer questions worth answering',
  'objections SAM can research',
  'content patterns worth repeating',
]

export const DEMAND_LEARNING_LOOP = [
  {
    title: 'Ingest',
    body: 'Pull website, SEO headers, product pages, blog, LinkedIn, Instagram, YouTube, Medium, Quora, Reddit, Facebook, and X where available.',
  },
  {
    title: 'Interpret',
    body: 'Separate tone of voice by medium when the evidence supports it, then keep a shared brand core for consistency.',
  },
  {
    title: 'Experiment',
    body: 'Create platform-native variants for hooks, formats, CTAs, claims, and creator voices before scaling a pattern.',
  },
  {
    title: 'Optimize',
    body: 'Update best practices, channel rules, SAM handoff triggers, and next content briefs from comments, shares, traffic, and conversion signals.',
  },
]

export const DEMAND_COMMERCIAL_REQUIREMENTS = [
  'Per-client provider keys and model entitlements',
  'Shared research profiles that never grant client publishing rights',
  'Case-based approvals by person, channel, topic, and claim risk',
  'Measured content loops that improve recommendations over time',
]

export const DEMAND_PROVIDER_READINESS = [
  { provider: 'linkedin', label: 'LinkedIn', detail: 'Unipile post counters, comments, reactions, shares, clicks, and publishing IDs.' },
  { provider: 'meta_facebook_pages', label: 'Facebook Pages', detail: 'Facebook Page insights, comments, shares, page reach, and post engagement.' },
  { provider: 'meta_instagram', label: 'Instagram Professional', detail: 'Instagram media views, reach, comments, saves, shares, and visual proof signals.' },
  { provider: 'x', label: 'X', detail: 'Manual-first publishing, replies, reposts, link clicks, and traffic-driving signals.' },
  { provider: 'google_search_console', label: 'Google Search Console', detail: 'Search query, page, device, country, and opportunity snapshots.' },
  { provider: 'google_analytics_4', label: 'Google Analytics 4', detail: 'Traffic, sessions, conversions, landing pages, and source performance.' },
  { provider: 'youtube', label: 'YouTube', detail: 'Channel, video, Shorts, view, subscriber, watch-time, and traffic analytics.' },
  { provider: 'medium', label: 'Medium', detail: 'Manual-first article publishing, referral traffic, reads, claps, responses, and long-form themes.' },
  { provider: 'quora', label: 'Quora', detail: 'Manual-first answer research, views, upvotes, comments, shares, and traffic-driving questions.' },
  { provider: 'reddit', label: 'Reddit', detail: 'Read-only market listening, comments, upvotes, objections, and traffic intent.' },
  { provider: 'wordpress', label: 'WordPress', detail: 'Approved article publishing, page performance, referral traffic, and conversion context.' },
]

export const DEMAND_CONTENT_METRIC_PROVIDERS = [
  'linkedin',
  'meta_instagram',
  'meta_facebook_pages',
  'youtube',
  'medium',
  'quora',
  'reddit',
  'x',
  'wordpress',
  'custom_cms',
]

export const DEFAULT_DEMAND_OPERATING_MODEL: Pick<
  BusinessContext,
  | 'demandObjective'
  | 'conversionPath'
  | 'speakerStrategy'
  | 'platformToneOfVoice'
  | 'channelStrategy'
  | 'contentFormats'
  | 'approvalModel'
  | 'approvalStakeholders'
  | 'engagementSignals'
  | 'samHandoffRules'
  | 'learningCadence'
  | 'channelOperatingPolicies'
> = {
  demandObjective: 'Create B2B top-of-funnel demand that produces useful conversations, comments, shares, qualified traffic, and sales research signals.',
  conversionPath: 'Move attention into comments, shares, qualified site traffic, newsletter or event opt-ins, direct messages, and SAM follow-up queues.',
  speakerStrategy: 'Choose the speaker case by case: company account for official POV, named founder or expert when lived experience matters, and team voice only when source material supports it.',
  platformToneOfVoice: 'Keep one shared brand core, then adapt by medium: LinkedIn authoritative, YouTube explanatory, Medium article-led, Quora useful, Reddit community-native, Meta visual and conversational, X concise.',
  channelStrategy: 'Use LinkedIn for authority and founder voice, YouTube for depth and Shorts, Medium and blog for long-form demand capture, Quora for buyer questions, Reddit for listening and language mining, Instagram and Facebook for visual proof and community trust, and X when speed or conversation entry matters.',
  contentFormats: DEMAND_CONTENT_JOBS.join(', '),
  approvalModel: 'Case based. Some posts can be approved by one named owner, sensitive claims, named-person content, or high-risk channels need all required stakeholders.',
  approvalStakeholders: 'Low-risk drafts can go to one named owner. Named-person posts, sensitive claims, regulated topics, and client-visible publishing need all required stakeholders.',
  engagementSignals: DEMAND_OUTCOME_SIGNALS.join(', '),
  samHandoffRules: 'Hand off named accounts, repeated objections, buying-trigger comments, competitor mentions, high-intent clicks, inbound questions, and people asking for examples or pricing.',
  learningCadence: 'Review performance weekly, update what works and what does not from every useful signal, refresh channel-specific tone and platform best practices monthly, and turn repeatable wins into skills.',
  channelOperatingPolicies: serializeDemandChannelPolicies(defaultDemandChannelPolicies()),
}

export function applyDemandDefaults(context: BusinessContext): BusinessContext {
  return {
    ...context,
    demandObjective: context.demandObjective || DEFAULT_DEMAND_OPERATING_MODEL.demandObjective,
    conversionPath: context.conversionPath || DEFAULT_DEMAND_OPERATING_MODEL.conversionPath,
    speakerStrategy: context.speakerStrategy || DEFAULT_DEMAND_OPERATING_MODEL.speakerStrategy,
    platformToneOfVoice: context.platformToneOfVoice || DEFAULT_DEMAND_OPERATING_MODEL.platformToneOfVoice,
    channelStrategy: context.channelStrategy || DEFAULT_DEMAND_OPERATING_MODEL.channelStrategy,
    contentFormats: context.contentFormats || DEFAULT_DEMAND_OPERATING_MODEL.contentFormats,
    approvalModel: context.approvalModel || DEFAULT_DEMAND_OPERATING_MODEL.approvalModel,
    approvalStakeholders: context.approvalStakeholders || DEFAULT_DEMAND_OPERATING_MODEL.approvalStakeholders,
    engagementSignals: context.engagementSignals || DEFAULT_DEMAND_OPERATING_MODEL.engagementSignals,
    samHandoffRules: context.samHandoffRules || DEFAULT_DEMAND_OPERATING_MODEL.samHandoffRules,
    learningCadence: context.learningCadence || DEFAULT_DEMAND_OPERATING_MODEL.learningCadence,
    channelOperatingPolicies: context.channelOperatingPolicies || DEFAULT_DEMAND_OPERATING_MODEL.channelOperatingPolicies,
  }
}

export function demandChannelsFromContext(context: BusinessContext, max = 8): string[] {
  const sourceMatches = DEMAND_PLATFORM_DEFINITIONS
    .filter(platform => platform.sourceKey && context[platform.sourceKey]?.trim())
    .map(platform => platform.label)
  const strategyMatches = context.channelStrategy
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean)

  const merged = [...sourceMatches, ...strategyMatches]
  return [...new Set(merged)].slice(0, max)
}

export function demandChannelMatrixPrompt(projectName: string): string {
  const channels = ['LinkedIn', 'YouTube', 'Medium', 'Quora', 'Reddit', 'Instagram', 'Facebook', 'Blog', 'Email', 'X'].join(', ')
  return `Build a channel-native B2B demand distribution matrix for ${projectName}. Cover ${channels} where relevant. For each channel, define role, audience moment, format, CTA, engagement signal, traffic path, approval risk, and what should be handed to SAM.`
}
