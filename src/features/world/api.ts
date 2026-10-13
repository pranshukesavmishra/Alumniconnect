// JEC World data: alumni by city for the globe (members), a coarser public version (landing page), and the drill-down list.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { MemberWorldPlace, PublicWorldPlace } from './geo'

export interface WorldMember {
  user_id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  headline: string | null
  current_title: string | null
  current_company: string | null
  city: string | null
  country: string | null
  same_batch: boolean
  /** total members in the place (for "Showing 50 of 120") */
  total: number
}

export const WORLD_PAGE = 50

/** Verified members only (42501 otherwise). Members who hid themselves from the map are not counted. */
export function useAlumniWorld(enabled = true) {
  return useQuery({
    queryKey: ['alumni-world', 'members'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('alumni_world')
      if (error) throw error
      return (data ?? []) as MemberWorldPlace[]
    },
  })
}

/** Anyone (signed out too): places with 3+ alumni, counts are lower bounds. */
export function usePublicAlumniWorld(enabled = true) {
  return useQuery({
    queryKey: ['alumni-world', 'public'],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('public_alumni_world')
      if (error) throw error
      return (data ?? []) as PublicWorldPlace[]
    },
  })
}

/** The members of one place: a city (cityId) or "somewhere in <country>" (cityId null + countryCode). Paged by 50. */
export function useAlumniWorldPlace(place: { cityId: number | null; countryCode: string | null } | null) {
  return useInfiniteQuery({
    queryKey: ['alumni-world', 'place', place?.cityId ?? null, place?.countryCode ?? null],
    enabled: !!place && (place.cityId !== null || !!place.countryCode),
    staleTime: 5 * 60_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('alumni_world_city', {
        p_city_id: place?.cityId ?? null,
        p_country_code: place?.cityId ? null : (place?.countryCode ?? null),
        p_limit: WORLD_PAGE,
        p_offset: pageParam,
      })
      if (error) throw error
      return (data ?? []) as WorldMember[]
    },
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.length, 0)
      const total = last[0]?.total ?? 0
      return last.length === WORLD_PAGE && loaded < total ? loaded : undefined
    },
  })
}
