import clsx from 'clsx'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { useAuth, useMyProfile } from '../../features/auth/AuthProvider'
import { useAutoPhoto } from '../../features/profile/useAutoPhoto'
import { useInboxLive, useUnreadChats } from '../../features/chat/queries'
import { BottomTabs } from '../../features/shell/BottomTabs'
import { CreateSheet } from '../../features/shell/CreateSheet'
import { InstallPrompt } from '../../features/shell/InstallPrompt'
import { useUnreadNotificationCount } from '../../features/shell/queries'
import { RouteProgress, ScrollMemory } from '../../features/shell/RouteChrome'
import { TopBar } from '../../features/shell/TopBar'
import { useHideOnScroll } from '../../features/shell/useHideOnScroll'
import '../../features/shell/shell.css'
import { PageSkeleton } from '../ui/Display'
import { useT } from '../../i18n'
import { MenuSheet, SidebarMenu } from './MenuNav'

export { useIsOrganiser } from './useMenuCtx'

// heavy overlays load the first time they open
const CommandSearch = lazy(() => import('../../features/shell/CommandSearch').then((r) => ({ default: r.CommandSearch })))
const NotificationsCentre = lazy(() => import('../../features/shell/NotificationsCentre').then((r) => ({ default: r.NotificationsCentre })))

const SIDEBAR_KEY = 'jec-sidebar-collapsed'
function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  useAutoPhoto()
  const { data: profile } = useMyProfile()
  const { session, loading: authLoading } = useAuth()
  const unread = useUnreadChats()
  const unreadNotifs = useUnreadNotificationCount()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    requestAnimationFrame(() => menuBtn.current?.focus({ preventScroll: true }))
  }, [])
  useInboxLive()
  // Focused screens (an open chat, the registration form, the check-in scanner) use the whole height: no bars.
  const inChat = useMatch('/chat/:id')
  const inRegister = useMatch('/meet/register')
  const inCheckIn = useMatch('/admin/events/:slug/check-in')
  const focused = !!(inChat || inRegister || inCheckIn)
  const barHidden = useHideOnScroll(!focused && !menuOpen)

  // Ctrl/Cmd+K opens search anywhere (signed in)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.altKey) {
        e.preventDefault()
        if (profile) setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [profile])

  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })

  return (
    <div className={clsx('min-h-dvh md:flex', !focused && 'has-topbar')} data-topbar-hidden={barHidden || undefined}>
      <RouteProgress />
      <ScrollMemory />
      <SidebarMenu collapsed={collapsed} onToggle={toggleSidebar} onSearch={() => setSearchOpen(true)} onNotifications={() => setNotifOpen(true)} unread={unreadNotifs} />

      {!focused && (
        <TopBar
          menuRef={menuBtn}
          menuOpen={menuOpen}
          onMenu={() => setMenuOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onNotifications={() => setNotifOpen(true)}
          unread={unreadNotifs}
          profile={profile}
          hidden={barHidden}
        />
      )}
      <main className={clsx('min-w-0 flex-1 md:pb-0', !focused && 'pb-[calc(7rem+env(safe-area-inset-bottom))]')}>
        <Suspense fallback={<PageSkeleton />}>
          <div key={pathname} className="route-fade">
            <Outlet />
          </div>
        </Suspense>
      </main>

      {!focused && <BottomTabs unread={unread} createOpen={createOpen} onCreate={() => (session || authLoading ? setCreateOpen(true) : navigate('/signin'))} />}
      <MenuSheet open={menuOpen} onClose={closeMenu} />
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <Suspense fallback={null}>
        {searchOpen && <CommandSearch open onClose={() => setSearchOpen(false)} />}
        {notifOpen && <NotificationsCentre open onClose={() => setNotifOpen(false)} />}
      </Suspense>
      <InstallPrompt enabled={!!profile && !focused} />
    </div>
  )
}

function useScrolledPast(px = 12) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    // hysteresis so the header never flickers at the threshold
    const on = () => setPast((p) => (p ? window.scrollY > 4 : window.scrollY > px))
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [px])
  return past
}

/**
 * Page header with title and optional back link / action, used on every screen.
 * At the top: a large serif title on the page background. Once scrolled: the title eases down to a compact size and
 * the bar turns to glass with a hairline. No layout shift (the title scales with a transform).
 */
export function PageHeader({ title, subtitle, back, action }: { title: ReactNode; subtitle?: ReactNode; back?: string; action?: ReactNode }) {
  const tx = useT()
  const scrolled = useScrolledPast()
  return (
    <header
      data-scrolled={scrolled || undefined}
      className={clsx(
        'sticky top-0 z-20 border-b pt-safe transition-[top,background-color,border-color,box-shadow] duration-300 ease-[var(--ease-out)]',
        scrolled
          ? 'border-border/60 bg-bg/80 shadow-[0_10px_30px_-24px_rgb(0_0_0/0.45)] backdrop-blur-xl backdrop-saturate-150'
          : 'border-transparent bg-bg/0',
      )}
    >
      <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-2 px-4">
        {back && (
          <Link
            to={back}
            className="tap -ml-2 grid size-11 shrink-0 place-items-center rounded-full border border-border/70 bg-surface/70 text-text shadow-e1 hover:bg-surface-2"
            aria-label={tx('common.back')}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1
            className={clsx(
              'origin-left line-clamp-2 text-[24px] font-semibold leading-tight sm:text-[26px] transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none',
              scrolled && 'scale-[0.78]',
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p className={clsx('line-clamp-2 text-sm text-muted transition-[opacity,transform] duration-300', scrolled && '-translate-y-1 opacity-80')}>{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  )
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={clsx('mx-auto w-full px-4 pb-6 pt-3', wide ? 'max-w-6xl' : 'max-w-3xl', className)}>{children}</div>
}
