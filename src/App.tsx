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
import Dashboard from './pages/Dashboard'
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
                {/* ── Altitude 1: THE SHELF ── */}
                {/* "/" is Across Clients — the operator's day starts here,    */}
                {/* every client on one shelf. (Was redirect-to-dashboard.)    */}
                <Route index element={<AcrossClients />} />

                {/* ── Altitude 2: THE DESK ── one client, six loop surfaces. */}
                <Route path="p/:projectSlug">
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard"  element={<Dashboard />} />{/* Home */}
                  <Route path="vera"       element={<VeraThread />} />
                  <Route path="review"     element={<Review />} />
                  <Route path="review/:id" element={<ReviewDetail />} />
                  <Route path="knowledge"  element={<Knowledge />} />
                  <Route path="brain"      element={<Brain />} />
                  <Route path="measure"    element={<Measure />} />
                </Route>

                {/* ── Flat → project redirect shims ──                        */}
                {/* The rail no longer links to these, but bookmarks + deep    */}
                {/* links must not 404. Each rewrites into the project frame   */}
                {/* (or the shelf) per the blueprint's surface-fate table.     */}
                <Route path="dashboard"  element={<RedirectFlatToProject section="dashboard" />} />
                <Route path="generate"   element={<RedirectFlatToProject section="vera" />} />{/* Generate folds into VERA */}
                <Route path="review"     element={<RedirectFlatToProject section="review" />} />
                <Route path="review/:id" element={<RedirectReviewDetailToProject />} />
                <Route path="knowledge"  element={<RedirectFlatToProject section="knowledge" />} />
                <Route path="audit"      element={<RedirectFlatToProject section="measure" />} />{/* LinkedIn audit removed — land on Measure */}
                <Route path="intel"      element={<RedirectFlatToProject section="measure" />} />
                <Route path="library"    element={<RedirectFlatToProject section="review" />} />{/* Library dissolves → Review */}
                <Route path="calendar"   element={<RedirectFlatToProject section="review" />} />{/* Calendar → Review's calendar view */}
                <Route path="templates"  element={<RedirectFlatToProject section="knowledge" />} />{/* Templates fold into Knowledge */}
                <Route path="clients"    element={<Navigate to="/" replace />} />{/* Clients = the shelf */}
                <Route path="agency"     element={<Navigate to="/" replace />} />{/* Agency → Across Clients */}

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

// Flat-route → project-scoped redirect shim. The rail no longer links to
// flat routes, but bookmarks + deep links must not 404. Reads the active
// project and rewrites into /p/:slug/<section>. If no project exists yet,
// falls through to the shelf ("/"), which handles the empty state.
//
// `section` may carry a query string (e.g. "measure?tab=audit").
function RedirectFlatToProject({ section }: { section: string }) {
  const { activeProject, loading } = useProject()
  if (loading) return null
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/${section}`} replace />
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
