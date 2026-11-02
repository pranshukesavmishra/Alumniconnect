import { m } from 'motion/react'
import { CalendarHeart, Home, MessagesSquare, Plus, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { SPRING } from '../../components/ui/Motion'
import { useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { CountBubble } from './TopBar'

interface Tab {
  to: string
  label: MsgKey
  icon: LucideIcon
  end?: boolean
}

// Four places and the Create button in the middle; everything else lives in the menu registry (menu.ts).
const LEFT: Tab[] = [
  { to: '/', label: 'nav.home', icon: Home, end: true },
  { to: '/groups', label: 'nav.groups', icon: Users },
]
const RIGHT: Tab[] = [
  { to: '/meet', label: 'nav.meet', icon: CalendarHeart },
  { to: '/chat', label: 'nav.chat', icon: MessagesSquare },
]

function activeTab(pathname: string): string | null {
  if (pathname === '/') return '/'
  return [...LEFT, ...RIGHT].find((t) => t.to !== '/' && (pathname === t.to || pathname.startsWith(t.to + '/')))?.to ?? null
}

function TabLink({ t, active, unread }: { t: Tab; active: boolean; unread: number }) {
  const tx = useT()
  return (
    <li className="flex-1">
      <NavLink
        to={t.to}
        end={t.end}
        className={cn(
          'fx-press relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-[22px] text-[11px] font-semibold tracking-[0.01em] transition-colors',
          active ? 'text-primary' : 'text-muted hover:text-text',
        )}
      >
        {active && (
          <m.span
            layoutId="shell-tab-pill"
            transition={SPRING}
            aria-hidden
            className="absolute inset-x-1 inset-y-1 -z-0 rounded-[18px] bg-primary/[0.11] shadow-[inset_0_1px_0_var(--highlight),inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_16%,transparent)] dark:bg-primary/[0.14]"
          />
        )}
        <span className="relative grid h-6 place-items-center">
          <t.icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.9} aria-hidden />
          {t.to === '/chat' && unread > 0 && <CountBubble n={unread} label={tx('chat.unreadN', { n: unread })} className="-right-3 -top-1.5" />}
        </span>
        <span className="relative max-w-full truncate px-0.5">{tx(t.label)}</span>
      </NavLink>
    </li>
  )
}

/** Phone: the floating liquid-glass tab bar with a sliding active pill and a raised gold Create button. */
export function BottomTabs({ unread, onCreate, createOpen }: { unread: number; onCreate: () => void; createOpen: boolean }) {
  const tx = useT()
  const { pathname } = useLocation()
  const active = activeTab(pathname)
  const modal = useModalOpen()
  // a dialog drawn inside the page can sit below this bar (page transitions create their own layer): step aside while one is open
  if (modal) return null
  return (
    <nav aria-label={tx('nav.main')} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))] md:hidden">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(to_top,var(--bg),transparent)] opacity-80" />
      <ul className="fx-liquid pointer-events-auto relative mx-auto flex max-w-md items-stretch gap-0.5 rounded-[30px] p-1.5">
        {LEFT.map((t) => (
          <TabLink key={t.to} t={t} active={active === t.to} unread={unread} />
        ))}
        <li className="flex w-[64px] shrink-0 flex-col items-center justify-end">
          <button
            type="button"
            onClick={onCreate}
            aria-label={tx('shell.create')}
            aria-haspopup="dialog"
            aria-expanded={createOpen}
            className="group -mt-6 flex flex-col items-center gap-1 rounded-[22px] text-[11px] font-semibold text-gold-ink focus-visible:outline-none"
          >
            <span
              className={cn(
                'fx-shine fx-press grid size-[54px] place-items-center rounded-[20px] text-[#2b1a05] transition-transform duration-300',
                'bg-[linear-gradient(145deg,#f8e4b0_0%,#e9b955_38%,#c98a2a_72%,#a8661b_100%)]',
                'shadow-[inset_0_1px_0_rgb(255_255_255/0.65),inset_0_-2px_6px_rgb(120_60_10/0.35),0_0_0_4px_var(--bg),0_14px_28px_-10px_rgb(181_116_28/0.85)]',
                'group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-primary',
                createOpen && 'rotate-45',
              )}
            >
              <Plus className="size-7" strokeWidth={2.4} aria-hidden />
            </span>
            <span aria-hidden className="pb-1 leading-none">{tx('shell.create')}</span>
          </button>
        </li>
        {RIGHT.map((t) => (
          <TabLink key={t.to} t={t} active={active === t.to} unread={unread} />
        ))}
      </ul>
    </nav>
  )
}

/** True while any modal dialog (aria-modal) is on screen. */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('[aria-modal="true"]'))
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] })
    return () => mo.disconnect()
  }, [])
  return open
}
