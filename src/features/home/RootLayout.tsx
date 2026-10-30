import { useLocation } from 'react-router'
import { AppShell } from '../../components/layout/AppShell'
import { useAuth } from '../auth/AuthProvider'
import { LandingPage } from '../landing/LandingPage'

/** Visitors at "/" get the full-bleed landing page (no app chrome); everyone else, and every other page, gets the app shell. */
export function RootLayout() {
  const { session, loading } = useAuth()
  const { pathname } = useLocation()
  if (pathname === '/' && !loading && !session) return <LandingPage />
  return <AppShell />
}
