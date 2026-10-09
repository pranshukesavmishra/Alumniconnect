import { List, MapPin, MessageCircle, Search, ShieldAlert, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, EmptyState, Notice, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Checkbox, Input, Select } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { shortBranch, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { useMyProfile } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'
import { LocationPromptCard } from './LocationSharing'
import { clusterByCity, distanceText, locationErrorMessage, splitBatchmates, type NearbyRow } from './geo'
import { cityLabel, useCitySuggestions, useLocationActions, useMyLocation, useNearby, type CitySuggestion, type NearbyFilters } from './queries'

const NearbyMap = lazy(() => import('./NearbyMap'))

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function CityPicker({ onPick }: { onPick: (c: CitySuggestion) => void }) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebounced(text, 250)
  const { data, isFetching } = useCitySuggestions(debounced)
  const list = data ?? []
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open && debounced.length >= 2}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-label={t('nearby.searchCity')}
        placeholder={t('nearby.searchPh')}
        className="pl-11"
        value={text}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault()
            setOpen(false)
            setText('')
            onPick(list[0])
          }
        }}
      />
      {open && debounced.trim().length >= 2 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t('nearby.suggestions')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-border bg-surface shadow-pop"
        >
          {list.length === 0 && !isFetching && <li className="px-4 py-3 text-sm text-muted">{t('nearby.noCity')}</li>}
          {list.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-2"
                onClick={() => {
                  setOpen(false)
                  setText('')
                  onPick(c)
                }}
              >
                <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 truncate">{cityLabel(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonRow({ r, originCity }: { r: NearbyRow; originCity: string | null }) {
  const t = useT()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const role = r.current_title && r.current_company ? `${r.current_title} @ ${r.current_company}` : (r.headline ?? r.current_title ?? r.current_company ?? '')
  return (
    <li className="flex items-center gap-2 p-3.5" data-testid="nearby-row">
      <Link to={`/people/${r.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={r.avatar_url} name={r.full_name} size={48} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            <span className="truncate">{r.full_name}</span>
            {r.is_mentor && <Badge tone="accent">{t('nearby.mentor')}</Badge>}
          </p>
          <p className="truncate text-sm text-muted">{[r.grad_year ? t('common.batch', { year: r.grad_year }) : null, shortBranch(r.branch)].filter(Boolean).join(' · ')}</p>
          {role && <p className="truncate text-sm">{role}</p>}
          <p className="truncate text-sm font-medium text-primary">
            {[r.bucket === 'profile' || r.bucket === 'same_city' ? null : r.city, distanceText(r, t, originCity)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </Link>
      <Button
        variant="secondary"
        size="sm"
        className="size-11 shrink-0 px-0"
        aria-label={t('nearby.messageTo', { name: r.full_name })}
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            navigate(`/chat/${await startDm(r.user_id)}`)
          } catch (e) {
            toast.error(locationErrorMessage(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {!busy && <MessageCircle className="size-4" aria-hidden />}
      </Button>
    </li>
  )
}

export function NearbyPage() {
  const t = useT()
  const { data: me } = useMyProfile()
  const { data: loc, isLoading: locLoading } = useMyLocation()
  const { refresh } = useLocationActions()
  const [params, setParams] = useSearchParams()
  const cityId = params.get('city') ? Number(params.get('city')) : null
  const cityName = params.get('name')
  const view = params.get('view') === 'map' ? 'map' : 'list'
  const [scope, setScope] = useState<NearbyFilters['scope']>('all')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [text, setText] = useState('')
  const dtext = useDebounced(text)
  const [mentors, setMentors] = useState(false)
  const [helpers, setHelpers] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [updating, setUpdating] = useState(false)

  const verified = me?.verification === 'verified' || !!me?.is_admin
  const sharing = !!loc?.sharing
  const filters: NearbyFilters = { cityId, scope, yearFrom: yearFrom ? Number(yearFrom) : null, yearTo: yearTo ? Number(yearTo) : null, query: dtext, mentors, helpers }
  const needsSharing = cityId === null && !sharing
  const q = useNearby(filters, verified && !locLoading && !needsSharing)
  const rows = q.data ?? []
  const { batchmates, others } = useMemo(() => splitBatchmates(rows), [rows])
  const clusters = useMemo(() => clusterByCity(rows), [rows])
  const origin = cityId === null ? (loc?.city ?? null) : cityName
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const shown = selected === null ? null : clusters.find((c) => c.id === selected)

  return (
    <div>
      <PageHeader title={t('nearby.title')} subtitle={t('nearby.subtitle')} back="/people" />
      <Page className="space-y-4">
        {!verified ? (
          <EmptyState icon={<ShieldAlert />} title={t('nearby.verifiedOnly')} />
        ) : (
          <>
            <CityPicker onPick={(c) => setParams({ city: String(c.id), name: c.name, ...(view === 'map' ? { view: 'map' } : {}) }, { replace: true })} />

            {cityId !== null ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-primary-soft px-4 py-2">
                <p className="min-w-0 truncate font-semibold" data-testid="nearby-origin">{t('nearby.showing', { city: cityName ?? '' })}</p>
                <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-primary" onClick={() => setParams(view === 'map' ? { view: 'map' } : {}, { replace: true })}>
                  <X className="size-4" aria-hidden /> {t('nearby.backToMe')}
                </button>
              </div>
            ) : sharing ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-soft px-4 py-2">
                <p className="min-w-0 font-semibold" data-testid="nearby-origin">{t('nearby.showingMe', { city: loc?.city ?? '' })}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updating}
                  onClick={async () => {
                    setUpdating(true)
                    try {
                      await refresh()
                      toast.success(t('loc.updated'))
                    } catch (e) {
                      toast.error(locationErrorMessage(e))
                    } finally {
                      setUpdating(false)
                    }
                  }}
                >
                  {t('loc.updateNow')}
                </Button>
              </div>
            ) : null}

            {needsSharing && (
              <>
                <Notice tone="info" title={t('nearby.turnOnTitle')}>{t('nearby.turnOnBody')}</Notice>
                <LocationPromptCard always />
              </>
            )}

            {!needsSharing && (
              <>
                <div className="grid gap-2 min-[420px]:grid-cols-2">
                  <Select aria-label={t('nearby.filter')} value={scope} onChange={(e) => setScope(e.target.value as NearbyFilters['scope'])}>
                    <option value="all">{t('nearby.scopeAll')}</option>
                    <option value="batch" disabled={!me?.grad_year}>{t('nearby.scopeBatch')}</option>
                    <option value="branch" disabled={!me?.branch}>{t('nearby.scopeBranch')}</option>
                    <option value="range">{t('nearby.scopeRange')}</option>
                  </Select>
                  <Input aria-label={t('nearby.textPh')} placeholder={t('nearby.textPh')} value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                {scope === 'range' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select aria-label={t('nearby.from')} value={yearFrom} onChange={(e) => setYearFrom(e.target.value)}>
                      <option value="">{t('nearby.from')}</option>
                      {yearRange(1960, CURRENT_YEAR + 5).map((y) => <option key={y}>{y}</option>)}
                    </Select>
                    <Select aria-label={t('nearby.to')} value={yearTo} onChange={(e) => setYearTo(e.target.value)}>
                      <option value="">{t('nearby.to')}</option>
                      {yearRange(1960, CURRENT_YEAR + 5).map((y) => <option key={y}>{y}</option>)}
                    </Select>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-5">
                  <Checkbox checked={mentors} onChange={setMentors}>{t('nearby.mentors')}</Checkbox>
                  <Checkbox checked={helpers} onChange={setHelpers}>{t('nearby.helpers')}</Checkbox>
                </div>

                <div role="group" aria-label={`${t('nearby.list')} / ${t('nearby.map')}`} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
                  {(['list', 'map'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold ${view === v ? 'bg-surface shadow-sm' : 'text-muted'}`}
                      onClick={() => setParam('view', v === 'map' ? 'map' : null)}
                    >
                      {v === 'list' ? <List className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
                      {t(v === 'list' ? 'nearby.list' : 'nearby.map')}
                    </button>
                  ))}
                </div>

                {q.error && <Notice tone="danger" title={locationErrorMessage(q.error)} />}
                {q.isLoading ? (
                  <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
                ) : rows.length === 0 && !q.error ? (
                  <EmptyState icon={<MapPin />} title={t('nearby.empty')}>{t('nearby.emptyBody')}</EmptyState>
                ) : view === 'map' ? (
                  <div className="space-y-3">
                    <Suspense fallback={<Skeleton className="h-80" />}>
                      <NearbyMap clusters={clusters} selected={selected} onSelect={setSelected} />
                    </Suspense>
                    <ul className="flex flex-wrap gap-2" aria-label={t('nearby.mapLabel')}>
                      {clusters.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            aria-pressed={selected === c.id}
                            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${selected === c.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface'}`}
                            onClick={() => setSelected(selected === c.id ? null : c.id)}
                          >
                            {c.name} <Badge tone="primary">{c.people.length}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {shown && (
                      <section aria-label={t('nearby.clusterOpen', { city: shown.name })}>
                        <SectionTitle>{t('nearby.clusterOpen', { city: shown.name })} · {t('nearby.clusterPeople', { count: shown.people.length })}</SectionTitle>
                        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                          {shown.people.map((r) => <PersonRow key={r.user_id} r={r} originCity={origin} />)}
                        </ul>
                      </section>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {batchmates.length > 0 && (
                      <section aria-label={t('nearby.batchmates')}>
                        <SectionTitle>{t('nearby.batchmates')}</SectionTitle>
                        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                          {batchmates.map((r) => <PersonRow key={r.user_id} r={r} originCity={origin} />)}
                        </ul>
                      </section>
                    )}
                    {others.length > 0 && (
                      <section aria-label={t('nearby.others')}>
                        {batchmates.length > 0 && <SectionTitle>{t('nearby.others')}</SectionTitle>}
                        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                          {others.map((r) => <PersonRow key={r.user_id} r={r} originCity={origin} />)}
                        </ul>
                      </section>
                    )}
                  </div>
                )}
                <p className="text-center text-xs text-muted">{t('nearby.explainDistance')}</p>
              </>
            )}
          </>
        )}
      </Page>
    </div>
  )
}
