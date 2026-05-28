// SectionLabel — the 10-11px UPPERCASE label that introduces every list
// or group in VERA. Per the design system, this is the visual rhythm
// driver — every content group has one above it.
//
// Variants:
//   · default — ghost color
//   · accent  — accent color (only for high-attention groups like
//               "What VERA noticed" with open items)
//
// Slots:
//   · count   — inline count after the label, e.g. PROJECT KNOWLEDGE 14
//   · action  — right-aligned link/button, e.g. "+ Add ⌘U" or "See all →"

import type { ReactNode } from 'react'
import { color, type as t } from './tokens'

export type SectionLabelTone = 'default' | 'accent'

interface Props {
  children: ReactNode
  tone?: SectionLabelTone
  count?: number | string
  action?: ReactNode
  className?: string
  style?: React.CSSProperties
}

const TONE_COLOR: Record<SectionLabelTone, string> = {
  default: color.ghost,
  accent:  color.accent,
}

export function SectionLabel({
  children,
  tone = 'default',
  count,
  action,
  className,
  style,
}: Props) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: action ? 'space-between' : 'flex-start',
        gap: 8,
        ...style,
      }}
    >
      <p
        style={{
          fontSize: t.size.micro,
          fontWeight: t.weight.medium,
          textTransform: 'uppercase',
          letterSpacing: t.letterSpacing.wide,
          color: TONE_COLOR[tone],
          margin: 0,
        }}
      >
        {children}
        {count !== undefined && count !== '' && count !== 0 && (
          <span style={{ marginLeft: 8, color: color.faint, fontWeight: t.weight.regular }}>
            {count}
          </span>
        )}
      </p>
      {action && (
        <div style={{
          flexShrink: 0,
          fontSize: t.size.cap,
          color: color.ink2,
        }}>
          {action}
        </div>
      )}
    </div>
  )
}
