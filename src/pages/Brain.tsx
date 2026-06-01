// Brain — per-client config (/p/:slug/brain).
//
// The home for what makes a client a bounded scope: custom instructions
// (writes projects.instructions — migration 026, currently unwritten),
// brand voice, audiences, and channels. Plus the re-runnable grounding
// audit.
//
// Phase 0 scope: the surface exists and shows what it will hold, reading
// the active project's current instructions if any. The editors (voice,
// audiences, channels, instruction-save) land in Phase 2.

import { useNavigate } from 'react-router-dom'
import { Brain as BrainIcon, Mic2, Users, Radio, Telescope } from 'lucide-react'
import { useProject } from '../lib/projectContext'
import {
  PageHeader, SectionLabel, Card, EmptyState, Button,
  color, space, type as t,
} from '../design'

export default function Brain() {
  const navigate = useNavigate()
  const { activeProject } = useProject()

  if (!activeProject) {
    return (
      <div style={{ padding: space[8], maxWidth: 760 }}>
        <EmptyState
          icon={<BrainIcon size={22} strokeWidth={1.5} />}
          title="No active project"
          body="Pick a client in the left rail to set its brain — instructions, voice, audiences, channels."
        />
      </div>
    )
  }

  const sections: Array<{ icon: React.ReactNode; label: string; desc: string }> = [
    { icon: <Mic2 size={15} strokeWidth={1.75} />,      label: 'Custom instructions', desc: 'The standing brief VERA reads on every turn for this client. Tone, do/don\'t, positioning in plain language.' },
    { icon: <Mic2 size={15} strokeWidth={1.75} />,      label: 'Brand voice',         desc: 'Tone words, writing rules, forbidden + required phrases, sample posts. Per-client — moves out of workspace Settings.' },
    { icon: <Users size={15} strokeWidth={1.75} />,     label: 'Audiences',           desc: 'ICPs and personas VERA writes toward. Drives register and proof points.' },
    { icon: <Radio size={15} strokeWidth={1.75} />,     label: 'Channels',            desc: 'Where this client publishes — LinkedIn + the 8 CMS connectors. Connect once, publish anywhere.' },
  ]

  return (
    <div style={{ padding: space[8], maxWidth: 760 }}>
      <PageHeader
        eyebrow={activeProject.name}
        title="Brain"
        subtitle="Everything that makes this client a bounded scope — the ground truth VERA reasons from. Editors land in Phase 2; this is the shape."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leading={<Telescope size={13} strokeWidth={1.75} />}
            onClick={() => navigate('/audit')}
          >
            Run grounding audit
          </Button>
        }
      />

      {activeProject.instructions && (
        <Card tone="subtle" style={{ marginBottom: space[6] }}>
          <SectionLabel style={{ marginBottom: space[3] }}>Current instructions</SectionLabel>
          <p style={{ fontSize: t.size.sm, color: color.ink2, lineHeight: t.lineHeight.relaxed, whiteSpace: 'pre-wrap', margin: 0 }}>
            {activeProject.instructions}
          </p>
        </Card>
      )}

      <SectionLabel style={{ marginBottom: space[4] }}>What lives here</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
        {sections.map(s => (
          <Card key={s.label} tone="default" style={{ display: 'flex', gap: space[4], alignItems: 'flex-start' }}>
            <span style={{
              width: 30, height: 30, borderRadius: 6, flexShrink: 0,
              background: color.paper2, color: color.ink2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {s.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: t.size.body, fontWeight: t.weight.medium, color: color.ink }}>{s.label}</div>
              <div style={{ fontSize: t.size.cap, color: color.ink2, marginTop: 2, lineHeight: t.lineHeight.normal }}>{s.desc}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
