import { useQuery } from '@tanstack/react-query'
import { publicUrl, supabase } from '../../lib/supabase'

export interface Glimpse {
  id: string
  caption: string | null
  caption_hi: string | null
  year: number | null
  poster_path: string
  mime_type: string
  size_bytes: number
  duration_ms: number | null
  width: number | null
  height: number | null
  drive_file_id: string | null
  sort_order: number
  is_visible: boolean
  meet_id: string | null
  created_at: string
}

export const glimpsePoster = (g: Pick<Glimpse, 'poster_path'>) => publicUrl('glimpses', g.poster_path) ?? ''
export const glimpseCaption = (g: Pick<Glimpse, 'caption' | 'caption_hi'>, lang: string) => (lang === 'hi' ? g.caption_hi || g.caption : g.caption || g.caption_hi) || null

/** What the public sees: shown by an admin AND already in Drive. (Curators also receive hidden and unfinished ones from the database.) */
export const isLive = (g: Pick<Glimpse, 'is_visible' | 'drive_file_id'>) => g.is_visible && !!g.drive_file_id

const COLUMNS = 'id, caption, caption_hi, year, poster_path, mime_type, size_bytes, duration_ms, width, height, drive_file_id, sort_order, is_visible, meet_id, created_at'

async function fetchGlimpses(): Promise<Glimpse[]> {
  const { data, error } = await supabase.from('glimpses').select(COLUMNS).order('sort_order').order('created_at')
  if (error) throw error
  return data as Glimpse[]
}

/** Every glimpse the signed-in person may read (anonymous visitors: the live ones). */
export function useGlimpses() {
  return useQuery({ queryKey: ['glimpses'], staleTime: 5 * 60_000, queryFn: fetchGlimpses })
}

export function useLiveGlimpses(meetId?: string) {
  const q = useGlimpses()
  const data = (q.data ?? []).filter((g) => isLive(g) && (meetId === undefined || g.meet_id === meetId))
  return { ...q, data }
}

/** The tidy order after moving one entry up (-1) or down (+1). */
export function moveItem<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const j = index + by
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[j]] = [next[j]!, next[index]!]
  return next
}
