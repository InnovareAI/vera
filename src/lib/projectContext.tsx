// Project context — parallel to OrgContext.
//
// Claude.ai-style projects: bounded scopes within a workspace. Each
// project has its own custom instructions, knowledge base, brand voice,
// and artifacts. VERA's chat scope follows the active project.
//
// Backed by the `projects` table (migration 026). Every org gets a
// default project on backfill (`[Org name] brand`); the operator can
// create additional projects (prospect work, exercises, internal, etc.)
// from the project switcher.
//
// Defensive behavior: if the migration hasn't been applied yet (table
// doesn't exist), the provider degrades silently — projects stays empty,
// activeProject null, and consumers fall back to org-level scope. Once
// the migration lands, projects populate automatically.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import type { Project } from './supabase'
import { useOrg } from './orgContext'

interface ProjectContextType {
  activeProject: Project | null
  projects: Project[]
  starredProjects: Project[]
  recentProjects: Project[]
  loading: boolean
  /** Switch active project by slug or id. */
  switchProject: (slugOrId: string) => void
  /** Re-query the projects list (after create / edit / star toggle). */
  refetch: () => void
}

const ProjectContext = createContext<ProjectContextType>({
  activeProject: null,
  projects: [],
  starredProjects: [],
  recentProjects: [],
  loading: true,
  switchProject: () => {},
  refetch: () => {},
})

const ACTIVE_PROJECT_STORAGE = 'vera-active-project'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useOrg()
  const [projects, setProjects] = useState<Project[]>([])
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!activeOrg?.id) {
      setProjects([])
      setActiveSlug(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('projects')
      .select('id, org_id, name, slug, description, instructions, is_starred, is_archived, is_default, created_at, updated_at')
      .eq('org_id', activeOrg.id)
      .eq('is_archived', false)
      .order('is_starred', { ascending: false })
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Defensive: table doesn't exist yet (migration 026 not applied),
          // or RLS blocks. Surface empty list rather than crash.
          // eslint-disable-next-line no-console
          console.warn('[projectContext] projects query failed — migration 026 may not be applied yet:', error.message)
          setProjects([])
          setActiveSlug(null)
          setLoading(false)
          return
        }
        const list = (data ?? []) as Project[]
        setProjects(list)
        // Pick active: stored slug if still valid, else the org's default project, else first.
        const storageKey = `${ACTIVE_PROJECT_STORAGE}:${activeOrg.id}`
        const stored = localStorage.getItem(storageKey)
        const pick =
          (stored && list.find(p => p.slug === stored)) ||
          list.find(p => p.is_default) ||
          list[0] ||
          null
        setActiveSlug(pick?.slug ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeOrg?.id, tick])

  const switchProject = useCallback((slugOrId: string) => {
    const target = projects.find(p => p.slug === slugOrId || p.id === slugOrId)
    if (!target || !activeOrg?.id) return
    setActiveSlug(target.slug)
    try {
      localStorage.setItem(`${ACTIVE_PROJECT_STORAGE}:${activeOrg.id}`, target.slug)
    } catch { /* ignore quota errors */ }
  }, [projects, activeOrg?.id])

  const refetch = useCallback(() => setTick(t => t + 1), [])

  const activeProject = projects.find(p => p.slug === activeSlug) ?? null
  const starredProjects = projects.filter(p => p.is_starred)
  // "Recent" excludes whatever's already in Starred (avoid dupes in the rail)
  const recentProjects = projects.filter(p => !p.is_starred).slice(0, 6)

  return (
    <ProjectContext.Provider value={{
      activeProject,
      projects,
      starredProjects,
      recentProjects,
      loading,
      switchProject,
      refetch,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export const useProject = () => useContext(ProjectContext)
