import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface OrgInfo {
  id: string
  name: string
  slug: string
  org_type: string
  logo_url?: string
  plan: string
}

interface OrgMember {
  org_id: string
  role: string
  organizations: OrgInfo
}

interface OrgContextType {
  activeOrg: OrgInfo | null
  activeRole: string | null
  orgs: OrgMember[]
  loading: boolean
  switchOrg: (orgId: string) => void
  refetch: () => void
}

const OrgContext = createContext<OrgContextType>({
  activeOrg: null,
  activeRole: null,
  orgs: [],
  loading: true,
  switchOrg: () => {},
  refetch: () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState<OrgMember[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // No-auth fallback: load all orgs directly so the UI works without a
    // session. Was DEV-only before, but auth is deferred per "Internal
    // first — external later", so production needs the same fallback
    // until GoTrue lands. Tighten when auth wiring runs.
    if (!user) {
      setLoading(true)
      // Load all orgs + a project tally so we land on a POPULATED workspace.
      // The old fallback picked an unordered synthetic[0], which sometimes
      // resolved to a project-less org → "No clients yet" / stuck "Loading
      // thread…". Prefer: prior selection → stored selection → org with the
      // most projects → first org.
      Promise.all([
        supabase.from('organizations').select('id, name').order('name').limit(50),
        supabase.from('projects').select('org_id'),
      ]).then(([orgRes, projRes]) => {
        const synthetic: OrgMember[] = ((orgRes.data ?? []) as Array<{ id: string } & Record<string, unknown>>).map(o => ({
          org_id: o.id,
          role: 'dev' as const,
          organizations: o as unknown as OrgMember['organizations'],
        }))
        const counts = new Map<string, number>()
        for (const r of (projRes.data ?? []) as Array<{ org_id: string }>) {
          counts.set(r.org_id, (counts.get(r.org_id) ?? 0) + 1)
        }
        const richest = synthetic
          .map(m => ({ id: m.org_id, n: counts.get(m.org_id) ?? 0 }))
          .sort((a, b) => b.n - a.n)[0]
        const stored = localStorage.getItem('activeOrgId')
        setOrgs(synthetic)
        setActiveOrgId(prev => {
          if (prev && synthetic.find(m => m.org_id === prev)) return prev
          if (stored && synthetic.find(m => m.org_id === stored)) return stored
          return (richest && richest.n > 0 ? richest.id : synthetic[0]?.org_id) ?? null
        })
        setLoading(false)
      })
      return
    }
    setLoading(true)
    supabase
      .from('org_members')
      .select('org_id, role, organizations(id, name, slug, org_type, logo_url, plan)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const members = (data as unknown as OrgMember[]) || []
        setOrgs(members)
        setActiveOrgId(prev => {
          // Keep current selection if still valid
          if (prev && members.find(m => m.org_id === prev)) return prev
          return members[0]?.org_id ?? null
        })
        setLoading(false)
      })
  }, [user, tick])

  // Persist the active org so a reload — or a new deploy forcing a fresh load —
  // returns to the same workspace instead of re-resolving to a random one.
  useEffect(() => {
    if (activeOrgId) { try { localStorage.setItem('activeOrgId', activeOrgId) } catch { /* ignore */ } }
  }, [activeOrgId])

  function switchOrg(orgId: string) {
    setActiveOrgId(orgId)
  }

  function refetch() {
    setTick(t => t + 1)
  }

  const activeMember = orgs.find(o => o.org_id === activeOrgId) ?? orgs[0]
  const activeOrg = activeMember?.organizations ?? null
  const activeRole = activeMember?.role ?? null

  return (
    <OrgContext.Provider value={{ activeOrg, activeRole, orgs, loading, switchOrg, refetch }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
