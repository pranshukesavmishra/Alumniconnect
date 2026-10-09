// Trips ("visiting soon") and city meetups: data hooks plus the pure validation the forms use.
// The database enforces the same rules; this only gives friendly messages before a round trip.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MsgKey } from '../../i18n/core'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export const MAX_TRIP_DAYS = 90
export const MAX_UPCOMING_TRIPS = 5

export type TripVisibility = 'everyone' | 'batch'

export interface Trip {
  id: string
  city_id: number
  city: string
  region: string | null
  country: string
  starts_on: string
  ends_on: string
  visibility: TripVisibility
}

export interface CityTrip {
  id: string
  user_id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  current_title: string | null
  current_company: string | null
  starts_on: string
  ends_on: string
  visibility: TripVisibility
  mine: boolean
}

export interface ProfileTrip {
  id: string
  city_id: number
  city: string
  country: string
  starts_on: string
  ends_on: string
}

export interface CityInfo {
  id: number
  name: string
  region: string | null
  country: string
}

export interface Meetup {
  group_id: string
  chat_id: string | null
  name: string
  description: string | null
  meet_when: string | null
  place: string | null
  creator_id: string | null
  creator_name: string | null
  creator_avatar: string | null
  member_count: number
  joined: boolean
  is_creator: boolean
  status: 'active' | 'closed' | 'hidden'
  created_at: string
}

/** Today's date in India (YYYY-MM-DD): trips are dated in the alumni's own calendar. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000)

/** null when valid, otherwise the message key to show. `keepStart`: an edit may keep the start of a trip that already began. */
export function validateTrip(
  v: { cityId: number | null; starts: string; ends: string },
  today: string = todayIst(),
  keepStart: string | null = null,
): MsgKey | null {
  if (!v.cityId) return 'trips.errCity'
  if (!v.starts || !v.ends) return 'trips.errDates'
  if (v.ends < v.starts) return 'trips.errOrder'
  if (v.ends < today || (v.starts < today && v.starts !== keepStart)) return 'trips.errPast'
  if (dayNumber(v.ends) - dayNumber(v.starts) > MAX_TRIP_DAYS) return 'trips.errLong'
  return null
}

/** "12–15 Nov 2026" style text for a trip, in the member's language. */
export function tripDates(starts: string, ends: string, locale: string): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }).format(new Date(`${d}T00:00:00Z`))
  if (starts === ends) return fmt(starts, { day: 'numeric', month: 'short', year: 'numeric' })
  const sameYear = starts.slice(0, 4) === ends.slice(0, 4)
  return `${fmt(starts, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(ends, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export function useMyTrips() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-trips', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_trips')
      if (error) throw error
      return data as Trip[]
    },
  })
}

export function useTripActions() {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-trips'] })
    void qc.invalidateQueries({ queryKey: ['city-trips'] })
    void qc.invalidateQueries({ queryKey: ['profile-trips'] })
  }
  const save = useMutation({
    mutationFn: async (v: { id?: string; cityId: number; starts: string; ends: string; visibility: TripVisibility }) => {
      const { error } = v.id
        ? await supabase.rpc('update_trip', { p_id: v.id, p_city_id: v.cityId, p_starts: v.starts, p_ends: v.ends, p_visibility: v.visibility })
        : await supabase.rpc('add_trip', { p_city_id: v.cityId, p_starts: v.starts, p_ends: v.ends, p_visibility: v.visibility })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('cancel_trip', { p_id: id })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { save, cancel }
}

export function useCityTrips(cityId: number | null) {
  return useQuery({
    queryKey: ['city-trips', cityId],
    enabled: cityId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('city_trips', { p_city_id: cityId })
      if (error) throw error
      return data as CityTrip[]
    },
  })
}

export function useProfileTrips(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile-trips', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('member_trips_of', { p_user: userId })
      if (error) throw error
      return data as ProfileTrip[]
    },
  })
}

export function useCityInfo(cityId: number | null) {
  return useQuery({
    queryKey: ['city-info', cityId],
    enabled: cityId !== null && Number.isFinite(cityId),
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('city_info', { p_city_id: cityId })
      if (error) throw error
      return ((data as CityInfo[])[0] ?? null) as CityInfo | null
    },
  })
}

export function useCityMeetups(cityId: number | null) {
  return useQuery({
    queryKey: ['city-meetups', cityId],
    enabled: cityId !== null && Number.isFinite(cityId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('city_meetups', { p_city_id: cityId })
      if (error) throw error
      return data as Meetup[]
    },
  })
}

export function useMeetupActions(cityId: number | null) {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['city-meetups', cityId] })
    void qc.invalidateQueries({ queryKey: ['chats'] })
  }
  const start = useMutation({
    mutationFn: async (v: { name: string; when: string; place: string; description: string }) => {
      const { data, error } = await supabase.rpc('start_meetup', {
        p_city_id: cityId,
        p_name: v.name,
        p_when: v.when || null,
        p_place: v.place || null,
        p_description: v.description || null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: done,
  })
  const join = useMutation({
    mutationFn: async (group: string) => {
      const { data, error } = await supabase.rpc('join_meetup', { p_group: group })
      if (error) throw error
      return data as string
    },
    onSuccess: done,
  })
  const leave = useMutation({
    mutationFn: async (group: string) => {
      const { error } = await supabase.rpc('leave_meetup', { p_group: group })
      if (error) throw error
    },
    onSuccess: done,
  })
  const close = useMutation({
    mutationFn: async (group: string) => {
      const { error } = await supabase.rpc('close_meetup', { p_group: group })
      if (error) throw error
    },
    onSuccess: done,
  })
  const adminSet = useMutation({
    mutationFn: async (v: { group: string; status: 'active' | 'closed' | 'hidden'; reason?: string }) => {
      const { error } = await supabase.rpc('admin_set_meetup', { p_group: v.group, p_status: v.status, p_reason: v.reason ?? null })
      if (error) throw error
    },
    onSuccess: done,
  })
  return { start, join, leave, close, adminSet }
}
