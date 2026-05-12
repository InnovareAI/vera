import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Generate from './pages/Generate'
import Review from './pages/Review'
import Clients from './pages/Clients'
import Calendar from './pages/Calendar'
import Library from './pages/Library'
import Templates from './pages/Templates'
import Skills from './pages/Skills'

function ProtectedRoutes() {
  const { session, loading } = useAuth()

  // While checking session, show nothing (avoids flash)
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // No session — redirect to login
  // NOTE: anon bypass policies are still active in dev, so the app works
  // without auth for development. Remove anon policies (migration 005) when
  // auth is fully rolled out.
  if (!session) return <Navigate to="/login" replace />

  return (
    <Route element={<Layout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="generate" element={<Generate />} />
      <Route path="review" element={<Review />} />
      <Route path="clients" element={<Clients />} />
      <Route path="calendar" element={<Calendar />} />
      <Route path="library" element={<Library />} />
      <Route path="templates" element={<Templates />} />
      <Route path="skills" element={<Skills />} />
    </Route>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginGuard />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="generate" element={<Generate />} />
          <Route path="review" element={<Review />} />
          <Route path="clients" element={<Clients />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="library" element={<Library />} />
          <Route path="templates" element={<Templates />} />
          <Route path="skills" element={<Skills />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

// Redirect to dashboard if already logged in
function LoginGuard() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/dashboard" replace />
  return <Login />
}
