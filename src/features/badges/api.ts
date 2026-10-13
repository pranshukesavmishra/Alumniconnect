// Achievements: one call returns every badge of a member with progress. Computed by the database, never written.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { shownBadges, type BadgeState, type ShownBadge } from './catalog'

export interface MemberAchievements {
  user_id: string
  badges: BadgeState[]
}

export const achievementsKey = (userId: string | null | undefined) => ['achievements', userId ?? null] as const

/**
 * Badges of a member (yourself or another verified member). Resolves to null when the member is blocked (either way) or not
 * verified. An unverified caller asking about someone else gets an error (42501).
 */
export function useMemberAchievements(userId: string | null | undefined) {
  return useQuery({
    queryKey: achievementsKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MemberAchievements | null> => {
      const { data, error } = await supabase.rpc('member_achievements', { p_user: userId })
      if (error) throw error
      return (data as MemberAchievements | null) ?? null
    },
  })
}

/** The same, joined with the catalogue (icons, tiers, titles), in catalogue order. */
export function useShownBadges(userId: string | null | undefined): { badges: ShownBadge[]; isLoading: boolean; error: unknown } {
  const q = useMemberAchievements(userId)
  return { badges: shownBadges(q.data?.badges), isLoading: q.isLoading, error: q.error }
}
