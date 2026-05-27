// Right rail content slot — pages opt into providing content for the
// right rail; Layout renders it when present, or widens the canvas when
// it's null. Implementation: simple state in context, pages call
// setRightRail(<Stuff/>) in a useEffect and clear it on unmount.
//
// Per the UX skill: don't render an empty rail. If a page has no
// right-rail content, the rail collapses entirely and the canvas
// takes its width.

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface RightRailContextType {
  content: ReactNode | null
  setContent: (content: ReactNode | null) => void
}

const RightRailContext = createContext<RightRailContextType>({
  content: null,
  setContent: () => {},
})

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null)
  return (
    <RightRailContext.Provider value={{ content, setContent }}>
      {children}
    </RightRailContext.Provider>
  )
}

/** Read the current rail content (used by Layout). */
export function useRightRailContent() {
  return useContext(RightRailContext).content
}

/**
 * Hook for pages to provide right-rail content.
 *
 * Pass JSX (or null to opt out). The hook automatically clears the
 * rail on unmount so content doesn't leak across page navigations.
 *
 * Pass the dependency array carefully — anything used inside the rail
 * content that can change (e.g. an audit score, a count) should be a
 * dependency so the rail re-renders when it updates.
 *
 * Example:
 *   useRightRail(
 *     <DashboardRail audit={audit} pending={pendingCount} />,
 *     [audit, pendingCount],
 *   )
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRightRail(content: ReactNode | null, deps: unknown[] = []) {
  const { setContent } = useContext(RightRailContext)
  useEffect(() => {
    setContent(content)
    return () => setContent(null)
    // The deps array drives when content re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
