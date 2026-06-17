import { Clock3 } from 'lucide-react'
import { EmptyState, space } from '../design'

// Placeholder screen for surfaces that are parked behind a "coming soon" state.
// Routed in place of the real page so the page code can stay in the repo and be
// restored by swapping the route element back.
export function ComingSoon({ feature, body }: { feature: string; body?: string }) {
  return (
    <div style={{ padding: space[8], maxWidth: 760, width: '100%' }}>
      <EmptyState
        icon={<Clock3 size={22} strokeWidth={1.5} />}
        title={`${feature} is coming soon`}
        body={body ?? `${feature} isn't live yet. We're building it. It will show up here once it's ready.`}
      />
    </div>
  )
}
