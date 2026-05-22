import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, ArrowRight, RotateCw, Check } from 'lucide-react'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(TOGGLE_STORAGE, JSON.stringify(enabledPrinciples))
  }, [enabledPrinciples])

  const togglePrinciple = (id: string) => {
    setEnabledPrinciples(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  const runProfile = useCallback(async () => {
    if (!orgId) return
    setProfileLoading(true)
    setError(null)
    try {
      const res = await fetch(PROFILE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ org_id: orgId }),
      })
      const data = await res.json() as ProfileResult & { error?: string }
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setProfile(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setProfileLoading(false) }
  }, [orgId])

  const runBrew = useCallback(async () => {
    if (!orgId) return
    setBrewLoading(true)
    setError(null)
    try {
      const res = await fetch(BREW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ org_id: orgId, principles: enabledPrinciples }),
      })
      const data = await res.json() as BrewResult & { error?: string }
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setBrew(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBrewLoading(false) }
  }, [orgId, enabledPrinciples])

  // Auto-run both on first mount
  useEffect(() => {
    if (!orgId) return
    runProfile()
    runBrew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const canContinue = !!profile && !!brew

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 pb-16">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-1">LinkedIn audit · required</p>
        <h1 className="text-2xl font-bold text-gray-900">How LinkedIn sees you</h1>
        <p className="text-sm text-gray-500 mt-1">
          Two scores: your profile quality (deterministic) and your fit with LinkedIn's 360Brew algorithm (AI-judged on the 5 principles below).
          Toggle the principles you want included in the algorithm score.
        </p>
      </div>

      {/* Toggles */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-900">360Brew principles ({enabledPrinciples.length} of {ALL_PRINCIPLES.length})</p>
          <button onClick={runBrew} disabled={brewLoading || !enabledPrinciples.length}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-40">
            {brewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Re-run brew360 with current selection
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_PRINCIPLES.map(p => {
            const on = enabledPrinciples.includes(p.id)
            return (
              <button key={p.id} onClick={() => togglePrinciple(p.id)}
                className={`text-left p-3 rounded-lg border-2 transition-all ${on ? 'border-violet-400 bg-violet-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="flex items-start gap-2">
                  <div className={`w-4 h-4 mt-0.5 rounded border-2 flex-shrink-0 flex items-center justify-center ${on ? 'border-violet-600 bg-violet-600' : 'border-gray-300 bg-white'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{p.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{p.desc}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Two score cards side-by-side on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Profile score */}
        <ScoreCard
          title="Profile score"
          subtitle={profile ? `Deterministic — ${profile.sections.length} sections checked` : 'Deterministic — every profile field scored'}
          loading={profileLoading}
          score={profile?.score}
          grade={profile?.grade}
          subline={profile ? `${profile.profile.connections_count.toLocaleString()} connections · ${profile.profile.follower_count.toLocaleString()} followers${profile.profile.is_creator ? ' · creator mode' : ''}` : null}
          onRefresh={runProfile}
        >
          {profile && (
            <div className="space-y-1.5">
              {profile.sections.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-600">{s.label}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full ${s.score >= 70 ? 'bg-emerald-500' : s.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${s.score}%` }} />
                    </div>
                    <span className="text-xs font-mono text-gray-700 w-8 text-right">{s.score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScoreCard>

        {/* Brew360 score */}
        <ScoreCard
          title="360Brew algo fit"
          subtitle={`AI scoring · ${enabledPrinciples.length} principle${enabledPrinciples.length === 1 ? '' : 's'}`}
          loading={brewLoading}
          score={brew?.audit?.overall_score}
          grade={brew?.audit?.grade}
          subline={brew ? `${brew.posts_analyzed ?? 0} recent posts analysed` : null}
          onRefresh={runBrew}
        >
          {brew?.audit && (
            <div className="space-y-1.5">
              {Object.entries(brew.audit.principles).map(([key, val]) => {
                const meta = ALL_PRINCIPLES.find(p => p.id === key)
                return (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-600">{meta?.label ?? key}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full ${val.score >= 70 ? 'bg-emerald-500' : val.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${val.score}%` }} />
                      </div>
                      <span className="text-xs font-mono text-gray-700 w-8 text-right">{val.score}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScoreCard>
      </div>

      {/* Top fixes pooled from both audits */}
      {(profile || brew) && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-900 mb-3">Top fixes</p>
          <div className="space-y-2">
            {profile?.fixes?.slice(0, 3).map((f, i) => (
              <div key={`p-${i}`} className="flex items-start gap-2 text-sm">
                <span className="text-[10px] uppercase font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">PROFILE</span>
                <div className="text-gray-700"><span className="font-medium">{f.section}:</span> {f.fix}</div>
              </div>
            ))}
            {brew?.audit?.quick_wins?.slice(0, 3).map((w, i) => (
              <div key={`b-${i}`} className="flex items-start gap-2 text-sm">
                <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">BREW360</span>
                <div className="text-gray-700">{w}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Continue */}
      <div className="mt-8 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {canContinue ? "When you're ready, continue to the voice audit." : "Both audits must complete before you can continue."}
        </p>
        <button onClick={() => navigate(`/onboarding/audit/${orgId}?skip_brew=1`)} disabled={!canContinue}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
          Continue to voice audit <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function ScoreCard({ title, subtitle, loading, score, grade, subline, onRefresh, children }: {
  title: string; subtitle: string; loading: boolean; score?: number; grade?: string;
  subline: string | null; onRefresh: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex items-end gap-3 mb-4">
        <span className="text-5xl font-bold text-gray-900">{loading && score === undefined ? '—' : (score ?? '—')}</span>
        {grade && <span className="text-2xl font-bold text-violet-600 mb-1">{grade}</span>}
      </div>
      {subline && <p className="text-xs text-gray-500 mb-4">{subline}</p>}
      {loading && score === undefined && (
        <div className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</div>
      )}
      {children}
    </div>
  )
}
