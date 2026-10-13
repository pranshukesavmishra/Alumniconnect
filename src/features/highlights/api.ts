// Home "today" strip: one round trip (home_highlights()).
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { clockOffset } from './countdown'

export type ProfileStep = 'photo' | 'role' | 'about' | 'skills' | 'help' | 'linkedin'

export interface HomeHighlights {
  me: { grad_year: number | null; join_year: number | null; branch: string | null; city: string | null; verified: boolean }
  /** null when the batch year is unknown or in the future (students) */
  batch_anniversary: { grad_year: number; years: number; milestone: boolean; join_year: number | null; years_since_join: number | null } | null
  new_batchmates_week: { count: number; people: { id: string; full_name: string; avatar_url: string | null; branch: string | null; joined_at: string }[] }
  upcoming_events: {
    event_id: string
    slug: string
    title: string
    starts_at: string | null
    ends_at: string | null
    venue: string | null
    cover_url: string | null
    registration_status: 'pending_payment' | 'under_review' | 'confirmed'
    /** calendar days in India time; 0 = today; null when the date is not set */
    days_left: number | null
  }[]
  unread: { notifications: number; chats: number }
  profile: { percent: number; missing: ProfileStep[]; has_social: boolean }
  pending_connection_requests: number
  nearby_in_my_city: number
  server_now: string
}

export interface HomeHighlightsResult extends HomeHighlights {
  /** server clock minus device clock in ms: pass to countdown() */
  clock_offset_ms: number
}

export const homeHighlightsKey = (uid: string | null) => ['home-highlights', uid] as const

export function useHomeHighlights() {
  const uid = useUserId()
  return useQuery({
    queryKey: homeHighlightsKey(uid),
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<HomeHighlightsResult> => {
      const sent = Date.now()
      const { data, error } = await supabase.rpc('home_highlights')
      if (error) throw error
      const h = data as HomeHighlights
      return { ...h, clock_offset_ms: clockOffset(h.server_now, sent, Date.now()) }
    },
  })
}
