// Digital alumni ID card + the member's showcase privacy settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { normaliseCardToken } from './card'

export interface MyIdCard {
  /** active = verified member with a card; pending / rejected = no number and no token yet */
  status: 'active' | 'pending' | 'rejected'
  membership_no: string | null
  serial: number | null
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  join_year: number | null
  branch: string | null
  member_type: 'student' | 'alumnus' | 'faculty' | null
  verified: boolean
  /** when the member was first verified (the card was issued) */
  member_since: string | null
  joined_app_at: string
  /** keys, see CARD_ROLE_LABELS / cardRoles() */
  roles: string[]
  /** null when the member revoked the QR code (or is not verified) */
  token: string | null
  token_created_at: string | null
  card_show_photo: boolean
}

export type CardCheckStatus = 'valid' | 'revoked' | 'not_found' | 'inactive' | 'rate_limited'
export interface CardCheck {
  status: CardCheckStatus
  valid: boolean
  verified?: boolean
  full_name?: string
  /** only when the member allowed the photo on the public check */
  avatar_url?: string | null
  grad_year?: number | null
  branch?: string | null
  member_type?: string | null
}

export interface ShowcasePrefs {
  show_on_world_map: boolean
  show_in_yearbook: boolean
  card_show_photo: boolean
}

export const myIdCardKey = (uid: string | null) => ['my-id-card', uid] as const
export const showcasePrefsKey = (uid: string | null) => ['showcase-prefs', uid] as const

export function useMyIdCard() {
  const uid = useUserId()
  return useQuery({
    queryKey: myIdCardKey(uid),
    enabled: !!uid,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_id_card')
      if (error) throw error
      return data as MyIdCard
    },
  })
}

/** regenerate: a new QR code (the old one stops working); revoke: no QR code until a new one is made. */
export function useIdCardTokenActions() {
  const uid = useUserId()
  const qc = useQueryClient()
  const onSuccess = (data: MyIdCard) => qc.setQueryData(myIdCardKey(uid), data)
  const regenerate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('regenerate_my_id_card_token')
      if (error) throw error
      return data as MyIdCard
    },
    onSuccess,
  })
  const revoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('revoke_my_id_card_token')
      if (error) throw error
      return data as MyIdCard
    },
    onSuccess,
  })
  return { regenerate, revoke }
}

/** The public check behind the QR code. Works signed out. A malformed token never reaches the server. */
export function useVerifyIdCard(token: string | null | undefined) {
  const t = normaliseCardToken(token)
  return useQuery({
    queryKey: ['verify-id-card', t],
    enabled: token !== undefined,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<CardCheck> => {
      if (!t) return { status: 'not_found', valid: false }
      const { data, error } = await supabase.rpc('verify_id_card', { p_token: t })
      if (error) throw error
      return data as CardCheck
    },
  })
}

export function useShowcasePrefs() {
  const uid = useUserId()
  return useQuery({
    queryKey: showcasePrefsKey(uid),
    enabled: !!uid,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_showcase_prefs')
      if (error) throw error
      return data as ShowcasePrefs
    },
  })
}

/** Change any of the three settings (others are kept). Refreshes what depends on them. */
export function useSetShowcasePrefs() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Partial<ShowcasePrefs>) => {
      const { data, error } = await supabase.rpc('set_my_showcase_prefs', {
        p_show_on_world_map: p.show_on_world_map ?? null,
        p_show_in_yearbook: p.show_in_yearbook ?? null,
        p_card_show_photo: p.card_show_photo ?? null,
      })
      if (error) throw error
      return data as ShowcasePrefs
    },
    onSuccess: (data) => {
      qc.setQueryData(showcasePrefsKey(uid), data)
      void qc.invalidateQueries({ queryKey: myIdCardKey(uid) })
      void qc.invalidateQueries({ queryKey: ['alumni-world'] })
      void qc.invalidateQueries({ queryKey: ['yearbook'] })
    },
  })
}
