import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('kai-theme')
    return (stored === 'light' || stored === 'dark') ? stored : 'dark'
  })

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    localStorage.setItem('kai-theme', theme)
  }, [theme])

  // Apply on mount immediately
  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [])

  function toggle() {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
