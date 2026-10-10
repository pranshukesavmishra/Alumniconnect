import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { AdminTranslator } from './i18n/AdminTranslator'
import { AppShell } from './components/layout/AppShell'
import { PageSkeleton } from './components/ui/Display'
import { RequirePerm } from './features/admin/access'
import { useAuth, useMyProfile } from './features/auth/AuthProvider'
import { LocationAutoRefresh } from './features/location/LocationAutoRefresh'
import { readCachedTicket } from './features/events/ticketCache'
import { useOnline } from './hooks/useOnline'
import { AuthCallbackPage, SignInPage } from './features/auth/SignInPage'
import { MeetPage } from './features/events/MeetPage'
import { HomePage } from './features/home/HomePage'
import { InstallPage, NotFoundPage, AboutPage, PrivacyPage, TermsPage } from './features/home/StaticPages'
import { WelcomePage } from './features/onboarding/WelcomePage'
import { isConfigured, supabase } from './lib/supabase'

// Less-used screens load on demand to keep the first load small on mobile data.
const RegisterPage = lazy(() => import('./features/events/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const MyRegistrationPage = lazy(() => import('./features/events/MyRegistrationPage').then((m) => ({ default: m.MyRegistrationPage })))
const PhotosPage = lazy(() => import('./features/events/PhotosPage').then((m) => ({ default: m.PhotosPage })))
const PhotoUploadPage = lazy(() => import('./features/events/PhotosPage').then((m) => ({ default: m.PhotoUploadPage })))
const PhotoSlideshow = lazy(() => import('./features/photos/PhotoSlideshow').then((m) => ({ default: m.PhotoSlideshow })))
const PhotoLink = lazy(() => import('./features/photos/PhotoLink').then((m) => ({ default: m.PhotoLink })))
const GalleryPage = lazy(() => import('./features/photos/GalleryPage').then((m) => ({ default: m.GalleryPage })))
const ProfilePage = lazy(() => import('./features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const EditProfilePage = lazy(() => import('./features/profile/EditProfilePage').then((m) => ({ default: m.EditProfilePage })))
const LinkedInImportPage = lazy(() => import('./features/profile/LinkedInImportPage').then((m) => ({ default: m.LinkedInImportPage })))
const DirectoryPage = lazy(() => import('./features/directory/DirectoryPage').then((m) => ({ default: m.DirectoryPage })))
const AdminHome = lazy(() => import('./features/admin/AdminHome').then((m) => ({ default: m.AdminHome })))
const AdminEventPage = lazy(() => import('./features/admin/AdminEventPage').then((m) => ({ default: m.AdminEventPage })))
const AdminMembers = lazy(() => import('./features/admin/AdminMembers').then((m) => ({ default: m.AdminMembers })))
const MentorsPage = lazy(() => import('./features/mentorship/MentorsPage').then((m) => ({ default: m.MentorsPage })))
const HelpPage = lazy(() => import('./features/help/HelpPage').then((m) => ({ default: m.HelpPage })))
const JobsPage = lazy(() => import('./features/jobs/JobsPage').then((m) => ({ default: m.JobsPage })))
const JobDetailPage = lazy(() => import('./features/jobs/JobDetailPage').then((m) => ({ default: m.JobDetailPage })))
const PostJobPage = lazy(() => import('./features/jobs/PostJobPage').then((m) => ({ default: m.PostJobPage })))
const MyJobsPage = lazy(() => import('./features/jobs/MyJobsPage').then((m) => ({ default: m.MyJobsPage })))
const AdminAnalytics = lazy(() => import('./features/admin/AdminAnalytics').then((m) => ({ default: m.AdminAnalytics })))
const BusinessesPage = lazy(() => import('./features/businesses/BusinessesPage').then((m) => ({ default: m.BusinessesPage })))
const BusinessDetailPage = lazy(() => import('./features/businesses/BusinessDetailPage').then((m) => ({ default: m.BusinessDetailPage })))
const AddBusinessPage = lazy(() => import('./features/businesses/AddBusinessPage').then((m) => ({ default: m.AddBusinessPage })))
const AdminCommunity = lazy(() => import('./features/admin/AdminCommunity').then((m) => ({ default: m.AdminCommunity })))
const AdminModeration = lazy(() => import('./features/admin/AdminModeration').then((m) => ({ default: m.AdminModeration })))
const AdminMemberTimeline = lazy(() => import('./features/admin/AdminMemberTimeline').then((m) => ({ default: m.AdminMemberTimeline })))
const AdminDuplicates = lazy(() => import('./features/admin/AdminDuplicates').then((m) => ({ default: m.AdminDuplicates })))
const AdminImport = lazy(() => import('./features/admin/AdminImport').then((m) => ({ default: m.AdminImport })))
const AdminHealth = lazy(() => import('./features/admin/AdminHealth').then((m) => ({ default: m.AdminHealth })))
const AdminInbox = lazy(() => import('./features/admin/AdminInbox').then((m) => ({ default: m.AdminInbox })))
const AdminViewAs = lazy(() => import('./features/admin/AdminViewAs').then((m) => ({ default: m.AdminViewAs })))
const AdminRoles = lazy(() => import('./features/admin/AdminRoles').then((m) => ({ default: m.AdminRoles })))
const AdminAudit = lazy(() => import('./features/admin/AdminAudit').then((m) => ({ default: m.AdminAudit })))
const GroupsPage = lazy(() => import('./features/community/GroupsPage').then((m) => ({ default: m.GroupsPage })))
const GroupPage = lazy(() => import('./features/community/GroupsPage').then((m) => ({ default: m.GroupPage })))
const NotificationsPage = lazy(() => import('./features/community/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const ConnectionsPage = lazy(() => import('./features/community/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })))
const InvitePage = lazy(() => import('./features/community/InvitePage').then((m) => ({ default: m.InvitePage })))
const ChatListPage = lazy(() => import('./features/chat/ChatPages').then((m) => ({ default: m.ChatListPage })))
const ChatThreadPage = lazy(() => import('./features/chat/ChatPages').then((m) => ({ default: m.ChatThreadPage })))
const NearbyPage = lazy(() => import('./features/location/NearbyPage').then((m) => ({ default: m.NearbyPage })))
const TripsPage = lazy(() => import('./features/location/TripsPage').then((m) => ({ default: m.TripsPage })))
const CityPage = lazy(() => import('./features/location/CityPage').then((m) => ({ default: m.CityPage })))
const AdminBadges = lazy(() => import('./features/admin/AdminBadges').then((m) => ({ default: m.AdminBadges })))
const GivingHub = lazy(() => import('./features/giving/GivingHub').then((m) => ({ default: m.GivingHub })))
const CampaignPage = lazy(() => import('./features/giving/CampaignPage').then((m) => ({ default: m.CampaignPage })))
const MyGivingPage = lazy(() => import('./features/giving/MyGiving').then((m) => ({ default: m.MyGivingPage })))
const TransparencyPage = lazy(() => import('./features/giving/Transparency').then((m) => ({ default: m.TransparencyPage })))
const ReceiptPage = lazy(() => import('./features/giving/ReceiptPage').then((m) => ({ default: m.ReceiptPage })))
const AdminFunds = lazy(() => import('./features/giving/admin/AdminFunds').then((m) => ({ default: m.AdminFunds })))
const CampaignEditor = lazy(() => import('./features/giving/admin/CampaignEditor').then((m) => ({ default: m.CampaignEditor })))
const SponsorDetail = lazy(() => import('./features/giving/admin/SponsorDetail').then((m) => ({ default: m.SponsorDetail })))
const SponsorPrint = lazy(() => import('./features/giving/admin/SponsorPrint').then((m) => ({ default: m.SponsorPrint })))
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
      <LocationAutoRefresh />
      <AdminTranslator />
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
            <Route path="meet/photos/upload" element={m(<PhotoUploadPage />)} />
            <Route path="meet/photos/slideshow" element={m(<PhotoSlideshow />)} />
            <Route path="events/:slug/photos" element={m(<PhotosPage />)} />
            <Route path="events/:slug/photos/upload" element={m(<PhotoUploadPage />)} />
            <Route path="events/:slug/photos/slideshow" element={m(<PhotoSlideshow />)} />
            <Route path="photo/:id" element={m(<PhotoLink />)} />
            <Route path="gallery" element={m(<GalleryPage />)} />
            <Route path="groups" element={m(<GroupsPage />)} />
            <Route path="groups/:slug" element={m(<GroupPage />)} />
            <Route path="chat" element={m(<ChatListPage />)} />
            <Route path="chat/:id" element={m(<ChatThreadPage />)} />
            <Route path="mentors" element={m(<MentorsPage />)} />
            <Route path="mentors/mine" element={m(<MentorsPage />)} />
            <Route path="help" element={m(<HelpPage />)} />
            <Route path="jobs" element={m(<JobsPage />)} />
            <Route path="jobs/new" element={m(<PostJobPage />)} />
            <Route path="jobs/mine" element={m(<MyJobsPage />)} />
            <Route path="jobs/:id" element={m(<JobDetailPage />)} />
            <Route path="businesses" element={m(<BusinessesPage />)} />
            <Route path="businesses/new" element={m(<AddBusinessPage />)} />
            <Route path="businesses/:id" element={m(<BusinessDetailPage />)} />
            <Route path="notifications" element={m(<NotificationsPage />)} />
            <Route path="me/connections" element={m(<ConnectionsPage />)} />
            <Route path="invite" element={m(<InvitePage />)} />
            <Route path="people" element={m(<DirectoryPage />)} />
            <Route path="nearby" element={m(<NearbyPage />)} />
            <Route path="trips" element={m(<TripsPage />)} />
            <Route path="city/:id" element={m(<CityPage />)} />
            <Route path="people/:id" element={m(<ProfilePage />)} />
            <Route path="me" element={m(<ProfilePage self />)} />
            <Route path="me/edit" element={m(<EditProfilePage />)} />
            <Route path="me/import" element={m(<LinkedInImportPage />)} />
            <Route path="admin" element={m(<AdminHome />)} />
            <Route path="admin/members" element={m(<AdminMembers />)} />
            <Route path="admin/members/import" element={m(<RequirePerm any={['members_import']} what="Importing members"><AdminImport /></RequirePerm>)} />
            <Route path="admin/members/duplicates" element={m(<RequirePerm any={['members_merge']} what="Merging duplicate members"><AdminDuplicates /></RequirePerm>)} />
            <Route path="admin/members/:id" element={m(<RequirePerm any={['members_view']} what="The member history"><AdminMemberTimeline /></RequirePerm>)} />
            <Route path="admin/members/:id/preview" element={m(<RequirePerm any={['members_view']} what="Viewing as a member"><AdminViewAs /></RequirePerm>)} />
            <Route path="admin/health" element={m(<RequirePerm any={['health']} what="The health page"><AdminHealth /></RequirePerm>)} />
            <Route path="admin/inbox" element={m(<AdminInbox />)} />
            <Route path="admin/activity" element={m(<RequirePerm any={['audit']} what="The activity log"><AdminAudit /></RequirePerm>)} />
            <Route path="admin/roles" element={m(<AdminRoles />)} />
            <Route path="admin/reports" element={m(<AdminModeration />)} />
            <Route path="admin/analytics" element={m(<RequirePerm any={['analytics']} what="Analytics"><AdminAnalytics /></RequirePerm>)} />
            <Route path="admin/community" element={m(<AdminCommunity />)} />
            <Route path="give" element={m(<GivingHub />)} />
            <Route path="give/mine" element={m(<MyGivingPage />)} />
            <Route path="give/where-it-went" element={m(<TransparencyPage />)} />
            <Route path="give/receipt/:id" element={m(<ReceiptPage />)} />
            <Route path="give/:slug" element={m(<CampaignPage />)} />
            <Route path="admin/funds" element={m(<RequirePerm any={['funds_manage', 'funds_verify', 'funds_reports', 'sponsors_manage']} what="Funds"><AdminFunds /></RequirePerm>)} />
            <Route path="admin/funds/campaign/:id" element={m(<RequirePerm any={['funds_manage']} what="Fund appeals"><CampaignEditor /></RequirePerm>)} />
            <Route path="admin/funds/sponsor/:id" element={m(<RequirePerm any={['sponsors_manage']} what="Sponsors"><SponsorDetail /></RequirePerm>)} />
            <Route path="admin/funds/sponsor/:id/print" element={m(<RequirePerm any={['sponsors_manage', 'funds_verify']} what="Sponsor documents"><SponsorPrint /></RequirePerm>)} />
            <Route path="admin/events/:slug" element={m(<AdminEventPage />)} />
            <Route path="admin/events/:slug/check-in" element={m(<CheckInPage />)} />
            <Route path="admin/events/:slug/badges" element={m(<AdminBadges />)} />
            <Route path="about" element={<AboutPage />} />
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
