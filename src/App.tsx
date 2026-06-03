import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { OrgProvider, useOrg } from './lib/orgContext'
import { ProjectProvider, useProject } from './lib/projectContext'
import { RightRailProvider } from './lib/rightRailContext'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './design'
import { ErrorBoundary } from './components/ErrorBoundary'
import { setUserContext, setOrgContext } from './lib/sentry'
import Layout from './components/Layout'
import Login from './pages/Login'
import Review from './pages/Review'
import ReviewDetail from './pages/ReviewDetail'
import Onboarding from './pages/Onboarding'
import Knowledge from './pages/Knowledge'
import Skills from './pages/Skills'
import Settings from './pages/Settings'
// ── Phase 0 surfaces (UX_BLUEPRINT.md): the two-altitude IA ──────────
import AcrossClients from './pages/AcrossClients'   // "/" — the shelf
import VeraThread from './pages/VeraThread'          // /p/:slug/vera
import Brain from './pages/Brain'                    // /p/:slug/brain
import Measure from './pages/Measure'                // /p/:slug/measure

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
              <Route path="/" element={<Layout />}>
                {/* "/" lands you IN your active client — no duplicate client  */}
                {/* list in the canvas (the rail is the switcher). The "all     */}
                {/* clients" shelf lives at /clients for when it's needed.      */}
                <Route index element={<RootIndex />} />

                {/* ── The DESK ── one client, six loop surfaces. */}
                <Route path="p/:projectSlug">
                  <Route index element={<Navigate to="vera" replace />} />{/* Vera is home-base (SAM-style) */}
                  <Route path="dashboard"  element={<RedirectFlatToProject section="vera" />} />{/* Home removed → Vera */}
                  <Route path="vera"       element={<VeraThread />} />
                  <Route path="review"     element={<Review />} />
                  <Route path="review/:id" element={<ReviewDetail />} />
                  <Route path="calendar"   element={<Review initialView="calendar" />} />{/* scheduled posts on a month grid */}
                  <Route path="knowledge"  element={<Knowledge />} />
                  <Route path="brain"      element={<Brain />} />
                  <Route path="measure"    element={<Measure />} />
                </Route>

                {/* ── Flat → project redirect shims ──                        */}
                {/* The rail no longer links to these, but bookmarks + deep    */}
                {/* links must not 404. Each rewrites into the project frame   */}
                {/* (or the shelf) per the blueprint's surface-fate table.     */}
                <Route path="dashboard"  element={<RedirectFlatToProject section="vera" />} />{/* Home removed → Vera */}
                <Route path="generate"   element={<RedirectFlatToProject section="vera" />} />{/* Generate folds into VERA */}
                <Route path="review"     element={<RedirectFlatToProject section="review" />} />
                <Route path="review/:id" element={<RedirectReviewDetailToProject />} />
                <Route path="knowledge"  element={<RedirectFlatToProject section="knowledge" />} />
                <Route path="audit"      element={<RedirectFlatToProject section="measure" />} />{/* LinkedIn audit removed — land on Measure */}
                <Route path="intel"      element={<RedirectFlatToProject section="measure" />} />
                <Route path="library"    element={<RedirectFlatToProject section="review" />} />{/* Library dissolves → Review */}
                <Route path="calendar"   element={<RedirectFlatToProject section="calendar" />} />{/* flat → project calendar */}
                <Route path="templates"  element={<RedirectFlatToProject section="knowledge" />} />{/* Templates fold into Knowledge */}
                <Route path="clients"    element={<AcrossClients />} />{/* the "all clients" shelf — reachable, not the default */}
                <Route path="agency"     element={<AcrossClients />} />{/* Agency → the shelf */}

                {/* Workspace-level, kept as-is for Phase 0. */}
                <Route path="skills"     element={<Skills />} />
                <Route path="settings"   element={<Settings />} />
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

// Already logged in → the shelf ("/"), the operator's start surface.
function LoginGuard() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return <Login />
}

// Root "/" — land the operator IN their active client's Home. The rail is
// the client switcher; the canvas should never re-list clients (that was
// the duplication that made the UI confusing). No project yet → the shelf
// at /clients, which shows the "add a client" empty state.
function RootIndex() {
  const { loading: orgLoading } = useOrg()
  const { activeProject, projects, loading } = useProject()
  if (orgLoading || loading) return null   // wait for both to settle — don't race to /clients
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/vera`} replace />
  if (projects.length > 0) return <Navigate to={`/p/${projects[0].slug}/vera`} replace />
  return <Navigate to="/clients" replace />
}

// Flat-route → project-scoped redirect shim. The rail no longer links to
// flat routes, but bookmarks + deep links must not 404. Reads the active
// project and rewrites into /p/:slug/<section>. No project yet → /clients.
//
// `section` may carry a query string (e.g. "measure?tab=audit").
function RedirectFlatToProject({ section }: { section: string }) {
  const { activeProject, loading } = useProject()
  if (loading) return null
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/${section}`} replace />
  return <Navigate to="/clients" replace />
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
