import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface OrgInfo {
  id: string
  name: string
  slug: string
  org_type?: string
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
  // True when the user has a real org_members row (agency staff). False when the
  // workspace was derived from project memberships only (a client collaborator
  // invited to a single client space). Drives where they land on entry.
  isOrgMember: boolean
  switchOrg: (orgId: string) => void
  refetch: () => void
}

const OrgContext = createContext<OrgContextType>({
  activeOrg: null,
  activeRole: null,
  orgs: [],
  loading: true,
  isOrgMember: false,
  switchOrg: () => {},
  refetch: () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState<OrgMember[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOrgMember, setIsOrgMember] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    // Build the workspace list from the PROJECTS table — which is readable in
    // every case — rather than `organizations`. An authenticated non-member is
    // blocked by RLS from reading `organizations` (returns []), which used to
    // strand them on "No clients yet" even though their projects are visible.
    // We enrich names from `organizations` where visible, then land on the org
    // with the most projects (never an empty one). Used for both no-session and
    // authenticated-but-unprovisioned users.
    const loadFromProjects = async () => {
      const [orgRes, projRes] = await Promise.all([
        supabase.from('organizations').select('id, name').limit(50),
        supabase.from('projects').select('org_id').eq('is_archived', false),
      ])
      if (cancelled) return
      const names = new Map<string, string>()
      for (const o of (orgRes.data ?? []) as Array<{ id: string; name: string }>) names.set(o.id, o.name)
      const counts = new Map<string, number>()
      for (const r of (projRes.data ?? []) as Array<{ org_id: string }>) counts.set(r.org_id, (counts.get(r.org_id) ?? 0) + 1)
      const ids = new Set<string>([...counts.keys(), ...names.keys()])
      const synthetic: OrgMember[] = [...ids].map(id => ({
        org_id: id,
        role: 'dev' as const,
        organizations: { id, name: names.get(id) ?? 'Workspace' } as unknown as OrgMember['organizations'],
      }))
      const richest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      const stored = localStorage.getItem('activeOrgId')
      setIsOrgMember(false)
      setOrgs(synthetic)
      setActiveOrgId(prev => {
        if (prev && synthetic.find(m => m.org_id === prev)) return prev
        if (stored && synthetic.find(m => m.org_id === stored)) return stored
        return (richest ? richest[0] : synthetic[0]?.org_id) ?? null
      })
      setLoading(false)
    }

    // No session → fallback (auth deferred per "internal first — external later").
    if (!user) { loadFromProjects(); return () => { cancelled = true } }

    // Authenticated: use real memberships; if the user has none (domain-join
    // never provisioned them), fall back to the project-derived list so they
    // still land in a usable workspace instead of an empty one.
    supabase
      .from('org_members')
      .select('org_id, role, organizations(id, name, slug, logo_url, plan)')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return
        // Any failure (or no rows) falls back to the project-derived workspace,
        // so an invited member never lands on a blank app while loading hangs.
        const members = (error ? [] : (data as unknown as OrgMember[])) || []
        if (members.length === 0) { loadFromProjects(); return }
        setIsOrgMember(true)
        setOrgs(members)
        setActiveOrgId(prev => {
          if (prev && members.find(m => m.org_id === prev)) return prev
          return members[0]?.org_id ?? null
        })
        setLoading(false)
      })
    return () => { cancelled = true }
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
    <OrgContext.Provider value={{ activeOrg, activeRole, orgs, loading, isOrgMember, switchOrg, refetch }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
