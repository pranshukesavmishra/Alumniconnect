import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ProgrammeItem {
  id: string
  event_id: string
  starts_at: string
  ends_at: string | null
  title: string
  venue: string | null
  details: string | null
}

export interface Announcement {
  id: string
  title: string
  body: string
  pinned: boolean
  created_at: string
}

export function useProgramme(eventId: string | undefined) {
  return useQuery({
    queryKey: ['programme', eventId],
    enabled: !!eventId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_programme').select('*').eq('event_id', eventId!).order('starts_at')
      if (error) throw error
      return data as ProgrammeItem[]
    },
  })
}

/** Announcements are only readable by registered people and the team; others simply get an empty list. */
export function useAnnouncements(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['announcements', eventId],
    enabled: !!eventId && enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_announcements').select('id, title, body, pinned, created_at').eq('event_id', eventId!).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return data as Announcement[]
    },
  })
}

const IST = { timeZone: 'Asia/Kolkata' } as const

/** "2026-12-26T10:30" typed by an organiser is Indian time, whatever timezone their phone is in. */
export function istInputToIso(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? new Date(`${local}:00+05:30`).toISOString() : null
}

export function isoToIstInput(iso: string | null): string {
  if (!iso) return ''
  const p = new Intl.DateTimeFormat('en-CA', { ...IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

export const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', IST).format(new Date(iso))
export const dayHeading = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { ...IST, weekday: 'long', day: 'numeric', month: 'long' })
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit', hour12: true })

/** Group sessions by Indian calendar day, in time order. */
export function groupByDay(items: ProgrammeItem[]): { day: string; heading: string; items: ProgrammeItem[] }[] {
  const out: { day: string; heading: string; items: ProgrammeItem[] }[] = []
  for (const it of [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = dayKey(it.starts_at)
    const last = out[out.length - 1]
    if (last?.day === day) last.items.push(it)
    else out.push({ day, heading: dayHeading(it.starts_at), items: [it] })
  }
  return out
}
