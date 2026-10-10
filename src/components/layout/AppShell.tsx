import clsx from 'clsx'
import { CalendarHeart, Home, Menu, MessagesSquare, Users, type LucideIcon } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { useMyProfile } from '../../features/auth/AuthProvider'
import { useAutoPhoto } from '../../features/profile/useAutoPhoto'
import { useInboxLive, useUnreadChats } from '../../features/chat/queries'
import { Avatar } from '../ui/Display'
import { useT, type MsgKey } from '../../i18n'
import { MenuSheet, SidebarMenu } from './MenuNav'

export { useIsOrganiser } from './useMenuCtx'

interface Tab {
  to: string
  label: MsgKey
  icon: LucideIcon
  end?: boolean
}

// The phone bar keeps four places and a Menu button; everything else lives in the registry (menu.ts).
const TABS: Tab[] = [
  { to: '/', label: 'nav.home', icon: Home, end: true },
  { to: '/groups', label: 'nav.groups', icon: Users },
  { to: '/meet', label: 'nav.meet', icon: CalendarHeart },
  { to: '/chat', label: 'nav.chat', icon: MessagesSquare },
]

export function AppShell() {
  useAutoPhoto()
  const tx = useT()
  const { data: profile } = useMyProfile()
  const unread = useUnreadChats()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const closeMenu = () => {
    setMenuOpen(false)
    requestAnimationFrame(() => menuBtn.current?.focus({ preventScroll: true }))
  }
  useInboxLive()
  // Focused screens (an open chat, the registration form, the check-in scanner) use the whole height: no bottom tabs.
  const inChat = useMatch('/chat/:id')
  const inRegister = useMatch('/meet/register')
  const inCheckIn = useMatch('/admin/events/:slug/check-in')
  const focused = !!(inChat || inRegister || inCheckIn)
  return (
    <div className="min-h-dvh md:flex">
      {/* desktop sidebar: every destination, grouped */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-border bg-surface/80 px-3 py-5 backdrop-blur md:flex">
        <Link to="/" className="mb-5 flex items-center gap-3 px-3">
          <img src="/jec-logo.png" alt="" className="h-10 w-auto drop-shadow-sm" />
          <span className="leading-tight">
            <span className="block text-[17px] font-bold tracking-tight">JEC Alumni</span>
            <span className="block text-xs font-medium text-muted">Jabalpur Engineering College</span>
          </span>
        </Link>
        <SidebarMenu />
        {profile && (
          <Link to="/me" className="mt-3 flex shrink-0 items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card hover:bg-surface-2" data-testid="sidebar-user">
            <Avatar src={profile.avatar_url} name={profile.full_name} size={40} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{profile.full_name || tx('nav.yourProfile')}</span>
              <span className="block truncate text-xs text-muted">{profile.grad_year ? tx('common.batch', { year: profile.grad_year }) : tx('nav.completeProfile')}</span>
            </span>
          </Link>
        )}
      </aside>

      <main className={clsx('min-w-0 flex-1 md:pb-0', !focused && 'pb-[calc(6rem+env(safe-area-inset-bottom))]')}>
        <Outlet />
      </main>

      {/* phone bottom tabs: a floating glass bar */}
      {!focused && (
        <nav aria-label={tx('nav.main')} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden">
          <ul className="pointer-events-auto mx-auto flex max-w-md gap-1 rounded-[1.75rem] border border-border/70 bg-surface/85 p-1.5 shadow-pop backdrop-blur-xl">
            {TABS.map((t) => (
              <li key={t.to} className="flex-1">
                <NavLink
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[1.25rem] text-[11px] font-semibold transition-colors',
                      isActive ? 'bg-primary text-on-primary shadow-[0_6px_16px_-8px_var(--primary)]' : 'text-muted active:bg-surface-2',
                    )
                  }
                >
                  <span className="relative grid h-6 place-items-center">
                    <t.icon className="size-[22px]" aria-hidden />
                    {t.to === '/chat' && unread > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 min-w-4.5 rounded-full bg-accent px-1 text-[10px] font-bold leading-4.5 text-[#2b1d00]" aria-label={tx('chat.unreadN', { n: unread })}>
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </span>
                  {tx(t.label)}
                </NavLink>
              </li>
            ))}
            <li className="flex-1">
              <button
                ref={menuBtn}
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                className={clsx(
                  'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-[1.25rem] text-[11px] font-semibold transition-colors',
                  menuOpen ? 'bg-primary text-on-primary' : 'text-muted active:bg-surface-2',
                )}
              >
                <span className="grid h-6 place-items-center">
                  <Menu className="size-[22px]" aria-hidden />
                </span>
                {tx('menu.title')}
              </button>
            </li>
          </ul>
        </nav>
      )}
      <MenuSheet open={menuOpen} onClose={closeMenu} />
    </div>
  )
}

/** Page header with title and optional back link / action, used on every screen. */
export function PageHeader({ title, subtitle, back, action }: { title: ReactNode; subtitle?: ReactNode; back?: string; action?: ReactNode }) {
  const tx = useT()
  return (
    <header className="sticky top-0 z-20 bg-bg/80 pt-safe backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-2 px-4">
        {back && (
          <Link to={back} className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-text hover:bg-surface-2" aria-label={tx('common.back')}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={clsx('mx-auto w-full px-4 pb-6 pt-3', wide ? 'max-w-6xl' : 'max-w-3xl', className)}>{children}</div>
}
