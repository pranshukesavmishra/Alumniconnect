// Fill from LinkedIn (licensed provider, linkedin-enrich function) and the admins' LinkedIn verification hints.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import type { AiProfile } from './mapping'
import { AiFillError, type AiFillErrorCode } from './queries'

export interface EnrichJec {
  school: string
  kind: 'jec' | 'affiliation'
  start_year: number | null
  end_year: number | null
  branch: string | null
  hint: 'open' | 'auto_approved' | null
}

/** Is a LinkedIn data provider switched on? (free check, no look-up). Off, failing or not deployed: false. */
export function useEnrichAvailable(enabled = true) {
  const uid = useUserId()
  return useQuery({
    queryKey: ['enrich-available', uid],
    enabled: !!uid && enabled,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      // switched on by a super admin once the provider secrets are set; until then the function is never called
      const flags = await supabase.rpc('quick_profile_flags')
      if (flags.error || !(flags.data as { linkedin_fill?: boolean } | null)?.linkedin_fill) return false
      const { data, error } = await supabase.functions.invoke('linkedin-enrich', { body: { mode: 'status' } })
      if (error) return false
      return !!(data as { available?: boolean } | null)?.available
    },
  })
}

export async function enrichFromLinkedIn(input: { mode: 'email' | 'url'; url?: string }): Promise<{ profile: AiProfile; jec: EnrichJec | null }> {
  const { data, error } = await supabase.functions.invoke('linkedin-enrich', { body: { ...input, consent: true } })
  if (error) {
    const body = (await (error as { context?: Response }).context?.json?.().catch(() => null)) as { error?: string; message?: string } | null
    throw new AiFillError((body?.error ?? 'failed') as AiFillErrorCode, body?.message ?? '')
  }
  return data as { profile: AiProfile; jec: EnrichJec | null }
}

export interface VerificationHint {
  id: string
  user_id: string
  full_name: string
  avatar_url: string | null
  school: string
  degree: string | null
  field: string | null
  branch: string | null
  start_year: number | null
  end_year: number | null
  linkedin_url: string | null
  created_at: string
}

export function useVerificationHints(enabled: boolean) {
  return useQuery({
    queryKey: ['verification-hints'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_verification_hints')
      if (error) throw error
      return (data ?? []) as VerificationHint[]
    },
  })
}

export function useReviewHint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('admin_review_hint', { p_id: input.id, p_approve: input.approve })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['verification-hints'] })
      void qc.invalidateQueries({ queryKey: ['admin-members'] })
    },
  })
}

/** A super-admin switch: 'auto_verify_linkedin_jec' (default off) or 'linkedin_fill' (default off). */
export function useAppFlag(key: 'auto_verify_linkedin_jec' | 'linkedin_fill', enabled: boolean) {
  const qc = useQueryClient()
  const flag = useQuery({
    queryKey: ['app-flag', key],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_flags').select('enabled').eq('key', key).maybeSingle()
      if (error) throw error
      return !!(data as { enabled: boolean } | null)?.enabled
    },
  })
  const set = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.rpc('admin_set_flag', { p_key: key, p_enabled: on })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['app-flag', key] })
      void qc.invalidateQueries({ queryKey: ['enrich-available'] })
    },
  })
  return { flag, set }
}
