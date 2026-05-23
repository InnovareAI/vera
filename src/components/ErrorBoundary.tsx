// React error boundary. Class component because hooks can't catch render
// errors — that's the whole reason this file exists.
//
// We use it in two places:
//   1. Top-level (wraps the whole app, in App.tsx) — catches crashes inside
//      providers, the shell, or anything that escapes a route boundary. The
//      fallback is the "the app crashed" full-page screen.
//   2. Route-level (wraps the <Layout /> <Outlet />) — keeps the rail + header
//      visible when a single page blows up. The fallback is a compact
//      in-canvas card.
//
// `reset()` flips a key on the boundary's children so React remounts the
// subtree clean, which is good enough for "try again" on most transient
// errors (race conditions, stale network state, etc).
//
// Logging: console.error today. When Sentry is wired (next production-
// readiness item) this is where `Sentry.captureException(err)` lands.

import { Component, Fragment } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
  variant?: 'page' | 'route'  // full-page (default) vs in-canvas card
  onReset?: () => void        // optional extra callback (e.g. navigate away)
  // External reset signal. When this value changes while the boundary is in
  // an error state, we auto-reset. The route-level boundary passes the
  // location pathname here so navigating to another page clears the error
  // without the operator having to click "Try again".
  resetKey?: string | number
}

interface State {
  error: Error | null
  // Bumped on reset() — used as a key on a passthrough wrapper to force the
  // child subtree to remount. Cheap, no router coupling.
  resetKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for now — Sentry hook lands here next.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  componentDidUpdate(prevProps: Props): void {
    // Auto-reset when the external signal changes AND we're currently in an
    // error state. Without the `state.error` guard this would fire on every
    // prop change, defeating the boundary.
    if (
      this.state.error &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.reset()
    }
  }

  reset = (): void => {
    this.setState(s => ({ error: null, resetKey: s.resetKey + 1 }))
    this.props.onReset?.()
  }

  render(): ReactNode {
    if (this.state.error) {
      const isPage = this.props.variant !== 'route'
      return isPage
        ? <PageFallback error={this.state.error} onReset={this.reset} />
        : <RouteFallback error={this.state.error} onReset={this.reset} />
    }
    // Fragment with a key so reset() actually remounts the children. A real
    // Fragment (not the <> shorthand) is required because the shorthand
    // doesn't accept a key.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
  }
}

// ─── Full-page fallback (top-level boundary) ────────────────────────────────
function PageFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const isDev = import.meta.env.DEV
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--paper)' }}
    >
      <div
        className="w-full max-w-md p-8"
        style={{
          background: 'var(--paper-warm)',
          border: '1px solid var(--paper-edge)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div
          className="w-10 h-10 flex items-center justify-center mb-5"
          style={{
            background: 'var(--accent-tint)',
            border: '1px solid var(--accent-rule)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent)',
          }}
        >
          <AlertTriangle className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <h1
          className="text-[22px] leading-tight tracking-tight font-semibold mb-2"
          style={{ color: 'var(--ink)' }}
        >
          Something didn't work
        </h1>
        <p className="text-[13px] mb-6" style={{ color: 'var(--ghost)' }}>
          VERA hit an unexpected error. The issue has been logged. You can try
          again, or head back to the dashboard.
        </p>

        {isDev && <ErrorDetails error={error} />}

        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper-warm)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <RotateCw className="w-3.5 h-3.5" strokeWidth={2} /> Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium hover:opacity-80"
            style={{ color: 'var(--ink-quiet)' }}
          >
            <Home className="w-3.5 h-3.5" strokeWidth={1.75} /> Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Compact route fallback (rail stays visible) ────────────────────────────
function RouteFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const isDev = import.meta.env.DEV
  return (
    <div className="p-8">
      <div
        className="max-w-2xl p-6"
        style={{
          background: 'var(--paper-warm)',
          border: '1px solid var(--paper-edge)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-8 h-8 flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--accent-tint)',
              border: '1px solid var(--accent-rule)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent)',
            }}
          >
            <AlertTriangle className="w-4 h-4" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-[15px] font-semibold leading-tight"
              style={{ color: 'var(--ink)' }}
            >
              This page didn't load
            </h2>
            <p className="text-[13px] mt-1" style={{ color: 'var(--ghost)' }}>
              Something went wrong rendering this view. The rest of VERA is
              still working — try again, or pick a different section from the rail.
            </p>
          </div>
        </div>

        {isDev && <ErrorDetails error={error} />}

        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper-warm)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <RotateCw className="w-3.5 h-3.5" strokeWidth={2} /> Try again
        </button>
      </div>
    </div>
  )
}

// ─── Dev-only error details (collapsed by default in case of long stacks) ──
function ErrorDetails({ error }: { error: Error }) {
  return (
    <details
      className="mb-6 text-[12px] font-mono"
      style={{
        background: 'var(--fog)',
        border: '1px solid var(--paper-edge)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--ink-quiet)',
      }}
    >
      <summary
        className="cursor-pointer px-3 py-2 font-sans font-medium"
        style={{ color: 'var(--ink-quiet)' }}
      >
        Error details (dev only)
      </summary>
      <div className="px-3 pb-3 whitespace-pre-wrap break-words leading-relaxed">
        <p className="mb-2" style={{ color: 'var(--ink)' }}>{error.name}: {error.message}</p>
        {error.stack && <p>{error.stack}</p>}
      </div>
    </details>
  )
}
