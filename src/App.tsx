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
