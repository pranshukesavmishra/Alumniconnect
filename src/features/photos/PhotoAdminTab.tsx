import { Link } from 'react-router'
import { Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import type { EventRow } from '../../lib/types'
import { usePhotoCaps } from './api'
import { PhotoAdminPanel } from './PhotoAdminPanel'
import { useT } from '../../i18n'

/** The "Photos" tab of an event in the admin area: the same management panel as on the photo page. */
export function PhotoAdminTab({ event }: { event: EventRow }) {
  const tx = useT()
  const caps = usePhotoCaps(event.id)
  if (caps.isLoading) return <PageSkeleton />
  if (caps.error || !caps.data) return <Notice tone="danger" title={friendlyError(caps.error)} />
  if (!caps.data.official) return <Notice tone="info" title={tx('photos.verifyTitle')} />
  return (
    <div className="space-y-4">
      <PhotoAdminPanel event={event} caps={caps.data} onView={(s) => window.location.assign(`/events/${event.slug}/photos?view=${s}`)} />
      <p className="text-sm"><Link to={`/events/${event.slug}/photos`} className="font-semibold text-primary">{tx('photos.title')}</Link></p>
    </div>
  )
}
