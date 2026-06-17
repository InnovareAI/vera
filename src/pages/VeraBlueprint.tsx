import type { CSSProperties, ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Image,
  KeyRound,
  Lightbulb,
  MessageSquareText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useProject } from '../lib/projectContext'
import { useRightRail } from '../lib/rightRailContext'
import { color, radius, space, type as t } from '../design'

type StageTone = 'blue' | 'green' | 'amber' | 'red' | 'neutral'

type Metric = {
  label: string
  value: string
  detail: string
  tone: StageTone
  icon: LucideIcon
}

type ChannelRow = {
  channel: string
  role: string
  voice: string
  decision: string
  signal: string
  tone: StageTone
}

type LoopStep = {
  label: string
  value: string
  detail: string
  tone: StageTone
  icon: LucideIcon
}

type LearningRow = {
  signal: string
  evidence: string
  decision: string
  next: string
  owner: string
  tone: StageTone
}

const metrics: Metric[] = [
  { label: 'Brain health', value: '82%', detail: '3 gaps', tone: 'green', icon: Brain },
  { label: 'Ready to review', value: '6', detail: '2 asset checks', tone: 'amber', icon: ShieldCheck },
  { label: 'Unscheduled', value: '3', detail: 'approved posts', tone: 'red', icon: CalendarDays },
  { label: 'Spend today', value: '$0.18', detail: 'warn mode', tone: 'blue', icon: CircleDollarSign },
]

const loopSteps: LoopStep[] = [
  { label: 'Plan', value: '2 briefs', detail: 'campaign and channel fit', tone: 'green', icon: Brain },
  { label: 'Produce', value: '14 drafts', detail: 'copy, image, storyboard', tone: 'blue', icon: Sparkles },
  { label: 'Review', value: '6 open', detail: 'approval and comments', tone: 'amber', icon: ShieldCheck },
  { label: 'Publish', value: '9 slots', detail: 'native calendar', tone: 'blue', icon: CalendarDays },
  { label: 'Measure', value: '4 sources', detail: 'comments, shares, traffic', tone: 'green', icon: BarChart3 },
  { label: 'Learn', value: '9 signals', detail: 'fed back to Brain', tone: 'green', icon: RefreshCw },
]

const workQueue = [
  { label: 'Review 6 posts', detail: 'Two need asset checks before approval', tone: 'amber' as StageTone },
  { label: 'Schedule 3 approved posts', detail: 'Unscheduled work blocks learning', tone: 'red' as StageTone },
  { label: 'Publish RDF carousel', detail: 'Instagram preview ready', tone: 'blue' as StageTone },
  { label: 'Sync performance', detail: 'LinkedIn and Meta due today', tone: 'green' as StageTone },
]

const channels: ChannelRow[] = [
  {
    channel: 'LinkedIn',
    role: 'Authority and demand creation',
    voice: 'Expert, useful, direct',
    decision: 'Use when buying audience is present',
    signal: 'Comments, shares, buyer questions',
    tone: 'blue',
  },
  {
    channel: 'Instagram',
    role: 'Proof, lifestyle, visual trust',
    voice: 'Short, warm, visual',
    decision: 'Use for product, founder, culture',
    signal: 'Saves, shares, profile visits',
    tone: 'green',
  },
  {
    channel: 'YouTube',
    role: 'Depth and evergreen search',
    voice: 'Educational, structured',
    decision: 'Use when demos matter',
    signal: 'Watch time, clicks, comments',
    tone: 'amber',
  },
  {
    channel: 'Medium',
    role: 'Long-form idea capture',
    voice: 'Editorial, reflective',
    decision: 'Manual publish is acceptable',
    signal: 'Reads, referrals, newsletter lift',
    tone: 'neutral',
  },
  {
    channel: 'Reddit and Quora',
    role: 'Market questions and objections',
    voice: 'Helpful, non-promotional',
    decision: 'Research first, publish carefully',
    signal: 'Question patterns, objections',
    tone: 'red',
  },
]

const learningRows: LearningRow[] = [
  {
    signal: 'Comparison hook',
    evidence: '2.4x qualified comments',
    decision: 'Keep',
    next: 'Reuse on Tuesday post',
    owner: 'VERA',
    tone: 'green',
  },
  {
    signal: 'Low-context video prompts',
    evidence: '2 failed renders',
    decision: 'Gate',
    next: 'Storyboard before render',
    owner: 'Operator',
    tone: 'amber',
  },
  {
    signal: 'Instagram education posts',
    evidence: 'Low saves',
    decision: 'Shift',
    next: 'Use visual proof instead',
    owner: 'VERA',
    tone: 'blue',
  },
  {
    signal: 'Buyer question in comments',
    evidence: '3 explicit intent signals',
    decision: 'Route',
    next: 'Create SAM follow-up task',
    owner: 'SAM',
    tone: 'green',
  },
]

function toneColor(tone: StageTone) {
  if (tone === 'green') return color.success
  if (tone === 'amber') return color.warn
  if (tone === 'red') return color.danger
  if (tone === 'blue') return color.accent
  return color.ghost
}

function toneBg(tone: StageTone) {
  if (tone === 'green') return 'rgba(45, 122, 59, 0.08)'
  if (tone === 'amber') return 'rgba(176, 122, 12, 0.10)'
  if (tone === 'red') return 'rgba(185, 28, 28, 0.08)'
  if (tone === 'blue') return color.accentSoft
  return color.paper2
}

function baseSurface(extra?: CSSProperties): CSSProperties {
  return {
    background: color.surface,
    border: `1px solid ${color.line}`,
    borderRadius: radius.md,
    ...extra,
  }
}

export default function VeraBlueprint() {
  const { activeProject } = useProject()
  const spaceName = activeProject?.name ?? 'RDF Style'
  useRightRail(<BlueprintOutputRail />, [], '360px')

  return (
    <div style={{ minHeight: '100%', background: color.paper, color: color.ink }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: `${space[7]} ${space[7]} ${space[10]}` }}>
        <header style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: space[5], alignItems: 'end', marginBottom: space[6] }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[3] }}>
              <Pill tone="blue" icon={RefreshCw}>Growth Loop</Pill>
              <Pill tone="green" icon={Brain}>Brain driven</Pill>
              <Pill tone="amber" icon={CircleDollarSign}>Spend aware</Pill>
            </div>
            <h1 style={{ margin: 0, fontSize: t.size.h2, lineHeight: t.lineHeight.tight, letterSpacing: 0, fontWeight: t.weight.semibold }}>
              VERA operating desk
            </h1>
          </div>
          <div style={baseSurface({ padding: space[4] })}>
            <div style={{ color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>Active space</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[4], marginTop: space[2] }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: t.size.h4, fontWeight: t.weight.semibold, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spaceName}</div>
                <div style={{ fontSize: t.size.cap, color: color.ghost, marginTop: 2 }}>Setup: Settings, Brain &amp; Models</div>
              </div>
              <button
                type="button"
                onClick={() => { window.location.href = '/settings?tab=brain' }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.md,
                  background: color.ink,
                  color: '#fff',
                  border: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                }}
                title="Open Brain and model settings"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        </header>

        <main style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: space[7], alignItems: 'start' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: space[7] }}>
            <section style={baseSurface({ padding: space[6] })}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: space[5], alignItems: 'stretch' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[4] }}>
                    <Target size={16} style={{ color: color.accent }} />
                    <SectionTitle>Command and productivity</SectionTitle>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(136px, 1fr))', gap: space[3] }}>
                    {metrics.map(metric => <MetricTile key={metric.label} metric={metric} />)}
                  </div>
                  <div style={{ marginTop: space[5], display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: space[4] }}>
                    <CommandComposer />
                    <NextDecision />
                  </div>
                </div>
                <div style={baseSurface({ background: color.paper2, padding: space[5] })}>
                  <SectionKicker>Next actions</SectionKicker>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], marginTop: space[4] }}>
                    {workQueue.map(item => <WorkItem key={item.label} {...item} />)}
                  </div>
                </div>
              </div>
            </section>

            <section style={baseSurface({ padding: space[5] })}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[5], marginBottom: space[5] }}>
                <div>
                  <SectionKicker>Operating model</SectionKicker>
                  <SectionTitle>Plan, produce, publish, learn</SectionTitle>
                </div>
                <button
                  type="button"
                  onClick={() => { window.location.href = '/settings?tab=brain' }}
                  style={secondaryButton()}
                >
                  <Settings2 size={14} />
                  Setup in Settings
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: space[3] }}>
                {loopSteps.map(step => <LoopStepCard key={step.label} step={step} />)}
              </div>
            </section>

            <section style={baseSurface({ padding: space[5] })}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[6], marginBottom: space[5] }}>
                <div>
                  <SectionKicker>Channel strategy</SectionKicker>
                  <SectionTitle>Platform fit</SectionTitle>
                </div>
                <Pill tone="green" icon={CheckCircle2}>LinkedIn optional</Pill>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr 1fr 1fr 0.9fr', gap: 0, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
                <MatrixHeader>Channel</MatrixHeader>
                <MatrixHeader>Role</MatrixHeader>
                <MatrixHeader>Tone</MatrixHeader>
                <MatrixHeader>Decision</MatrixHeader>
                <MatrixHeader>Signal</MatrixHeader>
                {channels.map(row => <ChannelMatrixRow key={row.channel} row={row} />)}
              </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: space[7] }}>
              <section style={baseSurface({ padding: space[5] })}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[4], marginBottom: space[5] }}>
                  <div>
                    <SectionKicker>Self-learning loop</SectionKicker>
                    <SectionTitle>Signals to decisions</SectionTitle>
                  </div>
                  <Pill tone="blue" icon={Lightbulb}>4 active learnings</Pill>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.7fr 1fr 0.7fr', gap: 0, border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
                  <MatrixHeader>Signal</MatrixHeader>
                  <MatrixHeader>Evidence</MatrixHeader>
                  <MatrixHeader>Decision</MatrixHeader>
                  <MatrixHeader>Next test</MatrixHeader>
                  <MatrixHeader>Owner</MatrixHeader>
                  {learningRows.map(row => <LearningTableRow key={row.signal} row={row} />)}
                </div>
              </section>

              <section style={baseSurface({ padding: space[5], background: '#101828', color: '#f8fafc', borderColor: 'rgba(255,255,255,0.08)' })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[5] }}>
                  <Users size={18} style={{ color: '#fbbf24' }} />
                  <div>
                    <div style={{ fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, color: '#94a3b8', fontWeight: t.weight.semibold }}>Demand routing</div>
                    <div style={{ fontSize: t.size.h4, fontWeight: t.weight.semibold }}>SAM handoff</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: space[4], fontSize: t.size.sm, lineHeight: t.lineHeight.normal, color: '#dbeafe' }}>
                  <DarkRow label="Buyer questions" value="3" />
                  <DarkRow label="Qualified traffic" value="12 visits" />
                  <DarkRow label="Action" value="Create SAM task" />
                </div>
              </section>
            </section>
          </section>

        </main>
      </div>
    </div>
  )
}

function BlueprintOutputRail() {
  return (
    <div style={{ padding: space[5], display: 'flex', flexDirection: 'column', gap: space[5] }}>
      <DraftPreview />
      <ReadinessPanel />
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h4, fontWeight: t.weight.semibold, letterSpacing: 0 }}>{children}</h2>
}

function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, marginBottom: space[2] }}>
      {children}
    </div>
  )
}

function Pill({ children, tone = 'neutral', icon: Icon }: { children: ReactNode; tone?: StageTone; icon?: LucideIcon }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: space[2],
      minHeight: 28,
      padding: `0 ${space[4]}`,
      borderRadius: radius.pill,
      border: `1px solid ${tone === 'neutral' ? color.line : toneColor(tone)}`,
      background: toneBg(tone),
      color: toneColor(tone),
      fontSize: t.size.cap,
      fontWeight: t.weight.semibold,
      whiteSpace: 'nowrap',
    }}>
      {Icon && <Icon size={13} />}
      {children}
    </span>
  )
}

function MetricTile({ metric }: { metric: Metric }) {
  const Icon = metric.icon
  return (
    <div style={{ ...baseSurface({ padding: space[4], background: color.paper }), minHeight: 112 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <span style={{ width: 32, height: 32, borderRadius: radius.sm, display: 'grid', placeItems: 'center', background: toneBg(metric.tone), color: toneColor(metric.tone) }}>
          <Icon size={16} />
        </span>
        <span style={{ color: toneColor(metric.tone), fontSize: t.size.h4, fontWeight: t.weight.semibold }}>{metric.value}</span>
      </div>
      <div style={{ marginTop: space[4], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{metric.label}</div>
      <div style={{ marginTop: space[1], color: color.ghost, fontSize: t.size.cap, lineHeight: t.lineHeight.normal }}>{metric.detail}</div>
    </div>
  )
}

function LoopStepCard({ step }: { step: LoopStep }) {
  const Icon = step.icon
  return (
    <div style={baseSurface({ padding: space[4], background: color.paper, minHeight: 136 })}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <span style={{ width: 34, height: 34, borderRadius: radius.sm, display: 'grid', placeItems: 'center', background: toneBg(step.tone), color: toneColor(step.tone) }}>
          <Icon size={16} />
        </span>
        <span style={{ color: toneColor(step.tone), fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{step.value}</span>
      </div>
      <div style={{ marginTop: space[4], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{step.label}</div>
      <div style={{ marginTop: space[1], color: color.ghost, fontSize: t.size.cap, lineHeight: t.lineHeight.normal }}>{step.detail}</div>
    </div>
  )
}

function CommandComposer() {
  return (
    <div style={baseSurface({ padding: space[5], background: color.paper })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: space[3] }}>
        <MessageSquareText size={16} style={{ color: color.accent }} />
        <div style={{ color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>Command</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3], minHeight: 54, border: `1px solid ${color.line2}`, borderRadius: radius.md, background: color.surface, padding: `${space[4]} ${space[5]}` }}>
        <span style={{ color: color.ink, fontSize: t.size.body, flex: 1 }}>Create next week&apos;s content plan from current learnings.</span>
        <button style={{ border: 'none', background: color.ink, color: '#fff', borderRadius: radius.sm, height: 34, padding: `0 ${space[5]}`, display: 'inline-flex', alignItems: 'center', gap: space[2], fontSize: t.size.sm, fontWeight: t.weight.semibold }}>
          Run <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function NextDecision() {
  return (
    <div style={baseSurface({ padding: space[5], background: 'rgba(185, 28, 28, 0.05)', borderColor: 'rgba(185, 28, 28, 0.18)' })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
        <AlertTriangle size={16} style={{ color: color.danger }} />
        <div style={{ color: color.danger, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold }}>Decision</div>
      </div>
      <div style={{ marginTop: space[3], color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Schedule approved work first.</div>
      <div style={{ marginTop: space[2], color: color.ghost, fontSize: t.size.cap, lineHeight: t.lineHeight.normal }}>3 approved posts have no publishing slot.</div>
    </div>
  )
}

function WorkItem({ label, detail, tone }: { label: string; detail: string; tone: StageTone }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: space[3], padding: `${space[3]} 0`, borderBottom: `1px solid ${color.line}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: toneColor(tone) }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{label}</div>
        <div style={{ color: color.ghost, fontSize: t.size.cap, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
      </div>
      <ChevronRight size={15} style={{ color: color.ghost }} />
    </div>
  )
}

function MatrixHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: `${space[3]} ${space[4]}`, background: color.paper2, color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: 0, fontWeight: t.weight.semibold, borderBottom: `1px solid ${color.line}` }}>
      {children}
    </div>
  )
}

function ChannelMatrixRow({ row }: { row: ChannelRow }) {
  const cells = [
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[3], fontWeight: t.weight.semibold }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: toneColor(row.tone) }} />{row.channel}</span>,
    row.role,
    row.voice,
    row.decision,
    row.signal,
  ]
  return (
    <>
      {cells.map((cell, index) => (
        <div key={`${row.channel}-${index}`} style={{ minHeight: 66, padding: `${space[4]} ${space[4]}`, borderBottom: `1px solid ${color.line}`, color: index === 0 ? color.ink : color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.normal, background: color.surface }}>
          {cell}
        </div>
      ))}
    </>
  )
}

function LearningTableRow({ row }: { row: LearningRow }) {
  const cells = [
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[3], fontWeight: t.weight.semibold }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: toneColor(row.tone) }} />{row.signal}</span>,
    row.evidence,
    <span style={{ color: toneColor(row.tone), fontWeight: t.weight.semibold }}>{row.decision}</span>,
    row.next,
    row.owner,
  ]
  return (
    <>
      {cells.map((cell, index) => (
        <div key={`${row.signal}-${index}`} style={{ minHeight: 58, padding: `${space[4]} ${space[4]}`, borderBottom: `1px solid ${color.line}`, color: index === 0 ? color.ink : color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.normal, background: color.surface }}>
          {cell}
        </div>
      ))}
    </>
  )
}

function DarkRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: space[4], paddingBottom: space[3], borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ color: '#f8fafc', textAlign: 'right', fontWeight: t.weight.semibold }}>{value}</span>
    </div>
  )
}

function DraftPreview() {
  return (
    <section style={baseSurface({ overflow: 'hidden' })}>
      <div style={{ padding: space[5], borderBottom: `1px solid ${color.line}` }}>
        <SectionKicker>Live artifact</SectionKicker>
        <SectionTitle>Platform preview</SectionTitle>
      </div>
      <div style={{ padding: space[5] }}>
        <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden', background: color.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[4], borderBottom: `1px solid ${color.line}` }}>
            <img src="/vera-avatar.png" alt="Vera" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>Vera</div>
              <div style={{ color: color.ghost, fontSize: t.size.cap }}>Instagram preview</div>
            </div>
          </div>
          <div style={{ aspectRatio: '1 / 1', background: 'linear-gradient(135deg, #fde68a 0%, #f8fafc 48%, #d1fae5 100%)', display: 'grid', placeItems: 'center', color: color.ink }}>
            <div style={{ width: '72%', borderRadius: radius.lg, background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.8)', padding: space[6], textAlign: 'center', boxShadow: 'var(--shadow-pop)' }}>
              <Image size={38} style={{ color: color.accent, margin: '0 auto 12px' }} />
              <div style={{ fontSize: t.size.h4, fontWeight: t.weight.semibold }}>Storyboard frame</div>
              <div style={{ marginTop: space[2], color: color.ghost, fontSize: t.size.cap }}>Image first, video second</div>
            </div>
          </div>
          <div style={{ padding: space[4] }}>
            <div style={{ color: color.ink, fontSize: t.size.sm, lineHeight: t.lineHeight.normal }}>
              Launch post, visual proof angle, direct engagement CTA.
            </div>
            <div style={{ marginTop: space[4], border: `1px solid ${color.line}`, borderRadius: radius.sm, minHeight: 38, padding: `${space[3]} ${space[4]}`, color: color.ghost, fontSize: t.size.cap }}>
              First comment and source links
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[3], marginTop: space[4] }}>
          <button style={previewButton(color.ink, '#fff')}>Approve</button>
          <button style={previewButton(color.surface, color.ink)}>Tweak</button>
        </div>
      </div>
    </section>
  )
}

function previewButton(background: string, foreground: string): CSSProperties {
  return {
    height: 38,
    borderRadius: radius.sm,
    border: `1px solid ${background === color.surface ? color.line2 : background}`,
    background,
    color: foreground,
    fontSize: t.size.sm,
    fontWeight: t.weight.semibold,
  }
}

function secondaryButton(): CSSProperties {
  return {
    height: 36,
    border: `1px solid ${color.line2}`,
    borderRadius: radius.sm,
    background: color.surface,
    color: color.ink,
    display: 'inline-flex',
    alignItems: 'center',
    gap: space[2],
    padding: `0 ${space[5]}`,
    fontSize: t.size.sm,
    fontWeight: t.weight.semibold,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function ReadinessPanel() {
  return (
    <section style={baseSurface({ padding: space[5] })}>
      <SectionKicker>Readiness</SectionKicker>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[3], marginTop: space[4] }}>
        <ReadinessRow icon={CheckCircle2} label="Brain" value="Ready" tone="green" />
        <ReadinessRow icon={KeyRound} label="Keys" value="Scoped" tone="green" />
        <ReadinessRow icon={CircleDollarSign} label="Cost" value="$0.18" tone="blue" />
        <ReadinessRow icon={AlertTriangle} label="Video" value="Locked" tone="amber" />
        <ReadinessRow icon={CalendarDays} label="Schedule" value="Missing" tone="red" />
      </div>
    </section>
  )
}

function ReadinessRow({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: StageTone }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: space[3], padding: `${space[3]} 0`, borderBottom: `1px solid ${color.line}` }}>
      <Icon size={15} style={{ color: toneColor(tone) }} />
      <span style={{ color: color.ink2, fontSize: t.size.sm }}>{label}</span>
      <span style={{ color: toneColor(tone), fontSize: t.size.cap, fontWeight: t.weight.semibold }}>{value}</span>
    </div>
  )
}
