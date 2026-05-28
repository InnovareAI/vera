// EmptyState — VERA's canonical empty surface.
//
// Per the design system, every "nothing here" state follows this shape:
//   1. Single icon (line-style, 22px, faint)
//   2. Title — one short line, ink, h4 weight
//   3. Body — one sentence, ink-2, cap size
//   4. Primary action button + optional secondary action
//
// No emoji. No stock illustration. The empty state IS the affordance —
// don't ship "Nothing yet" with no next action.

import type { ReactNode } from 'react'
import { color, space, type as t } from './tokens'

interface Props {
  icon?: ReactNode             // Lucide icon, ~22px line stroke
  title: ReactNode
  body?: ReactNode
  actions?: ReactNode          // 1-2 Button components
  style?: React.CSSProperties
}

export function EmptyState({ icon, title, body, actions, style }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: space[4],
        padding: `${space[10]} ${space[6]}`,
        ...style,
      }}
    >
      {icon && (
        <div
          style={{
            color: color.faint,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: space[2],
          }}
        >
          {icon}
        </div>
      )}
      <h3
        style={{
          fontSize: t.size.h4,
          fontWeight: t.weight.semibold,
          color: color.ink,
          margin: 0,
          letterSpacing: t.letterSpacing.snug,
        }}
      >
        {title}
      </h3>
      {body && (
        <p
          style={{
            fontSize: t.size.cap,
            color: color.ink2,
            margin: 0,
            maxWidth: '42ch',
            lineHeight: t.lineHeight.relaxed,
          }}
        >
          {body}
        </p>
      )}
      {actions && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[3],
          marginTop: space[2],
        }}>
          {actions}
        </div>
      )}
    </div>
  )
}
