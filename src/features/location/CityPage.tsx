import { CalendarDays, MapPin, MessageSquare, Plane, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Field, Input, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { dateLocale } from '../../i18n/core'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { shortBranch } from '../../lib/constants'
import { useModerationCaps } from '../admin/queries'
import { useMyProfile } from '../auth/AuthProvider'
import { tripDates, useCityInfo, useCityMeetups, useCityTrips, useMeetupActions, type Meetup } from './trips'

/** "Visiting soon": upcoming trips to a city that this member is allowed to see. */
export function CityTrips({ cityId }: { cityId: number }) {
  const t = useT()
  const { data, isLoading } = useCityTrips(cityId)
  return (
    <section aria-label={t('trips.visiting')}>
      <SectionTitle action={<Link to="/trips" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">{t('trips.manage')}</Link>}>
        {t('trips.visiting')}
      </SectionTitle>
      {isLoading ? (
        <Skeleton className="h-16" />
      ) : !data?.length ? (
        <p className="text-sm text-muted">{t('trips.visitingNone')}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {data.map((trip) => (
            <li key={trip.id} data-testid="city-trip">
              <Link to={trip.mine ? '/trips' : `/people/${trip.user_id}`} className="flex items-center gap-3 p-3.5 hover:bg-surface-2">
                <Avatar src={trip.avatar_url} name={trip.full_name} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{trip.full_name}</p>
                  <p className="truncate text-sm text-muted">{[trip.grad_year ? t('common.batch', { year: trip.grad_year }) : null, shortBranch(trip.branch)].filter(Boolean).join(' · ')}</p>
                  <p className="flex items-center gap-1 text-sm font-medium text-primary">
                    <CalendarDays className="size-4" aria-hidden /> {tripDates(trip.starts_on, trip.ends_on, dateLocale())}
                  </p>
                </div>
                {trip.visibility === 'batch' && <Badge>{t('trips.visBatch')}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StartMeetup({ cityId, cityName, onClose }: { cityId: number; cityName: string; onClose: () => void }) {
  const t = useT()
  const { start } = useMeetupActions(cityId)
  const [name, setName] = useState(`${cityName} meetup`)
  const [when, setWhen] = useState('')
  const [place, setPlace] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      noValidate
      className="space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        const n = name.trim()
        if (n.length < 3 || n.length > 80) return setError(t('meetup.errName'))
        setError(null)
        try {
          await start.mutateAsync({ name: n, when: when.trim(), place: place.trim(), description: desc.trim() })
          toast.success(t('meetup.created'))
          onClose()
        } catch (err) {
          setError(friendlyError(err))
        }
      }}
    >
      <h2 className="text-lg font-bold">{t('meetup.start')}</h2>
      <Field label={t('meetup.name')}>{(p) => <Input {...p} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('meetup.namePh')} />}</Field>
      <Field label={t('meetup.when')} optional>{(p) => <Input {...p} maxLength={80} value={when} onChange={(e) => setWhen(e.target.value)} placeholder={t('meetup.whenPh')} />}</Field>
      <Field label={t('meetup.place')} optional>{(p) => <Input {...p} maxLength={80} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('meetup.placePh')} />}</Field>
      <Field label={t('meetup.desc')} optional>{(p) => <Textarea {...p} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
      <p className="text-sm text-muted">{t('meetup.rules')}</p>
      {error && <Notice tone="danger" title={error} />}
      <div className="flex gap-2">
        <Button type="submit" loading={start.isPending}>{t('meetup.create')}</Button>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </form>
  )
}

function MeetupCard({ m, cityId }: { m: Meetup; cityId: number }) {
  const t = useT()
  const navigate = useNavigate()
  const moderator = useModerationCaps().meetups
  const { join, leave, close, adminSet } = useMeetupActions(cityId)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  return (
    <Card className="space-y-3 p-4" data-testid="meetup-card">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
          <MessageSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="min-w-0 break-words">{m.name}</span>
            {m.status === 'hidden' && <Badge tone="danger">{t('meetup.hidden')}</Badge>}
            {m.status === 'closed' && <Badge>{t('meetup.closedBadge')}</Badge>}
          </p>
          {(m.meet_when || m.place) && <p className="text-sm text-muted">{[m.meet_when, m.place].filter(Boolean).join(' · ')}</p>}
          {m.description && <p className="mt-1 whitespace-pre-line text-[15px]">{m.description}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <span className="inline-flex items-center gap-1"><Users className="size-4" aria-hidden /> {t('meetup.members', { count: m.member_count })}</span>
            {m.creator_name && <span>{t('meetup.by', { name: m.creator_name })}</span>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {m.status === 'active' && !m.joined && (
          <Button size="sm" loading={join.isPending} onClick={() => run(() => join.mutateAsync(m.group_id), t('meetup.joinedToast'))}>
            {t('meetup.join')}
          </Button>
        )}
        {m.joined && m.chat_id && (
          <Button size="sm" icon={<MessageSquare className="size-4" />} onClick={() => navigate(`/chat/${m.chat_id}`)}>
            {t('meetup.open')}
          </Button>
        )}
        {m.joined && !m.is_creator && (
          <Button size="sm" variant="secondary" loading={leave.isPending} onClick={() => run(() => leave.mutateAsync(m.group_id), t('meetup.leftToast'))}>
            {t('meetup.leave')}
          </Button>
        )}
        {m.is_creator && m.status === 'active' && (
          <Button
            size="sm"
            variant="danger-ghost"
            onClick={() => {
              if (window.confirm(t('meetup.confirmClose'))) void run(() => close.mutateAsync(m.group_id), t('meetup.closedToast'))
            }}
          >
            {t('meetup.close')}
          </Button>
        )}
        {moderator && (
          m.status === 'hidden' || m.status === 'closed' ? (
            <Button size="sm" variant="secondary" onClick={() => run(() => adminSet.mutateAsync({ group: m.group_id, status: 'active' }))}>
              {t('meetup.restore')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger-ghost"
              onClick={() => {
                const reason = window.prompt(t('meetup.hideReason'))
                if (reason === null) return
                void run(() => adminSet.mutateAsync({ group: m.group_id, status: 'hidden', reason }))
              }}
            >
              {t('meetup.hide')}
            </Button>
          )
        )}
      </div>
    </Card>
  )
}

export function CityPage() {
  const t = useT()
  const params = useParams()
  const cityId = Number(params.id)
  const { data: me } = useMyProfile()
  const { data: city, isLoading } = useCityInfo(Number.isFinite(cityId) ? cityId : null)
  const { data: meetups, isLoading: meetupsLoading, error } = useCityMeetups(Number.isFinite(cityId) ? cityId : null)
  const [starting, setStarting] = useState(false)
  const verified = me?.verification === 'verified' || !!me?.is_admin

  if (isLoading) return <PageSkeleton />
  if (!city) {
    return (
      <div>
        <PageHeader title={t('city.page')} back="/nearby" />
        <EmptyState icon={<MapPin />} title={t('city.notFound')} />
      </div>
    )
  }
  const label = [city.name, city.region, city.country].filter(Boolean).join(', ')
  return (
    <div>
      <PageHeader title={city.name} subtitle={label} back="/nearby" />
      <Page className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/nearby?city=${city.id}&name=${encodeURIComponent(city.name)}`} icon={<Users className="size-4" />}>
            {t('city.seePeople', { city: city.name })}
          </ButtonLink>
          <ButtonLink to="/trips" variant="secondary" icon={<Plane className="size-4" />}>
            {t('trips.manage')}
          </ButtonLink>
        </div>

        {verified && <CityTrips cityId={city.id} />}

        <section aria-label={t('meetup.title')}>
          <SectionTitle action={verified ? <Button size="sm" onClick={() => setStarting(true)}>{t('meetup.start')}</Button> : undefined}>{t('meetup.title')}</SectionTitle>
          {error && <Notice tone="danger" title={friendlyError(error)} />}
          {meetupsLoading ? (
            <Skeleton className="h-24" />
          ) : !meetups?.length ? (
            <EmptyState icon={<MessageSquare />} title={t('meetup.empty')}>{t('meetup.emptyBody', { city: city.name })}</EmptyState>
          ) : (
            <ul className="space-y-3">
              {meetups.map((m) => (
                <li key={m.group_id}>
                  <MeetupCard m={m} cityId={city.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Page>
      <Sheet open={starting} onClose={() => setStarting(false)} label={t('meetup.start')}>
        {starting && <StartMeetup cityId={city.id} cityName={city.name} onClose={() => setStarting(false)} />}
      </Sheet>
    </div>
  )
}
