// LinkedIn audit. Answers ONE question: "How is this client's surface scoring?"
//
// Applied the UX declutter skill:
//   · Cut eyebrow + H1 + 2-line subtitle (rail labels the page; scores
//     speak for themselves)
//   · Toggles collapsed into a quiet expander — they're configuration,
//     not content. Operator opens it when they want to dial principles.
//   · Audited-against + Verdict moved out of ScoreCard nesting into a
//     single quiet section above the score grid (the foundation reads
//     once, not embedded inside the algo card)
//   · Top fixes: badges flattened to muted prefixes
//   · Continue-to-voice-audit only renders when brand_voice doesn't yet
//     exist for this org (i.e. user is still in onboarding flow). Daily
//     users never see it.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, ArrowRight, RotateCw, Check, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRightRail } from '../lib/rightRailContext'
import { useAuth } from '../lib/auth'
import { useProject } from '../lib/projectContext'
import { parseProjectInstructions } from '../lib/businessContext'
import { demandPlatformHasStrategyEvidence } from '../lib/demandModel'

const PROFILE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/linkedin-profile-score`
const BREW_URL    = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/brew360-audit`
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const ALL_PRINCIPLES = [
  { id: 'semantic_personalization',  label: 'Semantic Personalization',  desc: 'Profile + content alignment, topic authority' },
  { id: 'meaningful_engagement',     label: 'Meaningful Engagement',     desc: 'Comments > reactions, depth, stories' },
  { id: 'relationship_intelligence', label: 'Relationship Intelligence', desc: 'Cadence, variety, community participation' },
  { id: 'language_purity',           label: 'Language Purity',           desc: 'Single consistent language across profile + posts' },
  { id: 'content_authority',         label: 'Content Authority',         desc: 'Expertise, data, value prop in headline + about' },
] as const

const TOGGLE_STORAGE = 'brew_principles_enabled'

interface ProfileSection { id: string; label: string; score: number; findings: string[]; suggestion: string }
interface ProfileResult {
  success: boolean
  profile: { name: string; headline: string | null; follower_count: number; connections_count: number; is_creator: boolean; profile_picture_url: string | null }
  score: number
  grade: string
  completeness_only_score: number
  sections: ProfileSection[]
  fixes: Array<{ section: string; score: number; fix: string }>
}
interface BrewResult {
  success: boolean
  audit?: {
    audited_against?: string
    verdict?: string
    overall_score: number
    grade: string
    principles: Record<string, { score: number; findings: string[]; suggestions: string[] }>
    profile_optimization?: Record<string, { score: number; suggestion?: string; current?: string; findings?: string[] }>
    quick_wins: string[]
  }
  posts_analyzed?: number
}

export default function LinkedInScore() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { activeProject } = useProject()
  const projectId = activeProject?.org_id === orgId ? activeProject?.id ?? null : null

  const [enabledPrinciples, setEnabledPrinciples] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(TOGGLE_STORAGE)
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        return parsed.length ? parsed : ALL_PRINCIPLES.map(p => p.id)
      }
    } catch { /* ignore */ }
    return ALL_PRINCIPLES.map(p => p.id)
  })

  const [profileLoading, setProfileLoading] = useState(false)
  const [brewLoading, setBrewLoading] = useState(false)
  const [profile, setProfile] = useState<ProfileResult | null>(null)
  const [brew, setBrew] = useState<BrewResult | null>(null)
  const [profileRunAt, setProfileRunAt] = useState<string | null>(null)
  const [brewRunAt, setBrewRunAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [togglesOpen, setTogglesOpen] = useState(false)
  const [hasBrandVoice, setHasBrandVoice] = useState(false)
  const [recentRuns, setRecentRuns] = useState<Array<{ kind: string; created_at: string; score: number | null }>>([])
  const [strategyGate, setStrategyGate] = useState<'loading' | 'valid' | 'invalid'>('loading')
  const [strategyGateDetail, setStrategyGateDetail] = useState('')

  // Persist toggles to localStorage (UI fallback) AND to organisations.settings
  // (durable per-org). Org settings win on load.
  useEffect(() => {
    localStorage.setItem(TOGGLE_STORAGE, JSON.stringify(enabledPrinciples))
    if (orgId) {
      void supabase.rpc('jsonb_set_settings_brew_principles', { p_org_id: orgId, p_principles: enabledPrinciples }).then(({ error }) => {
        // RPC may not exist yet — fall back to direct merge
        if (error) {
          supabase.from('organizations').select('settings').eq('id', orgId).maybeSingle().then(({ data }) => {
            const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), brew_principles: enabledPrinciples }
            supabase.from('organizations').update({ settings }).eq('id', orgId)
          })
        }
      })
    }
  }, [enabledPrinciples, orgId])

  const togglePrinciple = (id: string) => {
    setEnabledPrinciples(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  const runProfile = useCallback(async () => {
    if (!orgId) return
    if (!session?.access_token || !projectId) {
      setError('Open this audit from an active client space and sign in again.')
      return
    }
    if (strategyGate !== 'valid') {
      setError('LinkedIn audit is not enabled for this client strategy.')
      return
    }
    setProfileLoading(true)
    setError(null)
    try {
      const res = await fetch(PROFILE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ org_id: orgId, project_id: projectId }),
      })
      const data = await res.json() as ProfileResult & { error?: string }
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setProfile(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setProfileLoading(false) }
  }, [orgId, projectId, session?.access_token, strategyGate])

  const runBrew = useCallback(async () => {
    if (!orgId) return
    if (!session?.access_token || !projectId) {
      setError('Open this audit from an active client space and sign in again.')
      return
    }
    if (strategyGate !== 'valid') {
      setError('LinkedIn audit is not enabled for this client strategy.')
      return
    }
    setBrewLoading(true)
    setError(null)
    try {
      const res = await fetch(BREW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ org_id: orgId, project_id: projectId, principles: enabledPrinciples }),
      })
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let ev: { event: string; [k: string]: unknown }
          try { ev = JSON.parse(line.slice(6).trim()) } catch { continue }
          if (ev.event === 'done')  setBrew(ev as unknown as BrewResult)
          if (ev.event === 'error') throw new Error((ev.message as string) ?? 'Unknown error')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBrewLoading(false) }
  }, [orgId, projectId, session?.access_token, enabledPrinciples, strategyGate])

  useEffect(() => {
    if (!orgId || !projectId || activeProject?.org_id !== orgId) {
      setStrategyGate('invalid')
      setStrategyGateDetail('Open this audit from an active client space.')
      return
    }
    let cancelled = false
    const context = parseProjectInstructions(activeProject?.instructions ?? '').businessContext
    if (demandPlatformHasStrategyEvidence('linkedin', context)) {
      setStrategyGate('valid')
      setStrategyGateDetail('LinkedIn is configured in this client Strategy Brain.')
      return
    }
    setStrategyGate('loading')
    Promise.all([
      supabase
        .from('client_integrations')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('provider', 'linkedin')
        .in('status', ['connected', 'healthy']),
      supabase
        .from('content_posts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .ilike('channel', '%linkedin%'),
    ]).then(([integrationRes, postRes]) => {
      if (cancelled) return
      const hasLinkedInConnection = !integrationRes.error && (integrationRes.count ?? 0) > 0
      const hasLinkedInContent = !postRes.error && (postRes.count ?? 0) > 0
      if (hasLinkedInConnection || hasLinkedInContent) {
        setStrategyGate('valid')
        setStrategyGateDetail(hasLinkedInConnection ? 'LinkedIn is connected for this client.' : 'This client already has LinkedIn content history.')
      } else {
        setStrategyGate('invalid')
        setStrategyGateDetail('Add a LinkedIn source or explicit LinkedIn strategy in the client Strategy Brain first.')
      }
    })
    return () => { cancelled = true }
  }, [activeProject?.id, activeProject?.instructions, activeProject?.org_id, orgId, projectId])

  // On first mount: load org settings (toggles) + cached results from
  // linkedin_audits + brand_voice existence (drives Continue visibility).
  // Only fetch fresh audits if no cached row exists.
  useEffect(() => {
    if (!orgId || !projectId || strategyGate !== 'valid') return
    let cancelled = false
    async function load() {
      // 1. Load org toggle settings (if set, override localStorage)
      const { data: org } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId!)
        .maybeSingle()
      if (cancelled) return
      const orgPrinciples = (org?.settings as Record<string, unknown> | null)?.brew_principles as string[] | undefined
      if (orgPrinciples?.length) setEnabledPrinciples(orgPrinciples)

      // 2. Brand voice existence — drives whether "Continue to voice audit"
      //    renders. If the operator has already set a voice, they're past
      //    onboarding and don't need the continue prompt every visit.
      const { count: bvCount } = await supabase
        .from('brand_voice')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId!)
      if (cancelled) return
      setHasBrandVoice((bvCount ?? 0) > 0)

      // 3. Load latest cached audits (one per kind)
      const { data: cached } = await supabase
        .from('linkedin_audits')
        .select('kind, result, created_at')
        .eq('org_id', orgId!)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (cancelled) return
      const cachedProfile = cached?.find(c => c.kind === 'profile')
      const cachedBrew    = cached?.find(c => c.kind === 'brew360')
      if (cachedProfile) { setProfile(cachedProfile.result as ProfileResult); setProfileRunAt(cachedProfile.created_at) }
      else runProfile()
      if (cachedBrew)    { setBrew(cachedBrew.result as BrewResult);          setBrewRunAt(cachedBrew.created_at) }
      else runBrew()

      // 4. Recent runs — feeds the right-rail history
      setRecentRuns((cached ?? []).slice(0, 8).map(r => ({
        kind: r.kind as string,
        created_at: r.created_at as string,
        score: (() => {
          if (r.kind === 'profile') return (r.result as { score?: number } | undefined)?.score ?? null
          if (r.kind === 'brew360') return (r.result as { audit?: { overall_score?: number } } | undefined)?.audit?.overall_score ?? null
          return null
        })(),
      })))
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId, strategyGate])

  // Update runAt when fresh results land
  useEffect(() => { if (profile && !profileLoading) setProfileRunAt(new Date().toISOString()) }, [profile, profileLoading])
  useEffect(() => { if (brew && !brewLoading) setBrewRunAt(new Date().toISOString()) }, [brew, brewLoading])

  const canContinue = !!profile && !!brew

  const verdictText = brew?.audit?.verdict
  const auditedAgainstText = brew?.audit?.audited_against
  const showOnboardingContinue = !hasBrandVoice

  // Right rail — recent runs history + principle toggles summary
  useRightRail(
    <AuditRightRail
      runs={recentRuns}
      enabledCount={enabledPrinciples.length}
      totalPrinciples={ALL_PRINCIPLES.length}
      onOpenToggles={() => setTogglesOpen(true)}
    />,
    [recentRuns, enabledPrinciples.length],
  )

  if (strategyGate !== 'valid') {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 pb-16">
        <div
          className="p-6"
          style={{
            background: 'var(--paper-warm)',
            border: '1px solid var(--paper-edge)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            LinkedIn audit is optional
          </p>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-quiet)' }}>
            {strategyGate === 'loading'
              ? 'Checking whether LinkedIn belongs in this client strategy.'
              : strategyGateDetail || 'LinkedIn is not currently part of this client strategy.'}
          </p>
          {strategyGate !== 'loading' && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => navigate(activeProject?.slug ? `/p/${activeProject.slug}/brain` : '/')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
              >
                Open Strategy Brain
              </button>
              <button
                onClick={() => navigate(activeProject?.slug ? `/p/${activeProject.slug}/vera` : '/')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-colors"
                style={{ border: '1px solid var(--paper-edge)', color: 'var(--ink-quiet)', borderRadius: 'var(--radius-md)' }}
              >
                Back to Vera
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 pb-16">
      {/* Audit context — extracted from website, operator reviews + edits */}
      <AuditContextCard orgId={orgId!} projectId={projectId} accessToken={session?.access_token ?? null} />

      {/* Verdict + audited-against, lifted out of the algo card so it reads */}
      {/* once as the foundation rather than nested inside one of two scores. */}
      {(verdictText || auditedAgainstText) && (
        <div className="mb-6 text-sm" style={{ borderLeft: '2px solid var(--accent-soft)', paddingLeft: 14 }}>
          {verdictText && (
            <p className="font-medium leading-snug mb-1.5" style={{ color: 'var(--ink)' }}>{verdictText}</p>
          )}
          {auditedAgainstText && (
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-quiet)' }}>{auditedAgainstText}</p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Two score cards side-by-side on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScoreCard
          title="Profile score"
          loading={profileLoading}
          score={profile?.score}
          grade={profile?.grade}
          subline={profile ? `${profile.profile.connections_count.toLocaleString()} connections · ${profile.profile.follower_count.toLocaleString()} followers${profile.profile.is_creator ? ' · creator mode' : ''}` : null}
          runAt={profileRunAt}
          onRefresh={runProfile}
        >
          {profile && (
            <div className="space-y-1.5">
              {profile.sections.map(s => (
                <ScoreBar key={s.id} label={s.label} score={s.score} />
              ))}
            </div>
          )}
        </ScoreCard>

        <ScoreCard
          title="360Brew fit"
          loading={brewLoading}
          score={brew?.audit?.overall_score}
          grade={brew?.audit?.grade}
          subline={brew ? `${brew.posts_analyzed ?? 0} recent posts analysed` : null}
          runAt={brewRunAt}
          onRefresh={runBrew}
        >
          {brew?.audit && (
            <div className="space-y-1.5">
              {Object.entries(brew.audit.principles).map(([key, val]) => {
                const meta = ALL_PRINCIPLES.find(p => p.id === key)
                return <ScoreBar key={key} label={meta?.label ?? key} score={val.score} />
              })}
            </div>
          )}
        </ScoreCard>
      </div>

      {/* Top fixes — flat list, no badge chrome. Source signalled by muted */}
      {/* prefix; visual rhythm comes from hairline rules, not card frames.  */}
      {(profile?.fixes?.length || brew?.audit?.quick_wins?.length) && (
        <div className="mt-8">
          <p className="text-[12px] font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--ghost)' }}>Top fixes</p>
          <div style={{ borderTop: '1px solid var(--paper-edge)' }}>
            {profile?.fixes?.slice(0, 3).map((f, i) => (
              <FixRow key={`p-${i}`} source="Profile" focus={f.section} text={f.fix} />
            ))}
            {brew?.audit?.quick_wins?.slice(0, 3).map((w, i) => (
              <FixRow key={`b-${i}`} source="Brew360" text={w} />
            ))}
          </div>
        </div>
      )}

      {/* Principles toggle — collapsed by default. It's configuration that  */}
      {/* most operators set once and never revisit; surfacing it as a full   */}
      {/* card every visit was the page's biggest violation of the skill.    */}
      <div className="mt-8" style={{ borderTop: '1px solid var(--paper-edge)' }}>
        <button
          onClick={() => setTogglesOpen(o => !o)}
          className="w-full flex items-center gap-2 py-3 text-left transition-colors hover:bg-[var(--fog)] -mx-2 px-2"
          style={{ color: 'var(--ink-quiet)' }}
        >
          <ChevronRight size={13} className={`transition-transform ${togglesOpen ? 'rotate-90' : ''}`} strokeWidth={2} />
          <span className="text-[13px] font-medium">
            Brew360 principles
            <span className="ml-1.5 font-normal" style={{ color: 'var(--ghost)' }}>
              {enabledPrinciples.length} of {ALL_PRINCIPLES.length} active
            </span>
          </span>
          {togglesOpen && (
            <button
              onClick={e => { e.stopPropagation(); runBrew() }}
              disabled={brewLoading || !enabledPrinciples.length}
              className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
              style={{ color: 'var(--ink)' }}
            >
              {brewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" strokeWidth={2} />}
              Re-run
            </button>
          )}
        </button>
        {togglesOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pb-4">
            {ALL_PRINCIPLES.map(p => {
              const on = enabledPrinciples.includes(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => togglePrinciple(p.id)}
                  className="text-left px-3 py-2 transition-colors hover:bg-[var(--fog)]"
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-4 h-4 mt-0.5 flex-shrink-0 flex items-center justify-center"
                      style={{
                        background: on ? 'var(--ink)' : 'transparent',
                        border: on ? 'none' : '1px solid var(--mist)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {on && <Check className="w-3 h-3" style={{ color: 'var(--paper-warm)' }} strokeWidth={2.5} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{p.label}</p>
                      <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--ghost)' }}>{p.desc}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Continue — only renders during onboarding (when brand_voice hasn't  */}
      {/* been set yet). Daily users hitting /audit never see this prompt.    */}
      {showOnboardingContinue && (
        <div className="mt-8 flex items-center justify-between" style={{ borderTop: '1px solid var(--paper-edge)', paddingTop: 24 }}>
          <p className="text-[12px]" style={{ color: 'var(--ghost)' }}>
            {canContinue ? 'Both audits complete. Continue to voice setup.' : 'Both audits must complete before you can continue.'}
          </p>
          <button
            onClick={() => navigate(`/onboarding/audit/${orgId}?skip_brew=1`)}
            disabled={!canContinue}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--ink)', color: 'var(--paper-warm)', borderRadius: 'var(--radius-md)' }}
          >
            Continue <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ScoreBar — shared section-score row used by both audit cards ────────
function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-600">{label}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="text-xs font-mono text-gray-700 w-8 text-right">{score}</span>
      </div>
    </div>
  )
}

// ─── FixRow — flat hairline-divided row, muted source prefix ─────────────
function FixRow({ source, focus, text }: { source: string; focus?: string; text: string }) {
  return (
    <div className="py-2.5 flex gap-3 text-[13px] leading-relaxed" style={{ borderBottom: '1px solid var(--paper-edge)' }}>
      <span className="text-[11px] font-medium uppercase tracking-wide flex-shrink-0 w-16 mt-0.5" style={{ color: 'var(--ghost)' }}>
        {source}
      </span>
      <span style={{ color: 'var(--ink-quiet)' }}>
        {focus && <span className="font-medium" style={{ color: 'var(--ink)' }}>{focus}: </span>}
        {text}
      </span>
    </div>
  )
}

function ScoreCard({ title, loading, score, grade, subline, runAt, onRefresh, children }: {
  title: string; loading: boolean; score?: number; grade?: string;
  subline: string | null; runAt?: string | null; onRefresh: () => void; children?: React.ReactNode;
}) {
  return (
    <div
      className="p-5"
      style={{
        background: 'var(--paper-warm)',
        border: '1px solid var(--paper-edge)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{title}</p>
        <button
          onClick={onRefresh}
          disabled={loading}
          title={runAt ? `Last run ${relativeTime(runAt)}` : 'Run'}
          className="hover:opacity-100 opacity-50 disabled:opacity-30 transition-opacity"
          style={{ color: 'var(--ink-quiet)' }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" strokeWidth={1.75} />}
        </button>
      </div>
      <div className="flex items-end gap-3 mb-3">
        <span className="text-[40px] font-semibold leading-none" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
          {loading && score === undefined ? '—' : (score ?? '—')}
        </span>
        {grade && <span className="text-[20px] font-semibold pb-0.5" style={{ color: 'var(--ink-quiet)' }}>{grade}</span>}
      </div>
      {/* One meta line — subline + runAt collapsed together. Picked over    */}
      {/* "Last run X" double-printing.                                       */}
      {(subline || runAt) && (
        <p className="text-[11.5px] mb-4" style={{ color: 'var(--ghost)' }}>
          {[subline, runAt ? `· ${relativeTime(runAt)}` : null].filter(Boolean).join(' ')}
        </p>
      )}
      {loading && score === undefined && (
        <div className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--ghost)' }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Running…
        </div>
      )}
      {children}
    </div>
  )
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60_000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return `${d}d ago`
}

// ─── AuditContextCard ────────────────────────────────────────────────────────
// Captures the operator's audience, offer, value prop, positioning, themes,
// tone, and success criteria so both audits score against intent, not generic
// best practices. Pre-fills via the extract-audit-intent edge function
// (which crawls the org website + LLM-extracts). Operator reviews/edits/saves.

interface AuditIntent {
  summary?: string
  icp_summary?: string
  offer?: string
  value_prop?: string
  role_positioning?: string
  themes?: string[]
  tone_target?: string
  success_criteria?: string
  extracted_at?: string
  extracted_from?: string[]
  sitemap_urls_found?: number
  blog_posts_sampled?: number
}

function AuditContextCard({ orgId, projectId, accessToken }: { orgId: string; projectId: string | null; accessToken: string | null }) {
  const [intent, setIntent] = useState<AuditIntent | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AuditIntent>({})

  useEffect(() => {
    let cancelled = false
    supabase.from('organizations').select('settings').eq('id', orgId).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const ai = ((data?.settings as Record<string, unknown> | null) ?? {}).audit_intent as AuditIntent | undefined
      setIntent(ai ?? null)
      setDraft(ai ?? {})
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [orgId])

  async function extractFromWebsite() {
    setExtracting(true)
    setError(null)
    if (!projectId || !accessToken) {
      setError('Open this audit from an active client space and sign in again.')
      setExtracting(false)
      return
    }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-audit-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ org_id: orgId, project_id: projectId, force: true }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? `HTTP ${res.status}`)
      setIntent(data.audit_intent as AuditIntent)
      setDraft(data.audit_intent as AuditIntent)
      setEditing(true)  // open editor so the operator reviews the extraction
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setExtracting(false) }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const { data } = await supabase.from('organizations').select('settings').eq('id', orgId).maybeSingle()
      const settings = { ...((data?.settings as Record<string, unknown> | null) ?? {}), audit_intent: { ...draft, edited_at: new Date().toISOString() } }
      const { error: updErr } = await supabase.from('organizations').update({ settings }).eq('id', orgId)
      if (updErr) throw new Error(updErr.message)
      setIntent(draft)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 text-xs text-gray-400">Loading audit context…</div>
    )
  }

  // Empty state — no audit_intent set
  if (!intent && !editing) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold flex-shrink-0">!</div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">No audit context set</p>
            <p className="text-xs text-amber-800 mt-1">
              Both audits score against generic best practices unless you tell them who this profile is for, what you sell, and how you want to be perceived. Pull this from your website to start.
            </p>
            <div className="flex gap-2 mt-3">
              <button onClick={extractFromWebsite} disabled={extracting}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
                {extracting ? <><Loader2 className="w-3 h-3 animate-spin" /> Extracting…</> : 'Pull from website'}
              </button>
              <button onClick={() => { setDraft({}); setEditing(true) }}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-amber-300 text-amber-900 hover:bg-amber-100">
                Enter manually
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    )
  }

  // Editor
  if (editing) {
    return (
      <div className="bg-white border-2 border-gray-300 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-900">Audit context</p>
          <div className="flex gap-2">
            <button onClick={extractFromWebsite} disabled={extracting}
              className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {extracting ? '…' : 'Re-extract from website'}
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <IntentField label="Summary (the foundation BREW360 echoes back)" hint="60-90 word narrative — who you are, who for, what success looks like"
            value={draft.summary} onChange={v => setDraft(d => ({ ...d, summary: v }))} />
          <IntentField label="Audience (who is this for?)" hint="Segment, role, stage, trigger"
            value={draft.icp_summary} onChange={v => setDraft(d => ({ ...d, icp_summary: v }))} />
          <IntentField label="Offer (what you sell)" hint="Concrete deliverable, not category"
            value={draft.offer} onChange={v => setDraft(d => ({ ...d, offer: v }))} />
          <IntentField label="Value prop (specific outcome)" hint="Numbers + differentiation vs the obvious alternative"
            value={draft.value_prop} onChange={v => setDraft(d => ({ ...d, value_prop: v }))} />
          <IntentField label="Role positioning" hint="How you want to be perceived to credibly sell this"
            value={draft.role_positioning} onChange={v => setDraft(d => ({ ...d, role_positioning: v }))} />
          <IntentField label="Content themes" hint="3-5 themes, comma-separated"
            value={draft.themes?.join(', ') ?? ''}
            onChange={v => setDraft(d => ({ ...d, themes: v.split(',').map(s => s.trim()).filter(Boolean) }))} />
          <IntentField label="Tone target" hint="Voice profile — direct, opinionated, technical, etc."
            value={draft.tone_target} onChange={v => setDraft(d => ({ ...d, tone_target: v }))} />
          <IntentField label="Success criteria" hint="What 'winning' on LinkedIn looks like in 6 months"
            value={draft.success_criteria} onChange={v => setDraft(d => ({ ...d, success_criteria: v }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setEditing(false); setDraft(intent ?? {}) }}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  // Compact view
  const sources = intent?.extracted_from?.length ?? 0
  const blogN = intent?.blog_posts_sampled ?? 0
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Audit context</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {intent?.extracted_at ? `Extracted ${relativeTime(intent.extracted_at)}` : 'Manually set'}
            {sources ? ` from ${sources} source${sources === 1 ? '' : 's'}` : ''}
            {blogN ? ` (incl. ${blogN} blog post${blogN === 1 ? '' : 's'})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)}
            className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
            Edit
          </button>
          <button onClick={extractFromWebsite} disabled={extracting}
            className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {extracting ? '…' : 'Re-extract'}
          </button>
        </div>
      </div>

      {/* Lead narrative — reads first, becomes the foundation BREW360 echoes back */}
      {intent?.summary && (
        <p className="text-sm text-gray-800 leading-relaxed mb-4 pb-4 border-b border-gray-100">
          {intent.summary}
        </p>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <CompactRow label="Audience"      value={intent?.icp_summary} />
        <CompactRow label="Offer"         value={intent?.offer} />
        <CompactRow label="Value prop"    value={intent?.value_prop} />
        <CompactRow label="Positioning"   value={intent?.role_positioning} />
        <CompactRow label="Themes"        value={intent?.themes?.join(' · ')} />
        <CompactRow label="Tone"          value={intent?.tone_target} />
        <CompactRow label="Success"       value={intent?.success_criteria} fullWidth />
      </dl>
    </div>
  )
}

function IntentField({ label, hint, value, onChange }: {
  label: string; hint: string; value?: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-700 block mb-0.5">{label}</label>
      <p className="text-[11px] text-gray-400 mb-1.5">{hint}</p>
      <textarea
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="input w-full resize-y"
        placeholder="—"
      />
    </div>
  )
}

function CompactRow({ label, value, fullWidth }: { label: string; value?: string; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</dt>
      <dd className="text-xs text-gray-700 mt-0.5">{value || <span className="text-gray-300">—</span>}</dd>
    </div>
  )
}

// ─── Audit right rail ──────────────────────────────────────────────────
// Recent runs history (chronological scores) + a compact summary of the
// Brew360 principles toggle state (with a button that scrolls the page
// down to the full toggle expander).
function AuditRightRail({
  runs, enabledCount, totalPrinciples, onOpenToggles,
}: {
  runs: Array<{ kind: string; created_at: string; score: number | null }>
  enabledCount: number
  totalPrinciples: number
  onOpenToggles: () => void
}) {
  // Group runs by date — one row per day showing both scores
  const byDate = new Map<string, { profile?: number | null; brew?: number | null; iso: string }>()
  for (const r of runs) {
    const day = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const existing = byDate.get(day) ?? { iso: r.created_at }
    if (r.kind === 'profile') existing.profile = r.score
    if (r.kind === 'brew360') existing.brew    = r.score
    byDate.set(day, existing)
  }
  const grouped = Array.from(byDate.entries()).slice(0, 5)

  return (
    <div className="flex flex-col gap-6 py-6 pr-5 pl-1">
      {grouped.length > 0 && (
        <section>
          <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
            Recent runs
          </p>
          <div className="flex flex-col text-[12.5px]" style={{ color: 'var(--ink-quiet)' }}>
            {grouped.map(([day, scores], i) => (
              <div
                key={day}
                className="flex justify-between py-2"
                style={{ borderBottom: i < grouped.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}
              >
                <span>{day}</span>
                <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                  {scores.profile ?? '—'} · {scores.brew ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="text-[10px] font-medium uppercase mb-2.5" style={{ color: 'var(--ghost)', letterSpacing: '0.06em' }}>
          Brew360 principles
        </p>
        <button
          onClick={onOpenToggles}
          className="text-left w-full text-[12.5px] hover:opacity-80 transition-opacity"
          style={{ color: 'var(--ink-quiet)' }}
        >
          <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{enabledCount}</span> of {totalPrinciples} active
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ghost)' }}>
            Tap to configure ↓
          </div>
        </button>
      </section>
    </div>
  )
}
