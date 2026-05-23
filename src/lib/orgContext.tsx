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
      supabase
        .from('organizations')
        .select('id, name')
        .limit(10)
        .then(({ data }) => {
          const synthetic: OrgMember[] = ((data ?? []) as Array<{ id: string } & Record<string, unknown>>).map(o => ({
            org_id: o.id,
            role: 'dev' as const,
            organizations: o as unknown as OrgMember['organizations'],
          }))
          setOrgs(synthetic)
          setActiveOrgId(prev => prev && synthetic.find(m => m.org_id === prev) ? prev : (localStorage.getItem('activeOrgId') ?? synthetic[0]?.org_id) ?? null)
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
