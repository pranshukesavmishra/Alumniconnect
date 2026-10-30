import { ChevronRight, Globe2, List, MapPin, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Badge, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { Input, Switch } from '../../components/ui/Form'
import { NoResultsArt } from '../../components/ui/Illustrations'
import { NumberTicker, useInViewOnce } from '../../components/ui/Motion'
import { Sheet } from '../../components/ui/Sheet'
import { SkeletonList } from '../../components/ui/Skeleton'
import { Tabs } from '../../components/ui/Tabs'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { friendlyError } from '../../lib/errors'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { useSetShowcasePrefs, useShowcasePrefs } from '../idcard/api'
import { useAlumniWorld, useAlumniWorldPlace, usePublicAlumniWorld } from './api'
import { countLabel, placeKey, worldTotals } from './geo'
import { Globe } from './Globe'
import { groupByCountry, matchesPlace, placeName, toGlobePoints, type AnyPlace } from './places'

interface Selected {
  key: string
  cityId: number | null
  countryCode: string | null
  name: string
  lat: number
  lng: number
}

/** /world: the members' globe. Visitors are sent to the landing page's globe; members not yet verified see the public version. */
export function WorldPage() {
  const { session, loading } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  if (loading || (session && isLoading)) return <PageSkeleton />
  if (!session) return <Navigate to="/#world" replace />
  if (profile && !profile.onboarded) return <Navigate to="/welcome?next=%2Fworld" replace />
  const verified = profile?.verification === 'verified' || !!profile?.is_admin
  return <World verified={verified} />
}

function World({ verified }: { verified: boolean }) {
  const tx = useT()
  const members = useAlumniWorld(verified)
  const visitors = usePublicAlumniWorld(!verified)
  const q = verified ? members : visitors
  const places: AnyPlace[] = useMemo(() => (q.data ?? []) as AnyPlace[], [q.data])
  const [view, setView] = useState<'globe' | 'list'>('globe')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Selected | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null)

  const nameOf = (p: AnyPlace) => (p.place_precision === 'country' ? tx('world.somewhereIn', { country: p.country }) : placeName(p))
  const points = useMemo(() => toGlobePoints(places, (n, place) => tx('world.inPlace', { n, place })), [places, tx])
  const totals = worldTotals(places)
  const filtered = places.filter((p) => matchesPlace(p, query))

  const choose = (p: AnyPlace) => {
    setFocus({ lat: p.lat, lng: p.lng })
    if (!verified) return
    setSelected({
      key: placeKey(p),
      cityId: p.place_precision === 'city' ? (p.city_id ?? null) : null,
      countryCode: p.country_code,
      name: nameOf(p),
      lat: p.lat,
      lng: p.lng,
    })
  }
  const chooseKey = (key: string) => {
    const p = places.find((x) => placeKey(x) === key)
    if (p) choose(p)
  }

  return (
    <div data-theme="dark" className="relative isolate min-h-[calc(100dvh-3rem)] overflow-hidden bg-[#041a14] text-white md:min-h-dvh">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_50%_30%,rgb(31_145_106/0.32),transparent_70%),radial-gradient(40%_30%_at_90%_0%,rgb(228_173_69/0.18),transparent_70%)]" />
      <div aria-hidden className="fx-dots fx-dots-light absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-4 pb-6 pt-[calc(env(safe-area-inset-top)+1rem)] md:px-8 md:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow text-accent">{tx('world.title')}</p>
            <h1 className="text-display mt-1 text-white">{tx('landing.worldTitle')}</h1>
          </div>
          <Tabs
            label={tx('world.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'globe', label: tx('world.viewGlobe'), icon: <Globe2 aria-hidden /> },
              { value: 'list', label: tx('world.viewList'), icon: <List aria-hidden /> },
            ]}
          />
        </header>
        <dl className="mt-5 grid grid-cols-3 gap-2 sm:max-w-md" data-testid="world-totals">
          {(
            [
              ['world.alumni', totals.alumni],
              ['world.cities', totals.cities],
              ['world.countries', totals.countries],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="fx-liquid-dark rounded-[20px] px-3 py-3">
              <dt className="text-[12.5px] text-white/65">{tx(k)}</dt>
              <dd className="text-stat mt-1 text-[26px] leading-none">{q.isLoading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-white/10" /> : <NumberTicker value={n} />}</dd>
            </div>
          ))}
        </dl>

        {!verified && (
          <Notice tone="info" className="mt-4 border-white/10 bg-white/5 text-white [&_.text-muted]:text-white/70" title={tx('world.unverified')}>
            {tx('world.unverifiedBody')}
          </Notice>
        )}
        {q.error && <Notice tone="danger" className="mt-4" title={tx('world.error')}>{friendlyError(q.error)}</Notice>}

        <div className={cn('mt-4 grid gap-6', view === 'globe' && 'lg:grid-cols-[1fr_380px] lg:items-start')}>
          {view === 'globe' && (
            <div className="relative mx-auto w-full max-w-[620px]">
              {q.isLoading ? (
                <div aria-hidden className="aspect-square w-full animate-pulse rounded-full bg-[radial-gradient(circle,rgb(31_145_106/0.25),transparent_65%)]" />
              ) : (
                <Globe
                  points={points}
                  labels={7}
                  focus={focus}
                  selectedKey={selected?.key ?? null}
                  onSelect={chooseKey}
                  ariaLabel={tx('world.globeAria')}
                  fallback={<p className="py-10 text-center text-white/70">{tx('world.tapHint')}</p>}
                />
              )}
              <p className="text-center text-xs text-white/55">{tx('world.tapHint')}</p>
            </div>
          )}

          <aside className={cn('rounded-[28px] p-4 sm:p-5', view === 'globe' ? 'fx-liquid-dark -mx-1 lg:sticky lg:top-6' : 'bg-transparent p-0 sm:p-0')}>
            {view === 'globe' && <span aria-hidden className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-white/25 lg:hidden" />}
            <label className="sr-only" htmlFor="world-search">
              {tx('world.search')}
            </label>
            <Input
              id="world-search"
              type="search"
              placeholder={tx('world.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leading={<Search className="size-5" aria-hidden />}
            />
            {q.isLoading ? (
              <SkeletonList rows={5} className="mt-3" />
            ) : !places.length ? (
              <EmptyState compact title={tx('world.empty')}>{tx('world.emptyBody')}</EmptyState>
            ) : !filtered.length ? (
              <EmptyState compact illustration={<NoResultsArt />} title={tx('world.noMatch', { q: query.trim() })} />
            ) : view === 'globe' ? (
              <>
                <h2 className="mt-5 px-1 text-[13px] font-bold uppercase tracking-[0.12em] text-white/60">{tx('world.topCities')}</h2>
                <ul className="mt-2 max-h-[420px] space-y-1 overflow-y-auto pr-1" data-testid="world-places">
                  {filtered.slice(0, 40).map((p) => (
                    <li key={placeKey(p)}>
                      <PlaceRow place={p} name={nameOf(p)} active={selected?.key === placeKey(p)} onClick={() => choose(p)} interactive={verified} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="mt-5 space-y-5" data-testid="world-places">
                {groupByCountry(filtered).map((g) => (
                  <section key={g.code} aria-labelledby={`c-${g.code}`} className="fx-liquid-dark rounded-[24px] p-3">
                    <div className="flex items-baseline justify-between gap-3 px-2 pb-1 pt-1">
                      <h2 id={`c-${g.code}`} className="font-display text-[20px] font-semibold">{g.country}</h2>
                      <span className="text-sm tabular-nums text-white/65">{g.total.toLocaleString('en-IN')}</span>
                    </div>
                    <ul className="space-y-1">
                      {g.places.map((p) => (
                        <li key={placeKey(p)}>
                          <PlaceRow place={p} name={nameOf(p)} active={selected?.key === placeKey(p)} onClick={() => choose(p)} interactive={verified} hideCountry />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {verified && <PrivacyToggle />}
          </aside>
        </div>
      </div>
      <PlaceSheet selected={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function PlaceRow({ place, name, active, onClick, interactive, hideCountry }: { place: AnyPlace; name: string; active: boolean; onClick: () => void; interactive: boolean; hideCountry?: boolean }) {
  const inner = (
    <>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', active ? 'bg-(image:--grad-gold) text-[#2b1a05]' : 'bg-white/8 text-accent')}>
        <MapPin className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-tight">{name}</span>
        {!hideCountry && place.place_precision === 'city' && <span className="block text-[13px] text-white/60">{place.country}</span>}
      </span>
      <span className="text-stat shrink-0 text-[18px] tabular-nums">{countLabel(place)}</span>
      {interactive && <ChevronRight className="size-4 shrink-0 text-white/40" aria-hidden />}
    </>
  )
  const cls = cn('flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left', active ? 'bg-white/10' : 'hover:bg-white/5')
  if (!interactive)
    return (
      <div className={cls} onClick={onClick}>
        {inner}
      </div>
    )
  return (
    <button type="button" className={cn('fx-press', cls)} onClick={onClick}>
      {inner}
    </button>
  )
}

function PlaceSheet({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  const tx = useT()
  const q = useAlumniWorldPlace(selected ? { cityId: selected.cityId, countryCode: selected.countryCode } : null)
  const people = q.data?.pages.flat() ?? []
  const total = people[0]?.total ?? 0
  const [more, seen] = useInViewOnce<HTMLDivElement>('200px')
  useEffect(() => {
    if (seen && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
  }, [seen, q])
  return (
    <Sheet open={!!selected} onClose={onClose} label={selected ? tx('world.members', { place: selected.name }) : ''}>
      {selected && (
        <div className="px-4 pb-2 pt-4" data-testid="world-members">
          <p className="text-eyebrow text-gold-ink">{tx('world.title')}</p>
          <h2 className="text-h1 mt-1">{selected.name}</h2>
          {!q.isLoading && total > 0 && <p className="mt-1 text-sm text-muted">{tx('world.showing', { shown: people.length, total })}</p>}
          {q.isLoading ? (
            <SkeletonList rows={5} className="mt-3" />
          ) : q.error ? (
            <Notice tone="danger" className="mt-4" title={friendlyError(q.error)} />
          ) : !people.length ? (
            <EmptyState compact title={tx('world.empty')} />
          ) : (
            <ul className="mt-3 divide-y divide-border/70">
              {people.map((p) => (
                <li key={p.user_id}>
                  <Link to={`/people/${p.user_id}`} className="flex min-h-16 items-center gap-3 rounded-2xl px-1 py-2.5 hover:bg-surface-2">
                    <Avatar src={p.avatar_url} name={p.full_name} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{p.full_name}</span>
                        {p.same_batch && <Badge tone="gold">{tx('world.sameBatch')}</Badge>}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {[p.grad_year, p.branch].filter(Boolean).join(' · ')}
                      </span>
                      {(p.current_title || p.headline) && (
                        <span className="block truncate text-sm text-muted">
                          {[p.current_title || p.headline, p.current_company].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <div ref={more} className="pt-3">
              <Button variant="secondary" block loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {tx('world.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

function PrivacyToggle() {
  const tx = useT()
  const { data } = useShowcasePrefs()
  const set = useSetShowcasePrefs()
  const on = data?.show_on_world_map ?? true
  return (
    <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.04] p-4" data-testid="world-privacy">
      <Switch
        checked={on}
        disabled={!data || set.isPending}
        label={tx('world.privacyTitle')}
        hint={tx('world.privacyBody')}
        onChange={(v) =>
          set.mutate(
            { show_on_world_map: v },
            {
              onSuccess: () => toast.success(v ? tx('world.privacyOn') : tx('world.privacyOff')),
              onError: (e) => toast.error(friendlyError(e)),
            },
          )
        }
      />
    </div>
  )
}
