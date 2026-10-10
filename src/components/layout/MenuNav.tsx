import clsx from 'clsx'
import { ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router'
import { signOut } from '../../features/auth/AuthProvider'
import { useUnreadChats } from '../../features/chat/queries'
import { useT } from '../../i18n'
import { isActive, searchMenu, type MenuItem, type MenuSection } from './menu'
import { useVisibleMenu } from './useMenuCtx'

/** One destination: a link (current page highlighted, aria-current) or the sign-out button. */
function MenuRow({ item, active, big, onDone }: { item: MenuItem; active: boolean; big?: boolean; onDone?: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const unread = useUnreadChats()
  const cls = clsx(
    'flex w-full items-center gap-3 rounded-2xl px-3 text-left font-semibold transition-colors',
    big ? 'min-h-14 text-[16px]' : 'min-h-11 text-[15px]',
    active ? 'bg-primary text-on-primary shadow-[0_8px_20px_-10px_var(--primary)]' : 'text-text hover:bg-surface-2',
  )
  const body = (
    <>
      <item.icon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{tx(item.label)}</span>
      {item.id === 'chat' && unread > 0 && <span className="rounded-full bg-accent px-2 text-xs font-bold leading-5 text-[#2b1d00]">{unread}</span>}
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

/** The grouped list with a search box, shared by the desktop sidebar and the phone sheet. */
function MenuList({ big, onDone }: { big?: boolean; onDone?: () => void }) {
  const tx = useT()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const all = useVisibleMenu()
  const [q, setQ] = useState('')
  // one section open at a time (accordion); the one holding the current page starts open
  const [openId, setOpenId] = useState<string | null>(() => all.find((s) => s.id !== 'home' && s.items.some((i) => isActive(i, pathname)))?.id ?? null)
  // landing on a page opens the section that holds it
  useEffect(() => {
    const id = all.find((s) => s.id !== 'home' && s.items.some((i) => isActive(i, pathname)))?.id
    if (id) setOpenId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  const sections: MenuSection[] = useMemo(() => searchMenu(all, q, tx), [all, q, tx])
  const searching = q.trim().length > 0

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
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          aria-label={tx('menu.search')}
          placeholder={tx('menu.jump')}
          enterKeyHint="go"
          autoComplete="off"
          className="min-h-11 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-[15px] placeholder:text-muted"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pb-4" data-testid="menu-sections">
        {sections.length === 0 && <p className="px-3 py-6 text-center text-muted">{tx('menu.noMatch', { q })}</p>}
        {sections.map((s) => {
          const open = searching || s.id === 'home' || openId === s.id
          const headId = `menu-h-${s.id}-${big ? 'm' : 'd'}`
          return (
            <section key={s.id} aria-labelledby={s.id === 'home' ? undefined : headId} aria-label={s.id === 'home' ? tx(s.label) : undefined} data-menu-group={s.id}>
              {s.id !== 'home' && !searching && (
                <h2>
                  <button
                    type="button"
                    id={headId}
                    aria-expanded={open}
                    onClick={() => toggle(s.id)}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-2xl px-3 text-left font-bold transition-colors hover:bg-surface-2',
                      big ? 'min-h-14 text-[16px]' : 'min-h-11 text-[15px]',
                      open && 'bg-surface-2',
                    )}
                  >
                    <span>{tx(s.label)}</span>
                    <ChevronDown className={clsx('size-5 text-muted transition-transform', !open && '-rotate-90')} aria-hidden />
                  </button>
                </h2>
              )}
              {s.id !== 'home' && searching && (
                <h2 id={headId} className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted">
                  {tx(s.label)}
                </h2>
              )}
              {open && (
                <ul className={clsx('space-y-0.5', s.id !== 'home' && !searching && 'mt-1 border-l-2 border-border/70 pl-2 ml-4')}>
                  {s.items.map((i) => (
                    <li key={i.id}>
                      <MenuRow item={i} active={isActive(i, pathname)} big={big} onDone={onDone} />
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

/** Desktop: the persistent left menu (everything, grouped, collapsible, with a jump box). */
export function SidebarMenu() {
  const tx = useT()
  return (
    <nav aria-label={tx('nav.main')} className="flex min-h-0 flex-1 flex-col" data-testid="sidebar-menu">
      <MenuList />
    </nav>
  )
}

/** Phone: the full-screen menu opened by the Menu tab. Esc, the close button and the phone's Back all close it. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tx = useT()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const followed = useRef(false)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // opening adds a history entry so the phone's Back closes the sheet instead of leaving the page
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

  if (!open) return null
  return createPortal(
    <div ref={panel} role="dialog" aria-modal="true" aria-label={tx('menu.title')} data-testid="menu-sheet" className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe animate-[drawer-in_180ms_ease-out] md:hidden">
      <div className="mx-auto flex w-full max-w-md shrink-0 items-center gap-2 px-4 py-2">
        <h1 className="flex-1 text-[22px] font-bold tracking-tight">{tx('menu.title')}</h1>
        <button type="button" onClick={onClose} aria-label={tx('menu.close')} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <MenuList big onDone={() => {
            followed.current = true
            onClose()
          }} />
      </div>
    </div>,
    document.body,
  )
}
