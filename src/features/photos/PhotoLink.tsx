import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { EmptyState, PageSkeleton } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { supabase } from '../../lib/supabase'

/** /photo/:id (notifications and shared links): finds the event of the photo and opens it there. */
export function PhotoLink() {
  const tx = useT()
  const { id = '' } = useParams()
  const q = useQuery({
    queryKey: ['photo-link', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_photos').select('id, event:events(slug)').eq('id', id).maybeSingle()
      if (error) throw error
      return (data as unknown as { id: string; event: { slug: string } | null } | null)?.event?.slug ?? null
    },
  })
  if (q.isLoading) return <PageSkeleton />
  if (!q.data) return <EmptyState title={tx('photos.notFound')}>{tx('photos.notFoundBody')}</EmptyState>
  return <Navigate to={`/events/${q.data}/photos?photo=${id}`} replace />
}
