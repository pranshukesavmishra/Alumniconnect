import { CalendarDays, Pencil, Plane, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { dateLocale } from '../../i18n/core'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { CityPicker } from './CityPicker'
import { cityLabel, type CitySuggestion } from './queries'
import { todayIst, tripDates, useMyTrips, useTripActions, validateTrip, type Trip, type TripVisibility } from './trips'

function TripForm({ trip, onClose }: { trip: Trip | null; onClose: () => void }) {
  const t = useT()
  const { save } = useTripActions()
  const today = todayIst()
  const [city, setCity] = useState<{ id: number; label: string } | null>(trip ? { id: trip.city_id, label: cityLabel({ name: trip.city, region: trip.region, country: trip.country }) } : null)
  const [starts, setStarts] = useState(trip?.starts_on ?? '')
  const [ends, setEnds] = useState(trip?.ends_on ?? '')
  const [visibility, setVisibility] = useState<TripVisibility>(trip?.visibility ?? 'everyone')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const problem = validateTrip({ cityId: city?.id ?? null, starts, ends }, today, trip?.starts_on ?? null)
    if (problem) return setError(t(problem))
    setError(null)
    try {
      await save.mutateAsync({ id: trip?.id, cityId: city!.id, starts, ends, visibility })
      toast.success(t('trips.saved'))
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <form
      noValidate
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2 className="text-lg font-bold">{trip ? t('trips.edit') : t('trips.add')}</h2>
      <div className="space-y-1.5">
        <span className="block text-sm font-semibold">{t('trips.city')}</span>
        {city && (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft px-3.5 py-2 font-semibold" data-testid="trip-city">
            <span className="min-w-0 truncate">{city.label}</span>
          </p>
        )}
        <CityPicker
          label={t('trips.cityPh')}
          placeholder={t('trips.cityPh')}
          onPick={(c: CitySuggestion) => setCity({ id: c.id, label: cityLabel(c) })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('trips.from')}>
          {(p) => <Input type="date" {...p} min={trip && trip.starts_on < today ? trip.starts_on : today} value={starts} onChange={(e) => setStarts(e.target.value)} />}
        </Field>
        <Field label={t('trips.to')}>
          {(p) => <Input type="date" {...p} min={starts || today} value={ends} onChange={(e) => setEnds(e.target.value)} />}
        </Field>
      </div>
      <ChoiceGroup
        label={t('trips.visibility')}
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: 'everyone', label: t('trips.visEveryone') },
          { value: 'batch', label: t('trips.visBatch') },
        ]}
      />
      {error && <Notice tone="danger" title={error} />}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>
          {t('trips.save')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

export function TripsPage() {
  const t = useT()
  const { data: me } = useMyProfile()
  const { data: trips, isLoading, error } = useMyTrips()
  const { cancel } = useTripActions()
  const [editing, setEditing] = useState<Trip | 'new' | null>(null)
  const verified = me?.verification === 'verified' || !!me?.is_admin

  return (
    <div>
      <PageHeader title={t('trips.title')} subtitle={t('trips.subtitle')} back="/nearby" />
      <Page className="space-y-4">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        <Notice tone="info">{t('trips.rules')}</Notice>
        <Button icon={<Plane className="size-4" />} disabled={!verified} onClick={() => setEditing('new')}>
          {t('trips.add')}
        </Button>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !trips?.length ? (
          <EmptyState icon={<Plane />} title={t('trips.empty')}>{t('trips.emptyBody')}</EmptyState>
        ) : (
          <ul className="space-y-2" aria-label={t('trips.title')}>
            {trips.map((trip) => (
              <li key={trip.id}>
                <Card className="flex items-start gap-3 p-4" data-testid="trip-row">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
                    <CalendarDays className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/city/${trip.city_id}`} className="block truncate font-semibold hover:underline">
                      {cityLabel({ name: trip.city, region: trip.region, country: trip.country })}
                    </Link>
                    <p className="text-sm text-muted">{tripDates(trip.starts_on, trip.ends_on, dateLocale())}</p>
                    <Badge tone={trip.visibility === 'batch' ? 'neutral' : 'primary'} className="mt-1.5">
                      {trip.visibility === 'batch' ? t('trips.visBatch') : t('trips.visEveryone')}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" className="size-11 px-0" aria-label={`${t('trips.edit')}: ${trip.city}`} onClick={() => setEditing(trip)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    className="size-11 px-0"
                    aria-label={`${t('trips.cancel')}: ${trip.city}`}
                    onClick={async () => {
                      if (!window.confirm(t('trips.confirmCancel'))) return
                      try {
                        await cancel.mutateAsync(trip.id)
                        toast.success(t('trips.cancelled'))
                      } catch (e) {
                        toast.error(friendlyError(e))
                      }
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Page>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} label={editing && editing !== 'new' ? t('trips.edit') : t('trips.add')}>
        {editing !== null && <TripForm key={editing === 'new' ? 'new' : editing.id} trip={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  )
}
