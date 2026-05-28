// Field — VERA's form primitives. Input, Textarea, Select.
//
// Per the design system:
//   · 13px text (--t-sm)
//   · Hairline border, paper-2 background
//   · Accent focus ring (1px accent border + 3px accent-soft glow)
//   · Helper text below in caption size
//   · Error state — danger border + danger-tinted helper
//
// All three share <Field label="..." helper="..."> wrappers so labels
// + helpers stay consistent across forms.

import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'
import { color, radius, space, type as t, motion } from './tokens'

// ─── Field wrapper — shared label / helper / error ────────────────
interface FieldShellProps {
  label?: ReactNode
  helper?: ReactNode
  error?: ReactNode
  children: ReactNode
  optional?: boolean
}

export function Field({ label, helper, error, children, optional }: FieldShellProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {label && (
        <span style={{
          fontSize: t.size.sm,
          fontWeight: t.weight.medium,
          color: color.ink,
          display: 'flex',
          alignItems: 'baseline',
          gap: space[2],
        }}>
          {label}
          {optional && (
            <span style={{ fontSize: t.size.cap, color: color.faint, fontWeight: t.weight.regular }}>
              · optional
            </span>
          )}
        </span>
      )}
      {children}
      {(helper || error) && (
        <span style={{
          fontSize: t.size.cap,
          color: error ? color.danger : color.ink2,
          lineHeight: t.lineHeight.normal,
        }}>
          {error || helper}
        </span>
      )}
    </label>
  )
}

// ─── Shared input style ───────────────────────────────────────────
const inputBaseStyle = (error?: boolean): React.CSSProperties => ({
  width: '100%',
  fontSize: t.size.sm,
  fontFamily: t.family.sans,
  color: color.ink,
  background: color.paper2,
  border: `1px solid ${error ? color.danger : color.line}`,
  borderRadius: radius.sm,
  padding: `8px 12px`,
  outline: 'none',
  transition: `border-color ${motion.fast} ${motion.ease}, box-shadow ${motion.fast} ${motion.ease}, background ${motion.fast} ${motion.ease}`,
})

const FOCUS_RING = `0 0 0 3px ${color.accentSoft}`
const FOCUS_BORDER = color.accent
const ERROR_FOCUS_RING = `0 0 0 3px rgba(185,28,28,0.10)`

// ─── Input ────────────────────────────────────────────────────────
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  leading?: ReactNode    // icon prefix
}

export function Input({ error, leading, style, ...rest }: InputProps) {
  if (leading) {
    return (
      <span style={{
        ...inputBaseStyle(error),
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[3],
        padding: `6px 12px`,
      }}>
        <span style={{ color: color.faint, display: 'inline-flex', flexShrink: 0 }}>{leading}</span>
        <input
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: color.ink,
            fontSize: t.size.sm,
            fontFamily: t.family.sans,
            padding: 0,
            ...style,
          }}
          onFocus={(e) => {
            const parent = e.currentTarget.parentElement
            if (parent) {
              parent.style.borderColor = error ? color.danger : FOCUS_BORDER
              parent.style.boxShadow = error ? ERROR_FOCUS_RING : FOCUS_RING
              parent.style.background = color.surface
            }
          }}
          onBlur={(e) => {
            const parent = e.currentTarget.parentElement
            if (parent) {
              parent.style.borderColor = error ? color.danger : color.line
              parent.style.boxShadow = 'none'
              parent.style.background = color.paper2
            }
          }}
          {...rest}
        />
      </span>
    )
  }
  return (
    <input
      style={{ ...inputBaseStyle(error), ...style }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : FOCUS_BORDER
        e.currentTarget.style.boxShadow = error ? ERROR_FOCUS_RING : FOCUS_RING
        e.currentTarget.style.background = color.surface
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : color.line
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.background = color.paper2
      }}
      {...rest}
    />
  )
}

// ─── Textarea ─────────────────────────────────────────────────────
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export function Textarea({ error, style, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      style={{
        ...inputBaseStyle(error),
        resize: 'vertical',
        lineHeight: t.lineHeight.relaxed,
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : FOCUS_BORDER
        e.currentTarget.style.boxShadow = error ? ERROR_FOCUS_RING : FOCUS_RING
        e.currentTarget.style.background = color.surface
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : color.line
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.background = color.paper2
      }}
      {...rest}
    />
  )
}

// ─── Select ───────────────────────────────────────────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
  children: ReactNode
}

export function Select({ error, style, children, ...rest }: SelectProps) {
  return (
    <select
      style={{
        ...inputBaseStyle(error),
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        cursor: 'pointer',
        paddingRight: 32,
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        backgroundSize: '14px 14px',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : FOCUS_BORDER
        e.currentTarget.style.boxShadow = error ? ERROR_FOCUS_RING : FOCUS_RING
        e.currentTarget.style.background = `${color.surface} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>") no-repeat right 10px center / 14px 14px`
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = error ? color.danger : color.line
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.background = `${color.paper2} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>") no-repeat right 10px center / 14px 14px`
      }}
      {...rest}
    >
      {children}
    </select>
  )
}
