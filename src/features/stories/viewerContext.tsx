import { useQueryClient } from '@tanstack/react-query'
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { StorySource } from './api'

const StoryViewer = lazy(() => import('./StoryViewer').then((m) => ({ default: m.StoryViewer })))

export interface ViewerRequest {
  /** the rings to play in order: when one ends the next starts */
  sources: StorySource[]
  /** open at this story of the first source (otherwise the first one not watched yet) */
  startStoryId?: string
}

interface ViewerApi {
  open: (sources: StorySource[], opts?: { startStoryId?: string }) => void
  close: () => void
  isOpen: boolean
}

const Ctx = createContext<ViewerApi>({ open: () => undefined, close: () => undefined, isOpen: false })

/** One full-screen story viewer for the whole app: Home, profiles, the directory and highlights all open it through this. */
export function StoryViewerProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ViewerRequest | null>(null)
  const qc = useQueryClient()
  const open = useCallback((sources: StorySource[], opts?: { startStoryId?: string }) => {
    if (sources.length) setReq({ sources, startStoryId: opts?.startStoryId })
  }, [])
  const close = useCallback(() => {
    setReq(null)
    // the rings now show what was watched
    void qc.invalidateQueries({ queryKey: ['stories', 'feed'] })
    void qc.invalidateQueries({ queryKey: ['stories', 'ring'] })
    void qc.invalidateQueries({ queryKey: ['stories', 'source'] })
  }, [qc])
  const api = useMemo(() => ({ open, close, isOpen: !!req }), [open, close, req])
  return (
    <Ctx.Provider value={api}>
      {children}
      {req && (
        <Suspense fallback={null}>
          <StoryViewer request={req} onClose={close} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}

export function useStoryViewer(): ViewerApi {
  return useContext(Ctx)
}
