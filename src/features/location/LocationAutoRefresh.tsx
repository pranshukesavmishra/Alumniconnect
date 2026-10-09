import { useEffect, useRef } from 'react'
import { useMyProfile } from '../auth/AuthProvider'
import { isStale, permissionState } from './geo'
import { useLocationActions, useMyLocation } from './queries'

/**
 * When the app opens and the member shares their city, refresh it at most once every 12 hours, in the foreground only.
 * It never shows a permission prompt by itself: it only runs when the browser already allows location for this site.
 */
export function LocationAutoRefresh() {
  const { data: profile } = useMyProfile()
  const { data: loc } = useMyLocation()
  const { refresh } = useLocationActions()
  const tried = useRef(false)
  useEffect(() => {
    if (tried.current || !profile?.onboarded || !loc?.sharing || !isStale(loc.updated_at)) return
    tried.current = true
    void permissionState().then((s) => {
      if (s === 'granted') refresh().catch(() => undefined) // quiet: the Nearby screen offers a manual update
    })
  }, [profile?.onboarded, loc?.sharing, loc?.updated_at, refresh])
  return null
}
