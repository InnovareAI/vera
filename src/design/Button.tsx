// Button — VERA's canonical action affordance.
//
// Per the design system: ONE primary per surface. Ghost for inline /
// cancel. Danger only on destructive confirm. The shortcut chip ([⌘K]
// hint pill) is a key Linear-pattern affordance — surface keyboard
// shortcuts next to their actions whenever possible.
//
// Variants:
//   · primary    — accent fill (oxblood). The one "do it" per surface.
//   · secondary  — paper-2 fill, ink text. The companion action.
//   · ghost      — transparent, ink-2. Quiet cancel / dismiss.
//   · danger     — danger fill, white text. Destructive confirm only.
//
// Sizes:
//   · sm — 26px tall, 12px text. Inline actions on dense rows.
//   · md — 32px tall, 13px text. Default.
//
// Slots:
//   · leading  — icon or element before label
//   · trailing — icon or element after label
//   · shortcut — keyboard hint (e.g. "⌘N"). Renders as a small kbd pill.
//   · loading  — replaces leading slot with a spinner; disables click.
//   · iconOnly — square button, no label. Pass leading icon as content.

import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { color, radius, motion, type as t } from './tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize    = 'sm' | 'md'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?:  ButtonVariant
  size?:     ButtonSize
  leading?:  ReactNode
  trailing?: ReactNode
  shortcut?: string         // e.g. "⌘N" — rendered as a kbd pill
  loading?:  boolean
  iconOnly?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

const VARIANT: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: color.accent,
    color: '#FFF',
    border: '1px solid transparent',
  },
  secondary: {
    background: color.paper2,
    color: color.ink,
    border: `1px solid ${color.line}`,
  },
  ghost: {
    background: 'transparent',
    color: color.ink2,
    border: '1px solid transparent',
  },
  danger: {
    background: color.danger,
    color: '#FFF',
    border: '1px solid transparent',
  },
}

const SIZE: Record<ButtonSize, { height: number; padX: number; font: string; gap: number; iconGap: number }> = {
  sm: { height: 26, padX: 10, font: t.size.cap, gap: 6,  iconGap: 4 },
  md: { height: 32, padX: 12, font: t.size.sm,  gap: 8,  iconGap: 6 },
}

const KBD_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 5px',
  background: 'rgba(255,255,255,0.16)',
  color: 'inherit',
  borderRadius: radius.xs,
  fontFamily: t.family.mono,
  fontSize: 10.5,
  fontWeight: t.weight.medium,
  lineHeight: 1,
  letterSpacing: 0,
  opacity: 0.85,
}

export function Button({
  variant = 'primary',
  size = 'md',
  leading,
  trailing,
  shortcut,
  loading = false,
  iconOnly = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...rest
}: Props) {
  const v = VARIANT[variant]
  const s = SIZE[size]
  const isDark = variant === 'primary' || variant === 'danger'

  return (
    <button
      type="button"
      disabled={disabled || loading}
      style={{
        ...v,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: iconOnly ? 'center' : 'flex-start',
        height: s.height,
        padding: iconOnly ? 0 : `0 ${s.padX}px`,
        width: fullWidth ? '100%' : iconOnly ? s.height : undefined,
        gap: s.iconGap,
        fontSize: s.font,
        fontFamily: t.family.sans,
        fontWeight: t.weight.medium,
        letterSpacing: 0,
        borderRadius: radius.sm,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.55 : 1,
        transition: `background ${motion.fast} ${motion.ease}, border-color ${motion.fast} ${motion.ease}, opacity ${motion.fast} ${motion.ease}, transform ${motion.tap} ${motion.ease}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
      onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
      onMouseUp={(e) =>   { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      onMouseLeave={(e) =>{ (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      {...rest}
    >
      {loading
        ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" />
        : leading}
      {!iconOnly && children && (
        <span style={{ display: 'inline-block' }}>{children}</span>
      )}
      {!loading && trailing && (
        <span style={{ display: 'inline-flex', marginLeft: 'auto' }}>{trailing}</span>
      )}
      {shortcut && !iconOnly && !loading && (
        <span
          style={{
            ...KBD_STYLE,
            marginLeft: s.gap,
            // Light variants need a different kbd background
            background: isDark
              ? 'rgba(255,255,255,0.16)'
              : 'rgba(0,0,0,0.06)',
            opacity: isDark ? 0.9 : 0.7,
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  )
}
