// Card — VERA's canonical raised surface.
//
// Three tones:
//   · default — surface white, hairline border. The standard container.
//   · subtle  — paper-2 fill (same as canvas rails). Recedes; use when
//               the content IS the focus and the container should fade.
//   · accent  — accent-soft fill + accent-line border. Reserved for
//               attention moments (priority observations, callouts).
//               Per the design system: one accent moment per surface.

import type { HTMLAttributes, ReactNode } from 'react'
import { color, radius, space } from './tokens'

export type CardTone = 'default' | 'subtle' | 'accent'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  tone?: CardTone
  padding?: keyof typeof space      // default 6 (16px)
  interactive?: boolean              // hover ring on the border
  children: ReactNode
}

const TONE: Record<CardTone, React.CSSProperties> = {
  default: {
    background: color.surface,
    border: `1px solid ${color.line}`,
  },
  subtle: {
    background: color.paper2,
    border: `1px solid ${color.line}`,
  },
  accent: {
    background: color.accentSoft,
    border: `1px solid ${color.accentLine}`,
  },
}

export function Card({
  tone = 'default',
  padding = 6,
  interactive = false,
  children,
  style,
  ...rest
}: Props) {
  return (
    <div
      style={{
        ...TONE[tone],
        padding: space[padding],
        borderRadius: radius.md,
        transition: interactive ? 'border-color 120ms var(--ease)' : undefined,
        cursor: interactive ? 'pointer' : undefined,
        ...style,
      }}
      onMouseEnter={interactive ? (e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = color.line2.replace('var(', '').replace(')', '')
      } : undefined}
      {...rest}
    >
      {children}
    </div>
  )
}
