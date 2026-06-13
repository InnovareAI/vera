import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import {
  AlertTriangle,
  AtSign,
  BarChart3,
  Camera,
  CheckCircle2,
  Clock3,
  Database,
  FileCode2,
  Globe2,
  Hash,
  KeyRound,
  ListChecks,
  Loader2,
  MessageSquareText,
  PauseCircle,
  Radio,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UploadCloud,
  Video,
  Wrench,
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
import { demandPlatformForProvider, type DemandPlatformDefinition } from '../lib/demandModel'

interface IntegrationTemplate {
  provider: ClientIntegrationProvider
  category: ClientIntegrationCategory
  group: 'Search & analytics' | 'Organic social' | 'Content platforms' | 'Publishing & CMS'
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
  launch?: {
    priority: 'wave_1' | 'wave_2' | 'later'
    workstream: 'Search & analytics' | 'LinkedIn' | 'WordPress' | 'Meta' | 'YouTube' | 'Content platforms' | 'Other'
    adapterState: string
    nextBuild: string
    requirements: string[]
  }
  icon: ElementType
  accent: string
}

const PROVIDERS: IntegrationTemplate[] = [
  {
    provider: 'google_search_console',
    category: 'seo',
    group: 'Search & analytics',
    label: 'Google Search Console',
    eyebrow: 'Search intelligence',
    description: 'Pull search clicks, impressions, CTR, average position, landing pages, indexing gaps, sitemap state, and SEO opportunity data.',
    connectionKind: 'oauth',
    credentialRoute: 'Google OAuth with Search Console API scopes',
    primaryLabel: 'Verified property URL',
    primaryPlaceholder: 'https://example.com/',
    scopes: ['webmasters.readonly', 'site_verification.read'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Connect Google first, then choose a verified site for Search Console performance sync.',
    launch: {
      priority: 'wave_1',
      workstream: 'Search & analytics',
      adapterState: 'Google OAuth connected. Search performance sync is available for the selected site property.',
      nextBuild: 'Add scheduled query, country, device, indexing, and content opportunity breakdowns.',
      requirements: ['Google Cloud project', 'OAuth consent screen', 'Verified site property', 'Daily ingestion schedule'],
    },
    icon: Search,
    accent: '#0f766e',
  },
  {
    provider: 'google_analytics_4',
    category: 'analytics',
    group: 'Search & analytics',
    label: 'Google Analytics 4',
    eyebrow: 'Performance analytics',
    description: 'Read sessions, users, page views, engaged sessions, acquisition, campaign, conversion, and content performance signals.',
    connectionKind: 'oauth',
    credentialRoute: 'Google OAuth with Analytics readonly scopes',
    primaryLabel: 'GA4 property ID',
    primaryPlaceholder: 'properties/123456789',
    scopes: ['analytics.readonly'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Connect Google first, then choose a GA4 property for traffic performance sync.',
    launch: {
      priority: 'wave_1',
      workstream: 'Search & analytics',
      adapterState: 'Google OAuth connected. GA4 traffic sync is available for the selected property.',
      nextBuild: 'Add landing-page breakdowns, acquisition channels, assisted conversions, and traffic quality scoring.',
      requirements: ['Google Cloud project', 'GA4 property access', 'Analytics readonly scope', 'Quota guardrails'],
    },
    icon: BarChart3,
    accent: '#a16207',
  },
  {
    provider: 'meta_facebook_pages',
    category: 'social',
    group: 'Organic social',
    label: 'Facebook Pages',
    eyebrow: 'Meta organic',
    description: 'Publish and analyze Facebook Page posts, media, comments, and engagement signals through Meta Graph API.',
    connectionKind: 'oauth',
    credentialRoute: 'Meta OAuth with Page publishing and engagement scopes',
    primaryLabel: 'Facebook Page ID or URL',
    primaryPlaceholder: 'https://facebook.com/brand',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs Meta app review, Page asset access, and a Graph API adapter before live publishing.',
    launch: {
      priority: 'wave_1',
      workstream: 'Meta',
      adapterState: 'Needs Meta app review and Page adapter',
      nextBuild: 'Build the Meta OAuth callback, Page selector, publishing dry run, and human approval gate.',
      requirements: ['Meta app', 'Business Manager asset access', 'Page publishing permissions', 'Comment and insight permissions'],
    },
    icon: MessageSquareText,
    accent: '#2563eb',
  },
  {
    provider: 'meta_instagram',
    category: 'social',
    group: 'Organic social',
    label: 'Instagram Professional',
    eyebrow: 'Meta organic',
    description: 'Publish Instagram feed posts, reels, carousels, and pull profile, media, comment, and insight context.',
    connectionKind: 'oauth',
    credentialRoute: 'Meta OAuth with Instagram professional publishing scopes',
    primaryLabel: 'Instagram account URL or ID',
    primaryPlaceholder: 'https://instagram.com/brand',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs a professional Instagram account, Meta app review, media URL hosting, and a Graph API publish adapter.',
    launch: {
      priority: 'wave_1',
      workstream: 'Meta',
      adapterState: 'Needs Meta app review and media publish adapter',
      nextBuild: 'Build Instagram professional account connection, media container creation, publish dry run, and insight sync.',
      requirements: ['Professional Instagram account', 'Connected Facebook Page', 'Media URL hosting', 'Content publishing permissions'],
    },
    icon: Camera,
    accent: '#c026d3',
  },
  {
    provider: 'meta_threads',
    category: 'social',
    group: 'Organic social',
    label: 'Threads',
    eyebrow: 'Meta organic',
    description: 'Publish short-form text, image, carousel, and video posts, then read replies and post-level insights.',
    connectionKind: 'oauth',
    credentialRoute: 'Threads OAuth with content publish and basic profile scopes',
    primaryLabel: 'Threads profile URL or ID',
    primaryPlaceholder: 'https://threads.net/@brand',
    scopes: ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs Threads API app setup and publish adapter before live posting.',
    icon: AtSign,
    accent: '#111827',
  },
  {
    provider: 'linkedin',
    category: 'social',
    group: 'Organic social',
    label: 'LinkedIn',
    eyebrow: 'Unipile OAuth',
    description: 'Connect LinkedIn through the Unipile OAuth Wizard, then publish and analyze personal or company content from Vera.',
    connectionKind: 'oauth',
    credentialRoute: 'Unipile Hosted Auth Wizard for LinkedIn account connection',
    primaryLabel: 'LinkedIn profile or company URL',
    primaryPlaceholder: 'https://linkedin.com/company/brand',
    scopes: ['unipile.linkedin.account', 'posts.read', 'posts.write', 'profile.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Use the Unipile OAuth Wizard for LinkedIn personal and company access. Vera stores only the Unipile account reference in this registry.',
    launch: {
      priority: 'wave_1',
      workstream: 'LinkedIn',
      adapterState: 'Unipile OAuth Wizard ready for account connection',
      nextBuild: 'Open the Unipile wizard from this card, persist the account ID on callback, then use it for LinkedIn ingestion, audits, and approved publishing.',
      requirements: ['Unipile API key', 'Hosted auth wizard', 'LinkedIn account consent', 'Space approval'],
    },
    icon: Share2,
    accent: '#0a66c2',
  },
  {
    provider: 'x',
    category: 'social',
    group: 'Organic social',
    label: 'X',
    eyebrow: 'Later, paid API',
    description: 'Prepare X posts for manual handoff now. Add official API publishing only when the space plan covers X usage.',
    connectionKind: 'manual',
    credentialRoute: 'Manual handoff by default. Add X OAuth only when the space plan explicitly covers paid API usage',
    primaryLabel: 'X handle or profile URL',
    primaryPlaceholder: 'https://x.com/brand',
    scopes: ['manual.publish', 'public.read', 'traffic.review'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Keep manual handoff first. Add API publishing only when the client plan covers X API usage.',
    launch: {
      priority: 'wave_2',
      workstream: 'Other',
      adapterState: 'Manual-first and cost-gated. Official API usage depends on client plan and paid API economics.',
      nextBuild: 'Register X handles, draft POV tests for manual handoff, track traffic manually, and add OAuth only when the client plan covers API cost.',
      requirements: ['X profile URL or handle', 'Manual publish owner', 'Paid API decision', 'Traffic tracking plan'],
    },
    icon: Hash,
    accent: '#0f172a',
  },
  {
    provider: 'youtube',
    category: 'social',
    group: 'Organic social',
    label: 'YouTube',
    eyebrow: 'Video channel',
    description: 'Connect YouTube channel discovery and posted-video performance signals. Publishing and uploads come after the upload adapter and approval path.',
    connectionKind: 'oauth',
    credentialRoute: 'Google OAuth with YouTube readonly and analytics scopes',
    primaryLabel: 'YouTube channel URL or ID',
    primaryPlaceholder: 'https://youtube.com/@brand',
    scopes: ['youtube.readonly', 'yt-analytics.readonly'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Connects the channel and analytics context now. Video upload and publishing need a separate Google upload-scope review.',
    launch: {
      priority: 'wave_1',
      workstream: 'YouTube',
      adapterState: 'Google OAuth path ready for channel and analytics access. Upload adapter comes next.',
      nextBuild: 'Connect channel selection, then add video metadata drafting, upload dry runs, quota handling, and live publishing approval gates.',
      requirements: ['Google Cloud project', 'YouTube channel access', 'YouTube readonly scope', 'YouTube analytics readonly scope'],
    },
    icon: Video,
    accent: '#dc2626',
  },
  {
    provider: 'tiktok',
    category: 'social',
    group: 'Organic social',
    label: 'TikTok',
    eyebrow: 'Short video',
    description: 'Publish TikTok videos or draft uploads and pull creator, post, and performance context after consent.',
    connectionKind: 'oauth',
    credentialRoute: 'TikTok OAuth with Content Posting API scopes',
    primaryLabel: 'TikTok profile URL or handle',
    primaryPlaceholder: 'https://tiktok.com/@brand',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true },
    setupNote: 'Needs TikTok Content Posting API approval, explicit user consent, and verified media hosting.',
    icon: Radio,
    accent: '#0891b2',
  },
  {
    provider: 'pinterest',
    category: 'social',
    group: 'Organic social',
    label: 'Pinterest',
    eyebrow: 'Visual discovery',
    description: 'Publish pins, read boards, and analyze visual discovery performance for evergreen content.',
    connectionKind: 'oauth',
    credentialRoute: 'Pinterest OAuth with pins and boards scopes',
    primaryLabel: 'Pinterest profile or board URL',
    primaryPlaceholder: 'https://pinterest.com/brand',
    scopes: ['pins:read', 'pins:write', 'boards:read', 'boards:write', 'user_accounts:read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs Pinterest OAuth app setup and media upload adapter before live publishing.',
    icon: UploadCloud,
    accent: '#be123c',
  },
  {
    provider: 'reddit',
    category: 'content_source',
    group: 'Content platforms',
    label: 'Reddit',
    eyebrow: 'Read-only listening',
    description: 'Read subreddit context, mine objections, draft community-safe posts and comments, and keep final posting as a human decision.',
    connectionKind: 'manual',
    credentialRoute: 'No client credential by default. Use public listening, target subreddit URLs, and approved manual handoff',
    primaryLabel: 'Reddit profile or subreddit',
    primaryPlaceholder: 'r/community or u/brand',
    scopes: ['public.read', 'community.rules', 'manual.publish'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Use Reddit for market listening and draft prep. Final posting stays manual unless a space-specific approved adapter is added later.',
    launch: {
      priority: 'wave_1',
      workstream: 'Content platforms',
      adapterState: 'Manual-first research and answer drafting. OAuth publishing later.',
      nextBuild: 'Register target subreddits, ingest public discussions, summarize objections, and draft posts or comments for human approval.',
      requirements: ['Target subreddit or profile', 'Community rules', 'Manual approval gate', 'Engagement signal tracking'],
    },
    icon: MessageSquareText,
    accent: '#ea580c',
  },
  {
    provider: 'bluesky',
    category: 'social',
    group: 'Organic social',
    label: 'Bluesky',
    eyebrow: 'Open social',
    description: 'Publish posts, threads, images, and read account or feed context through the AT Protocol.',
    connectionKind: 'api_key',
    credentialRoute: 'Bluesky app password or OAuth, stored as encrypted client credential',
    primaryLabel: 'Bluesky handle',
    primaryPlaceholder: '@brand.bsky.social',
    scopes: ['atproto.repo.write', 'atproto.repo.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs Bluesky app-password or OAuth adapter and AT Protocol publishing implementation.',
    icon: Send,
    accent: '#0284c7',
  },
  {
    provider: 'medium',
    category: 'content_source',
    group: 'Content platforms',
    label: 'Medium',
    eyebrow: 'Manual publishing',
    description: 'Ingest Medium profile or publication RSS, analyze long-form tone, and prepare approved drafts for manual publishing.',
    connectionKind: 'manual',
    credentialRoute: 'No API token required. Use RSS for reading and manual handoff for publishing',
    primaryLabel: 'Medium profile or publication URL',
    primaryPlaceholder: 'https://medium.com/@brand',
    scopes: ['rss.read', 'manual.publish'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Use Medium RSS for source ingestion. Final publishing stays manual because Medium does not support new official API integrations.',
    launch: {
      priority: 'wave_1',
      workstream: 'Content platforms',
      adapterState: 'Manual-first source ingestion and publishing handoff.',
      nextBuild: 'Register profile or publication RSS, ingest articles, map long-form themes, and prepare approved drafts for manual publishing.',
      requirements: ['Medium profile or publication URL', 'RSS availability', 'Manual publish owner', 'Canonical link strategy'],
    },
    icon: FileCode2,
    accent: '#111827',
  },
  {
    provider: 'quora',
    category: 'content_source',
    group: 'Content platforms',
    label: 'Quora',
    eyebrow: 'Answer platform',
    description: 'Track target topics, ingest public profile or Space context, draft answers, and capture questions that should become content.',
    connectionKind: 'manual',
    credentialRoute: 'No direct publishing API. Use URL ingestion and approved manual answer handoff',
    primaryLabel: 'Quora profile, Space, or topic URL',
    primaryPlaceholder: 'https://www.quora.com/profile/brand-or-person',
    scopes: ['public.read', 'manual.publish', 'answer.research'],
    capabilities: { read: true, ingest: true, analyze: true },
    setupNote: 'Use Quora as a research and answer-prep source. Final posting stays manual unless a space-specific approved adapter is added later.',
    launch: {
      priority: 'wave_1',
      workstream: 'Content platforms',
      adapterState: 'Manual-first question research and answer drafting.',
      nextBuild: 'Register profile, Space, or topic URLs, collect audience questions, draft answers, and label traffic-driving themes for follow-up.',
      requirements: ['Quora profile, Space, or topic URL', 'Manual answer owner', 'Source-quality review', 'Engagement signal tracking'],
    },
    icon: MessageSquareText,
    accent: '#b92b27',
  },
  {
    provider: 'wordpress',
    category: 'publisher',
    group: 'Publishing & CMS',
    label: 'WordPress',
    eyebrow: 'Publishing',
    description: 'Publish approved drafts, upload media, update posts, and read taxonomy context.',
    connectionKind: 'app_password',
    credentialRoute: 'WordPress application password stored as an encrypted space key',
    primaryLabel: 'WordPress site URL',
    primaryPlaceholder: 'https://blog.example.com',
    scopes: ['posts.write', 'posts.read', 'media.upload', 'taxonomies.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true, upload_media: true, schedule: true },
    setupNote: 'Needs the WordPress publishing function and encrypted application password.',
    launch: {
      priority: 'wave_1',
      workstream: 'WordPress',
      adapterState: 'Needs deployed WordPress connector and credential vault path',
      nextBuild: 'Ship WordPress connect, dry run, publish, featured image upload, taxonomy mapping, and posted URL verification.',
      requirements: ['Site URL', 'Application password', 'User with post permissions', 'Dry-run preview before publish'],
    },
    icon: Globe2,
    accent: '#7c3aed',
  },
  {
    provider: 'webflow',
    category: 'cms',
    group: 'Publishing & CMS',
    label: 'Webflow',
    eyebrow: 'CMS publishing',
    description: 'Create CMS items, stage drafts, and publish approved long-form content to Webflow.',
    connectionKind: 'api_key',
    credentialRoute: 'Webflow API token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Contentful',
    eyebrow: 'Headless CMS',
    description: 'Create entries, attach assets, and route approved articles into a Contentful space.',
    connectionKind: 'api_key',
    credentialRoute: 'Contentful management token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Sanity',
    eyebrow: 'Structured content',
    description: 'Write portable text, media references, and article documents into Sanity datasets.',
    connectionKind: 'api_key',
    credentialRoute: 'Sanity write token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Strapi',
    eyebrow: 'Self-hosted CMS',
    description: 'Create and publish entries in a Strapi content type with media and metadata.',
    connectionKind: 'api_key',
    credentialRoute: 'Strapi API token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'HubSpot CMS',
    eyebrow: 'Marketing CMS',
    description: 'Create blog posts and campaign content in HubSpot with approval controls.',
    connectionKind: 'api_key',
    credentialRoute: 'HubSpot private app token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Ghost',
    eyebrow: 'Editorial publishing',
    description: 'Send approved posts and newsletters into Ghost with tags, authors, and imagery.',
    connectionKind: 'api_key',
    credentialRoute: 'Ghost Admin API key stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Shopify Blog',
    eyebrow: 'Commerce content',
    description: 'Publish SEO articles and product-led content to Shopify blogs.',
    connectionKind: 'api_key',
    credentialRoute: 'Shopify Admin API token stored as an encrypted space key',
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
    group: 'Publishing & CMS',
    label: 'Custom CMS',
    eyebrow: 'Other CMS',
    description: 'Register a generic publishing route for a space-specific CMS, webhook, or middleware.',
    connectionKind: 'webhook',
    credentialRoute: 'Webhook secret or API key stored as an encrypted space key',
    primaryLabel: 'Endpoint or adapter name',
    primaryPlaceholder: 'https://cms.example.com/api/vera',
    scopes: ['content.write', 'content.read'],
    capabilities: { read: true, ingest: true, analyze: true, publish: true },
    setupNote: 'Needs a custom adapter contract before live publishing.',
    icon: Settings2,
    accent: '#be123c',
  },
]

const PROVIDER_GROUPS: IntegrationTemplate['group'][] = [
  'Search & analytics',
  'Publishing & CMS',
  'Organic social',
  'Content platforms',
]

const DEFAULT_PROVIDER: ClientIntegrationProvider = 'google_search_console'
const DEFAULT_TEMPLATE = PROVIDERS.find(provider => provider.provider === DEFAULT_PROVIDER) ?? PROVIDERS[0]

function initialProviderFromUrl(): ClientIntegrationProvider {
  if (typeof window === 'undefined') return DEFAULT_PROVIDER
  const value = new URL(window.location.href).searchParams.get('provider')
  return PROVIDERS.some(template => template.provider === value)
    ? value as ClientIntegrationProvider
    : DEFAULT_PROVIDER
}

const DEFAULT_LAUNCH = {
  priority: 'later',
  workstream: 'Other',
  adapterState: 'Backlog',
  nextBuild: 'Defer until a client needs this channel.',
  requirements: ['Space strategy', 'Adapter brief', 'Permission model'],
} satisfies NonNullable<IntegrationTemplate['launch']>

function launchMeta(template: IntegrationTemplate): NonNullable<IntegrationTemplate['launch']> {
  return template.launch ?? DEFAULT_LAUNCH
}

function isWaveOne(template: IntegrationTemplate): boolean {
  return launchMeta(template).priority === 'wave_1'
}

function googleProvidersForSelection(provider: ClientIntegrationProvider): string[] {
  if (provider === 'youtube') return ['youtube']
  return ['google_search_console', 'google_analytics_4']
}

function metaProvidersForSelection(provider: ClientIntegrationProvider): string[] {
  if (provider === 'meta_facebook_pages' || provider === 'meta_instagram') {
    return ['meta_facebook_pages', 'meta_instagram']
  }
  return []
}

const WAVE_ONE_TEMPLATES = PROVIDERS.filter(isWaveOne)

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

type SharedResearchProfile = {
  id?: string | null
  name?: string | null
  unipile_account_id: string | null
  unipile_health_status: string | null
  unipile_connected_at: string | null
  unipile_last_health_check: string | null
}

const UNUSABLE_UNIPILE_HEALTH_STATUSES = new Set(['stale', 'error', 'disconnected', 'revoked'])

function maskAccountId(accountId: string): string {
  if (accountId.length <= 12) return accountId
  return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`
}

function isUsableUnipileProfile(profile: SharedResearchProfile | null): boolean {
  if (!profile?.unipile_account_id) return false
  const status = (profile.unipile_health_status ?? '').trim().toLowerCase()
  return !status || !UNUSABLE_UNIPILE_HEALTH_STATUSES.has(status)
}

function configString(row: ClientIntegration | undefined, key: string): string {
  const value = row?.config?.[key]
  return typeof value === 'string' ? value : ''
}

function configBool(row: ClientIntegration | undefined, key: string, fallback: boolean): boolean {
  const value = row?.config?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function integrationUnipileAccountId(row: ClientIntegration | undefined): string | null {
  return firstNonEmptyString(
    row?.external_ref?.unipile_account_id,
    row?.external_ref?.account_id,
    row?.config?.unipile_account_id,
  )
}

function linkedInScopeHint(row: ClientIntegration | undefined, researchConnected: boolean): string | null {
  if (row?.status === 'connected' && integrationUnipileAccountId(row)) return 'Space publishing connected'
  if (researchConnected) return 'Research available only'
  return null
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

function publishingModeLabel(mode: DemandPlatformDefinition['publishing']): string {
  if (mode === 'manual-first') return 'Manual first'
  if (mode === 'read-only') return 'Read only'
  if (mode === 'cms') return 'CMS'
  return 'Connected'
}

function buildIntegrationConfig(
  template: IntegrationTemplate,
  draft: Pick<Draft, 'primaryRef' | 'notes' | 'approvalRequired'>,
  previousConfig: Record<string, unknown> = {},
): Record<string, unknown> {
  const launch = launchMeta(template)
  const demandPlatform = demandPlatformForProvider(template.provider)
  return {
    ...previousConfig,
    primary_ref: draft.primaryRef.trim(),
    notes: draft.notes.trim(),
    approval_required: draft.approvalRequired,
    credential_route: template.credentialRoute,
    setup_note: template.setupNote,
    launch_priority: launch.priority,
    workstream: launch.workstream,
    adapter_state: launch.adapterState,
    next_build: launch.nextBuild,
    required_setup: launch.requirements,
    demand_role: demandPlatform?.role,
    demand_workflow: demandPlatform?.workflow,
    publishing_mode: demandPlatform?.publishing,
    outcome_signals: demandPlatform?.outcomeSignals,
  }
}

export function ClientIntegrationsCard() {
  const { activeProject } = useProject()
  const activeProjectId = activeProject?.id ?? null
  const activeOrgId = activeProject?.org_id ?? null
  const [rows, setRows] = useState<ClientIntegration[]>([])
  const [loading, setLoading] = useState(false)
  const [researchProfile, setResearchProfile] = useState<SharedResearchProfile | null>(null)
  const [platformResearchProfile, setPlatformResearchProfile] = useState<SharedResearchProfile | null>(null)
  const [loadingResearchProfile, setLoadingResearchProfile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [connectingMeta, setConnectingMeta] = useState(false)
  const [connectingUnipile, setConnectingUnipile] = useState(false)
  const [connectingResearchProfile, setConnectingResearchProfile] = useState(false)
  const [removingResearchProfile, setRemovingResearchProfile] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ClientIntegrationProvider>(() => initialProviderFromUrl())
  const selectedTemplate = PROVIDERS.find(p => p.provider === selectedProvider) ?? PROVIDERS[0]
  const rowByProvider = useMemo(() => new Map(rows.map(row => [row.provider, row])), [rows])
  const selectedRow = rowByProvider.get(selectedProvider)
  const draftKey = `${selectedProvider}:${selectedRow?.id ?? 'new'}:${selectedRow?.updated_at ?? ''}`
  const [draftState, setDraftState] = useState<{ key: string; draft: Draft }>(() => ({
    key: `${DEFAULT_PROVIDER}:new:`,
    draft: makeDraft(DEFAULT_TEMPLATE),
  }))
  const draft = draftState.key === draftKey ? draftState.draft : makeDraft(selectedTemplate, selectedRow)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const isGoogleOauthProvider = selectedProvider === 'google_search_console' || selectedProvider === 'google_analytics_4' || selectedProvider === 'youtube'
  const isMetaOauthProvider = selectedProvider === 'meta_facebook_pages' || selectedProvider === 'meta_instagram'
  const isUnipileOauthProvider = selectedProvider === 'linkedin'

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

  useEffect(() => {
    let cancelled = false
    async function loadResearchProfile() {
      if (!activeOrgId) {
        setResearchProfile(null)
        setPlatformResearchProfile(null)
        setLoadingResearchProfile(false)
        return
      }
      setLoadingResearchProfile(true)
      const [workspaceResult, platformResult] = await Promise.all([
        supabase
          .from('organizations')
          .select('id, name, unipile_account_id, unipile_health_status, unipile_connected_at, unipile_last_health_check')
          .eq('id', activeOrgId)
          .maybeSingle(),
        supabase
          .from('organizations')
          .select('id, name, unipile_account_id, unipile_health_status, unipile_connected_at, unipile_last_health_check')
          .eq('is_master', true)
          .not('unipile_account_id', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (cancelled) return
      if (workspaceResult.error) {
        setResearchProfile(null)
      } else {
        setResearchProfile((workspaceResult.data ?? null) as SharedResearchProfile | null)
      }
      const workspace = (workspaceResult.data ?? null) as SharedResearchProfile | null
      const platform = platformResult.error
        ? null
        : (platformResult.data ?? null) as SharedResearchProfile | null
      setPlatformResearchProfile(platform?.id && platform.id !== workspace?.id ? platform : null)
      setLoadingResearchProfile(false)
    }
    loadResearchProfile()
    return () => { cancelled = true }
  }, [activeOrgId])

  useEffect(() => {
    const url = new URL(window.location.href)
    const googleStatus = url.searchParams.get('google_status')
    const googleDetail = url.searchParams.get('google_detail')
    const metaStatus = url.searchParams.get('meta_status')
    const metaDetail = url.searchParams.get('meta_detail')

    if (googleStatus === 'success' || googleStatus === 'error') {
      queueMicrotask(() => {
        setMessage({
          type: googleStatus === 'success' ? 'ok' : 'err',
          text: googleDetail || (googleStatus === 'success' ? 'Google connected.' : 'Google connection failed.'),
        })
      })
      url.searchParams.delete('google_status')
      url.searchParams.delete('google_detail')
      window.history.replaceState({}, '', url.toString())
    }

    if (metaStatus === 'success' || metaStatus === 'error') {
      queueMicrotask(() => {
        setMessage({
          type: metaStatus === 'success' ? 'ok' : 'err',
          text: metaDetail || (metaStatus === 'success' ? 'Meta connected.' : 'Meta connection failed.'),
        })
      })
      url.searchParams.delete('meta_status')
      url.searchParams.delete('meta_detail')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  useEffect(() => {
    if (!activeProject) return
    const project = activeProject
    const url = new URL(window.location.href)
    const unipileStatus = url.searchParams.get('unipile_status')
    if (unipileStatus !== 'success' && unipileStatus !== 'error') return
    const requestedProjectId = url.searchParams.get('project_id')
    const callbackScope = url.searchParams.get('scope')
    const isResearchConnection = callbackScope === 'research' || !requestedProjectId
    if (requestedProjectId && project.id !== requestedProjectId) return

    const cleanUrl = () => {
      url.searchParams.delete('unipile_status')
      url.searchParams.delete('account_id')
      url.searchParams.delete('org_id')
      url.searchParams.delete('project_id')
      url.searchParams.delete('scope')
      window.history.replaceState({}, '', url.toString())
    }

    if (unipileStatus === 'error') {
      queueMicrotask(() => setMessage({ type: 'err', text: 'LinkedIn connection was cancelled or failed.' }))
      cleanUrl()
      return
    }

    const accountId = url.searchParams.get('account_id')
    if (!accountId) {
      queueMicrotask(() => setMessage({ type: 'err', text: 'LinkedIn connection finished without a Unipile account ID.' }))
      cleanUrl()
      return
    }

    let cancelled = false
    async function syncLinkedInConnection() {
      const template = PROVIDERS.find(provider => provider.provider === 'linkedin')
      if (!template) return
      setSaving(true)
      setMessage(null)

      const connectedAt = new Date().toISOString()
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id ?? null

      if (isResearchConnection) {
        const { error } = await supabase.from('organizations').update({
          unipile_account_id: accountId,
          unipile_connected_at: connectedAt,
          unipile_last_health_check: connectedAt,
          unipile_health_status: 'healthy',
        }).eq('id', project.org_id)

        if (cancelled) return
        setSaving(false)
        setConnectingResearchProfile(false)

        if (error) {
          setMessage({ type: 'err', text: error.message })
          cleanUrl()
          return
        }

        setResearchProfile({
          id: project.org_id,
          name: project.name,
          unipile_account_id: accountId,
          unipile_connected_at: connectedAt,
          unipile_last_health_check: connectedAt,
          unipile_health_status: 'healthy',
        })
        setSelectedProvider('linkedin')
        setMessage({ type: 'ok', text: 'LinkedIn research profile connected across spaces.' })
        cleanUrl()
        return
      }

      const { data: existingRows, error: lookupError } = await supabase
        .from('client_integrations')
        .select('*')
        .eq('project_id', project.id)
        .eq('provider', 'linkedin')
        .limit(1)

      if (cancelled) return
      if (lookupError) {
        setSaving(false)
        setMessage({ type: 'err', text: lookupError.message })
        cleanUrl()
        return
      }

      const existing = ((existingRows ?? []) as ClientIntegration[])[0]
      const previousConfig = existing?.config ?? {}
      const payload = {
        org_id: project.org_id,
        project_id: project.id,
        provider: template.provider,
        category: template.category,
        display_name: existing?.display_name ?? template.label,
        status: 'connected' as ClientIntegrationStatus,
        connection_kind: template.connectionKind,
        config: {
          ...buildIntegrationConfig(template, {
            primaryRef: configString(existing, 'primary_ref'),
            notes: configString(existing, 'notes'),
            approvalRequired: configBool(existing, 'approval_required', true),
          }, previousConfig),
          connected_via: 'unipile-oauth-wizard',
          unipile_connected_at: connectedAt,
        },
        capabilities: existing?.capabilities ?? template.capabilities,
        scopes: template.scopes,
        external_ref: {
          ...(existing?.external_ref ?? {}),
          unipile_account_id: accountId,
          source: 'client_integrations.external_ref.unipile_account_id',
        },
        health_status: 'healthy' as const,
        health_detail: 'LinkedIn connected through Unipile OAuth Wizard',
        last_health_check: connectedAt,
        updated_by: userId,
      }

      const query = existing
        ? supabase
            .from('client_integrations')
            .update(payload)
            .eq('id', existing.id)
            .select()
            .single()
        : supabase
            .from('client_integrations')
            .insert({ ...payload, created_by: userId })
            .select()
            .single()

      const { data, error } = await query
      if (cancelled) return
      setSaving(false)

      if (error) {
        setMessage({ type: 'err', text: error.message })
        cleanUrl()
        return
      }

      const saved = data as ClientIntegration
      setSelectedProvider('linkedin')
      setRows(prev => {
        const exists = prev.some(row => row.id === saved.id)
        return exists ? prev.map(row => row.id === saved.id ? saved : row) : [...prev, saved]
      })
      setDraftState({ key: `linkedin:${saved.id}:${saved.updated_at ?? ''}`, draft: makeDraft(template, saved) })
      setMessage({ type: 'ok', text: 'LinkedIn publishing connected for this space.' })
      cleanUrl()
    }

    syncLinkedInConnection()
    return () => { cancelled = true }
  }, [activeProject])

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
      config: buildIntegrationConfig(selectedTemplate, draft, selectedRow?.config ?? {}),
      capabilities: draft.capabilities,
      scopes: selectedTemplate.scopes,
      health_status: selectedRow?.health_status ?? 'unknown',
      health_detail: selectedRow?.health_detail ?? launchMeta(selectedTemplate).adapterState,
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
    if (!confirm(`Remove ${selectedRow.display_name}? Vera will stop seeing this integration for this space.`)) return
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

  async function connectGoogle() {
    if (!activeProject) return
    setConnectingGoogle(true)
    setMessage(null)

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in again before connecting Google.')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!supabaseUrl) throw new Error('Supabase URL is not configured.')

      const returnUrl = new URL('/settings', window.location.origin)
      returnUrl.searchParams.set('tab', 'integrations')
      returnUrl.searchParams.set('provider', selectedProvider)
      returnUrl.searchParams.set('project_id', activeProject.id)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      }
      if (anonKey) headers.apikey = anonKey

      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/google-oauth-start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          project_id: activeProject.id,
          providers: googleProvidersForSelection(selectedProvider),
          return_url: returnUrl.toString(),
        }),
      })
      const body = await response.json().catch(() => ({})) as { auth_url?: string; error?: string }
      if (!response.ok || !body.auth_url) {
        throw new Error(body.error ?? `Google OAuth returned HTTP ${response.status}`)
      }

      window.location.assign(body.auth_url)
    } catch (error) {
      setConnectingGoogle(false)
      setMessage({ type: 'err', text: error instanceof Error ? error.message : 'Google connection failed.' })
    }
  }

  async function connectMeta() {
    if (!activeProject) return
    setConnectingMeta(true)
    setMessage(null)

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in again before connecting Meta.')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!supabaseUrl) throw new Error('Supabase URL is not configured.')

      const returnUrl = new URL('/settings', window.location.origin)
      returnUrl.searchParams.set('tab', 'integrations')
      returnUrl.searchParams.set('provider', selectedProvider)
      returnUrl.searchParams.set('project_id', activeProject.id)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      }
      if (anonKey) headers.apikey = anonKey

      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/meta-oauth-start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          project_id: activeProject.id,
          providers: metaProvidersForSelection(selectedProvider),
          return_url: returnUrl.toString(),
        }),
      })
      const body = await response.json().catch(() => ({})) as { auth_url?: string; error?: string }
      if (!response.ok || !body.auth_url) {
        throw new Error(body.error ?? `Meta OAuth returned HTTP ${response.status}`)
      }

      window.location.assign(body.auth_url)
    } catch (error) {
      setConnectingMeta(false)
      setMessage({ type: 'err', text: error instanceof Error ? error.message : 'Meta connection failed.' })
    }
  }

  async function connectResearchProfile() {
    if (!activeProject) return
    setConnectingResearchProfile(true)
    setMessage(null)

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in again before connecting LinkedIn.')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!supabaseUrl || !anonKey) throw new Error('Supabase connection settings are not configured.')

      const returnUrl = new URL('/settings', window.location.origin)
      returnUrl.searchParams.set('tab', 'integrations')
      returnUrl.searchParams.set('provider', 'linkedin')
      returnUrl.searchParams.set('scope', 'research')

      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/unipile-connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          org_id: activeProject.org_id,
          return_url: returnUrl.toString(),
        }),
      })
      const body = await response.json().catch(() => ({})) as { auth_url?: string; error?: string }
      if (!response.ok || !body.auth_url) {
        throw new Error(body.error ?? `Unipile OAuth returned HTTP ${response.status}`)
      }

      window.location.assign(body.auth_url)
    } catch (error) {
      setConnectingResearchProfile(false)
      setMessage({ type: 'err', text: error instanceof Error ? error.message : 'LinkedIn research profile connection failed.' })
    }
  }

  async function removeResearchProfile() {
    if (!activeProject || !researchProfile?.unipile_account_id) return
    if (!confirm('Remove the shared LinkedIn research profile for this workspace? Space publishing integrations are not affected.')) return
    setRemovingResearchProfile(true)
    setMessage(null)

    const { error } = await supabase.from('organizations').update({
      unipile_account_id: null,
      unipile_connected_at: null,
      unipile_last_health_check: new Date().toISOString(),
      unipile_health_status: 'stale',
    }).eq('id', activeProject.org_id)

    setRemovingResearchProfile(false)
    if (error) {
      setMessage({ type: 'err', text: error.message })
      return
    }

    setResearchProfile({
      id: activeProject.org_id,
      name: activeProject.name,
      unipile_account_id: null,
      unipile_connected_at: null,
      unipile_last_health_check: new Date().toISOString(),
      unipile_health_status: 'stale',
    })
    setMessage({ type: 'ok', text: 'Shared LinkedIn research profile removed.' })
  }

  async function connectUnipile() {
    if (!activeProject) return
    setConnectingUnipile(true)
    setMessage(null)

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in again before connecting LinkedIn.')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!supabaseUrl || !anonKey) throw new Error('Supabase connection settings are not configured.')

      const returnUrl = new URL('/settings', window.location.origin)
      returnUrl.searchParams.set('tab', 'integrations')
      returnUrl.searchParams.set('provider', 'linkedin')
      returnUrl.searchParams.set('project_id', activeProject.id)
      returnUrl.searchParams.set('scope', 'client')

      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/unipile-connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          org_id: activeProject.org_id,
          project_id: activeProject.id,
          return_url: returnUrl.toString(),
        }),
      })
      const body = await response.json().catch(() => ({})) as { auth_url?: string; error?: string }
      if (!response.ok || !body.auth_url) {
        throw new Error(body.error ?? `Unipile OAuth returned HTTP ${response.status}`)
      }

      window.location.assign(body.auth_url)
    } catch (error) {
      setConnectingUnipile(false)
      setMessage({ type: 'err', text: error instanceof Error ? error.message : 'LinkedIn connection failed.' })
    }
  }

  async function createFirstWavePlan() {
    if (!activeProject) return
    const missingTemplates = WAVE_ONE_TEMPLATES.filter(template => !rowByProvider.has(template.provider))
    if (!missingTemplates.length) {
      setMessage({ type: 'ok', text: 'First-wave integrations are already planned for this space.' })
      return
    }

    setSaving(true)
    setMessage(null)
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id ?? null
    const payloads = missingTemplates.map(template => ({
      org_id: activeProject.org_id,
      project_id: activeProject.id,
      provider: template.provider,
      category: template.category,
      display_name: template.label,
      status: 'not_connected' as ClientIntegrationStatus,
      connection_kind: template.connectionKind,
      config: buildIntegrationConfig(template, { primaryRef: '', notes: '', approvalRequired: true }),
      capabilities: template.capabilities,
      scopes: template.scopes,
      health_status: 'unknown',
      health_detail: launchMeta(template).adapterState,
      created_by: userId,
      updated_by: userId,
    }))

    const { data, error } = await supabase
      .from('client_integrations')
      .insert(payloads)
      .select('*')

    setSaving(false)
    if (error) {
      setMessage({ type: 'err', text: error.message })
      return
    }

    const inserted = (data ?? []) as ClientIntegration[]
    setRows(prev => [...prev, ...inserted])
    setMessage({ type: 'ok', text: `First-wave plan added for ${activeProject.name}.` })
  }

  const connectedCount = rows.filter(row => row.status === 'connected').length
  const pendingCount = rows.filter(row => row.status === 'pending' || row.status === 'not_connected').length
  const publishCount = rows.filter(row => row.status === 'connected' && row.capabilities.publish).length
  const waveOneRows = WAVE_ONE_TEMPLATES.map(template => rowByProvider.get(template.provider)).filter(Boolean) as ClientIntegration[]
  const waveOneConnectedCount = waveOneRows.filter(row => row.status === 'connected').length
  const missingWaveOneCount = WAVE_ONE_TEMPLATES.length - waveOneRows.length

  if (!activeProject) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <p style={{ color: 'var(--ink)', fontSize: 'var(--t-body)', fontWeight: 650, margin: 0 }}>Agentic integrations</p>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', margin: '4px 0 0' }}>
          Select a space before configuring search, analytics, and publishing connections.
        </p>
      </div>
    )
  }

  const StatusIcon = STATUS_META[draft.status].icon
  const SelectedIcon = selectedTemplate.icon
  const selectedLaunch = launchMeta(selectedTemplate)
  const selectedDemandPlatform = demandPlatformForProvider(selectedTemplate.provider)
  const workspaceResearchPresent = !!researchProfile?.unipile_account_id
  const workspaceResearchUsable = isUsableUnipileProfile(researchProfile)
  const platformResearchUsable = isUsableUnipileProfile(platformResearchProfile)
  const workspaceResearchAccountId = workspaceResearchUsable ? researchProfile?.unipile_account_id ?? null : null
  const platformResearchAccountId = platformResearchUsable ? platformResearchProfile?.unipile_account_id ?? null : null
  const workspaceResearchConnected = workspaceResearchUsable
  const platformResearchConnected = platformResearchUsable
  const researchConnected = workspaceResearchConnected || platformResearchConnected
  const researchAccountId = workspaceResearchAccountId ?? platformResearchAccountId
  const researchScope = workspaceResearchConnected ? 'Workspace' : platformResearchConnected ? 'InnovareAI shared' : 'Research'
  const researchHealth = workspaceResearchConnected
    ? researchProfile?.unipile_health_status ?? 'unknown'
    : platformResearchConnected
      ? platformResearchProfile?.unipile_health_status ?? 'unknown'
      : workspaceResearchPresent
        ? researchProfile?.unipile_health_status ?? 'unknown'
        : 'not connected'
  const workspaceResearchStale = workspaceResearchPresent && !workspaceResearchUsable
  const selectedClientUnipileAccountId = selectedProvider === 'linkedin' ? integrationUnipileAccountId(selectedRow) : null
  const selectedLinkedInPublishingConnected = selectedProvider === 'linkedin' && draft.status === 'connected' && !!selectedClientUnipileAccountId

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p style={{ color: 'var(--ink)', fontSize: 'var(--t-body)', fontWeight: 700, margin: 0 }}>
            Agentic integrations
          </p>
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', lineHeight: 1.5, margin: '5px 0 0', maxWidth: 680 }}>
            Register organic social, content platforms, search, analytics, WordPress, and CMS routes per space. Vera reads these capability records before she analyzes, ingests, or publishes anything.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 min-w-[300px]">
          <Metric label="Connected" value={connectedCount} />
          <Metric label="Planned" value={pendingCount} />
          <Metric label="Publish" value={publishCount} />
        </div>
      </div>

      <div className="mt-4" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)', padding: 14 }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: '#0a66c218',
                color: '#0a66c2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Search size={17} />
            </span>
            <div className="min-w-0">
              <p style={{ color: 'var(--ink)', fontSize: 'var(--t-sm)', fontWeight: 750, margin: 0 }}>
                Shared LinkedIn research profile
              </p>
              <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '4px 0 0', maxWidth: 760 }}>
                Vera uses this only for read-only LinkedIn research: audits, source pulls, profile context, company-page context, and recent-post intelligence. It never grants publishing, media, spend, or company-page posting rights. Publishing still requires the active space LinkedIn integration below.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span style={{
                  ...chipStyle,
                  color: researchConnected ? '#059669' : '#78716c',
                  background: researchConnected ? '#05966914' : 'var(--paper)',
                }}>
                  {loadingResearchProfile
                    ? 'Checking profile'
                    : researchConnected && researchAccountId
                      ? `${researchScope}: ${maskAccountId(researchAccountId)}`
                      : 'Not connected'}
                </span>
                {platformResearchConnected && !workspaceResearchConnected && (
                  <span style={chipStyle}>InnovareAI profile, research only</span>
                )}
                {workspaceResearchStale && platformResearchConnected && (
                  <span style={chipStyle}>Workspace profile needs reconnect</span>
                )}
                <span style={chipStyle}>Cannot publish</span>
                <span style={chipStyle}>Cannot spend space credits</span>
                <span style={chipStyle}>Health: {researchHealth}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={connectResearchProfile}
              disabled={saving || connectingResearchProfile}
              className="inline-flex items-center gap-2"
              style={{
                ...secondaryButtonStyle,
                color: '#0a66c2',
                borderColor: '#0a66c2',
                opacity: saving || connectingResearchProfile ? 0.65 : 1,
              }}
            >
              {connectingResearchProfile ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              {workspaceResearchPresent ? 'Reconnect workspace profile' : 'Connect workspace profile'}
            </button>
            {workspaceResearchPresent && (
              <button
                type="button"
                onClick={removeResearchProfile}
                disabled={removingResearchProfile}
                className="inline-flex items-center gap-2"
                style={{ ...secondaryButtonStyle, color: '#dc2626' }}
              >
                {removingResearchProfile ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remove research profile
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)', padding: 14 }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2" style={{ color: 'var(--ink)', fontSize: 'var(--t-sm)', fontWeight: 750, margin: 0 }}>
              <Rocket size={15} /> First-wave integrations
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '4px 0 0', maxWidth: 680 }}>
              Focus on Search Console, GA4, LinkedIn through Unipile, WordPress, Meta, YouTube, Medium, Quora, and Reddit first. X stays manual-first until paid API usage is justified.
            </p>
          </div>
          <button
            type="button"
            onClick={createFirstWavePlan}
            disabled={saving || missingWaveOneCount === 0}
            className="inline-flex items-center gap-2"
            style={{
              ...secondaryButtonStyle,
              minHeight: 34,
              opacity: missingWaveOneCount === 0 ? 0.6 : 1,
            }}
          >
            <ListChecks size={14} />
            {missingWaveOneCount === 0 ? 'First wave planned' : `Plan ${missingWaveOneCount} missing`}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {WAVE_ONE_TEMPLATES.map(template => {
            const row = rowByProvider.get(template.provider)
            const launch = launchMeta(template)
            const demandPlatform = demandPlatformForProvider(template.provider)
            const ProviderIcon = template.icon
            const status = row?.status ?? 'not_connected'
            const StatusDot = STATUS_META[status].icon
            const active = selectedProvider === template.provider
            const scopeHint = template.provider === 'linkedin' ? linkedInScopeHint(row, researchConnected) : null
            return (
              <button
                type="button"
                key={template.provider}
                data-integration-tile={template.provider}
                onClick={() => {
                  setSelectedProvider(template.provider)
                  setMessage(null)
                }}
                className="text-left"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '30px minmax(0,1fr)',
                  gap: 9,
                  minHeight: 78,
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${active ? template.accent : 'var(--line)'}`,
                  background: active ? `${template.accent}10` : 'var(--surface)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 'var(--radius-md)',
                    background: `${template.accent}18`,
                    color: template.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ProviderIcon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span style={{ fontSize: 12, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {template.label}
                    </span>
                    <span className="inline-flex items-center gap-1" style={{ color: STATUS_META[status].color, fontSize: 10, flexShrink: 0 }}>
                      <StatusDot size={10} />
                      {STATUS_LABELS[status]}
                    </span>
                  </span>
                  <span style={{ display: 'block', color: 'var(--ink-2)', fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>
                    {launch.workstream}
                  </span>
                  <span style={{ display: 'block', color: 'var(--ghost)', fontSize: 10, lineHeight: 1.25, marginTop: 4 }}>
                    {demandPlatform ? `${publishingModeLabel(demandPlatform.publishing)} · ${demandPlatform.outcomeSignals.slice(0, 2).join(', ')}` : launch.adapterState}
                  </span>
                  {scopeHint && (
                    <span style={{ display: 'block', color: template.accent, fontSize: 10, lineHeight: 1.25, marginTop: 4, fontWeight: 700 }}>
                      {scopeHint}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Wave connected" value={waveOneConnectedCount} />
          <Metric label="Wave planned" value={waveOneRows.length} />
          <Metric label="Missing" value={missingWaveOneCount} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(280px,0.85fr)_minmax(420px,1.15fr)] gap-4">
        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)' }}>
              <Loader2 size={14} className="animate-spin" /> Loading integrations
            </div>
          )}
          {PROVIDER_GROUPS.map(group => (
            <div key={group} className="space-y-2">
              <p style={{ color: 'var(--ink-2)', fontSize: 11, fontWeight: 750, letterSpacing: 0, margin: '12px 2px 4px' }}>
                {group}
              </p>
              {PROVIDERS.filter(template => template.group === group).map(template => {
                const row = rowByProvider.get(template.provider)
                const active = selectedProvider === template.provider
                const status = row?.status ?? 'not_connected'
                const statusMeta = STATUS_META[status]
                const demandPlatform = demandPlatformForProvider(template.provider)
                const ProviderIcon = template.icon
                const RowStatusIcon = statusMeta.icon
                const scopeHint = template.provider === 'linkedin' ? linkedInScopeHint(row, researchConnected) : null
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
                      {demandPlatform && (
                        <span style={{ display: 'block', color: 'var(--ghost)', fontSize: 11, lineHeight: 1.35, marginTop: 3 }}>
                          {publishingModeLabel(demandPlatform.publishing)} · {demandPlatform.outcomeSignals.slice(0, 2).join(', ')}
                        </span>
                      )}
                      {scopeHint && (
                        <span style={{ display: 'block', color: template.accent, fontSize: 11, lineHeight: 1.35, marginTop: 3, fontWeight: 700 }}>
                          {scopeHint}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
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
            {selectedDemandPlatform && (
              <div style={{ background: `${selectedTemplate.accent}0f`, border: `1px solid ${selectedTemplate.accent}26`, borderRadius: 'var(--radius-md)', padding: 12 }}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-2" style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 750, margin: 0 }}>
                      <Rocket size={14} style={{ color: selectedTemplate.accent }} />
                      Demand role
                    </p>
                    <p style={{ color: 'var(--ink)', fontSize: 13, lineHeight: 1.45, margin: '5px 0 0' }}>
                      {selectedDemandPlatform.role}
                    </p>
                    <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '5px 0 0' }}>
                      {selectedDemandPlatform.workflow}
                    </p>
                  </div>
                  <span
                    style={{
                      ...chipStyle,
                      color: selectedTemplate.accent,
                      background: 'var(--surface)',
                      borderColor: `${selectedTemplate.accent}3a`,
                      flexShrink: 0,
                    }}
                  >
                    {publishingModeLabel(selectedDemandPlatform.publishing)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedDemandPlatform.outcomeSignals.map(signal => (
                    <span key={signal} style={{ ...chipStyle, color: selectedTemplate.accent, background: 'var(--surface)' }}>{signal}</span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div className="flex items-start gap-2">
                <ShieldCheck size={15} style={{ color: selectedTemplate.accent, flexShrink: 0, marginTop: 1 }} />
                <div className="min-w-0">
                  <p style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 750, margin: 0 }}>Connection scope guard</p>
                  {selectedProvider === 'linkedin' ? (
                    <>
                      <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '4px 0 0' }}>
                        LinkedIn research can use the shared profile. LinkedIn publishing can only use this active space integration.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span style={{ ...chipStyle, color: researchConnected ? '#059669' : '#78716c' }}>
                          Research: {researchConnected && researchAccountId ? `${researchScope} ${maskAccountId(researchAccountId)}` : 'not connected'}
                        </span>
                        <span style={{ ...chipStyle, color: selectedLinkedInPublishingConnected ? '#059669' : '#78716c' }}>
                          Publishing: {selectedClientUnipileAccountId ? `space ${maskAccountId(selectedClientUnipileAccountId)}` : 'not connected for this space'}
                        </span>
                        <span style={chipStyle}>Shared profile cannot publish</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '4px 0 0' }}>
                        This integration belongs to {activeProject.name}. Other spaces cannot use its credentials, publish rights, or spend path.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span style={chipStyle}>Space scoped</span>
                        <span style={chipStyle}>No shared credentials</span>
                        <span style={chipStyle}>Approval required: {draft.approvalRequired ? 'yes' : 'no'}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2" style={{ color: 'var(--ink)', fontSize: 12, fontWeight: 700, margin: 0 }}>
                    <Wrench size={14} style={{ color: selectedTemplate.accent }} />
                    Launch path
                  </p>
                  <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: '4px 0 0' }}>
                    {selectedLaunch.adapterState}
                  </p>
                </div>
                <span
                  style={{
                    ...chipStyle,
                    color: selectedLaunch.priority === 'wave_1' ? selectedTemplate.accent : 'var(--ink-2)',
                    background: selectedLaunch.priority === 'wave_1' ? `${selectedTemplate.accent}12` : 'var(--paper-2)',
                    flexShrink: 0,
                  }}
                >
                  {selectedLaunch.priority === 'wave_1' ? 'Wave 1' : selectedLaunch.priority === 'wave_2' ? 'Wave 2' : 'Later'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                <div>
                  <p style={{ color: 'var(--ink)', fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>Required setup</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLaunch.requirements.map(requirement => (
                      <span key={requirement} style={chipStyle}>{requirement}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p style={{ color: 'var(--ink)', fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>Next build</p>
                  <p style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.45, margin: 0 }}>
                    {selectedLaunch.nextBuild}
                  </p>
                </div>
              </div>
            </div>

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
                {isGoogleOauthProvider && (
                  <button
                    type="button"
                    onClick={connectGoogle}
                    disabled={saving || connectingGoogle}
                    className="inline-flex items-center gap-2"
                    style={{
                      ...secondaryButtonStyle,
                      color: selectedTemplate.accent,
                      borderColor: selectedTemplate.accent,
                      opacity: saving || connectingGoogle ? 0.65 : 1,
                    }}
                  >
                    {connectingGoogle ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Connect Google
                  </button>
                )}
                {isMetaOauthProvider && (
                  <button
                    type="button"
                    onClick={connectMeta}
                    disabled={saving || connectingMeta}
                    className="inline-flex items-center gap-2"
                    style={{
                      ...secondaryButtonStyle,
                      color: selectedTemplate.accent,
                      borderColor: selectedTemplate.accent,
                      opacity: saving || connectingMeta ? 0.65 : 1,
                    }}
                  >
                    {connectingMeta ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Connect Meta
                  </button>
                )}
                {isUnipileOauthProvider && (
                  <button
                    type="button"
                    onClick={connectUnipile}
                    disabled={saving || connectingUnipile}
                    className="inline-flex items-center gap-2"
                    style={{
                      ...secondaryButtonStyle,
                      color: selectedTemplate.accent,
                      borderColor: selectedTemplate.accent,
                      opacity: saving || connectingUnipile ? 0.65 : 1,
                    }}
                  >
                    {connectingUnipile ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    {draft.status === 'connected' ? 'Reconnect space LinkedIn publishing' : 'Connect space LinkedIn publishing'}
                  </button>
                )}
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
