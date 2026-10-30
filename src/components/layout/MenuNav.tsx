import { AnimatePresence, m } from 'motion/react'
import {
  BriefcaseBusiness, CalendarHeart, ChevronDown, ChevronRight, IdCard, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, UserRound, Users, X, type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router'
import { version } from '../../../package.json'
import { signOut, useMyProfile } from '../../features/auth/AuthProvider'
import { useUnreadChats } from '../../features/chat/queries'
import { profileCompleteness } from '../../features/home/HomePage'
import { CountBubble, Wordmark } from '../../features/shell/TopBar'
import { LanguageSwitch } from '../../i18n/LanguageSwitch'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import type { Profile } from '../../lib/types'
import { Avatar } from '../ui/Avatar'
import { IconTile, type TileTone } from '../ui/IconTile'
import { EASE_OUT, useReducedMotion } from '../ui/Motion'
import { ProgressRing } from '../ui/Progress'
import { ThemeToggle } from '../ui/ThemeToggle'
import { isActive, searchMenu, type MenuGroupId, type MenuItem, type MenuSection } from './menu'
import { useVisibleMenu } from './useMenuCtx'

/** Each section's look: one icon + one tone, used for the section header and its rows. */
export const SECTION_STYLE: Record<MenuGroupId, { icon: LucideIcon; tone: TileTone }> = {
  home: { icon: UserRound, tone: 'emerald' },
  community: { icon: Users, tone: 'emerald' },
  events: { icon: CalendarHeart, tone: 'gold' },
  opportunities: { icon: BriefcaseBusiness, tone: 'ink' },
  me: { icon: UserRound, tone: 'plum' },
  organise: { icon: ShieldCheck, tone: 'maroon' },
}

/** "Batch 2008 · CSE" */
export function memberLine(p: Profile, tx: ReturnType<typeof useT>): string {
  return [p.grad_year ? tx('common.batch', { year: p.grad_year }) : null, shortBranch(p.branch)].filter(Boolean).join(' · ') || tx('nav.completeProfile')
}

/** One destination: a link (current page highlighted, aria-current) or the sign-out button. */
function MenuRow({ item, tone, active, big, onDone }: { item: MenuItem; tone: TileTone; active: boolean; big?: boolean; onDone?: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const unread = useUnreadChats()
  const cls = cn(
    'fx-press group relative flex w-full items-center gap-3 rounded-[16px] pl-2 pr-3 text-left font-semibold transition-colors',
    big ? 'min-h-[52px] text-[16px]' : 'min-h-11 text-[14.5px]',
    active
      ? 'bg-primary-soft text-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_22%,transparent)]'
      : 'text-text hover:bg-text/[0.05]',
  )
  const body = (
    <>
      {active && <span aria-hidden className="absolute -left-[9px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
      <IconTile icon={item.icon} tone={item.action === 'signout' ? 'neutral' : tone} variant={active ? 'solid' : 'soft'} size="sm" className={big ? '' : 'size-8 rounded-[9px]'} />
      <span className="min-w-0 flex-1 truncate">{tx(item.label)}</span>
      {item.id === 'chat' && unread > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[linear-gradient(135deg,#f4dc9e,#e4ad45)] px-1.5 text-[11px] font-bold text-[#2b1d00]">{unread}</span>
      )}
    </>
  )
  if (item.action === 'signout') {
    return (
      <button
        type="button"
        className={cls}
        onClick={async () => {
          onDone?.()
          await signOut()
          navigate('/', { replace: true })
        }}
      >
        {body}
      </button>
    )
  }
  return (
    <Link to={item.to!} className={cls} aria-current={active ? 'page' : undefined} onClick={onDone}>
      {body}
    </Link>
  )
}

/** The grouped list with a jump box, shared by the desktop sidebar and the phone drawer. */
function MenuList({ big, onDone, hideSignOut, openSection }: { big?: boolean; onDone?: () => void; hideSignOut?: boolean; openSection?: string | null }) {
  const tx = useT()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const all = useVisibleMenu()
  const [q, setQ] = useState('')
  // one section open at a time (accordion); the one holding the current page starts open
  const [openId, setOpenId] = useState<string | null>(() => openSection ?? all.find((s) => s.id !== 'home' && s.items.some((i) => isActive(i, pathname)))?.id ?? null)
  // landing on a page opens the section that holds it (also once the menu finishes loading)
  const activeSection = all.find((s) => s.id !== 'home' && s.items.some((i) => isActive(i, pathname)))?.id
  useEffect(() => {
    if (activeSection) setOpenId(activeSection)
  }, [pathname, activeSection])
  useEffect(() => {
    if (openSection) setOpenId(openSection)
  }, [openSection])
  const searching = q.trim().length > 0
  const sections: MenuSection[] = useMemo(() => {
    const found = searchMenu(all, q, tx)
    // the drawer has its own Sign out in the footer
    return hideSignOut && !searching ? found.map((s) => ({ ...s, items: s.items.filter((i) => i.action !== 'signout') })) : found
  }, [all, q, tx, hideSignOut, searching])

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id))
  }

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const first = sections.flatMap((s) => s.items).find((i) => i.to)
    if (first?.to) {
      navigate(first.to)
      setQ('')
      onDone?.()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-3 shrink-0">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          aria-label={tx('menu.search')}
          placeholder={tx('menu.jump')}
          enterKeyHint="go"
          autoComplete="off"
          className="min-h-11 w-full rounded-[14px] border border-border/70 bg-surface-2/70 pl-10 pr-4 text-[15px] placeholder:text-subtle focus:border-primary/50 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-4" data-testid="menu-sections">
        {sections.length === 0 && <p className="px-3 py-6 text-center text-muted">{tx('menu.noMatch', { q })}</p>}
        {sections.map((s) => {
          const open = searching || s.id === 'home' || openId === s.id
          const headId = `menu-h-${s.id}-${big ? 'm' : 'd'}`
          const style = SECTION_STYLE[s.id]
          return (
            <section key={s.id} aria-labelledby={s.id === 'home' ? undefined : headId} aria-label={s.id === 'home' ? tx(s.label) : undefined} data-menu-group={s.id}>
              {s.id !== 'home' && !searching && (
                <h2 className="font-sans tracking-normal">
                  <button
                    type="button"
                    id={headId}
                    aria-expanded={open}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      'fx-press flex w-full items-center gap-3 rounded-[16px] pl-2 pr-3 text-left font-bold transition-colors hover:bg-text/[0.05]',
                      big ? 'min-h-[52px] text-[16px]' : 'min-h-11 text-[14.5px]',
                      open && 'bg-text/[0.04]',
                    )}
                  >
                    <IconTile icon={style.icon} tone={style.tone} variant={open ? 'solid' : 'soft'} size="sm" className={big ? '' : 'size-8 rounded-[9px]'} />
                    <span className="min-w-0 flex-1">{tx(s.label)}</span>
                    <span aria-hidden className="text-caption font-semibold text-subtle tabular-nums">{s.items.length}</span>
                    <ChevronDown className={cn('size-[18px] text-muted transition-transform duration-300 ease-[var(--ease-out)]', !open && '-rotate-90')} aria-hidden />
                  </button>
                </h2>
              )}
              {s.id !== 'home' && searching && (
                <h2 id={headId} className="px-3 pb-1 pt-2 font-sans text-eyebrow text-gold-ink">
                  {tx(s.label)}
                </h2>
              )}
              {open && (
                <ul className={cn('space-y-0.5', s.id !== 'home' && !searching && 'relative mb-1.5 ml-[26px] mt-1 border-l border-border pl-2.5', 'animate-[menu-open_260ms_var(--ease-out)]')}>
                  {s.items.map((i) => (
                    <li key={i.id}>
                      <MenuRow item={i} tone={style.tone} active={isActive(i, pathname)} big={big} onDone={onDone} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** The member card at the top of the drawer: aurora, avatar inside a profile-strength ring, two quick tiles. */
function ProfileCard({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const tx = useT()
  const pct = profileCompleteness(profile).percent
  return (
    <div className="aurora fx-hairline overflow-hidden rounded-[26px] p-4 text-white shadow-pop" data-testid="drawer-profile">
      <div aria-hidden className="fx-dots fx-dots-light pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative flex items-center gap-3.5">
        <ProgressRing value={pct} size={68} stroke={3.5} tone="gold" label={tx('shell.strength', { n: pct })}>
          <Avatar src={profile.avatar_url} name={profile.full_name || '?'} size={54} />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[21px] font-semibold leading-tight tracking-[-0.015em]">{profile.full_name || tx('nav.yourProfile')}</p>
          <p className="mt-0.5 truncate text-[13.5px] text-hero-text">{memberLine(profile, tx)}</p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent">
            <span className="tabular-nums">{pct}%</span>
            <span className="text-hero-text/90">{tx('shell.strengthShort')}</span>
          </p>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2">
        <Link to="/me" onClick={onDone} className="fx-liquid-dark fx-press flex min-h-12 items-center justify-center gap-1.5 rounded-[16px] px-3 text-[14px] font-semibold">
          {tx('shell.viewProfile')}
          <ChevronRight className="size-4 opacity-70" aria-hidden />
        </Link>
        <Link
          to="/id-card"
          onClick={onDone}
          aria-label={tx('shell.idCard')}
          className="fx-shine fx-press flex min-h-12 items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(140deg,#f8e4b0,#e4ad45_55%,#b5741c)] px-3 text-[14px] font-semibold text-[#2b1a05] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_10px_22px_-12px_rgb(228_173_69/0.9)]"
        >
          <IdCard className="size-[18px] shrink-0" aria-hidden />
          <span className="min-w-0 leading-tight">{tx('shell.idCardShort')}</span>
        </Link>
      </div>
    </div>
  )
}

function VisitorCard({ onDone }: { onDone: () => void }) {
  const tx = useT()
  return (
    <div className="aurora overflow-hidden rounded-[26px] p-5 text-white shadow-pop">
      <p className="text-eyebrow text-accent">{tx('shell.visitor.eyebrow')}</p>
      <p className="mt-1.5 font-display text-[22px] font-semibold leading-tight">{tx('shell.visitor.title')}</p>
      <Link to="/signin" onClick={onDone} className="fx-shine fx-press mt-4 inline-flex min-h-12 items-center gap-2 rounded-[16px] bg-[linear-gradient(140deg,#f8e4b0,#e4ad45_55%,#b5741c)] px-5 font-semibold text-[#2b1a05]">
        <LogIn className="size-[18px]" aria-hidden />
        {tx('auth.signIn')}
      </Link>
    </div>
  )
}

/** Desktop: the persistent left menu (glass panel, everything grouped, collapsible to an icon rail). */
export function SidebarMenu({
  collapsed,
  onToggle,
  onSearch,
  onNotifications,
  unread,
}: {
  collapsed: boolean
  onToggle: () => void
  onSearch: () => void
  onNotifications: () => void
  unread: number
}) {
  const tx = useT()
  const { data: profile } = useMyProfile()
  const all = useVisibleMenu()
  const { pathname } = useLocation()
  const [openSection, setOpenSection] = useState<string | null>(null)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const pct = profile ? profileCompleteness(profile).percent : 0
  const toggleBtn = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? tx('shell.expand') : tx('shell.collapse')}
      title={collapsed ? tx('shell.expand') : tx('shell.collapse')}
      aria-expanded={!collapsed}
      data-testid="sidebar-toggle"
      className="fx-press grid size-10 shrink-0 place-items-center rounded-[12px] text-muted hover:bg-text/[0.06] hover:text-text"
    >
      {collapsed ? <PanelLeftOpen className="size-[19px]" aria-hidden /> : <PanelLeftClose className="size-[19px]" aria-hidden />}
    </button>
  )
  const railBtn = 'fx-press relative grid size-12 place-items-center rounded-[16px] text-text hover:bg-text/[0.06]'
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 p-3 pr-0 transition-[width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none md:block',
        collapsed ? 'w-[92px]' : 'w-[300px]',
      )}
    >
      <div className="fx-liquid flex h-full flex-col overflow-hidden rounded-[28px] p-3">
        {/* brand + collapse */}
        <div className={cn('mb-3 flex items-center gap-2', collapsed ? 'flex-col' : 'pl-1.5')}>
          <Link to="/" className="flex min-h-11 min-w-0 flex-1 items-center" aria-label={tx('shell.homeLink')}>
            <Wordmark compact={collapsed} />
          </Link>
          {toggleBtn}
        </div>

        {collapsed ? (
          <nav aria-label={tx('nav.main')} className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto" data-testid="sidebar-rail">
            <button type="button" onClick={onSearch} aria-label={tx('shell.search.open')} title={tx('shell.search.open')} className={railBtn}>
              <Search className="size-5" aria-hidden />
            </button>
            {profile && (
              <button type="button" onClick={onNotifications} aria-label={unread ? tx('shell.notif.openN', { n: unread }) : tx('shell.notif.open')} title={tx('notif.title')} className={railBtn}>
                <span className="relative">
                  <BellGlyph />
                  <CountBubble n={unread} className="-right-2.5 -top-2" />
                </span>
              </button>
            )}
            <span aria-hidden className="my-1 h-px w-8 bg-border" />
            {all.map((s) => {
              const style = SECTION_STYLE[s.id]
              if (s.id === 'home') {
                const home = s.items[0]!
                const on = isActive(home, pathname)
                return (
                  <Link key="home" to="/" aria-label={tx(home.label)} title={tx(home.label)} aria-current={on ? 'page' : undefined} className={railBtn}>
                    <IconTile icon={home.icon} tone="emerald" variant={on ? 'solid' : 'soft'} size="md" />
                  </Link>
                )
              }
              const on = s.items.some((i) => isActive(i, pathname))
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-label={tx(s.label)}
                  title={tx(s.label)}
                  className={railBtn}
                  onClick={() => {
                    setOpenSection(s.id)
                    onToggle()
                  }}
                >
                  <IconTile icon={style.icon} tone={style.tone} variant={on ? 'solid' : 'soft'} size="md" />
                </button>
              )
            })}
          </nav>
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={onSearch}
                aria-haspopup="dialog"
                className="fx-press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-border/70 bg-surface/80 px-3 text-left text-[14.5px] text-muted shadow-e1 hover:border-border-strong hover:text-text"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{tx('shell.search.hint')}</span>
                <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
              </button>
              {profile && (
                <button
                  type="button"
                  onClick={onNotifications}
                  aria-haspopup="dialog"
                  aria-label={unread ? tx('shell.notif.openN', { n: unread }) : tx('shell.notif.open')}
                  className="fx-press relative grid size-11 shrink-0 place-items-center rounded-[14px] border border-border/70 bg-surface/80 text-text shadow-e1 hover:border-border-strong"
                  data-testid="sidebar-bell"
                >
                  <BellGlyph />
                  <CountBubble n={unread} className="-right-1 -top-1" />
                </button>
              )}
            </div>
            <nav aria-label={tx('nav.main')} className="flex min-h-0 flex-1 flex-col" data-testid="sidebar-menu">
              <MenuList openSection={openSection} />
            </nav>
          </>
        )}

        {profile && (
          <Link
            to="/me"
            aria-label={collapsed ? profile.full_name || tx('nav.yourProfile') : undefined}
            title={collapsed ? profile.full_name : undefined}
            className={cn(
              'fx-press mt-3 flex shrink-0 items-center gap-3 rounded-[20px] border border-border/60 bg-surface/80 shadow-e1 hover:border-border-strong',
              collapsed ? 'justify-center p-1.5' : 'p-2.5',
            )}
            data-testid="sidebar-user"
          >
            <ProgressRing value={pct} size={46} stroke={3} tone="gold" label={tx('shell.strength', { n: pct })}>
              <Avatar src={profile.avatar_url} name={profile.full_name || '?'} size={36} />
            </ProgressRing>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{profile.full_name || tx('nav.yourProfile')}</span>
                <span className="block truncate text-[12.5px] text-muted">{memberLine(profile, tx)}</span>
              </span>
            )}
            {!collapsed && <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />}
          </Link>
        )}
      </div>
    </aside>
  )
}

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.27 21a2 2 0 0 0 3.46 0" />
      <path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" />
    </svg>
  )
}

function DrawerFooter({ onDone, signedIn }: { onDone: () => void; signedIn: boolean }) {
  const tx = useT()
  const navigate = useNavigate()
  return (
    <div className="mt-2 space-y-3 border-t border-border/70 pt-4">
      <ThemeToggle className="flex w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2" />
      <div className="flex items-center justify-between gap-2">
        <LanguageSwitch compact />
        {signedIn && (
          <button
            type="button"
            onClick={async () => {
              onDone()
              await signOut()
              navigate('/', { replace: true })
            }}
            className="fx-press inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14.5px] font-semibold text-danger hover:bg-danger-soft"
          >
            <LogOut className="size-[18px]" aria-hidden />
            {tx('profile.signOut')}
          </button>
        )}
      </div>
      <p className="pb-1 text-center text-[12px] text-subtle">
        JEC Alumni Connect · {tx('shell.version', { v: version })}
      </p>
    </div>
  )
}

/** Phone: the menu drawer, sliding in from the left. Esc, the close button, a tap outside and the phone's Back close it. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tx = useT()
  const reduced = useReducedMotion()
  const { data: profile } = useMyProfile()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const followed = useRef(false)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // opening adds a history entry so the phone's Back closes the drawer instead of leaving the page
  useEffect(() => {
    if (!open) return
    followed.current = false
    const marker = { menu: true }
    window.history.pushState({ ...(window.history.state ?? {}), ...marker }, '')
    let closedByBack = false
    const onPop = () => {
      closedByBack = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // closed another way (Esc, X, a link): drop the extra entry we added
      if (!closedByBack && !followed.current && (window.history.state as { menu?: boolean } | null)?.menu) window.history.back()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const [a, z] = [items[0]!, items[items.length - 1]!]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
    }
  }, [open])

  const done = () => {
    followed.current = true
    onClose()
  }
  const t = reduced ? { duration: 0 } : { duration: 0.38, ease: EASE_OUT }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" key="menu">
          <m.div
            aria-hidden
            className="absolute inset-0 bg-scrim backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25 }}
            onClick={onClose}
          />
          <m.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={tx('menu.title')}
            data-testid="menu-sheet"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={t}
            className="absolute inset-y-0 left-0 flex w-[min(90vw,392px)] flex-col overflow-hidden rounded-r-[30px] bg-bg pt-safe shadow-[inset_-1px_0_0_var(--border),var(--shadow-5)]"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2.5">
              <Wordmark className="flex-1" />
              <button type="button" onClick={onClose} aria-label={tx('menu.close')} className="fx-press grid size-11 place-items-center rounded-full border border-border/70 bg-surface/70 shadow-e1 hover:bg-surface-2">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <div className="mb-4 mt-1 shrink-0">{profile ? <ProfileCard profile={profile} onDone={done} /> : <VisitorCard onDone={done} />}</div>
              <div className="flex shrink-0 flex-col [&_[data-testid=menu-sections]]:overflow-visible">
                <MenuList big hideSignOut onDone={done} />
              </div>
              <DrawerFooter onDone={done} signedIn={!!profile} />
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

