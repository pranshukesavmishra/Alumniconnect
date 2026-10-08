import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileKey, useUserId } from '../auth/AuthProvider'
import { AVATAR_SIZE, compressImage } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'
import type { Education, Experience, Profile, ProfilePrivate } from '../../lib/types'

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | 'full_name' | 'avatar_url' | 'headline' | 'member_type' | 'branch' | 'join_year' | 'grad_year' | 'current_title'
    | 'current_company' | 'city' | 'country' | 'about' | 'linkedin_url' | 'website_url' | 'skills' | 'help_tags'
    | 'interests' | 'onboarded'
  >
>

export function useMyPrivate() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['profile-private', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('*').eq('id', uid!).maybeSingle()
      if (error) throw error
      return (data as ProfilePrivate | null) ?? { id: uid!, phone: null, whatsapp_same_as_phone: true }
    },
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (input: { profile?: ProfileUpdate; phone?: string | null }) => {
      if (input.profile && Object.keys(input.profile).length) {
        const { error } = await supabase.from('profiles').update(input.profile).eq('id', uid!)
        if (error) throw error
      }
      if (input.phone !== undefined) {
        const { error } = await supabase.from('profile_private').update({ phone: input.phone }).eq('id', uid!)
        if (error) throw error
      }
    },
    // awaited: route guards must see e.g. onboarded=true before we navigate
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: profileKey(uid) }),
        qc.invalidateQueries({ queryKey: ['profile-private', uid] }),
        qc.invalidateQueries({ queryKey: ['member', uid] }),
      ])
    },
  })
}

export function useUploadAvatar() {
  const update = useUpdateProfile()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (file: File) => {
      const img = await compressImage(file, AVATAR_SIZE, 0.85)
      const path = `${uid}/avatar-${Date.now()}.${img.ext}`
      const { error } = await supabase.storage.from('avatars').upload(path, img.blob, { contentType: img.type, upsert: false })
      if (error) throw error
      const url = publicUrl('avatars', path)
      await update.mutateAsync({ profile: { avatar_url: url } })
      return url
    },
  })
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: ['member', id],
    enabled: !!id,
    queryFn: async () => {
      const [p, ex, ed] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id!).maybeSingle(),
        supabase.from('experiences').select('*').eq('profile_id', id!).order('is_current', { ascending: false }).order('start_date', { ascending: false, nullsFirst: false }),
        supabase.from('educations').select('*').eq('profile_id', id!).order('end_year', { ascending: false, nullsFirst: false }),
      ])
      if (p.error) throw p.error
      if (ex.error) throw ex.error
      if (ed.error) throw ed.error
      if (!p.data) return null
      return { profile: p.data as Profile, experiences: ex.data as Experience[], educations: ed.data as Education[] }
    },
  })
}

export interface ImportedProfile {
  headline?: string
  about?: string
  city?: string
  skills?: string[]
  linkedin_url?: string
  experiences: Omit<Experience, 'id' | 'profile_id'>[]
  educations: Omit<Education, 'id' | 'profile_id'>[]
}

/**
 * Saves a reviewed LinkedIn import in one database transaction: replaces previously imported
 * entries (manual ones are kept) and fills profile fields - only empty ones unless overwriteBasics.
 */
export function useSaveImport() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (data: ImportedProfile & { overwriteBasics: boolean; current?: Profile }) => {
      const cur = data.current
      const fields: Record<string, unknown> = {}
      const take = (k: keyof Profile, v: unknown) => {
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return
        const existing = cur?.[k]
        const empty = existing === null || existing === undefined || existing === '' || (Array.isArray(existing) && existing.length === 0)
        if (data.overwriteBasics || empty) fields[k] = v
      }
      take('headline', data.headline)
      take('about', data.about)
      take('city', data.city)
      take('skills', data.skills)
      take('linkedin_url', data.linkedin_url)
      // only a role marked as current on LinkedIn becomes the current role (never a past job)
      const current = data.experiences.find((e) => e.is_current)
      if (current) {
        take('current_title', current.title)
        take('current_company', current.company)
      }
      const { error } = await supabase.rpc('save_my_linkedin_import', {
        p_profile: fields,
        p_experiences: data.experiences,
        p_educations: data.educations,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: profileKey(uid) }), qc.invalidateQueries({ queryKey: ['member', uid] })])
    },
  })
}
