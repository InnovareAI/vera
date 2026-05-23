// Sentry initialization. Reads VITE_SENTRY_DSN from the env at build time.
// When the DSN is absent (local dev, branch previews without secrets) we
// no-op cleanly — the app still runs, errors still log to console via the
// ErrorBoundary, we just don't ship them anywhere.
//
// Usage:
//   import { initSentry, captureError } from './lib/sentry'
//   initSentry()                       // in main.tsx, before <App /> mounts
//   captureError(err, { route: '...' }) // anywhere
//
// Why a wrapper instead of importing @sentry/react directly everywhere:
//   - One place to flip on/off
//   - One place to add scope/tags (org_id, route, build hash)
//   - Callers don't need to defensively check the DSN — `captureError`
//     short-circuits when Sentry isn't initialized

import * as Sentry from '@sentry/react'

let initialized = false

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) {
    // Loud-ish in dev so it's obvious, quiet in prod so it doesn't spam the
    // operator console.
    if (import.meta.env.DEV) {
      console.info('[sentry] VITE_SENTRY_DSN not set — error reporting disabled')
    }
    return
  }

  Sentry.init({
    dsn,
    // VERA is small enough that we don't need performance tracing today —
    // crash visibility is the whole goal. Sampling can be turned on later
    // by passing tracesSampleRate > 0 here.
    tracesSampleRate: 0,
    // Tag every event so the Sentry inbox stays organised when other
    // InnovareAI surfaces start reporting too.
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    // Ignore browser-extension and network noise that's not actionable.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
  })

  initialized = true
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.withScope(scope => {
    if (context) {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v)
    }
    Sentry.captureException(error)
  })
}

export function setUserContext(user: { id?: string; email?: string } | null): void {
  if (!initialized) return
  Sentry.setUser(user ? { id: user.id, email: user.email } : null)
}

export function setOrgContext(org: { id: string; name: string } | null): void {
  if (!initialized) return
  Sentry.setTag('org_id', org?.id ?? '')
  Sentry.setTag('org_name', org?.name ?? '')
}
