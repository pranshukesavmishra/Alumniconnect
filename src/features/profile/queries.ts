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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKey(uid) })
      void qc.invalidateQueries({ queryKey: ['profile-private', uid] })
      void qc.invalidateQueries({ queryKey: ['member', uid] })
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

/** Saves a reviewed LinkedIn import: replaces previously imported entries, keeps manual ones. */
export function useSaveImport() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (data: ImportedProfile & { overwriteBasics: boolean; current?: Profile }) => {
      const update: ProfileUpdate = {}
      const cur = data.current
      const take = <K extends keyof ProfileUpdate>(k: K, v: ProfileUpdate[K] | undefined) => {
        if (v === undefined || v === null || v === '') return
        if (data.overwriteBasics || !cur || !cur[k as keyof Profile] || (Array.isArray(cur[k as keyof Profile]) && (cur[k as keyof Profile] as unknown[]).length === 0)) {
          update[k] = v
        }
      }
      take('headline', data.headline?.slice(0, 160))
      take('about', data.about?.slice(0, 3000))
      take('city', data.city?.slice(0, 80))
      take('skills', data.skills?.slice(0, 50))
      take('linkedin_url', data.linkedin_url)
      const current = data.experiences.find((e) => e.is_current) ?? data.experiences[0]
      if (current) {
        take('current_title', current.title.slice(0, 120))
        take('current_company', current.company.slice(0, 120))
      }
      if (Object.keys(update).length) {
        const { error } = await supabase.from('profiles').update(update).eq('id', uid!)
        if (error) throw error
      }
      const delEx = await supabase.from('experiences').delete().eq('profile_id', uid!).eq('source', 'linkedin')
      if (delEx.error) throw delEx.error
      const delEd = await supabase.from('educations').delete().eq('profile_id', uid!).eq('source', 'linkedin')
      if (delEd.error) throw delEd.error
      if (data.experiences.length) {
        const { error } = await supabase.from('experiences').insert(data.experiences.map((e) => ({ ...e, profile_id: uid, source: 'linkedin' })))
        if (error) throw error
      }
      if (data.educations.length) {
        const { error } = await supabase.from('educations').insert(data.educations.map((e) => ({ ...e, profile_id: uid, source: 'linkedin' })))
        if (error) throw error
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKey(uid) })
      void qc.invalidateQueries({ queryKey: ['member', uid] })
    },
  })
}
