// Batch yearbook (verified members) + the "your batch" Home summary + curator actions (gallery_manage).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { compressImageSizes } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export interface Yearbook {
  id: string
  grad_year: number
  /** null = the yearbook of the whole year (shown for every branch that has none of its own) */
  branch: string | null
  cover_path: string | null
  quote: string | null
  quote_hi: string | null
  class_photo_paths: string[]
  memories: string | null
  memories_hi: string | null
  is_published: boolean
  updated_at: string
}

export interface YearbookMember {
  id: string
  full_name: string
  avatar_url: string | null
  branch: string | null
  grad_year: number
  headline: string | null
  current_title: string | null
  current_company: string | null
  city: string | null
  country: string | null
  is_me: boolean
  /** false only for yourself when you chose not to be listed (others who did are left out) */
  listed: boolean
}

export interface BatchYearbook {
  grad_year: number
  branch: string | null
  years_since: number
  /** null when nothing is published yet (curators also see drafts: check is_published) */
  yearbook: Yearbook | null
  stats: {
    members: number
    cities: number
    countries: number
    /** only companies / cities shared by 2+ members; names only */
    top_companies: { name: string; members: number }[]
    top_cities: { city: string; country: string; members: number }[]
  }
  /** branch chips for the year */
  branches: { branch: string; members: number }[]
  members: YearbookMember[]
  /** members who chose not to be listed (shown as "and 3 others") */
  hidden_count: number
}

export interface BatchmatesSummary {
  grad_year: number | null
  branch: string | null
  batchmates: number
  same_branch: number
  in_my_city: number
  /** empty for members who are not verified yet */
  newest: { id: string; full_name: string; avatar_url: string | null; branch: string | null; joined_at: string }[]
}

export const yearbookKey = (year: number | null, branch: string | null) => ['yearbook', year, branch] as const

export function useBatchYearbook(year: number | null | undefined, branch: string | null = null) {
  return useQuery({
    queryKey: yearbookKey(year ?? null, branch),
    enabled: !!year,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('batch_yearbook', { p_year: year, p_branch: branch })
      if (error) throw error
      return data as BatchYearbook
    },
  })
}

export function useMyBatchmatesSummary() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['batchmates-summary', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_batchmates_summary')
      if (error) throw error
      return data as BatchmatesSummary
    },
  })
}

export const yearbookImageUrl = (path: string | null | undefined) => publicUrl('gallery', path)

const pick = (lang: string, en: string | null, hi: string | null) => (lang === 'hi' ? hi || en : en || hi) || null
export const yearbookQuote = (y: Pick<Yearbook, 'quote' | 'quote_hi'>, lang: string) => pick(lang, y.quote, y.quote_hi)
export const yearbookMemories = (y: Pick<Yearbook, 'memories' | 'memories_hi'>, lang: string) => pick(lang, y.memories, y.memories_hi)

// ------------------------------------------------------------------ curators (gallery_manage)
/** Every yearbook including drafts (RLS: curators only; members get published ones). */
export function useAdminYearbooks(enabled = true) {
  return useQuery({
    queryKey: ['yearbook', 'admin-list'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('yearbooks').select('*').order('grad_year', { ascending: false }).order('branch', { nullsFirst: true })
      if (error) throw error
      return (data ?? []) as Yearbook[]
    },
  })
}

/** Compresses and uploads one yearbook image; returns its storage path for admin_save_yearbook. */
export async function uploadYearbookImage(file: Blob): Promise<string> {
  const [img] = await compressImageSizes(file, [{ maxSide: 1800, quality: 0.82 }])
  const path = `gallery/yearbooks/${crypto.randomUUID()}.${img!.ext}`
  const up = await supabase.storage.from('gallery').upload(path, img!.blob, { contentType: img!.type, cacheControl: '31536000' })
  if (up.error) throw up.error
  return path
}

export interface YearbookInput {
  id?: string
  grad_year: number
  branch?: string | null
  cover_path?: string | null
  class_photo_paths?: string[]
  quote?: string | null
  quote_hi?: string | null
  memories?: string | null
  memories_hi?: string | null
  is_published?: boolean
}

export function useYearbookAdmin() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['yearbook'] })
  const save = useMutation({
    mutationFn: async (input: YearbookInput) => {
      const { data, error } = await supabase.rpc('admin_save_yearbook', { p: input })
      if (error) throw error
      return data as string
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('admin_delete_yearbook', { p_id: id })
      if (error) throw error
      const files = (data ?? []) as string[]
      if (files.length) await supabase.storage.from('gallery').remove(files)
      return files
    },
    onSuccess: refresh,
  })
  return { save, remove }
}
