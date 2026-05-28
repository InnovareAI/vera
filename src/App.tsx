import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { OrgProvider, useOrg } from './lib/orgContext'
import { ProjectProvider, useProject } from './lib/projectContext'
import { RightRailProvider } from './lib/rightRailContext'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './design'
import { ErrorBoundary } from './components/ErrorBoundary'
import { setUserContext, setOrgContext } from './lib/sentry'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Generate from './pages/Generate'
import Review from './pages/Review'
import ReviewDetail from './pages/ReviewDetail'
import Onboarding from './pages/Onboarding'
import OnboardingAudit from './pages/OnboardingAudit'
import LinkedInScore from './pages/LinkedInScore'
import Clients from './pages/Clients'
import Calendar from './pages/Calendar'
import Library from './pages/Library'
import Knowledge from './pages/Knowledge'
import Intel from './pages/Intel'
import Templates from './pages/Templates'
import Skills from './pages/Skills'
import Settings from './pages/Settings'
import Agency from './pages/Agency'

export default function App() {
  // Top-level boundary catches anything that escapes a route boundary —
  // provider crashes, route-shell crashes, anything in the non-Layout
  // routes (Login, Onboarding, OnboardingAudit, LinkedInScore). Route-level
  // boundary lives inside Layout, wrapping <Outlet />, so the rail survives
  // when a single page blows up.
  return (
    <ErrorBoundary variant="page">
      <ThemeProvider>
        <ToastProvider>
        <AuthProvider>
          <OrgProvider>
            <ProjectProvider>
            <RightRailProvider>
            <SentryContextBridge />
            <Routes>
              <Route path="/login" element={<LoginGuard />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/onboarding/audit/:orgId" element={<OnboardingAudit />} />
              <Route path="/" element={<Layout />}>
                {/* /linkedin-score moved INSIDE Layout so it picks up the     */}
                {/* rails (the standalone version had no left rail / chat dock */}
                {/* / right rail). Still works during onboarding — rails just  */}
                {/* have less content for a brand-new workspace.               */}
                <Route path="linkedin-score/:orgId" element={<LinkedInScore />} />
                <Route index element={<RedirectToProjectDashboard />} />

                {/* Project-scoped routes — preferred. URL carries the
                    active project's slug; pages filter by that project. */}
                <Route path="p/:projectSlug">
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard"  element={<Dashboard />} />
                  <Route path="generate"   element={<Generate />} />
                  <Route path="review"     element={<Review />} />
                  <Route path="review/:id" element={<ReviewDetail />} />
                  <Route path="knowledge"  element={<Knowledge />} />
                </Route>

                {/* Legacy flat routes — redirect to /p/:slug/* using the
                    active project (or fall through to dashboard if no
                    project context yet). Kept working so existing links,
                    bookmarks, and rail items don't 404. */}
                <Route path="dashboard"  element={<RedirectFlatToProject section="dashboard" />} />
                <Route path="generate"   element={<RedirectFlatToProject section="generate" />} />
                <Route path="review"     element={<RedirectFlatToProject section="review" />} />
                <Route path="review/:id" element={<RedirectReviewDetailToProject />} />

                {/* Workspace-level routes — not project-scoped. */}
                <Route path="audit"      element={<AuditRedirect />} />
                <Route path="knowledge"  element={<Knowledge />} />
                <Route path="clients"    element={<Clients />} />
                <Route path="calendar"   element={<Calendar />} />
                <Route path="library"    element={<Library />} />
                <Route path="intel"      element={<Intel />} />
                <Route path="templates"  element={<Templates />} />
                <Route path="skills"     element={<Skills />} />
                <Route path="settings"   element={<Settings />} />
                <Route path="agency"     element={<Agency />} />
              </Route>
            </Routes>
            </RightRailProvider>
            </ProjectProvider>
          </OrgProvider>
        </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

// Redirect to dashboard if already logged in
function LoginGuard() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/dashboard" replace />
  return <Login />
}

// /audit picks the right destination for the active workspace:
//   - no org              → /onboarding (first-time signup)
//   - org, no audit yet   → /onboarding/audit/:orgId (run the first audit)
//   - org, audit exists   → /linkedin-score/:orgId (the actual report)
//
// Waits for the org context to finish loading before deciding — earlier
// version raced the load and always fired '/onboarding' on first paint
// because activeOrg was null while the OrgProvider's query was in flight.
function AuditRedirect() {
  const { activeOrg, loading: orgLoading } = useOrg()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    // Hold redirect until the org context has settled. Without this gate,
    // the component fires Navigate('/onboarding') on first paint and we
    // never see activeOrg even when one exists.
    if (orgLoading) return
    if (!activeOrg?.id) {
      setTarget('/onboarding')
      return
    }
    let cancelled = false
    supabase
      .from('linkedin_audits')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', activeOrg.id)
      .then(({ count }) => {
        if (cancelled) return
        const hasAudit = (count ?? 0) > 0
        setTarget(hasAudit
          ? `/linkedin-score/${activeOrg.id}`
          : `/onboarding/audit/${activeOrg.id}`)
      })
    return () => { cancelled = true }
  }, [activeOrg?.id, orgLoading])

  if (!target) return null
  return <Navigate to={target} replace />
}

// Root index — picks the right landing URL once project context loads.
// Default project gets us /p/[default-slug]/dashboard; no project
// context (pre-migration) falls back to the flat /dashboard route.
function RedirectToProjectDashboard() {
  const { activeProject, loading } = useProject()
  if (loading) return null
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/dashboard`} replace />
  return <Navigate to="/dashboard" replace />
}

// Flat-route → project-scoped redirect. Used when somebody hits
// /dashboard / /generate / /review without a project slug in the URL.
// Reads the active project from context and rewrites. If no project
// is loaded yet (pre-migration), renders the flat page so nothing
// breaks visually.
function RedirectFlatToProject({ section }: { section: string }) {
  const { activeProject, loading } = useProject()
  if (loading) return null
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/${section}`} replace />
  // Pre-migration fallback — render the underlying page directly so
  // operators don't see a redirect loop. We re-route via the projects
  // path once one exists.
  if (section === 'dashboard') return <Dashboard />
  if (section === 'generate')  return <Generate />
  if (section === 'review')    return <Review />
  return <Navigate to="/" replace />
}

// /review/:id flat → /p/:slug/review/:id. Same idea, preserves the id.
function RedirectReviewDetailToProject() {
  const { activeProject, loading } = useProject()
  if (loading) return null
  // Read the :id from the current URL ourselves — we're at /review/:id
  const id = window.location.pathname.split('/').pop()
  if (activeProject && id) return <Navigate to={`/p/${activeProject.slug}/review/${id}`} replace />
  return <ReviewDetail />
}

// Pushes the current user + active org into the Sentry scope so crash
// reports tell us who was affected and which workspace they were in.
// Renders nothing — it's a hook host that sits inside the providers.
function SentryContextBridge() {
  const { user } = useAuth()
  const { activeOrg } = useOrg()
  useEffect(() => {
    setUserContext(user ? { id: user.id, email: user.email } : null)
  }, [user])
  useEffect(() => {
    setOrgContext(activeOrg ? { id: activeOrg.id, name: activeOrg.name } : null)
  }, [activeOrg])
  return null
}
