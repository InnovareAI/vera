import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { OrgProvider, useOrg } from './lib/orgContext'
import { ProjectProvider } from './lib/projectContext'
import { ThemeProvider } from './lib/theme'
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
        <AuthProvider>
          <OrgProvider>
            <ProjectProvider>
            <SentryContextBridge />
            <Routes>
              <Route path="/login" element={<LoginGuard />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/onboarding/audit/:orgId" element={<OnboardingAudit />} />
              <Route path="/linkedin-score/:orgId" element={<LinkedInScore />} />
              <Route path="/" element={<Layout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard"  element={<Dashboard />} />
                <Route path="generate"   element={<Generate />} />
                <Route path="audit"      element={<AuditRedirect />} />
                <Route path="review"     element={<Review />} />
                <Route path="review/:id" element={<ReviewDetail />} />
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
            </ProjectProvider>
          </OrgProvider>
        </AuthProvider>
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
// Avoids the old footgun of always landing on the setup flow even when a
// fresh score already exists.
function AuditRedirect() {
  const { activeOrg } = useOrg()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
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
  }, [activeOrg?.id])

  if (!target) return null
  return <Navigate to={target} replace />
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
