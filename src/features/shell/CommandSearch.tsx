import { useQuery } from '@tanstack/react-query'
import { m } from 'motion/react'
import { ArrowDown, ArrowUp, BriefcaseBusiness, CalendarHeart, Clock3, CornerDownLeft, History, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { SECTION_STYLE } from '../../components/layout/MenuNav'
import { MENU, searchMenu } from '../../components/layout/menu'
import { useVisibleMenu } from '../../components/layout/useMenuCtx'
import { Avatar } from '../../components/ui/Avatar'
import { groupIconFor } from '../../components/ui/GroupIcon'
import { IconTile } from '../../components/ui/IconTile'
import { NoResultsArt } from '../../components/ui/Illustrations'
import { EASE_OUT, useReducedMotion } from '../../components/ui/Motion'
import { useModal } from '../../components/ui/Sheet'
import { Skeleton } from '../../components/ui/Skeleton'
import { useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { useGroups } from '../community/queries'
import { ilikeTerm, pushRecent, readRecent, stepIndex, writeRecent } from './recent'

interface Result {
  key: string
  title: string
  sub?: string
  to: string
  lead: ReactNode
  /** typed query to remember, or null for plain navigation (recent chips) */
  remember?: boolean
}
interface Group {
  id: string
  label: MsgKey
  items: Result[]
  loading?: boolean
}

function useDebounced<T>(value: T, ms = 220) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

interface MemberHit {
  id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  current_company: string | null
  city?: string | null
}

function useRemote(q: string, canMembers: boolean) {
  const term = ilikeTerm(q)
  const on = term.length >= 2
  const members = useQuery({
    queryKey: ['cmdk', 'members', term],
    enabled: on && canMembers,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', { q: term, p_branch: null, p_year_from: null, p_year_to: null, p_limit: 5, p_offset: 0 })
      if (error) throw error
      return data as MemberHit[]
    },
  })
  const jobs = useQuery({
    queryKey: ['cmdk', 'jobs', term],
    enabled: on && canMembers,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_jobs', { p_query: term, p_type: null, p_mode: null, p_only_saved: false, p_limit: 4, p_offset: 0 })
      if (error) throw error
      return data as { id: string; title: string; company: string; location: string | null }[]
    },
  })
  const events = useQuery({
    queryKey: ['cmdk', 'events', term],
    enabled: on,
    staleTime: 60_000,
    queryFn: async () => {
      const [ev, past] = await Promise.all([
        supabase.from('events').select('id, slug, title, starts_at').ilike('title', `%${term}%`).order('starts_at', { ascending: false }).limit(3),
        supabase.from('past_meets').select('id, slug, title, year').ilike('title', `%${term}%`).order('year', { ascending: false }).limit(3),
      ])
      return [
        ...((ev.data ?? []) as { id: string; slug: string; title: string; starts_at: string | null }[]).map((e) => ({ id: e.id, title: e.title, to: '/meet', when: e.starts_at ? new Date(e.starts_at).getFullYear() : null })),
        ...((past.data ?? []) as { id: string; slug: string; title: string; year: number }[]).map((p) => ({ id: p.id, title: p.title, to: `/meets/${p.slug}`, when: p.year })),
      ].slice(0, 4)
    },
  })
  return { members, jobs, events, on }
}

/**
 * Search everything: members, groups, jobs, events and every page in the menu. A Raycast/Linear-style palette:
 * a combobox with a grouped listbox, ↑/↓ to move, Enter to open, Esc to close. Recent searches stay on this device.
 */
export function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <Palette onClose={onClose} />
}

function Palette({ onClose }: { onClose: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optId = (i: number) => `${listId}-o${i}`
  useModal(true, panel, onClose)
  const { data: me } = useMyProfile()
  const canMembers = me?.verification === 'verified' || !!me?.is_admin
  const menu = useVisibleMenu()
  const groupsQ = useGroups()
  const [q, setQ] = useState('')
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const [active, setActive] = useState(0)
  const dq = useDebounced(q)
  const typing = q.trim() !== dq.trim()
  const { members, jobs, events, on } = useRemote(dq, canMembers)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const groups: Group[] = useMemo(() => {
    const term = q.trim()
    const out: Group[] = []
    if (!term) {
      if (recent.length)
        out.push({
          id: 'recent',
          label: 'shell.search.recent',
          items: recent.map((r) => ({ key: `r-${r}`, title: r, to: `?q=${r}`, lead: <IconTile icon={History} tone="neutral" size="sm" /> })),
        })
      const quick = MENU.filter((i) => i.quick && menu.some((s) => s.items.includes(i)))
      out.push({
        id: 'suggested',
        label: 'shell.search.suggested',
        items: quick.slice(0, 6).map((i) => ({ key: `p-${i.id}`, title: tx(i.label), to: i.to!, lead: <IconTile icon={i.icon} tone={SECTION_STYLE[i.group].tone} size="sm" /> })),
      })
      return out
    }
    // pages answer instantly, as you type
    const pages = searchMenu(menu, term, tx)
      .flatMap((s) => s.items.filter((i) => i.to).map((i) => ({ i, s })))
      .slice(0, 5)
      .map(({ i, s }) => ({ key: `p-${i.id}`, title: tx(i.label), sub: tx(s.label), to: i.to!, lead: <IconTile icon={i.icon} tone={SECTION_STYLE[i.group].tone} size="sm" />, remember: true }))
    const lower = term.toLowerCase()
    const grp = (groupsQ.data ?? [])
      .filter((g) => `${g.name} ${g.description ?? ''}`.toLowerCase().includes(lower))
      .slice(0, 4)
      .map((g) => {
        const gi = groupIconFor(g.icon, g.kind)
        return { key: `g-${g.id}`, title: g.name, sub: tx('shell.search.members', { count: g.member_count }), to: `/groups/${g.slug}`, lead: <IconTile icon={gi.icon} tone={gi.tone} size="sm" />, remember: true }
      })
    const pending = (x: { isFetching: boolean; data?: unknown }) => typing || (x.isFetching && !x.data)
    if (canMembers)
      out.push({
        id: 'members',
        label: 'shell.search.people',
        loading: on && pending(members),
        items: (members.data ?? []).map((p) => ({
          key: `m-${p.id}`,
          title: p.full_name,
          sub: [p.grad_year ? tx('common.batch', { year: p.grad_year }) : null, shortBranch(p.branch), p.current_company].filter(Boolean).join(' · '),
          to: `/people/${p.id}`,
          lead: <Avatar src={p.avatar_url} name={p.full_name} size={36} />,
          remember: true,
        })),
      })
    if (grp.length) out.push({ id: 'groups', label: 'shell.search.groups', items: grp })
    if (canMembers)
      out.push({
        id: 'jobs',
        label: 'shell.search.jobs',
        loading: on && pending(jobs),
        items: (jobs.data ?? []).map((j) => ({ key: `j-${j.id}`, title: j.title, sub: [j.company, j.location].filter(Boolean).join(' · '), to: `/jobs/${j.id}`, lead: <IconTile icon={BriefcaseBusiness} tone="ink" size="sm" />, remember: true })),
      })
    out.push({
      id: 'events',
      label: 'shell.search.events',
      loading: on && pending(events),
      items: (events.data ?? []).map((e) => ({ key: `e-${e.id}`, title: e.title, sub: e.when ? String(e.when) : undefined, to: e.to, lead: <IconTile icon={CalendarHeart} tone="gold" size="sm" />, remember: true })),
    })
    if (pages.length) out.push({ id: 'pages', label: 'shell.search.pages', items: pages })
    return out.filter((g) => g.items.length || g.loading)
  }, [q, recent, menu, tx, groupsQ.data, canMembers, members, jobs, events, on, typing])

  const flat = groups.flatMap((g) => g.items)
  const anyLoading = groups.some((g) => g.loading)
  useEffect(() => setActive(0), [q])
  const safeActive = Math.min(active, flat.length - 1)

  function choose(r: Result) {
    if (r.key.startsWith('r-')) {
      setQ(r.title)
      input.current?.focus()
      return
    }
    if (r.remember && q.trim()) {
      const next = pushRecent(recent, q)
      setRecent(next)
      writeRecent(next)
    }
    onClose()
    navigate(r.to)
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = stepIndex(safeActive, e.key === 'ArrowDown' ? 1 : -1, flat.length)
      setActive(n)
      document.getElementById(optId(n))?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      const r = flat[safeActive]
      if (r) {
        e.preventDefault()
        choose(r)
      }
    }
  }

  let idx = -1
  const empty = q.trim().length > 0 && !flat.length && !anyLoading && !typing
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-center md:items-start md:p-6 md:pt-[11vh]" onClick={onClose}>
      <m.div
        aria-hidden
        className="absolute inset-0 bg-scrim backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      />
      <m.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={tx('shell.search.title')}
        data-testid="command-search"
        onClick={(e) => e.stopPropagation()}
        initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        className={cn(
          'relative flex h-dvh w-full flex-col overflow-hidden bg-bg pt-safe',
          'md:h-auto md:max-h-[72vh] md:max-w-[640px] md:rounded-[24px] md:border md:border-border/70 md:bg-elevated/95 md:pt-0 md:shadow-[inset_0_1px_0_var(--highlight),var(--shadow-5)] md:backdrop-blur-2xl',
        )}
      >
        {/* the input row */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2 md:px-4 md:py-3">
          <Search className="ml-1 size-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optId(safeActive) : undefined}
            aria-label={tx('shell.search.label')}
            placeholder={tx('shell.search.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-12 min-w-0 flex-1 bg-transparent text-[17px] font-medium text-text placeholder:font-normal placeholder:text-subtle focus:outline-none md:text-[18px]"
          />
          {q && (
            <button type="button" onClick={() => (setQ(''), input.current?.focus())} aria-label={tx('shell.search.clear')} className="fx-press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2">
              <X className="size-[18px]" aria-hidden />
            </button>
          )}
          <button type="button" onClick={onClose} className="fx-press min-h-11 shrink-0 rounded-full px-3 text-[15px] font-semibold text-primary hover:bg-primary-soft md:hidden">
            {tx('common.cancel')}
          </button>
          <kbd className="hidden shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted md:inline">Esc</kbd>
        </div>

        {/* results */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 md:pb-2">
          <div role="listbox" id={listId} aria-label={tx('shell.search.results')}>
            {groups.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`${listId}-${g.id}`} className="mb-2">
                <div id={`${listId}-${g.id}`} className="flex items-center gap-2 px-3 pb-1.5 pt-2.5 text-eyebrow text-gold-ink">
                  {g.id === 'recent' && <Clock3 className="size-3.5" aria-hidden />}
                  {tx(g.label)}
                </div>
                {g.items.map((r) => {
                  idx++
                  const i = idx
                  const on = i === safeActive
                  return (
                    <div
                      key={r.key}
                      id={optId(i)}
                      role="option"
                      aria-selected={on}
                      onClick={() => choose(r)}
                      onMouseMove={() => active !== i && setActive(i)}
                      className={cn(
                        'relative flex min-h-[54px] cursor-pointer items-center gap-3 rounded-[16px] px-3 py-2 transition-colors',
                        on ? 'bg-primary-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_20%,transparent)]' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="shrink-0">{r.lead}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15.5px] font-semibold text-text">{r.title}</span>
                        {r.sub && <span className="block truncate text-caption text-muted">{r.sub}</span>}
                      </span>
                      {on && <CornerDownLeft className="hidden size-4 shrink-0 text-primary md:block" aria-hidden />}
                    </div>
                  )
                })}
                {g.loading && !g.items.length && (
                  <div aria-hidden className="space-y-1 px-3 py-1">
                    {[0, 1].map((k) => (
                      <div key={k} className="flex min-h-[50px] items-center gap-3">
                        <Skeleton className="size-9 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-1/2" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {anyLoading && <p className="sr-only" role="status">{tx('common.loading')}</p>}
          {empty && (
            <div className="flex flex-col items-center px-6 py-10 text-center" role="status">
              <div className="w-[180px] [&_svg]:h-auto [&_svg]:w-full" aria-hidden>
                <NoResultsArt />
              </div>
              <p className="mt-3 font-display text-[21px] font-semibold">{tx('shell.search.none', { q: q.trim() })}</p>
              <p className="mt-1 max-w-xs text-body text-muted">{tx('shell.search.noneHint')}</p>
            </div>
          )}
        </div>

        {/* keyboard hints (desktop) */}
        <div className="hidden shrink-0 items-center gap-4 border-t border-border/70 px-4 py-2.5 text-[12px] text-muted md:flex">
          <Hint icon={[ArrowUp, ArrowDown]}>{tx('shell.search.kMove')}</Hint>
          <Hint icon={[CornerDownLeft]}>{tx('shell.search.kOpen')}</Hint>
          <span className="ml-auto">{tx('shell.search.kClose')}</span>
        </div>
      </m.div>
    </div>,
    document.body,
  )
}

function Hint({ icon, children }: { icon: LucideIcon[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon.map((I, k) => (
        <kbd key={k} className="grid size-5 place-items-center rounded-md border border-border bg-surface-2">
          <I className="size-3" aria-hidden />
        </kbd>
      ))}
      {children}
    </span>
  )
}

