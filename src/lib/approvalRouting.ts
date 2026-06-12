import type { BusinessContext } from './businessContext'
import type { Post } from './supabase'

export type ApprovalRouteTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'

export type ApprovalRoute = {
  label: string
  tone: ApprovalRouteTone
  risk: 'low' | 'medium' | 'high'
  reason: string
  checklist: string[]
  approverHint: string
}

const manualFirstChannels = new Set(['medium', 'quora', 'reddit', 'x', 'twitter'])
const stakeholderChannels = new Set(['youtube', 'blog', 'wordpress'])

const claimRiskTerms = [
  'guarantee',
  'guaranteed',
  'compliance',
  'legal',
  'regulated',
  'gdpr',
  'hipaa',
  'medical',
  'healthcare',
  'finance',
  'financial',
  'investment',
  'roi',
  'return on investment',
  'best in class',
  '#1',
  'number one',
  'only solution',
  'always',
  'never',
  'double',
  'triple',
]

const genericNames = new Set([
  'content generator',
  'jennifer fleming',
  'vera',
  'unassigned',
  'default',
])

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function hasAny(source: string, terms: string[]) {
  const haystack = source.toLowerCase()
  return terms.some(term => haystack.includes(term))
}

function isNamedSpeaker(post: Post) {
  const names = [post.author, post.profile_name]
    .map(value => normalize(value))
    .filter(Boolean)
  return names.some(name => !genericNames.has(name))
}

function channelKey(post: Post) {
  const channel = normalize(post.channel)
  if (channel.includes('twitter')) return 'x'
  if (channel.includes('wordpress')) return 'wordpress'
  return channel
}

function contextText(context?: BusinessContext) {
  if (!context) return ''
  return [
    context.approvalModel,
    context.approvalStakeholders,
    context.constraints,
    context.industry,
    context.offer,
  ].filter(Boolean).join(' ')
}

function stakeholderText(context?: BusinessContext) {
  const explicit = context?.approvalStakeholders?.trim()
  if (explicit) return explicit
  return 'Client lead, subject owner, and operator'
}

function baseChecklist(post: Post, context?: BusinessContext) {
  const checks = [
    'Message fits the client positioning',
    'Platform format and CTA are clear',
    'Comments, shares, and traffic goal are explicit',
  ]
  if (context?.platformToneOfVoice?.trim()) checks.push('Tone matches the selected platform voice')
  if (post.media_url || post.media_type) checks.push('Creative asset matches the post and platform dimensions')
  return checks
}

export function approvalRouteForPost(post: Post, context?: BusinessContext): ApprovalRoute {
  const channel = channelKey(post)
  const media = normalize(post.media_type || post.format)
  const copyContext = [post.title, post.copy, post.image_prompt, contextText(context)].filter(Boolean).join(' ')
  const hasClaimRisk = hasAny(copyContext, claimRiskTerms)
  const hasLegalContext = hasAny(contextText(context), ['legal', 'compliance', 'regulated', 'finance', 'medical', 'healthcare'])
  const hasSensitiveClaim = hasClaimRisk || hasLegalContext
  const hasVideo = media.includes('video') || channel === 'youtube'
  const namedSpeaker = isNamedSpeaker(post)
  const checklist = baseChecklist(post, context)
  const stakeholders = stakeholderText(context)

  if (hasSensitiveClaim) {
    return {
      label: 'Legal or compliance',
      tone: 'danger',
      risk: 'high',
      reason: 'The copy or client context includes claims, regulated topics, or compliance-sensitive language.',
      checklist: [
        'Verify claims, numbers, and proof points',
        'Check legal, compliance, and brand constraints',
        'Confirm destination page and CTA are accurate',
        ...checklist,
      ],
      approverHint: stakeholders,
    }
  }

  if (hasVideo || stakeholderChannels.has(channel)) {
    return {
      label: 'All stakeholders',
      tone: 'warning',
      risk: 'medium',
      reason: 'Video, YouTube, blog, and owned content have higher reuse value and public brand weight.',
      checklist: [
        'Approve script, storyboard, visual direction, and CTA',
        'Confirm speaker or brand owner signoff',
        ...checklist,
      ],
      approverHint: stakeholders,
    }
  }

  if (manualFirstChannels.has(channel)) {
    return {
      label: 'Client lead',
      tone: 'info',
      risk: 'medium',
      reason: 'This channel is manual-first or community-sensitive, so a human should own posting context.',
      checklist: [
        'Check community rules, question fit, and comment posture',
        'Confirm the post is helpful before it is promotional',
        ...checklist,
      ],
      approverHint: context?.approvalStakeholders?.trim() || 'Client lead or operator',
    }
  }

  if (namedSpeaker) {
    return {
      label: 'Named speaker',
      tone: 'warning',
      risk: 'medium',
      reason: 'The post appears under a named person, so the speaker should approve voice, stance, and claims.',
      checklist: [
        'Confirm the speaker would say this in their own voice',
        'Check personal profile, company page, and CTA alignment',
        ...checklist,
      ],
      approverHint: post.author?.trim() || post.profile_name?.trim() || 'Named speaker',
    }
  }

  return {
    label: 'Single owner',
    tone: 'success',
    risk: 'low',
    reason: 'Low-risk social post with no named speaker or sensitive claim detected.',
    checklist,
    approverHint: context?.approvalStakeholders?.trim() || 'Operator or assigned reviewer',
  }
}
