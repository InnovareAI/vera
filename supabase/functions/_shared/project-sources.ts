import type { AdminClient } from "./auth.ts"

export type AuditChannelProfile = {
  channel: string
  url: string
}

export type ProjectSourceResolution = {
  project: {
    id: string
    name: string
    org_id: string
    is_default: boolean
    instructions: string | null
  }
  channels: AuditChannelProfile[]
  source: "project_brain" | "legacy_org" | "none"
  sourcePullDepth: SourcePullDepth
}

const BUSINESS_CONTEXT_START = "[[VERA_BUSINESS_CONTEXT]]"
const BUSINESS_CONTEXT_END = "[[/VERA_BUSINESS_CONTEXT]]"

const LABEL_TO_KEY: Record<string, string> = {
  "website": "website",
  "linkedin company page": "linkedinCompany",
  "linkedin profile": "linkedinProfile",
  "linkedin events": "linkedinEvents",
  "linkedin newsletter": "linkedinNewsletter",
  "instagram": "instagram",
  "youtube": "youtube",
  "medium": "medium",
  "quora": "quora",
  "reddit": "reddit",
  "facebook page": "facebook",
  "x profile": "x",
  "source pull depth": "sourcePullDepth",
  "active channels": "activeChannels",
  "platform tone of voice": "platformToneOfVoice",
  "content objective": "demandObjective",
  "channel strategy": "channelStrategy",
  "content formats": "contentFormats",
}

type ProjectBusinessContext = Record<string, string>
export type SourcePullDepth = "light" | "standard" | "deep"
const LINKEDIN_SOURCE_KEYS = ["linkedinCompany", "linkedinProfile", "linkedinEvents", "linkedinNewsletter"]
const LINKEDIN_CHANNELS = new Set(["linkedin_company", "linkedin_personal", "linkedin_events", "linkedin_newsletter"])
const DEMAND_PLATFORM_KEYS = ["linkedin", "youtube", "medium", "quora", "reddit", "x", "instagram", "facebook", "blog", "email"] as const
type DemandPlatformKey = typeof DEMAND_PLATFORM_KEYS[number]
const PLATFORM_ALIASES: Record<DemandPlatformKey, string[]> = {
  linkedin: ["linkedin", "linkedin company", "linkedin company page", "linkedin profile", "linkedin personal", "linkedin events", "linkedin newsletter", "li"],
  youtube: ["youtube", "you tube", "youtube channel", "shorts"],
  medium: ["medium"],
  quora: ["quora"],
  reddit: ["reddit"],
  x: ["x", "twitter", "x.com"],
  instagram: ["instagram", "instagram profile", "ig", "reels"],
  facebook: ["facebook", "facebook page", "fb"],
  blog: ["blog", "website", "company website", "seo", "article", "wordpress", "cms"],
  email: ["email", "newsletter", "nurture"],
}

export async function resolveProjectAuditChannels(
  supabase: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ProjectSourceResolution> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id, name, is_default, instructions")
    .eq("id", projectId)
    .maybeSingle()

  if (projectError) throw new Error(`Project source lookup failed: ${projectError.message}`)
  if (!project) throw new Error("Client project not found")

  const projectRow = project as ProjectSourceResolution["project"]
  if (projectRow.org_id !== orgId) throw new Error("Project does not belong to this workspace")

  const context = parseProjectBusinessContext(projectRow.instructions)
  const sourcePullDepth = normalizeSourcePullDepth(context.sourcePullDepth)
  const projectChannels = projectChannelsFromBusinessContext(context)
  if (projectChannels.length) {
    return { project: projectRow, channels: projectChannels, source: "project_brain", sourcePullDepth }
  }

  // Legacy org-wide channels are only safe for the default workspace project.
  // Client projects must use their own Strategy Brain source URLs.
  if (projectRow.is_default) {
    const legacyChannels = await loadLegacyOrgChannels(supabase, orgId)
    if (legacyChannels.length) {
      return { project: projectRow, channels: legacyChannels, source: "legacy_org", sourcePullDepth }
    }
  }

  return { project: projectRow, channels: [], source: "none", sourcePullDepth }
}

export function parseProjectBusinessContext(raw: string | null | undefined): ProjectBusinessContext {
  const source = raw ?? ""
  const start = source.indexOf(BUSINESS_CONTEXT_START)
  const end = source.indexOf(BUSINESS_CONTEXT_END)
  if (start < 0 || end < start) return {}

  const block = source.slice(start + BUSINESS_CONTEXT_START.length, end)
  const context: ProjectBusinessContext = {}
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*-\s*([^:]+):\s*(.*)\s*$/)
    if (!match) continue
    const key = LABEL_TO_KEY[match[1].trim().toLowerCase()]
    const value = decodeBusinessContextValue(match[2].trim())
    if (key && value) context[key] = value
  }
  return context
}

export function projectChannelsFromBusinessContext(context: ProjectBusinessContext): AuditChannelProfile[] {
  const channels: AuditChannelProfile[] = []

  addChannel(channels, "blog", context.website)
  addChannel(channels, "linkedin_company", context.linkedinCompany)
  addChannel(channels, "linkedin_personal", context.linkedinProfile)
  addChannel(channels, "linkedin_events", context.linkedinEvents)
  addChannel(channels, "linkedin_newsletter", context.linkedinNewsletter)
  addChannel(channels, "instagram", context.instagram)
  addChannel(channels, "medium", context.medium)
  addChannel(channels, "youtube", context.youtube)
  addChannel(channels, "quora", context.quora)
  addChannel(channels, "reddit", context.reddit)
  addChannel(channels, "facebook", context.facebook)
  addChannel(channels, "twitter", context.x)

  return dedupeChannels(channels)
}

export function linkedInPersonalUrl(channels: AuditChannelProfile[]): string | null {
  return channels.find(channel => channel.channel === "linkedin_personal")?.url ?? null
}

export function projectHasLinkedInStrategy(sourceResolution: ProjectSourceResolution): boolean {
  const context = parseProjectBusinessContext(sourceResolution.project.instructions)
  const activeChannels = activeChannelKeysFromText(context.activeChannels)
  if (activeChannels.length) return activeChannels.includes("linkedin")
  if (sourceResolution.channels.some(channel => LINKEDIN_CHANNELS.has(channel.channel))) return true
  if (LINKEDIN_SOURCE_KEYS.some(key => cleanString(context[key]))) return true
  const strategyText = [
    context.channelStrategy,
    context.contentFormats,
    context.platformToneOfVoice,
    context.demandObjective,
  ].filter(Boolean).join(" ").toLowerCase()
  return textMentionsAlias(strategyText, "linkedin") || textMentionsAlias(strategyText, "li")
}

async function loadLegacyOrgChannels(
  supabase: AdminClient,
  orgId: string,
): Promise<AuditChannelProfile[]> {
  const { data: channels, error } = await supabase
    .from("channel_profiles")
    .select("channel, url")
    .eq("org_id", orgId)
    .eq("is_active", true)
  if (error) throw new Error(`Legacy channel lookup failed: ${error.message}`)
  return dedupeChannels(((channels ?? []) as AuditChannelProfile[])
    .filter(channel => cleanString(channel.channel) && cleanString(channel.url)))
}

function addChannel(channels: AuditChannelProfile[], channel: string, rawUrl: string | undefined) {
  const url = cleanString(rawUrl)
  if (!url) return
  channels.push({ channel, url })
}

function dedupeChannels(channels: AuditChannelProfile[]): AuditChannelProfile[] {
  const seen = new Set<string>()
  const out: AuditChannelProfile[] = []
  for (const channel of channels) {
    const key = `${channel.channel}:${channel.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(channel)
  }
  return out
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeSourcePullDepth(value: string | undefined): SourcePullDepth {
  if (value === "light" || value === "deep" || value === "standard") return value
  return "standard"
}

function activeChannelKeysFromText(raw: string | undefined): DemandPlatformKey[] {
  const source = raw?.trim()
  if (!source) return []
  let values: string[] = []
  try {
    const parsed = JSON.parse(source) as unknown
    if (Array.isArray(parsed)) values = parsed.map(item => String(item))
  } catch {
    values = source.split(/[\n,;|]+/)
  }
  const keys: DemandPlatformKey[] = []
  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (!normalized) continue
    const key = DEMAND_PLATFORM_KEYS.find(candidate => (
      candidate === normalized ||
      PLATFORM_ALIASES[candidate].some(alias => alias.toLowerCase() === normalized)
    ))
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

function textMentionsAlias(haystack: string, alias: string): boolean {
  const needle = alias.toLowerCase().trim()
  if (!needle) return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9.])${escaped}([^a-z0-9.]|$)`, "i").test(haystack)
}

function decodeBusinessContextValue(value: string): string {
  let decoded = ""
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    const next = value[i + 1]
    if (char === "\\" && next === "n") {
      decoded += "\n"
      i += 1
    } else if (char === "\\" && next === "\\") {
      decoded += "\\"
      i += 1
    } else {
      decoded += char
    }
  }
  return decoded.trim()
}
