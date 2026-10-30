import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { profileKey, useUserId } from '../auth/AuthProvider'
import type { AiProfile, QuickSave } from './mapping'
import type { PrefillRow } from './prefillImport'

export type AiFillErrorCode =
  | 'ai_not_configured' | 'limit' | 'empty' | 'too_long' | 'ai_busy' | 'ai_unavailable' | 'ai_failed' | 'refusal' | 'truncated' | 'bad_output' | 'unauthorized' | 'failed'

export class AiFillError extends Error {
  code: AiFillErrorCode
  constructor(code: AiFillErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** Codes after which the app should just show the manual fields (Magic fill is off or used up for today). */
export const AI_OFF_CODES: AiFillErrorCode[] = ['ai_not_configured', 'limit']

/** Sends the member's words to the profile-ai-fill function. Throws AiFillError with a friendly message. */
export async function aiFill(text: string): Promise<AiProfile> {
  const { data, error } = await supabase.functions.invoke('profile-ai-fill', { body: { text } })
  if (error) {
    const body = (await (error as { context?: Response }).context?.json?.().catch(() => null)) as { error?: AiFillErrorCode; message?: string } | null
    throw new AiFillError(body?.error ?? 'failed', body?.message ?? '')
  }
  const profile = (data as { profile?: AiProfile } | null)?.profile
  if (!profile) throw new AiFillError('bad_output', '')
  return profile
}

export function useAiFill() {
  return useMutation({ mutationFn: aiFill })
}

export function useSaveQuickProfile() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (s: QuickSave) => {
      const { error } = await supabase.rpc('save_my_quick_profile', { p_profile: s.profile, p_experiences: s.experiences, p_educations: s.educations })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: profileKey(uid) }),
        qc.invalidateQueries({ queryKey: ['member', uid] }),
      ])
    },
  })
}

// ---------------------------------------------------------------- reunion list (prefill)

export interface PrefillMatch {
  id: string
  match_kind: 'email' | 'phone'
  full_name: string
  grad_year: number | null
  join_year: number | null
  branch: string | null
  city: string | null
  country: string | null
  organisation: string | null
  designation: string | null
  source: string
}

/** The member's own reunion-list record (by sign-in e-mail, or by a typed mobile number + name initial). */
export function usePrefillMatch(opts: { phone?: string | null; name?: string | null; enabled?: boolean } = {}) {
  const uid = useUserId()
  const phone = opts.phone || null
  return useQuery({
    queryKey: ['prefill-match', uid, phone, phone ? (opts.name ?? '').trim().slice(0, 1).toLowerCase() : null],
    enabled: !!uid && opts.enabled !== false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_prefill_match', { p_phone: phone, p_name: phone ? (opts.name ?? null) : null })
      if (error) throw error
      return ((data ?? []) as PrefillMatch[])[0] ?? null
    },
  })
}

export function useClaimPrefill() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (input: { id: string; phone?: string | null; name?: string | null }) => {
      const { data, error } = await supabase.rpc('claim_prefill', { p_id: input.id, p_phone: input.phone ?? null, p_name: input.name ?? null })
      if (error) throw error
      return (data ?? []) as string[]
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: profileKey(uid) }),
        qc.invalidateQueries({ queryKey: ['profile-private', uid] }),
        qc.invalidateQueries({ queryKey: ['member', uid] }),
        qc.invalidateQueries({ queryKey: ['prefill-match', uid] }),
      ])
    },
  })
}

export function useDismissPrefill() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('dismiss_prefill', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefill-match', uid] }),
  })
}

export interface AdminPrefillRow {
  id: string
  full_name: string
  email_masked: string | null
  phone_tail: string | null
  grad_year: number | null
  branch: string | null
  city: string | null
  organisation: string | null
  designation: string | null
  source: string
  created_at: string
  claimed: boolean
  claimed_at: string | null
  claimed_by: string | null
  claimed_by_name: string | null
  total: number
  claimed_total: number
}

export function useAdminPrefillList(q: string, status: 'all' | 'claimed' | 'unclaimed') {
  return useQuery({
    queryKey: ['admin-prefill', q, status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_prefill_list', { p_q: q.trim() || null, p_status: status, p_limit: 200, p_offset: 0 })
      if (error) throw error
      return (data ?? []) as AdminPrefillRow[]
    },
  })
}

export function useAdminPrefillImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { rows: Omit<PrefillRow, 'line' | 'problem'>[]; source: string }) => {
      const { data, error } = await supabase.rpc('admin_prefill_import', { p_rows: input.rows, p_source: input.source })
      if (error) throw error
      return data as { added: number; updated: number; claimed_skipped: number; problems: { line: number; problem: string }[] }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-prefill'] }),
  })
}

export function useAdminPrefillDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('admin_prefill_delete', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-prefill'] }),
  })
}
