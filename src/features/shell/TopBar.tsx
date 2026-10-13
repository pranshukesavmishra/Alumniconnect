import { Bell, Menu, Search } from 'lucide-react'
import type { Ref } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import type { Profile } from '../../lib/types'

export function CountBubble({ n, className, label }: { n: number; className?: string; label?: string }) {
  if (n <= 0) return null
  return (
    <span
      aria-label={label}
      className={cn(
        'pointer-events-none absolute grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold leading-none text-[#2b1d00] tabular-nums',
        'bg-[linear-gradient(135deg,#f4dc9e,#e4ad45)] shadow-[0_0_0_2px_var(--bg),0_4px_10px_-4px_rgb(181_116_28/0.8)]',
        className,
      )}
    >
      {n > 9 ? '9+' : n}
    </span>
  )
}

/** Brand lockup: the crest and the serif wordmark. */
export function Wordmark({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span className="relative grid size-8 shrink-0 place-items-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(228_173_69/0.35),transparent_70%)] blur-[2px]" />
        <img src="/jec-logo.png" alt="" className="relative h-8 w-auto drop-shadow-[0_2px_4px_rgb(0_0_0/0.18)]" />
      </span>
      {!compact && (
        <span className="min-w-0 truncate font-display text-[18px] font-semibold leading-none tracking-[-0.02em] text-text">
          JEC Alumni<span className="hidden min-[380px]:inline"> Connect</span>
        </span>
      )}
    </span>
  )
}

const iconBtn =
  'fx-press relative grid size-11 shrink-0 place-items-center rounded-full text-text transition-colors hover:bg-text/[0.06] active:bg-text/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * Phone top bar: liquid glass, Menu top-left, the wordmark, then Search, the notification bell and a shortcut to
 * your profile. It tucks away while you scroll down and comes back on the way up (static with reduced motion).
 */
export function TopBar({
  menuRef,
  menuOpen,
  onMenu,
  onSearch,
  onNotifications,
  unread,
  profile,
  hidden,
}: {
  menuRef: Ref<HTMLButtonElement>
  menuOpen: boolean
  onMenu: () => void
  onSearch: () => void
  onNotifications: () => void
  unread: number
  profile: Profile | null | undefined
  hidden: boolean
}) {
  const tx = useT()
  return (
    <div
      data-testid="topbar"
      data-hidden={hidden || undefined}
      className={cn(
        'sticky top-0 z-30 transition-transform duration-300 ease-[var(--ease-out)] focus-within:translate-y-0 motion-reduce:transition-none md:hidden',
        hidden && '-translate-y-[calc(100%+4px)]',
      )}
    >
      <div className="fx-liquid shell-bar-top pt-safe">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-0.5 px-1.5">
          <button ref={menuRef} type="button" onClick={onMenu} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label={tx('menu.title')} className={iconBtn}>
            <Menu className="size-[22px]" strokeWidth={2} aria-hidden />
          </button>
          <Link to="/" className="flex min-h-11 min-w-0 flex-1 items-center pl-0.5 pr-1" aria-label={tx('shell.homeLink')}>
            <Wordmark />
          </Link>
          {profile && (
            <>
              <button type="button" onClick={onSearch} aria-label={tx('shell.search.open')} aria-haspopup="dialog" className={iconBtn}>
                <Search className="size-[21px]" strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={onNotifications}
                aria-haspopup="dialog"
                aria-label={unread ? tx('shell.notif.openN', { n: unread }) : tx('shell.notif.open')}
                className={iconBtn}
                data-testid="topbar-bell"
              >
                <Bell className={cn('size-[21px]', unread > 0 && 'origin-top animate-[bell-ring_1.2s_var(--ease-out)_1]')} strokeWidth={2} aria-hidden />
                <CountBubble n={unread} className="right-1 top-1" />
              </button>
              <Link to="/me" aria-label={tx('shell.myProfile')} className="fx-press grid size-11 shrink-0 place-items-center rounded-full">
                <Avatar src={profile.avatar_url} name={profile.full_name || '?'} size={32} ring={profile.verification === 'verified' ? 'verified' : 'none'} />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
