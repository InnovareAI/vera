import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initSentry } from './lib/sentry'

// Initialise Sentry before React mounts so even mount-time errors are
// captured. No-ops when VITE_SENTRY_DSN is absent (local dev, preview).
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
