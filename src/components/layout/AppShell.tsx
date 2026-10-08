import clsx from 'clsx'
import { CalendarHeart, Home, MessagesSquare, ShieldCheck, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { useMyProfile } from '../../features/auth/AuthProvider'
import { useMyStaffEvents } from '../../features/events/queries'
import { useInboxLive, useUnreadChats } from '../../features/chat/queries'
import { Avatar } from '../ui/Display'

interface Tab {
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}

function useTabs(): Tab[] {
  const tabs: Tab[] = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/groups', label: 'Groups', icon: Users },
    { to: '/meet', label: 'Meet 2026', icon: CalendarHeart },
    { to: '/chat', label: 'Chat', icon: MessagesSquare },
    { to: '/me', label: 'Me', icon: UserRound },
  ]
  return tabs
}

/** Organisers get an extra entry: in the sidebar on desktop, on the Me page on phones (5 tabs max). */
export function useIsOrganiser() {
  const { data: profile } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  return !!profile?.is_admin || !!staff?.length
}

export function AppShell() {
  const tabs = useTabs()
  const { data: profile } = useMyProfile()
  const organiser = useIsOrganiser()
  const unread = useUnreadChats()
  useInboxLive()
  // Focused screens (an open chat) use the whole height, like WhatsApp: no bottom tabs.
  const focused = !!useMatch('/chat/:id')
  const desktopTabs = organiser ? [...tabs, { to: '/admin', label: 'Organise', icon: ShieldCheck } as Tab] : tabs
  return (
    <div className="min-h-dvh md:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-3 px-3">
          <img src="/pwa-192.png" alt="" className="size-9 rounded-xl" />
          <span className="font-bold leading-tight">JEC Alumni Connect</span>
        </Link>
        <nav className="space-y-1" aria-label="Main">
          {desktopTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium',
                  isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
                )
              }
            >
              <t.icon className="size-5" aria-hidden />
              {t.label}
              {t.to === '/chat' && unread > 0 && <span className="ml-auto rounded-full bg-danger px-2 text-xs font-bold text-white">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        {profile && (
          <Link to="/me" className="mt-auto flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
            <Avatar src={profile.avatar_url} name={profile.full_name} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{profile.full_name || 'Your profile'}</span>
              <span className="block truncate text-xs text-muted">{profile.grad_year ? `Batch ${profile.grad_year}` : 'Complete profile'}</span>
            </span>
          </Link>
        )}
      </aside>

      <main className={clsx('min-w-0 flex-1 md:pb-0', !focused && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]')}>
        <Outlet />
      </main>

      {/* phone bottom tabs */}
      {!focused && (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {tabs.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  clsx('flex min-h-15 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', isActive ? 'text-primary' : 'text-muted')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx('relative grid h-7 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                      <t.icon className="size-5" aria-hidden />
                      {t.to === '/chat' && unread > 0 && (
                        <span className="absolute -right-0.5 -top-1 min-w-4.5 rounded-full bg-danger px-1 text-[10px] font-bold leading-4.5 text-white" aria-label={`${unread} unread`}>
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      )}
    </div>
  )
}

/** Page header with title and optional back link / action, used on every screen. */
export function PageHeader({ title, subtitle, back, action }: { title: ReactNode; subtitle?: ReactNode; back?: string; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 pt-safe backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-3xl items-center gap-2 px-4">
        {back && (
          <Link to={back} className="-ml-2 grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label="Back">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={clsx('mx-auto w-full px-4 py-5', wide ? 'max-w-6xl' : 'max-w-3xl', className)}>{children}</div>
}
