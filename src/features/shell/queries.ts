import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

/**
 * How many notifications are unread: a cheap head-only count for the bell. Lives under the ['notifications', uid]
 * key, so anything that refreshes the notifications list (marking read) refreshes the badge too.
 */
export function useUnreadNotificationCount() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['notifications', uid, 'unread'],
    enabled: !!uid,
    refetchInterval: 60_000,
    staleTime: 20_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  }).data ?? 0
}
