// Right rail content slot — pages opt into providing content for the
// right rail; Layout renders it when present, or widens the canvas when
// it's null. Implementation: simple state in context, pages call
// setRightRail(<Stuff/>) in a useEffect and clear it on unmount.
//
// Per the UX skill: don't render an empty rail. If a page has no
// right-rail content, the rail collapses entirely and the canvas
// takes its width.
//
// Width is configurable per consumer: a "pending count" sidebar wants the
// narrow default; the VERA draft artifact wants a wide, readable panel.

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

const DEFAULT_WIDTH = '296px'

interface RightRailContextType {
  content: ReactNode | null
  width: string
  setRail: (content: ReactNode | null, width?: string) => void
}

const RightRailContext = createContext<RightRailContextType>({
  content: null,
  width: DEFAULT_WIDTH,
  setRail: () => {},
})

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null)
  const [width, setWidth] = useState<string>(DEFAULT_WIDTH)
  const setRail = (c: ReactNode | null, w: string = DEFAULT_WIDTH) => {
    setContent(c)
    setWidth(w)
  }
  return (
    <RightRailContext.Provider value={{ content, width, setRail }}>
      {children}
    </RightRailContext.Provider>
  )
}

/** Read the current rail content (used by Layout). */
export function useRightRailContent() {
  return useContext(RightRailContext).content
}

/** Read the current rail width (used by Layout). */
export function useRightRailWidth() {
  return useContext(RightRailContext).width
}

/**
 * Hook for pages to provide right-rail content.
 *
 * Pass JSX (or null to opt out) and an optional CSS width for the rail.
 * The hook automatically clears the rail on unmount so content doesn't
 * leak across page navigations.
 *
 * Pass the dependency array carefully — anything used inside the rail
 * content that can change (e.g. an audit score, a count) should be a
 * dependency so the rail re-renders when it updates.
 *
 * Example:
 *   useRightRail(<DashboardRail pending={pendingCount} />, [pendingCount])
 *   useRightRail(<DraftArtifact draft={draft} />, [draft], 'clamp(380px, 42vw, 640px)')
 */
export function useRightRail(content: ReactNode | null, deps: unknown[] = [], width: string = DEFAULT_WIDTH) {
  const { setRail } = useContext(RightRailContext)
  useEffect(() => {
    setRail(content, width)
    return () => setRail(null)
    // The deps array drives when content re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
