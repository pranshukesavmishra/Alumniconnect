import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { PageSkeleton } from './components/ui/Display'
import { useAuth, useMyProfile } from './features/auth/AuthProvider'
import { readCachedTicket } from './features/events/ticketCache'
import { useOnline } from './hooks/useOnline'
import { AuthCallbackPage, SignInPage } from './features/auth/SignInPage'
import { MeetPage } from './features/events/MeetPage'
import { HomePage } from './features/home/HomePage'
import { InstallPage, NotFoundPage, PrivacyPage, TermsPage } from './features/home/StaticPages'
import { WelcomePage } from './features/onboarding/WelcomePage'
import { isConfigured, supabase } from './lib/supabase'

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
const JobsPage = lazy(() => import('./features/jobs/JobsPage').then((m) => ({ default: m.JobsPage })))
const JobDetailPage = lazy(() => import('./features/jobs/JobDetailPage').then((m) => ({ default: m.JobDetailPage })))
const PostJobPage = lazy(() => import('./features/jobs/PostJobPage').then((m) => ({ default: m.PostJobPage })))
const MyJobsPage = lazy(() => import('./features/jobs/MyJobsPage').then((m) => ({ default: m.MyJobsPage })))
const AdminCommunity = lazy(() => import('./features/admin/AdminCommunity').then((m) => ({ default: m.AdminCommunity })))
const AdminModeration = lazy(() => import('./features/admin/AdminModeration').then((m) => ({ default: m.AdminModeration })))
const AdminAudit = lazy(() => import('./features/admin/AdminAudit').then((m) => ({ default: m.AdminAudit })))
const GroupsPage = lazy(() => import('./features/community/GroupsPage').then((m) => ({ default: m.GroupsPage })))
const GroupPage = lazy(() => import('./features/community/GroupsPage').then((m) => ({ default: m.GroupPage })))
const NotificationsPage = lazy(() => import('./features/community/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const ConnectionsPage = lazy(() => import('./features/community/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })))
const InvitePage = lazy(() => import('./features/community/InvitePage').then((m) => ({ default: m.InvitePage })))
const ChatListPage = lazy(() => import('./features/chat/ChatPages').then((m) => ({ default: m.ChatListPage })))
const ChatThreadPage = lazy(() => import('./features/chat/ChatPages').then((m) => ({ default: m.ChatThreadPage })))
const CheckInPage = lazy(() => import('./features/admin/CheckInPage').then((m) => ({ default: m.CheckInPage })))

// Once the first screen is up, quietly fetch the code for the main screens so taps feel instant.
if (typeof window !== 'undefined') {
  const warm = () => {
    void import('./features/events/RegisterPage')
    void import('./features/events/MyRegistrationPage')
    void import('./features/profile/ProfilePage')
    void import('./features/directory/DirectoryPage')
    void import('./features/events/PhotosPage')
    void import('./features/community/GroupsPage')
    void import('./features/chat/ChatPages')
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  window.addEventListener('load', () => (idle ? idle(warm) : setTimeout(warm, 1500)), { once: true })
}

// Arrived through an invite link (?invite=CODE): remember it until the new member has signed up.
if (typeof window !== 'undefined') {
  const code = new URLSearchParams(window.location.search).get('invite')
  if (code && /^[A-Z0-9]{6,12}$/i.test(code)) {
    try {
      localStorage.setItem('invite-code', code.toUpperCase())
    } catch {
      /* ignore */
    }
  }
}

function ClaimInvite() {
  const { data: profile } = useMyProfile()
  useEffect(() => {
    if (!profile?.onboarded) return
    let code: string | null = null
    try {
      code = localStorage.getItem('invite-code')
    } catch {
      return
    }
    if (!code) return
    void supabase.rpc('claim_invite', { p_code: code }).then(() => {
      try {
        localStorage.removeItem('invite-code')
      } catch {
        /* ignore */
      }
    })
  }, [profile?.onboarded])
  return null
}

/** Signed in, and the quick profile is done. */
function RequireMember({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const location = useLocation()
  const here = location.pathname + location.search
  const online = useOnline()
  // at the gate with no signal: the saved entry pass must open without waiting for (or needing) a sign-in check
  if (!online && location.pathname === '/meet/my' && readCachedTicket(session?.user.id ?? null)) return <>{children}</>
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
      <ClaimInvite />
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
            <Route path="groups" element={m(<GroupsPage />)} />
            <Route path="groups/:slug" element={m(<GroupPage />)} />
            <Route path="chat" element={m(<ChatListPage />)} />
            <Route path="chat/:id" element={m(<ChatThreadPage />)} />
            <Route path="jobs" element={m(<JobsPage />)} />
            <Route path="jobs/new" element={m(<PostJobPage />)} />
            <Route path="jobs/mine" element={m(<MyJobsPage />)} />
            <Route path="jobs/:id" element={m(<JobDetailPage />)} />
            <Route path="notifications" element={m(<NotificationsPage />)} />
            <Route path="me/connections" element={m(<ConnectionsPage />)} />
            <Route path="invite" element={m(<InvitePage />)} />
            <Route path="people" element={m(<DirectoryPage />)} />
            <Route path="people/:id" element={m(<ProfilePage />)} />
            <Route path="me" element={m(<ProfilePage self />)} />
            <Route path="me/edit" element={m(<EditProfilePage />)} />
            <Route path="me/import" element={m(<LinkedInImportPage />)} />
            <Route path="admin" element={m(<AdminHome />)} />
            <Route path="admin/members" element={m(<AdminMembers />)} />
            <Route path="admin/activity" element={m(<AdminAudit />)} />
            <Route path="admin/reports" element={m(<AdminModeration />)} />
            <Route path="admin/community" element={m(<AdminCommunity />)} />
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
