// The signed-out landing page: aggregated numbers only (no names), safe to show to anyone.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface FlagshipEvent {
  slug: string
  title: string
  starts_at: string | null
  ends_at: string | null
  venue: string | null
}

export interface LandingStats {
  verified_members: number
  /** distinct graduation years among verified members */
  batches: number
  countries: number
  cities: number
  /** distinct current companies */
  companies: number
  /** the Grand Reunion 2026, when it is published */
  flagship: FlagshipEvent | null
  generated_at: string
}

export function usePublicLandingStats() {
  return useQuery({
    queryKey: ['landing-stats'],
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('public_landing_stats')
      if (error) throw error
      return data as LandingStats
    },
  })
}

/**
 * Whether a number is worth showing on the landing page: small numbers look sad ("3 countries"), so the UI can hide a
 * tile below a threshold. Returns the number rounded down for display ("1,200+") above 1000.
 */
export function landingNumber(n: number | null | undefined, min = 10): { show: boolean; value: number; plus: boolean } {
  const v = Math.max(0, Math.floor(n ?? 0))
  if (v >= 1000) return { show: true, value: Math.floor(v / 100) * 100, plus: v % 100 !== 0 }
  return { show: v >= min, value: v, plus: false }
}
