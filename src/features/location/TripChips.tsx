import { Plane } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { dateLocale } from '../../i18n/core'
import { tripDates, useProfileTrips } from './trips'

/** Upcoming-trip chips on a profile: only the trips this viewer is allowed to see (the server decides). */
export function TripChips({ userId, isMe }: { userId: string; isMe: boolean }) {
  const t = useT()
  const { data } = useProfileTrips(userId)
  if (!data?.length) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('trips.visiting')} data-testid="trip-chips">
      {data.map((trip) => (
        <li key={trip.id}>
          <Link to={isMe ? '/trips' : `/city/${trip.city_id}`} className="inline-flex">
            <Badge tone="accent" className="min-h-9 gap-1.5 px-3 text-sm">
              <Plane className="size-4" aria-hidden />
              {t('trips.chip', { city: trip.city, dates: tripDates(trip.starts_on, trip.ends_on, dateLocale()) })}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  )
}
