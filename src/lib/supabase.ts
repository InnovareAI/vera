import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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
  airtable_base_id?: string
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Post {
  id: string
  org_id?: string
  campaign_id?: string
  brief_id?: string
  persona_id?: string
  title?: string
  copy: string
  format: string
  channel: string
  status: string
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

export interface Campaign {
  id: string
  org_id: string
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
