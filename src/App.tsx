import { useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
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
import Calendar from './pages/Calendar'
import Onboarding from './pages/Onboarding'
import OnboardingAudit from './pages/OnboardingAudit'
import LinkedInScore from './pages/LinkedInScore'
import Knowledge from './pages/Knowledge'
import Artifacts from './pages/Artifacts'
import Skills from './pages/Skills'
import Settings from './pages/Settings'
import ResetPassword from './pages/ResetPassword'
// ── Phase 0 surfaces (UX_BLUEPRINT.md): the two-altitude IA ──────────
import AcrossClients from './pages/AcrossClients'   // "/" - the shelf
import VeraThread from './pages/VeraThread'          // /p/:slug/vera
import VeraBlueprint from './pages/VeraBlueprint'
import Brain from './pages/Brain'                    // /p/:slug/brain
// Performance (./pages/Measure) and Learning (./pages/Learning) are parked behind
// a coming-soon screen. Restore by re-importing them and swapping the routes below.
import { ComingSoon } from './components/ComingSoon'
import ReviewLink from './pages/ReviewLink'          // /r/:reviewToken — public, tokened review link
import ApprovalIndex from './pages/ApprovalIndex'
import AcceptInvite from './pages/AcceptInvite'
import ClientKeys from './pages/ClientKeys'          // /p/:slug/keys — a client's own provider keys

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
              {import.meta.env.DEV && (
                <Route path="/dev" element={<Layout />}>
                  <Route path="blueprint" element={<VeraBlueprint />} />
                  <Route path="calendar" element={<Calendar />} />
                </Route>
              )}
              <Route path="/login" element={<LoginGuard />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/onboarding/audit/:orgId" element={<OnboardingAudit />} />
              <Route path="/linkedin-score/:orgId" element={<LinkedInScore />} />
              {/* Public, no-login review link, scoped by a revocable review token. */}
              <Route path="/r/:reviewToken" element={<ReviewLink />} />
              <Route element={<RequireAuth />}>
                <Route path="invite/:token" element={<AcceptInvite />} />
                <Route path="approvals/:projectRef" element={<ApprovalIndex />} />
                <Route path="/" element={<Layout />}>
                {/* "/" lands you in the active space. The switcher handles     */}
                {/* space changes, and the full shelf lives at /spaces.         */}
                <Route index element={<RootIndex />} />

                {/* ── The DESK ── one client, the demand-content loop. */}
                <Route path="p/:projectSlug">
                  <Route index element={<Navigate to="blueprint" replace />} />{/* Operating desk is home-base; chat is a command layer. */}
                  <Route path="dashboard"  element={<RedirectFlatToProject section="blueprint" />} />{/* Home removed → Desk */}
                  <Route path="vera"       element={<VeraThread />} />
                  <Route path="blueprint"  element={<VeraBlueprint />} />
                  <Route path="review"     element={<Review />} />
                  <Route path="review/:id" element={<ReviewDetail />} />
                  <Route path="calendar"   element={<Calendar />} />{/* scheduled posts on a month grid */}
                  <Route path="artifacts"  element={<Artifacts />} />{/* the client's content library */}
                  <Route path="knowledge"  element={<Knowledge />} />{/* legacy KB — folds into Brain next */}
                  <Route path="brain"      element={<Brain />} />
                  <Route path="measure"    element={<ComingSoon feature="Performance" />} />
                  <Route path="learning"   element={<ComingSoon feature="Learning" />} />
                  <Route path="keys"       element={<ClientKeys />} />{/* the client's own provider keys */}
                </Route>

                {/* ── Flat → project redirect shims ──                        */}
                {/* The rail no longer links to these, but bookmarks + deep    */}
                {/* links must not 404. Each rewrites into the project frame   */}
                {/* (or the shelf) per the blueprint's surface-fate table.     */}
                <Route path="dashboard"  element={<RedirectFlatToProject section="blueprint" />} />{/* Home removed → Desk */}
                <Route path="blueprint"  element={<RedirectFlatToProject section="blueprint" />} />
                <Route path="generate"   element={<RedirectFlatToProject section="vera" />} />{/* Generate folds into VERA */}
                <Route path="review"     element={<RedirectFlatToProject section="review" />} />
                <Route path="review/:id" element={<RedirectReviewDetailToProject />} />
                <Route path="knowledge"  element={<RedirectFlatToProject section="knowledge" />} />
                <Route path="audit"      element={<RedirectFlatToProject section="measure" />} />{/* LinkedIn audit removed - land on Performance */}
                <Route path="intel"      element={<RedirectFlatToProject section="measure" />} />
                <Route path="library"    element={<RedirectFlatToProject section="review" />} />{/* Library dissolves → Review */}
                <Route path="calendar"   element={<RedirectFlatToProject section="calendar" />} />{/* flat → project calendar */}
                <Route path="templates"  element={<RedirectFlatToProject section="knowledge" />} />{/* Templates fold into Knowledge */}
                <Route path="learning"   element={<RedirectFlatToProject section="learning" />} />
                <Route path="spaces"     element={<AcrossClients />} />{/* the full spaces shelf */}
                <Route path="clients"    element={<Navigate to="/spaces" replace />} />{/* old client shelf URL */}
                <Route path="agency"     element={<Navigate to="/spaces" replace />} />{/* old agency shelf URL */}

                {/* Workspace-level, kept as-is for Phase 0. */}
                <Route path="skills"     element={<Skills />} />
                <Route path="settings"   element={<Settings />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
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

function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

// Root "/" lands the operator in the active space. The rail is the switcher;
// the canvas should not duplicate the full shelf. No project yet goes to
// /spaces, which shows the "add a space" empty state.
function RootIndex() {
  const { loading: orgLoading, isOrgMember } = useOrg()
  const { activeProject, projects, loading } = useProject()
  if (orgLoading || loading) return null   // wait for both to settle before routing to /spaces
  // Agency staff (org members) land on the operating desk. Chat remains a
  // command layer, but the product should not open as a blank assistant.
  // Client collaborators land on Review, where the content decisions live.
  const home = isOrgMember ? 'blueprint' : 'review'
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/${home}`} replace />
  if (projects.length > 0) return <Navigate to={`/p/${projects[0].slug}/${home}`} replace />
  return <Navigate to="/spaces" replace />
}

// Flat-route → project-scoped redirect shim. The rail no longer links to
// flat routes, but bookmarks + deep links must not 404. Reads the active
// project and rewrites into /p/:slug/<section>. No project yet goes to /spaces.
//
// `section` may carry a query string (e.g. "measure?tab=audit").
function RedirectFlatToProject({ section }: { section: string }) {
  const { activeProject, loading } = useProject()
  if (loading) return null
  if (activeProject) return <Navigate to={`/p/${activeProject.slug}/${section}`} replace />
  return <Navigate to="/spaces" replace />
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
