// Wall of Fame (alumni spotlight): verified members read it, the landing page shows public entries, curators manage it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { compressImageSizes } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'

export const FAME_CATEGORIES = ['achiever', 'entrepreneur', 'public_service', 'research', 'sports', 'arts', 'legend'] as const
export type FameCategory = (typeof FAME_CATEGORIES)[number]

export const FAME_CATEGORY_LABELS: Record<FameCategory, { en: string; hi: string; icon: string }> = {
  achiever: { en: 'Achievers', hi: 'उपलब्धि', icon: 'Trophy' },
  entrepreneur: { en: 'Entrepreneurs', hi: 'उद्यमी', icon: 'Rocket' },
  public_service: { en: 'Public service', hi: 'जन सेवा', icon: 'Landmark' },
  research: { en: 'Research', hi: 'शोध', icon: 'FlaskConical' },
  sports: { en: 'Sports', hi: 'खेल', icon: 'Medal' },
  arts: { en: 'Arts', hi: 'कला', icon: 'Palette' },
  legend: { en: 'Legends', hi: 'दिग्गज', icon: 'Sparkles' },
}

export interface FameEntry {
  id: string
  /** null for people who are not members, or when you and the member have blocked each other */
  member_id: string | null
  name: string
  title: string
  title_hi: string | null
  story: string | null
  story_hi: string | null
  image_path: string | null
  /** the member's avatar, used when no image was uploaded */
  avatar_url: string | null
  link_url: string | null
  category: FameCategory
  grad_year: number | null
  branch: string | null
  is_public: boolean
}

/** The landing-page shape: no ids at all. */
export type PublicFameEntry = Omit<FameEntry, 'id' | 'member_id' | 'avatar_url' | 'is_public'>

/** Full rows for curators (drafts, schedule, sort). */
export interface FameRow extends Omit<FameEntry, 'avatar_url'> {
  sort: number
  is_published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export function useWallOfFame(category: FameCategory | null = null) {
  return useQuery({
    queryKey: ['wall-of-fame', category],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('wall_of_fame_list', { p_category: category })
      if (error) throw error
      return (data ?? []) as FameEntry[]
    },
  })
}

export function usePublicWallOfFame(limit = 12) {
  return useQuery({
    queryKey: ['wall-of-fame', 'public', limit],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('public_wall_of_fame', { p_limit: limit })
      if (error) throw error
      return (data ?? []) as PublicFameEntry[]
    },
  })
}

export const fameImageUrl = (e: Pick<FameEntry, 'image_path'> & { avatar_url?: string | null }) =>
  publicUrl('gallery', e.image_path) ?? e.avatar_url ?? null

const pick = (lang: string, en: string | null, hi: string | null) => (lang === 'hi' ? hi || en : en || hi) || null
export const fameTitle = (e: Pick<FameEntry, 'title' | 'title_hi'>, lang: string) => pick(lang, e.title, e.title_hi) ?? e.title
export const fameStory = (e: Pick<FameEntry, 'story' | 'story_hi'>, lang: string) => pick(lang, e.story, e.story_hi)

// ------------------------------------------------------------------ curators (gallery_manage)
export function useAdminWallOfFame(enabled = true) {
  return useQuery({
    queryKey: ['wall-of-fame', 'admin'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('wall_of_fame').select('*').order('sort').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as FameRow[]
    },
  })
}

export async function uploadFameImage(file: Blob): Promise<string> {
  const [img] = await compressImageSizes(file, [{ maxSide: 1200, quality: 0.82 }])
  const path = `gallery/fame/${crypto.randomUUID()}.${img!.ext}`
  const up = await supabase.storage.from('gallery').upload(path, img!.blob, { contentType: img!.type, cacheControl: '31536000' })
  if (up.error) throw up.error
  return path
}

export interface FameInput {
  id?: string
  member_id?: string | null
  name?: string
  title: string
  title_hi?: string | null
  story?: string | null
  story_hi?: string | null
  image_path?: string | null
  link_url?: string | null
  category: FameCategory
  grad_year?: number | null
  branch?: string | null
  is_published?: boolean
  is_public?: boolean
  starts_at?: string | null
  ends_at?: string | null
}

/** https only, like the database check (which is the real gate). */
export function isSafeFameLink(url: string): boolean {
  return url.length <= 500 && /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(\/[^\s<>"'\\]*)?$/.test(url)
}

export function useFameAdmin() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['wall-of-fame'] })
  const save = useMutation({
    mutationFn: async (input: FameInput) => {
      const { data, error } = await supabase.rpc('admin_save_fame', { p: input })
      if (error) throw error
      return data as string
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('admin_delete_fame', { p_id: id })
      if (error) throw error
      const files = (data ?? []) as string[]
      if (files.length) await supabase.storage.from('gallery').remove(files)
      return files
    },
    onSuccess: refresh,
  })
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('admin_reorder_fame', { p_ids: ids })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { save, remove, reorder }
}
