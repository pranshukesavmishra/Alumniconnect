import { useQuery } from '@tanstack/react-query'
import { publicUrl, supabase } from '../../lib/supabase'

export interface PastMeet {
  id: string
  slug: string
  title: string
  title_hi: string | null
  year: number
  held_on: string | null
  venue: string | null
  description: string | null
  description_hi: string | null
  highlights: string | null
  highlights_hi: string | null
  attendance: number | null
  cover_path: string | null
  event_id: string | null
  archive_event: boolean
  members_can_add: boolean
  is_published: boolean
  created_at: string
}

const pick = (lang: string, en: string | null, hi: string | null) => (lang === 'hi' ? hi || en : en || hi) || null

export const meetTitle = (m: Pick<PastMeet, 'title' | 'title_hi'>, lang: string) => pick(lang, m.title, m.title_hi) ?? m.title
export const meetDescription = (m: Pick<PastMeet, 'description' | 'description_hi'>, lang: string) => pick(lang, m.description, m.description_hi)
export const meetHighlights = (m: Pick<PastMeet, 'highlights' | 'highlights_hi'>, lang: string) => pick(lang, m.highlights, m.highlights_hi)
export const meetCover = (m: Pick<PastMeet, 'cover_path'>) => publicUrl('gallery', m.cover_path) ?? null

/** Newest year first; within a year, the later date first, then the title. */
export function sortMeets<T extends Pick<PastMeet, 'year' | 'held_on' | 'title'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.year - a.year || (b.held_on ?? '').localeCompare(a.held_on ?? '') || a.title.localeCompare(b.title))
}

/** The meets grouped by year, newest first: [[2025, [...]], [2024, [...]]]. */
export function groupByYear<T extends Pick<PastMeet, 'year' | 'held_on' | 'title'>>(list: readonly T[]): [number, T[]][] {
  const out = new Map<number, T[]>()
  for (const m of sortMeets(list)) out.set(m.year, [...(out.get(m.year) ?? []), m])
  return [...out.entries()]
}

/** A web address piece from a title, the same rule the database uses. */
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'meet'
}

const COLUMNS = 'id, slug, title, title_hi, year, held_on, venue, description, description_hi, highlights, highlights_hi, attendance, cover_path, event_id, archive_event, members_can_add, is_published, created_at'

/** Published meets for everyone; curators also get the drafts. */
export function usePastMeets() {
  return useQuery({
    queryKey: ['past-meets'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('past_meets').select(COLUMNS).order('year', { ascending: false })
      if (error) throw error
      return data as PastMeet[]
    },
  })
}

export function usePastMeet(slug: string | undefined) {
  return useQuery({
    queryKey: ['past-meet', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase.from('past_meets').select(COLUMNS).eq('slug', slug!).maybeSingle()
      if (error) throw error
      return (data as PastMeet | null) ?? null
    },
  })
}

/** The slug of the meet's archive event (the page that holds its photos and videos). */
export function useMeetEvent(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ['meet-event', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('id, slug, title').eq('id', eventId!).maybeSingle()
      if (error) throw error
      return data as { id: string; slug: string; title: string } | null
    },
  })
}
