import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Generate from './pages/Generate'
import Review from './pages/Review'
import Clients from './pages/Clients'
import Calendar from './pages/Calendar'
import Library from './pages/Library'
import Templates from './pages/Templates'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="generate" element={<Generate />} />
        <Route path="review" element={<Review />} />
        <Route path="clients" element={<Clients />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="library" element={<Library />} />
        <Route path="templates" element={<Templates />} />
      </Route>
    </Routes>
  )
}
