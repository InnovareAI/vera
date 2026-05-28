// Toast — bottom-right notification stack.
//
// Per the design system: shown for transient confirmations + errors +
// async results. Toasts auto-dismiss with a progress bar (default 4s).
// Manual dismiss via ×. Stacks vertically at z-toast (300).
//
// Variants:
//   · success — green dot, paper-2 bg
//   · warn    — amber dot, paper-2 bg
//   · danger  — red dot, paper-2 bg
//   · info    — blue dot, paper-2 bg (default)
//
// Usage:
//   const { push } = useToast()
//   push({ kind: 'success', title: 'Brief sent to review' })
//
// Mount <ToastHost /> once in the app shell.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { color, radius, space, type as t, z, shadow, motion } from './tokens'

export type ToastKind = 'success' | 'warn' | 'danger' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: ReactNode
  body?: ReactNode
  duration?: number       // ms, default 4000; 0 = stay until dismissed
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  push: () => '',
  dismiss: () => {},
})

const DOT_COLOR: Record<ToastKind, string> = {
  success: color.success,
  warn:    color.warn,
  danger:  color.danger,
  info:    color.info,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((toast: Omit<Toast, 'id'>): string => {
    const id = crypto.randomUUID()
    const full: Toast = { id, duration: 4000, ...toast }
    setToasts(prev => [...prev, full])
    if (full.duration && full.duration > 0) {
      setTimeout(() => dismiss(id), full.duration)
    }
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}

function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        right: space[6],
        bottom: space[6],
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
        zIndex: z.toast as unknown as number,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(toast => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    if (!toast.duration || toast.duration === 0) return
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / toast.duration!) * 100)
      setProgress(pct)
      if (pct <= 0) clearInterval(interval)
    }, 50)
    return () => clearInterval(interval)
  }, [toast.duration])

  return (
    <div
      style={{
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        padding: `${space[4]} ${space[5]}`,
        width: 340,
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'auto',
        animation: `vera-toast-in ${motion.slow} ${motion.ease}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3] }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: DOT_COLOR[toast.kind],
            marginTop: 7,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: t.size.sm,
              fontWeight: t.weight.medium,
              color: color.ink,
              margin: 0,
              lineHeight: t.lineHeight.snug,
            }}
          >
            {toast.title}
          </p>
          {toast.body && (
            <p
              style={{
                fontSize: t.size.cap,
                color: color.ink2,
                margin: 0,
                marginTop: space[1],
                lineHeight: t.lineHeight.normal,
              }}
            >
              {toast.body}
            </p>
          )}
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.faint,
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
          }}
          aria-label="Dismiss"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
      {toast.duration && toast.duration > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 2,
            width: `${progress}%`,
            background: DOT_COLOR[toast.kind],
            opacity: 0.4,
            transition: 'width 50ms linear',
          }}
        />
      )}
      <style>{`
        @keyframes vera-toast-in {
          from { opacity: 0; transform: translateY(8px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </div>
  )
}
