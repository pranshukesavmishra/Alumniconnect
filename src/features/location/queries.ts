import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { profileKey, useUserId } from '../auth/AuthProvider'
import { getPosition, type NearbyRow } from './geo'

export interface MyLocation {
  sharing: boolean
  update_profile: boolean
  prompt_dismissed: boolean
  city: string | null
  region: string | null
  country: string | null
  lat: number | null
  lng: number | null
  updated_at: string | null
  history: { action: string; at: string }[]
}

export const myLocationKey = (uid: string | null) => ['my-location', uid] as const

export function useMyLocation() {
  const uid = useUserId()
  return useQuery({
    queryKey: myLocationKey(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_location')
      if (error) throw error
      return data as MyLocation
    },
  })
}

/** Actions that change the member's own sharing; each updates the cached state from the server's answer. */
export function useLocationActions() {
  const uid = useUserId()
  const qc = useQueryClient()
  const apply = useCallback(
    (data: unknown) => {
      qc.setQueryData(myLocationKey(uid), data as MyLocation)
      void qc.invalidateQueries({ queryKey: ['nearby'] })
      void qc.invalidateQueries({ queryKey: profileKey(uid) })
    },
    [qc, uid],
  )

  /** Ask the browser first: if location is refused nothing is turned on or stored. */
  const enable = useCallback(
    async (updateProfile: boolean) => {
      const pos = await getPosition()
      const on = await supabase.rpc('set_location_sharing', { p_on: true, p_update_profile: updateProfile })
      if (on.error) throw on.error
      apply(on.data)
      const { data, error } = await supabase.rpc('set_my_location', { p_lat: pos.lat, p_lng: pos.lng })
      if (error) throw error
      apply(data)
      return data as MyLocation
    },
    [apply],
  )

  const refresh = useCallback(async () => {
    const pos = await getPosition()
    const { data, error } = await supabase.rpc('set_my_location', { p_lat: pos.lat, p_lng: pos.lng })
    if (error) throw error
    apply(data)
    return data as MyLocation
  }, [apply])

  const setUpdateProfile = useCallback(
    async (on: boolean) => {
      const { data, error } = await supabase.rpc('set_location_sharing', { p_on: true, p_update_profile: on })
      if (error) throw error
      apply(data)
    },
    [apply],
  )

  const turnOff = useCallback(async () => {
    const { data, error } = await supabase.rpc('clear_my_location')
    if (error) throw error
    apply(data)
  }, [apply])

  const dismissPrompt = useCallback(async () => {
    const { error } = await supabase.rpc('dismiss_location_prompt')
    if (error) throw error
    qc.setQueryData<MyLocation>(myLocationKey(uid), (d) => (d ? { ...d, prompt_dismissed: true } : d))
  }, [qc, uid])

  return { enable, refresh, setUpdateProfile, turnOff, dismissPrompt }
}

export interface CitySuggestion {
  id: number
  name: string
  region: string | null
  country: string
  population: number
}

export function cityLabel(c: Pick<CitySuggestion, 'name' | 'region' | 'country'>): string {
  return [c.name, c.region, c.country].filter(Boolean).join(', ')
}

export function useCitySuggestions(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['city-suggest', q.toLowerCase()],
    enabled: q.length >= 2,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_cities', { p_query: q, p_limit: 8 })
      if (error) throw error
      return data as CitySuggestion[]
    },
  })
}

export interface NearbyFilters {
  cityId: number | null
  scope: 'all' | 'batch' | 'branch' | 'range'
  yearFrom: number | null
  yearTo: number | null
  query: string
  mentors: boolean
  helpers: boolean
}

export function useNearby(f: NearbyFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['nearby', f],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nearby_members', {
        p_city_id: f.cityId,
        p_scope: f.scope === 'range' ? 'all' : f.scope,
        p_year_from: f.scope === 'range' ? f.yearFrom : null,
        p_year_to: f.scope === 'range' ? f.yearTo : null,
        p_query: f.query.trim() || null,
        p_mentors: f.mentors,
        p_helpers: f.helpers,
        p_radius_km: 100,
        p_limit: 100,
      })
      if (error) throw error
      return data as NearbyRow[]
    },
  })
}
