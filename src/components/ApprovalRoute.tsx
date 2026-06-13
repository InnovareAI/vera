import { AlertTriangle, ClipboardCheck, ShieldCheck, UserCheck, Users } from 'lucide-react'
import type { ApprovalRoute, ApprovalRouteTone } from '../lib/approvalRouting'

function toneVars(tone: ApprovalRouteTone) {
  if (tone === 'danger') return { color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.18)' }
  if (tone === 'warning') return { color: 'var(--warn)', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.18)' }
  if (tone === 'info') return { color: 'var(--info)', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.18)' }
  if (tone === 'success') return { color: 'var(--success)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.18)' }
  return { color: 'var(--ink-quiet)', bg: 'var(--paper-warm)', border: 'var(--paper-edge)' }
}

function RouteIcon({ route, size = 13 }: { route: ApprovalRoute; size?: number }) {
  const color = toneVars(route.tone).color
  if (route.label.includes('Legal')) return <ShieldCheck size={size} style={{ color }} />
  if (route.label.includes('All')) return <Users size={size} style={{ color }} />
  if (route.label.includes('Space') || route.label.includes('Client')) return <ClipboardCheck size={size} style={{ color }} />
  if (route.label.includes('Named')) return <UserCheck size={size} style={{ color }} />
  if (route.tone === 'warning' || route.tone === 'danger') return <AlertTriangle size={size} style={{ color }} />
  return <ShieldCheck size={size} style={{ color }} />
}

export function ApprovalRouteChip({
  route,
  compact = false,
}: {
  route: ApprovalRoute
  compact?: boolean
}) {
  const vars = toneVars(route.tone)
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 font-medium"
      title={`${route.label}: ${route.reason}`}
      style={{
        color: vars.color,
        background: vars.bg,
        border: `1px solid ${vars.border}`,
        borderRadius: '8px',
        padding: compact ? '3px 6px' : '4px 8px',
        fontSize: compact ? '10px' : '11px',
      }}
    >
      <RouteIcon route={route} size={compact ? 11 : 12} />
      <span className="truncate">Approval: {route.label}</span>
    </span>
  )
}

export function ApprovalRouteSection({
  route,
  dense = false,
}: {
  route: ApprovalRoute
  dense?: boolean
}) {
  const vars = toneVars(route.tone)
  const checklist = route.checklist.slice(0, dense ? 3 : 5)
  return (
    <section
      className={dense ? 'py-3 my-3' : 'py-4 my-4'}
      style={{
        borderTop: '1px solid var(--paper-edge)',
        borderBottom: '1px solid var(--paper-edge)',
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-flex h-7 w-7 items-center justify-center flex-shrink-0"
          style={{ background: vars.bg, border: `1px solid ${vars.border}`, borderRadius: '8px' }}
        >
          <RouteIcon route={route} size={14} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Approval route</p>
            <span className="text-[11px] font-medium" style={{ color: vars.color }}>
              {route.label}
            </span>
          </div>
          <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--ink-quiet)' }}>
            {route.reason}
          </p>
          <p className="text-[11px] mt-2" style={{ color: 'var(--ghost)' }}>
            Approver: {route.approverHint}
          </p>
          <div className="mt-2 grid gap-1">
            {checklist.map(item => (
              <div key={item} className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--ghost)' }}>
                <span style={{ color: vars.color }}>-</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
