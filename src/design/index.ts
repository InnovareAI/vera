// VERA design system — barrel export.
//
// Import from '@/design' (or '../design') instead of individual files:
//   import { Button, Card, SectionLabel, color, space } from '../design'

export { color, type, space, radius, motion, z, shadow } from './tokens'

export { Button } from './Button'
export type { ButtonVariant, ButtonSize } from './Button'

export { Card } from './Card'
export type { CardTone } from './Card'

export { SectionLabel } from './SectionLabel'
export type { SectionLabelTone } from './SectionLabel'

export { PageHeader } from './PageHeader'

export { EmptyState } from './EmptyState'

export { Field, Input, Textarea, Select } from './Field'

export { Chip } from './Chip'
export type { ChipTone } from './Chip'

export { ToastProvider, useToast } from './Toast'
export type { Toast, ToastKind } from './Toast'
