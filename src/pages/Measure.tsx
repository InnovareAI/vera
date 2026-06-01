// Measure — outcomes for one client (/p/:slug/measure).
//
// "Know what landed, so the next brief is smarter." Today that's the
// competitor Intel timeline; the engagement-outcomes rollup lands in
// Phase 5 (gated on new content_posts columns).
//
// No LinkedIn audit tab — VERA is multi-category; a LinkedIn-shaped
// score doesn't belong on a universal Measure surface.

import { useProject } from '../lib/projectContext'
import { useOrg } from '../lib/orgContext'
import Intel from './Intel'
import { PageHeader, space } from '../design'

export default function Measure() {
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 980 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? activeOrg?.name ?? 'Workspace'}
        title="Measure"
        subtitle="What competitors are doing now, and (soon) how this client's content is landing. Engagement rollup lands in Phase 5."
      />
      {/* Intel renders inline — self-contained (reads useOrg, no route
          params). Negative margin pulls its own p-6 under the header. */}
      <div style={{ margin: `0 -${space[8]}` }}>
        <Intel />
      </div>
    </div>
  )
}
