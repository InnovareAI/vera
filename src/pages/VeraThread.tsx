// VERA — the one DOING surface (/p/:slug/vera).
//
// Per the blueprint, this becomes the single conversational surface:
// chat + the inline 9-agent pipeline, drafts as cards in the thread with
// Approve/Tweak/Regenerate. It absorbs both the old Generate page and the
// floating chat dock — killing the two-composer problem structurally.
//
// Phase 0 scope: the route + frame exist so the rail's VERA tab lands
// somewhere real. The live thread (run_pipeline tool, DraftCard,
// PR #1's create flow re-skinned on primitives) is built in Phase 1.
// Until then, the persistent chat dock below is the working surface.

import { MessagesSquare } from 'lucide-react'
import { useProject } from '../lib/projectContext'
import { PageHeader, EmptyState, color, space, type as t } from '../design'

export default function VeraThread() {
  const { activeProject } = useProject()

  return (
    <div style={{ padding: space[8], maxWidth: 760 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? 'Workspace'}
        title="VERA"
        subtitle="One conversation. VERA proposes, drafts inline with her team, and you steer — Approve, Tweak, or Kill."
      />
      <EmptyState
        icon={<MessagesSquare size={22} strokeWidth={1.5} />}
        title="The full thread lands in Phase 1"
        body="This becomes the single place VERA works — chat plus the inline pipeline, drafts as cards you approve in place. For now, the chat dock at the bottom of the screen is live and project-scoped."
      />
      <p style={{ textAlign: 'center', marginTop: space[2], fontSize: t.size.cap, color: color.faint }}>
        Phase 1 folds in the /generate pipeline + PR #1's create flow, re-skinned on the design system.
      </p>
    </div>
  )
}
