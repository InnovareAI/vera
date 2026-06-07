import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Auth config mirrors SAM (app/lib/supabase.ts): PKCE + detect-session-in-URL
// so Google/Microsoft SSO and magic links actually complete. VERA is a SPA
// (no server /auth/callback), so the client itself exchanges the ?code= on
// load — which only works with flowType 'pkce' + detectSessionInUrl.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Organisation {
  id: string
  name: string
  slug: string
  plan: 'starter' | 'growth' | 'scale' | 'enterprise'
  logo_url?: string
  website?: string
  industry?: string
  timezone: string
  locale: string
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Post {
  id: string
  org_id?: string
  project_id?: string | null
  campaign_id?: string
  brief_id?: string
  persona_id?: string
  title?: string
  copy: string
  format: string
  channel: string
  status: string
  category?: string | null        // content category (à la SocialBee) — set by Vera
  publish_date?: string
  scheduled_at?: string
  published_at?: string
  author?: string
  profile_name?: string
  profile_title?: string
  hashtags?: string[]
  model_used?: string
  agent_outputs?: Record<string, unknown>
  image_prompt?: string
  media_url?: string
  media_type?: string
  media_metadata?: Record<string, unknown> | null
  review_token?: string | null
  review_token_expires_at?: string | null
  review_token_revoked_at?: string | null
  feedback?: string
  compliance_checks?: Record<string, unknown>
  created_by?: string
  posted_at?: string | null
  posted_url?: string | null
  created_at: string
  updated_at: string
}

export interface Audience {
  id: string
  org_id: string
  kind: 'icp' | 'buyer_persona' | 'consumer_persona' | 'audience'
  name: string
  is_primary: boolean
  pain_points: string[]
  goals: string[]
  attributes: Record<string, unknown>
  parent_id?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

// ─── Projects — Claude.ai-style bounded scopes within a workspace ────────
// One workspace can have many projects. Each project has its own custom
// instructions (injected into VERA's system prompt) and knowledge base.
// Every artifact (campaign, post, chat, audit, voice) gets tagged with
// project_id once migration 026 lands.
export interface Project {
  id: string
  org_id: string
  name: string
  slug: string
  description: string | null
  instructions: string | null
  is_starred: boolean
  is_archived: boolean
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface ProjectKnowledge {
  id: string
  project_id: string
  title: string
  content: string
  source_kind: 'paste' | 'url' | 'upload'
  source_url: string | null
  file_name: string | null
  file_size: number | null
  created_at: string
  updated_at: string
}

export interface Campaign {
  id: string
  org_id: string
  project_id?: string                  // 026 — added by projects migration
  name: string
  theme?: string | null               // narrative anchor, flows into the Strategist
  description?: string
  goal?: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  start_date?: string
  end_date?: string
  platforms?: string[]
  post_count: number
  color?: string                       // 'oxblood' | ... — UI accent
  is_pinned?: boolean                  // surfaces in the rail's Pinned section
  created_at: string
  updated_at: string
}

export interface ContentBrief {
  id: string
  org_id: string
  campaign_id?: string
  persona_id?: string
  title?: string
  objective: string
  platform: string
  content_type: string
  key_messages?: string[]
  angle?: string
  cta?: string
  model_preference?: string
  created_at: string
  updated_at: string
}

export interface BrandVoice {
  id: string
  org_id: string
  project_id?: string | null   // per-client voice; null = workspace default
  tone?: string[]
  writing_rules?: string[]
  forbidden_phrases?: string[]
  required_phrases?: string[]
  persona_name?: string
  persona_gender?: string
  persona_descriptor?: string
  sample_posts?: string[]
  system_prompt?: string
  created_at: string
  updated_at: string
}

export interface Persona {
  id: string
  org_id: string
  name: string
  title?: string
  pain_points?: string[]
  goals?: string[]
  channels?: string[]
  seniority?: string
  industry?: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface PlatformConfig {
  id: string
  org_id: string
  platform: string
  is_active: boolean
  char_limit?: number
  best_times?: string[]
  hashtag_limit: number
  default_hashtags?: string[]
  content_types?: string[]
  model_override?: string
  tone_override?: string
  access_token?: string
  created_at: string
  updated_at: string
}

export type ClientIntegrationProvider =
  | 'google_search_console'
  | 'google_analytics_4'
  | 'meta_facebook_pages'
  | 'meta_instagram'
  | 'meta_threads'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'pinterest'
  | 'reddit'
  | 'bluesky'
  | 'wordpress'
  | 'webflow'
  | 'contentful'
  | 'sanity'
  | 'strapi'
  | 'hubspot_cms'
  | 'ghost'
  | 'shopify_blog'
  | 'custom_cms'

export type ClientIntegrationCategory =
  | 'analytics'
  | 'seo'
  | 'social'
  | 'publisher'
  | 'cms'
  | 'content_source'

export type ClientIntegrationStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'error'
  | 'paused'
  | 'revoked'

export type ClientIntegrationConnectionKind =
  | 'oauth'
  | 'api_key'
  | 'app_password'
  | 'webhook'
  | 'manual'
  | 'publisher'

export interface IntegrationCapabilities {
  read?: boolean
  ingest?: boolean
  analyze?: boolean
  publish?: boolean
  upload_media?: boolean
  schedule?: boolean
  [key: string]: boolean | undefined
}

export interface ClientIntegration {
  id: string
  org_id: string
  project_id: string
  provider: ClientIntegrationProvider
  category: ClientIntegrationCategory
  display_name: string
  status: ClientIntegrationStatus
  connection_kind: ClientIntegrationConnectionKind
  config: Record<string, unknown>
  capabilities: IntegrationCapabilities
  scopes: string[]
  credential_ref?: string | null
  external_ref: Record<string, unknown>
  health_status: 'unknown' | 'healthy' | 'stale' | 'error'
  health_detail?: string | null
  last_sync_at?: string | null
  last_health_check?: string | null
  created_by?: string | null
  updated_by?: string | null
  created_at: string
  updated_at: string
}
