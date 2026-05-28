// PageHeader — canonical opening block for every primary page.
//
// Per the UX declutter skill: exactly ONE H1 per page. Use this at the
// top of Dashboard / Knowledge / Audit / Review / etc.
//
// Slots:
//   · eyebrow  — workspace name or section kind (uppercase ghost label)
//   · title    — the H1 (the page's question, in one phrase)
//   · subtitle — single-line context (optional)
//   · actions  — right-aligned button cluster (re-run, edit, add new)
//
// Sizes:
//   · md (default) — h2 sized title (26px). Most pages.
//   · lg            — h1 sized title (34px). Dashboard / hero pages.

import type { ReactNode } from 'react'
import { color, type as t } from './tokens'

interface Props {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  size?: 'md' | 'lg'
  style?: React.CSSProperties
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  size = 'md',
  style,
}: Props) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <p
            style={{
              fontSize: t.size.micro,
              fontWeight: t.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: t.letterSpacing.wide,
              color: color.ghost,
              margin: 0,
              marginBottom: 6,
            }}
          >
            {eyebrow}
          </p>
        )}
        <h1
          style={{
            fontSize: size === 'lg' ? t.size.h1 : t.size.h2,
            fontWeight: t.weight.semibold,
            letterSpacing: t.letterSpacing.snug,
            lineHeight: t.lineHeight.tight,
            color: color.ink,
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              fontSize: t.size.cap,
              color: color.ghost,
              marginTop: 6,
              marginBottom: 0,
              maxWidth: '60ch',
              lineHeight: t.lineHeight.normal,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {actions}
        </div>
      )}
    </header>
  )
}
