// Shared chip components — Notion / Asana / Linear pattern: neutral grey
// background with a small coloured dot prefix instead of bright pill colours.
// Replaces the older `bg-blue-100 text-blue-700`-style platform pills.

import type { ReactNode } from 'react'

// Mapping from platform name → CSS variable name for the dot colour. The CSS
// vars are defined in index.css (--dot-blue, --dot-sky, etc.).
const PLATFORM_DOT: Record<string, string> = {
  linkedin: 'var(--dot-blue)',
  twitter: 'var(--dot-sky)',
  x: 'var(--dot-sky)',
  instagram: 'var(--dot-pink)',
  quora: 'var(--dot-rose)',
  facebook: 'var(--dot-indigo)',
  blog: 'var(--dot-amber)',
  email: 'var(--dot-emerald)',
  medium: 'var(--dot-violet)',
  reddit: 'var(--dot-orange)',
  substack: 'var(--dot-pink)',
}

// Mapping from status (lowercase) → dot colour.
const STATUS_DOT: Record<string, string> = {
  pending: 'var(--dot-amber)',
  'pending review': 'var(--dot-amber)',
  draft: 'var(--dot-amber)',
  changes_requested: 'var(--dot-amber)',
  'changes requested': 'var(--dot-amber)',
  approved: 'var(--dot-green)',
  scheduled: 'var(--dot-blue)',
  published: 'var(--dot-green)',
  posted: 'var(--dot-green)',
  rejected: 'var(--dot-rose)',
  active: 'var(--dot-green)',
  completed: 'var(--ghost)',
  archived: 'var(--ghost)',
}

interface ChipProps {
  children: ReactNode
  dotColor?: string
  size?: 'sm' | 'md'
  variant?: 'neutral' | 'subtle'
  className?: string
  title?: string
}

// Base chip — small rounded grey chip, optional coloured dot prefix.
export function Chip({ children, dotColor, size = 'md', variant = 'neutral', className = '', title }: ChipProps) {
  const sizing = size === 'sm'
    ? 'text-[11px] px-1.5 py-0.5 gap-1'
    : 'text-[12px] px-2 py-0.5 gap-1.5'
  const bg = variant === 'subtle' ? 'transparent' : 'var(--fog)'
  return (
    <span
      title={title}
      className={`inline-flex items-center font-medium ${sizing} ${className}`}
      style={{ background: bg, color: 'var(--ink-quiet)', borderRadius: 'var(--radius-sm)' }}
    >
      {dotColor && (
        <span
          className={size === 'sm' ? 'w-1.5 h-1.5' : 'w-1.5 h-1.5'}
          style={{ background: dotColor, borderRadius: '50%', flexShrink: 0 }}
        />
      )}
      {children}
    </span>
  )
}

export function PlatformChip({ channel, size = 'md' }: { channel?: string | null; size?: 'sm' | 'md' }) {
  if (!channel) return null
  const dot = PLATFORM_DOT[channel.toLowerCase()] ?? 'var(--mist)'
  return <Chip dotColor={dot} size={size}>{channel}</Chip>
}

export function StatusChip({ status, size = 'md' }: { status?: string | null; size?: 'sm' | 'md' }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const dot = STATUS_DOT[lower] ?? 'var(--mist)'
  // Display: humanise the status label ("changes_requested" → "Changes requested")
  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/^./, c => c.toUpperCase())
  return <Chip dotColor={dot} size={size}>{label}</Chip>
}
