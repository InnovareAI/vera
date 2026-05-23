// Theme management — three modes: light / dark / system.
//
// `theme` is the user's preference (light | dark | system). When system, we
// watch the OS via window.matchMedia('(prefers-color-scheme: dark)') and
// flip the resolved theme live as the OS preference changes (operator runs
// at night → app goes dark automatically).
//
// `resolvedTheme` is what's actually applied to <body data-theme="..."> —
// always light or dark, never system. Components that care about the
// applied theme (e.g. for conditional rendering) should read this, not
// `theme`.
//
// Persists the preference in localStorage. Defaults to 'system' on first
// load — matches Notion / Linear / GitHub / ChatGPT convention.

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  toggle: () => void   // kept for backwards compat — cycles light → dark → system
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  toggle: () => {},
})

const STORAGE_KEY = 'kai-theme'

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  // Watch the OS preference — fires whenever the user toggles their OS
  // light/dark setting. We update systemTheme so consumers re-derive.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  // Derived: what we actually apply
  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme

  // Push the resolved theme onto <body> and persist the preference
  useEffect(() => {
    document.body.setAttribute('data-theme', resolvedTheme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme, resolvedTheme])

  function setTheme(next: Theme) {
    setThemeState(next)
  }

  // Backwards-compat: cycle light → dark → system → light
  function toggle() {
    setThemeState(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
