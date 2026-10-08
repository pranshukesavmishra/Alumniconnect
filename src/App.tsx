import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { PageSkeleton } from './components/ui/Display'
import { useAuth, useMyProfile } from './features/auth/AuthProvider'
import { AuthCallbackPage, SignInPage } from './features/auth/SignInPage'
import { MeetPage } from './features/events/MeetPage'
import { HomePage } from './features/home/HomePage'
import { InstallPage, NotFoundPage, PrivacyPage, TermsPage } from './features/home/StaticPages'
import { WelcomePage } from './features/onboarding/WelcomePage'
import { isConfigured } from './lib/supabase'

// Less-used screens load on demand to keep the first load small on mobile data.
const RegisterPage = lazy(() => import('./features/events/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const MyRegistrationPage = lazy(() => import('./features/events/MyRegistrationPage').then((m) => ({ default: m.MyRegistrationPage })))
const PhotosPage = lazy(() => import('./features/events/PhotosPage').then((m) => ({ default: m.PhotosPage })))
const ProfilePage = lazy(() => import('./features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const EditProfilePage = lazy(() => import('./features/profile/EditProfilePage').then((m) => ({ default: m.EditProfilePage })))
const LinkedInImportPage = lazy(() => import('./features/profile/LinkedInImportPage').then((m) => ({ default: m.LinkedInImportPage })))
const DirectoryPage = lazy(() => import('./features/directory/DirectoryPage').then((m) => ({ default: m.DirectoryPage })))
const AdminHome = lazy(() => import('./features/admin/AdminHome').then((m) => ({ default: m.AdminHome })))
const AdminEventPage = lazy(() => import('./features/admin/AdminEventPage').then((m) => ({ default: m.AdminEventPage })))
const AdminMembers = lazy(() => import('./features/admin/AdminMembers').then((m) => ({ default: m.AdminMembers })))
const AdminAudit = lazy(() => import('./features/admin/AdminAudit').then((m) => ({ default: m.AdminAudit })))
const CheckInPage = lazy(() => import('./features/admin/CheckInPage').then((m) => ({ default: m.CheckInPage })))

// Once the first screen is up, quietly fetch the code for the main screens so taps feel instant.
if (typeof window !== 'undefined') {
  const warm = () => {
    void import('./features/events/RegisterPage')
    void import('./features/events/MyRegistrationPage')
    void import('./features/profile/ProfilePage')
    void import('./features/directory/DirectoryPage')
    void import('./features/events/PhotosPage')
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  window.addEventListener('load', () => (idle ? idle(warm) : setTimeout(warm, 1500)), { once: true })
}

/** Signed in, and the quick profile is done. */
function RequireMember({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const location = useLocation()
  const here = location.pathname + location.search
  if (loading || (session && isLoading)) return <PageSkeleton />
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(here)}`} replace />
  if (profile && !profile.onboarded) return <Navigate to={`/welcome?next=${encodeURIComponent(here)}`} replace />
  return <>{children}</>
}

function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageSkeleton />
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <>{children}</>
}

function SetupNeeded() {
  return (
    <div className="mx-auto max-w-lg p-6 pt-20">
      <h1 className="text-2xl font-bold">Almost there</h1>
      <p className="mt-2 text-muted">
        This build has no backend configured. Copy <code>.env.example</code> to <code>.env.local</code> and add your Supabase URL and anon key
        (see <code>docs/SETUP.md</code>).
      </p>
    </div>
  )
}

export function App() {
  if (!isConfigured) return <SetupNeeded />
  const m = (el: ReactNode) => <RequireMember>{el}</RequireMember>
  return (
    <BrowserRouter>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/welcome" element={<RequireSession><WelcomePage /></RequireSession>} />
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="meet" element={<MeetPage />} />
            <Route path="meet/register" element={m(<RegisterPage />)} />
            <Route path="meet/my" element={m(<MyRegistrationPage />)} />
            <Route path="meet/photos" element={m(<PhotosPage />)} />
            <Route path="people" element={m(<DirectoryPage />)} />
            <Route path="people/:id" element={m(<ProfilePage />)} />
            <Route path="me" element={m(<ProfilePage self />)} />
            <Route path="me/edit" element={m(<EditProfilePage />)} />
            <Route path="me/import" element={m(<LinkedInImportPage />)} />
            <Route path="admin" element={m(<AdminHome />)} />
            <Route path="admin/members" element={m(<AdminMembers />)} />
            <Route path="admin/activity" element={m(<AdminAudit />)} />
            <Route path="admin/events/:slug" element={m(<AdminEventPage />)} />
            <Route path="admin/events/:slug/check-in" element={m(<CheckInPage />)} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="terms" element={<TermsPage />} />
            <Route path="install" element={<InstallPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
