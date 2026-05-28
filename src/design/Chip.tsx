// Chip — VERA's status pill primitive.
//
// THE color rule (baked into the design system):
//   "The dot carries meaning, the body never. Don't ship a green-filled chip."
//
// So the chip body is always neutral (paper-2). The dot to the left of
// the label is what communicates state — status, channel, audience.
//
// Variants:
//   · default      — no dot, just a neutral pill (counts, formats)
//   · with-dot     — colored dot prefix (status, channel, audience)
//   · accent       — accent text + accent-soft background (one-off
//                    emphasis on RDF Style positioning, etc.)

import type { ReactNode } from 'react'
import { color, radius, type as t } from './tokens'

export type ChipTone = 'default' | 'accent'

interface Props {
  children: ReactNode
  dot?: string              // CSS color for the leading dot (success/warn/etc or any color var)
  tone?: ChipTone
  size?: 'sm' | 'md'        // sm: 22px tall (default in dense rows); md: 26px
  style?: React.CSSProperties
}

const SIZE: Record<'sm' | 'md', { height: number; padX: number; font: string; dot: number }> = {
  sm: { height: 22, padX: 8,  font: t.size.cap,   dot: 6 },
  md: { height: 26, padX: 10, font: t.size.sm,    dot: 7 },
}

export function Chip({ children, dot, tone = 'default', size = 'sm', style }: Props) {
  const s = SIZE[size]
  const isAccent = tone === 'accent'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: s.height,
        padding: `0 ${s.padX}px`,
        background: isAccent ? color.accentSoft : color.paper2,
        color: isAccent ? color.accent : color.ink2,
        border: isAccent ? `1px solid ${color.accentLine}` : `1px solid ${color.line}`,
        borderRadius: radius.xs,
        fontSize: s.font,
        fontWeight: t.weight.medium,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: s.dot,
            height: s.dot,
            borderRadius: 999,
            background: dot,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  )
}
