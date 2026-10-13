import { shortBranch } from '../../lib/constants'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, GraduationCap, HandHeart, LayoutGrid, List, MapPin, Search, ShieldAlert, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState, Notice } from '../../components/ui/Display'
import { Skeleton } from '../../components/ui/Skeleton'
import { IconTile } from '../../components/ui/IconTile'
import { NoResultsArt } from '../../components/ui/Illustrations'
import { Sheet } from '../../components/ui/Sheet'
import { Tabs } from '../../components/ui/Tabs'
import { Input } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { cn } from '../../lib/cn'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useT } from '../../i18n'
import { MemberGridCard, MemberRow, useMyConnectionStates } from './MemberCard'

const PAGE = 30
const VIEW_KEY = 'jec-people-view'

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function readView(): 'list' | 'grid' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

/** A filter pill: shows its value when set, with a clear (x) button. */
function FilterChip({ icon, label, value, onOpen, onClear, pressed }: { icon: ReactNode; label: string; value?: string | null; onOpen: () => void; onClear?: () => void; pressed?: boolean }) {
  const tx = useT()
  const on = !!value || pressed
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border transition-colors', on ? 'border-transparent bg-primary text-on-primary shadow-[0_6px_14px_-8px_var(--primary-glow)]' : 'border-border bg-surface text-text')}>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={onClear ? undefined : !!pressed}
        className={cn('fx-press inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-semibold [&_svg]:size-4', on && onClear ? 'pl-3.5 pr-1' : 'px-3.5')}
      >
        {icon}
        {value || label}
        {onClear && !value && <ChevronDown className="opacity-60" aria-hidden />}
      </button>
      {value && onClear && (
        <button type="button" onClick={onClear} aria-label={tx('dir.clearFilter', { name: label })} className="grid size-11 place-items-center rounded-full">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
  )
}

type SheetKind = 'batch' | 'branch' | 'city' | 'company' | null

export function DirectoryPage() {
  const tx = useT()
  const uid = useUserId()
  const { data: me } = useMyProfile()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const branch = params.get('branch') ?? ''
  const year = params.get('year') ?? ''
  const city = params.get('city') ?? ''
  const company = params.get('company') ?? ''
  const help = params.get('help') ?? ''
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [draft, setDraft] = useState('')
  const [view, setViewState] = useState<'list' | 'grid'>(readView)
  const setView = (v: 'list' | 'grid') => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode */
    }
  }
  const dq = useDebounced(q)
  const { data: states } = useMyConnectionStates()

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (dq) next.set('q', dq)
    else next.delete('q')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the debounced text changes
  }, [dq])

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  // city / company are matched by the server's text search when there is no typed query, then narrowed here
  const serverQ = dq || city || company || null
  const query = useInfiniteQuery({
    queryKey: ['directory', serverQ, branch, year],
    enabled: me?.verification === 'verified' || !!me?.is_admin,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_members', {
        q: serverQ,
        p_branch: branch || null,
        p_year_from: year ? Number(year) : null,
        p_year_to: year ? Number(year) : null,
        p_limit: PAGE,
        p_offset: pageParam,
      })
      if (error) throw error
      return data as Profile[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })

  const all = query.data?.pages.flat()
  const people = useMemo(() => {
    const has = (v: string | null | undefined, needle: string) => (v ?? '').toLowerCase().includes(needle.toLowerCase())
    return (all ?? []).filter(
      (p) =>
        (!city || has(p.city, city)) &&
        (!company || has(p.current_company, company)) &&
        (!help || (help === 'refer' ? p.help_tags.includes('Referrals') : p.help_tags.length > 0)),
    )
  }, [all, city, company, help])

  // section headers: A–Z inside one batch, otherwise by batch (only when browsing, not for a typed search)
  const sections = useMemo(() => {
    if (dq) return [{ key: '', title: '', items: people }]
    const byYear = !year
    const sorted = [...people].sort((a, b) =>
      byYear ? (b.grad_year ?? 0) - (a.grad_year ?? 0) || a.full_name.localeCompare(b.full_name) : a.full_name.localeCompare(b.full_name),
    )
    const out: { key: string; title: string; items: Profile[] }[] = []
    for (const p of sorted) {
      const key = byYear ? String(p.grad_year ?? '') : (p.full_name.trim()[0] ?? '#').toUpperCase()
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(p)
      else out.push({ key, title: byYear ? (p.grad_year ? tx('pp.classOf', { year: p.grad_year }) : tx('dir.noBatch')) : key, items: [p] })
    }
    return out
  }, [people, dq, year, tx])

  const verified = me?.verification === 'verified' || me?.is_admin
  const activeCount = [branch, year, city, company, help].filter(Boolean).length

  const openText = (k: 'city' | 'company') => {
    setDraft(k === 'city' ? city : company)
    setSheet(k)
  }

  return (
    <div>
      <PageHeader title={tx('dir.title')} subtitle={tx('dir.subtitle')} />
      <Page className="space-y-4">
        {!verified ? (
          <EmptyState icon={<ShieldAlert />} title="The directory is for verified members">
            You’ll be verified automatically once your Alumni Meet payment is confirmed. Admins can also verify you.
          </EmptyState>
        ) : (
          <>
            <div className="fx-liquid sticky top-[calc(4.25rem+env(safe-area-inset-top))] z-10 -mx-2 space-y-2 rounded-[28px] p-2" data-testid="people-filters">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    type="search"
                    aria-label="Search people"
                    placeholder={tx('dir.searchPh')}
                    className="rounded-full border-transparent bg-surface/80 pl-11 shadow-none"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    enterKeyHint="search"
                  />
                </div>
                <Tabs
                  label={tx('dir.view')}
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'list', label: <span className="sr-only">{tx('dir.list')}</span>, icon: <List aria-hidden /> },
                    { value: 'grid', label: <span className="sr-only">{tx('dir.grid')}</span>, icon: <LayoutGrid aria-hidden /> },
                  ]}
                  className="shrink-0 [&_button]:px-3"
                />
              </div>
              <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={tx('dir.filters')}>
                {me?.grad_year && (
                  <FilterChip
                    icon={<Sparkles />}
                    label={tx('dir.myBatch')}
                    pressed={year === String(me.grad_year)}
                    onOpen={() => setFilter('year', year === String(me.grad_year) ? '' : String(me.grad_year))}
                  />
                )}
                <FilterChip icon={<GraduationCap />} label={tx('dir.batch')} value={year ? tx('common.batch', { year }) : null} onOpen={() => setSheet('batch')} onClear={() => setFilter('year', '')} />
                <FilterChip icon={<Sparkles />} label={tx('dir.branch')} value={branch ? shortBranch(branch) : null} onOpen={() => setSheet('branch')} onClear={() => setFilter('branch', '')} />
                <FilterChip icon={<MapPin />} label={tx('dir.city')} value={city || null} onOpen={() => openText('city')} onClear={() => setFilter('city', '')} />
                <FilterChip icon={<Building2 />} label={tx('dir.company')} value={company || null} onOpen={() => openText('company')} onClear={() => setFilter('company', '')} />
                <FilterChip icon={<HandHeart />} label={tx('dir.openToHelp')} pressed={help === 'any'} onOpen={() => setFilter('help', help === 'any' ? '' : 'any')} />
                <FilterChip icon={<Sparkles />} label={tx('dir.refers')} pressed={help === 'refer'} onOpen={() => setFilter('help', help === 'refer' ? '' : 'refer')} />
              </div>
            </div>

            <Link to="/nearby" className="fx-press fx-lift group relative flex min-h-16 items-center gap-3.5 overflow-hidden rounded-3xl border border-border/80 bg-surface p-3.5 shadow-card">
              <div aria-hidden className="fx-dots absolute inset-y-0 right-0 w-1/2 opacity-60" />
              <IconTile icon={MapPin} tone="teal" variant="solid" />
              <span className="relative min-w-0 flex-1">
                <span className="block font-semibold">{tx('nearby.entry')}</span>
                <span className="text-caption block text-muted">{tx('nearby.entryHint')}</span>
              </span>
              <ChevronRight className="relative size-5 text-subtle" aria-hidden />
            </Link>

            {query.error && <Notice tone="danger" title={friendlyError(query.error)} />}

            {!query.isLoading && people.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-caption font-semibold text-muted" aria-live="polite" data-testid="people-count">
                  {tx('dir.count', { count: people.length, more: query.hasNextPage ? '+' : '' })}
                </p>
                {activeCount > 0 && (
                  <button type="button" className="min-h-11 px-2 text-sm font-semibold text-primary" onClick={() => setParams(dq ? { q: dq } : {}, { replace: true })}>
                    {tx('dir.clearAll')}
                  </button>
                )}
              </div>
            )}

            {query.isLoading ? (
              view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-64 rounded-3xl" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-20 rounded-3xl" />
                  ))}
                </div>
              )
            ) : people.length === 0 ? (
              <EmptyState illustration={<NoResultsArt />} title="No one found">
                Try a different spelling or fewer filters.
              </EmptyState>
            ) : (
              <div className="space-y-5">
                {sections.map((s) => (
                  <section key={s.key || 'all'} aria-label={s.title || undefined}>
                    {s.title && (
                      <h2 className="text-eyebrow mb-2 flex items-center gap-2 px-1 font-sans text-gold-ink">
                        {s.title}
                        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
                      </h2>
                    )}
                    {view === 'grid' ? (
                      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {s.items.map((p) => (
                          <li key={p.id}>
                            <MemberGridCard p={p} state={states?.get(p.id) ?? 'none'} isMe={p.id === uid} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-card">
                        {s.items.map((p) => (
                          <MemberRow key={p.id} p={p} state={states?.get(p.id) ?? 'none'} isMe={p.id === uid} />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
            {query.hasNextPage && (
              <Button variant="secondary" block loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                Show more
              </Button>
            )}
          </>
        )}
      </Page>

      <Sheet open={sheet === 'batch'} onClose={() => setSheet(null)} label={tx('dir.pickBatch')}>
        <div className="px-5 pb-4">
          <h2 className="text-h2 mb-1">{tx('dir.pickBatch')}</h2>
          <p className="text-caption mb-4 text-muted">{tx('dir.pickBatchHint')}</p>
          <div className="max-h-[50dvh] space-y-4 overflow-y-auto">
            {Array.from(new Set(yearRange(1960, CURRENT_YEAR + 5).map((y) => Math.floor(y / 10) * 10))).map((decade) => (
              <div key={decade}>
                <p className="text-eyebrow mb-2 text-gold-ink">{tx('dir.decade', { decade })}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {yearRange(Math.max(1960, decade), Math.min(CURRENT_YEAR + 5, decade + 9))
                    .reverse()
                    .map((y) => (
                      <button
                        key={y}
                        type="button"
                        aria-pressed={year === String(y)}
                        onClick={() => {
                          setFilter('year', year === String(y) ? '' : String(y))
                          setSheet(null)
                        }}
                        className={cn(
                          'fx-press min-h-11 rounded-xl text-sm font-semibold tabular-nums',
                          year === String(y) ? 'bg-primary text-on-primary' : y === me?.grad_year ? 'bg-accent-soft text-gold-ink' : 'bg-surface-2 hover:bg-surface-3',
                        )}
                      >
                        {y}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'branch'} onClose={() => setSheet(null)} label={tx('dir.pickBranch')}>
        <div className="px-5 pb-4">
          <h2 className="text-h2 mb-3">{tx('dir.pickBranch')}</h2>
          <ul className="max-h-[55dvh] space-y-1 overflow-y-auto">
            {BRANCHES.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  aria-pressed={branch === b}
                  onClick={() => {
                    setFilter('branch', branch === b ? '' : b)
                    setSheet(null)
                  }}
                  className={cn('fx-press flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium', branch === b ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-[11px] font-bold text-muted">{(shortBranch(b) ?? b).slice(0, 4)}</span>
                  <span className="min-w-0 flex-1">{b}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>

      <Sheet open={sheet === 'city' || sheet === 'company'} onClose={() => setSheet(null)} label={sheet === 'company' ? tx('dir.company') : tx('dir.city')}>
        <form
          className="space-y-4 px-5 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (sheet) setFilter(sheet, draft.trim())
            setSheet(null)
          }}
        >
          <h2 className="text-h2">{sheet === 'company' ? tx('dir.company') : tx('dir.city')}</h2>
          <Input
            aria-label={sheet === 'company' ? tx('dir.company') : tx('dir.city')}
            placeholder={sheet === 'company' ? tx('dir.companyPh') : tx('dir.cityPh')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" block>
            {tx('dir.apply')}
          </Button>
        </form>
      </Sheet>
    </div>
  )
}
