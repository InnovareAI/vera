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
}

type ProjectBusinessContext = Record<string, string>

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
  const projectChannels = projectChannelsFromBusinessContext(context)
  if (projectChannels.length) {
    return { project: projectRow, channels: projectChannels, source: "project_brain" }
  }

  // Legacy org-wide channels are only safe for the default workspace project.
  // Client projects must use their own Demand Brain source URLs.
  if (projectRow.is_default) {
    const legacyChannels = await loadLegacyOrgChannels(supabase, orgId)
    if (legacyChannels.length) {
      return { project: projectRow, channels: legacyChannels, source: "legacy_org" }
    }
  }

  return { project: projectRow, channels: [], source: "none" }
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
