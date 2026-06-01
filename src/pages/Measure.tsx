// Measure — outcomes for one client (/p/:slug/measure).
//
// Per the blueprint, Audit and Intel stop being flat top-level routes and
// become TABS of Measure. This is the surface that closes the loop:
// "know what landed, so the next brief is smarter."
//
// Phase 0 scope: the tab shell is real. Intel renders inline (it's
// workspace/project-scoped already). Audit links to the existing
// LinkedIn score report (re-scoping it per-project + the engagement-
// outcomes rollup are Phase 5, gated on new content_posts columns).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Telescope, ArrowRight } from 'lucide-react'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import Intel from './Intel'
import {
  PageHeader, EmptyState, Button,
  color, space, type as t,
} from '../design'

type Tab = 'audit' | 'intel'

export default function Measure() {
  const navigate = useNavigate()
  const { activeOrg } = useOrg()
  const { activeProject } = useProject()
  const initial = (new URLSearchParams(window.location.search).get('tab') as Tab) || 'audit'
  const [tab, setTab] = useState<Tab>(initial === 'intel' ? 'intel' : 'audit')

  return (
    <div style={{ padding: `${space[8]} ${space[8]} 0`, maxWidth: 980 }}>
      <PageHeader
        eyebrow={activeProject?.name ?? activeOrg?.name ?? 'Workspace'}
        title="Measure"
        subtitle="How this client's surface is scoring and what competitors are doing. Engagement-outcomes rollup lands in Phase 5."
      />

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: space[5], borderBottom: `1px solid ${color.line}`, marginBottom: space[7] }}>
        {([['audit', 'Audit'], ['intel', 'Intel']] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: t.family.sans, fontSize: t.size.sm,
              fontWeight: tab === id ? t.weight.medium : t.weight.regular,
              color: tab === id ? color.ink : color.ghost,
              padding: `${space[3]} 0`,
              borderBottom: `2px solid ${tab === id ? color.ink : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'audit' && (
        <EmptyState
          icon={<Telescope size={22} strokeWidth={1.5} />}
          title="LinkedIn audit"
          body="Profile score + Brew360 algorithm fit + top fixes. Per-project re-scoping and the outcomes rollup land in Phase 5; the full report is live now."
          actions={
            activeOrg ? (
              <Button
                variant="primary"
                onClick={() => navigate(`/linkedin-score/${activeOrg.id}`)}
                trailing={<ArrowRight size={13} strokeWidth={2} />}
              >
                Open the audit
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Intel renders inline — it's self-contained (reads useOrg, no route
          params). Negative top margin pulls its own p-6 back under the tab. */}
      {tab === 'intel' && (
        <div style={{ margin: `0 -${space[8]}` }}>
          <Intel />
        </div>
      )}
    </div>
  )
}
