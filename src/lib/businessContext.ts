export type BusinessContextKey =
  | 'companyName'
  | 'website'
  | 'linkedinCompany'
  | 'linkedinProfile'
  | 'linkedinEvents'
  | 'linkedinNewsletter'
  | 'instagram'
  | 'youtube'
  | 'medium'
  | 'quora'
  | 'reddit'
  | 'facebook'
  | 'x'
  | 'industry'
  | 'offer'
  | 'audience'
  | 'customerProblems'
  | 'differentiators'
  | 'competitors'
  | 'proofPoints'
  | 'contentGoals'
  | 'speakerStrategy'
  | 'platformToneOfVoice'
  | 'demandObjective'
  | 'conversionPath'
  | 'channelStrategy'
  | 'contentFormats'
  | 'approvalModel'
  | 'approvalStakeholders'
  | 'engagementSignals'
  | 'samHandoffRules'
  | 'learningCadence'
  | 'channelOperatingPolicies'
  | 'constraints'

export type BusinessContext = Record<BusinessContextKey, string>

export const EMPTY_BUSINESS_CONTEXT: BusinessContext = {
  companyName: '',
  website: '',
  linkedinCompany: '',
  linkedinProfile: '',
  linkedinEvents: '',
  linkedinNewsletter: '',
  instagram: '',
  youtube: '',
  medium: '',
  quora: '',
  reddit: '',
  facebook: '',
  x: '',
  industry: '',
  offer: '',
  audience: '',
  customerProblems: '',
  differentiators: '',
  competitors: '',
  proofPoints: '',
  contentGoals: '',
  speakerStrategy: '',
  platformToneOfVoice: '',
  demandObjective: '',
  conversionPath: '',
  channelStrategy: '',
  contentFormats: '',
  approvalModel: '',
  approvalStakeholders: '',
  engagementSignals: '',
  samHandoffRules: '',
  learningCadence: '',
  channelOperatingPolicies: '',
  constraints: '',
}

const BUSINESS_CONTEXT_START = '[[VERA_BUSINESS_CONTEXT]]'
const BUSINESS_CONTEXT_END = '[[/VERA_BUSINESS_CONTEXT]]'

const BUSINESS_CONTEXT_FIELDS: Array<{ key: BusinessContextKey; label: string }> = [
  { key: 'website', label: 'Website' },
  { key: 'linkedinCompany', label: 'LinkedIn company page' },
  { key: 'linkedinProfile', label: 'LinkedIn profile' },
  { key: 'linkedinEvents', label: 'LinkedIn events' },
  { key: 'linkedinNewsletter', label: 'LinkedIn newsletter' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'medium', label: 'Medium' },
  { key: 'quora', label: 'Quora' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'facebook', label: 'Facebook page' },
  { key: 'x', label: 'X profile' },
  { key: 'companyName', label: 'Company' },
  { key: 'industry', label: 'Industry' },
  { key: 'offer', label: 'Offer' },
  { key: 'audience', label: 'Target audience' },
  { key: 'customerProblems', label: 'Customer problems' },
  { key: 'differentiators', label: 'Differentiators' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'proofPoints', label: 'Proof points' },
  { key: 'contentGoals', label: 'Content goals' },
  { key: 'speakerStrategy', label: 'Speaker strategy' },
  { key: 'platformToneOfVoice', label: 'Platform tone of voice' },
  { key: 'demandObjective', label: 'Demand objective' },
  { key: 'conversionPath', label: 'Conversion path' },
  { key: 'channelStrategy', label: 'Channel strategy' },
  { key: 'contentFormats', label: 'Content formats' },
  { key: 'approvalModel', label: 'Approval model' },
  { key: 'approvalStakeholders', label: 'Approval stakeholders' },
  { key: 'engagementSignals', label: 'Engagement signals' },
  { key: 'samHandoffRules', label: 'SAM handoff rules' },
  { key: 'learningCadence', label: 'Learning cadence' },
  { key: 'channelOperatingPolicies', label: 'Channel operating policies' },
  { key: 'constraints', label: 'Constraints' },
]

function encodeBusinessContextValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
}

function decodeBusinessContextValue(value: string): string {
  let decoded = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    const next = value[i + 1]
    if (char === '\\' && next === 'n') {
      decoded += '\n'
      i += 1
    } else if (char === '\\' && next === '\\') {
      decoded += '\\'
      i += 1
    } else {
      decoded += char
    }
  }
  return decoded
}

export function hasBusinessContext(context: BusinessContext): boolean {
  return BUSINESS_CONTEXT_FIELDS.some(({ key }) => context[key].trim().length > 0)
}

export function buildBusinessContextBlock(context: BusinessContext): string {
  const rows = BUSINESS_CONTEXT_FIELDS
    .map(({ key, label }) => ({ label, value: context[key].trim() }))
    .filter(({ value }) => value.length > 0)

  if (rows.length === 0) return ''

  return [
    BUSINESS_CONTEXT_START,
    'Business context for this client. Use this before drafting, planning, or answering.',
    ...rows.map(({ label, value }) => `- ${label}: ${encodeBusinessContextValue(value)}`),
    BUSINESS_CONTEXT_END,
  ].join('\n')
}

export function parseProjectInstructions(raw: string | null | undefined): {
  customInstructions: string
  businessContext: BusinessContext
} {
  const source = raw ?? ''
  const start = source.indexOf(BUSINESS_CONTEXT_START)
  const end = source.indexOf(BUSINESS_CONTEXT_END)
  if (start < 0 || end < start) {
    return {
      customInstructions: source.trim(),
      businessContext: { ...EMPTY_BUSINESS_CONTEXT },
    }
  }

  const block = source.slice(start + BUSINESS_CONTEXT_START.length, end)
  const customInstructions = `${source.slice(0, start)}${source.slice(end + BUSINESS_CONTEXT_END.length)}`.trim()
  const businessContext = { ...EMPTY_BUSINESS_CONTEXT }

  for (const line of block.split('\n')) {
    const match = line.match(/^\s*-\s*([^:]+):\s*(.*)\s*$/)
    if (!match) continue
    const label = match[1].trim().toLowerCase()
    const value = decodeBusinessContextValue(match[2].trim())
    const field = BUSINESS_CONTEXT_FIELDS.find(item => item.label.toLowerCase() === label)
    if (field) businessContext[field.key] = value
  }

  return { customInstructions, businessContext }
}

export function mergeProjectInstructions(customInstructions: string, businessContext: BusinessContext): string | null {
  const businessBlock = buildBusinessContextBlock(businessContext)
  const custom = customInstructions.trim()
  const merged = [businessBlock, custom].filter(Boolean).join('\n\n').trim()
  return merged || null
}

export function compactProjectDescription(context: BusinessContext): string | null {
  const website = context.website.trim()
  if (website) return website
  const industry = context.industry.trim()
  if (industry) return industry
  const offer = context.offer.trim().replace(/\s+/g, ' ')
  if (offer) return offer.length > 96 ? `${offer.slice(0, 93).trimEnd()}...` : offer
  return null
}
