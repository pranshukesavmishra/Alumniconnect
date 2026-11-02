// Advance payments made before the app: the organisers' list per event, and manual matching on a registration.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { adminDataKey } from './queries'

export interface AdvanceCredit {
  id: string
  full_name: string
  grad_year: number | null
  branch: string | null
  phone_masked: string | null
  email_masked: string | null
  amount_paise: number
  note: string | null
  source: string | null
  status: 'open' | 'claimed' | 'void'
  created_at: string
  claimed_at: string | null
  claimed_by: 'auto' | 'admin' | null
  match_reason: 'phone' | 'email' | 'name' | 'admin' | null
  void_reason: string | null
  registration_id: string | null
  registration_code: string | null
  registration_name: string | null
}
export interface AdvanceList {
  credits: AdvanceCredit[]
  review: { id: string; code: string; full_name: string; grad_year: number | null; branch: string | null }[]
}
export interface AdvanceImportResult {
  added: number
  duplicates: { row: number; full_name: string }[]
  rejected: { row: number; error: string }[]
  applied: number
  review: number
}

const key = (eventId: string) => ['admin-advances', eventId] as const

export function useAdvanceCredits(eventId: string, enabled = true) {
  return useQuery({
    queryKey: key(eventId),
    enabled: !!eventId && enabled,
    queryFn: async (): Promise<AdvanceList> => {
      const { data, error } = await supabase.rpc('admin_advance_credits', { p_event: eventId })
      if (error) throw error
      return data as AdvanceList
    },
  })
}

export function useAdvanceCandidates(registrationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-advance-candidates', registrationId],
    enabled: !!registrationId && enabled,
    queryFn: async (): Promise<{ id: string; match: 'phone' | 'email' | 'name' }[]> => {
      const { data, error } = await supabase.rpc('admin_advance_candidates', { p_registration: registrationId })
      if (error) throw error
      return data as { id: string; match: 'phone' | 'email' | 'name' }[]
    },
  })
}

function useAdvanceMutation<I, O = void>(eventId: string, run: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key(eventId) })
      void qc.invalidateQueries({ queryKey: ['admin-advance-candidates'] })
      void qc.invalidateQueries({ queryKey: adminDataKey(eventId) })
    },
  })
}

export type AdvanceInputRow = { full_name: string; grad_year: number | null; branch: string | null; phone: string | null; email: string | null; amount_paise: number | null; note: string | null }

export function useAddAdvanceCredits(eventId: string) {
  return useAdvanceMutation(eventId, async (input: { rows: AdvanceInputRow[]; source: string | null }): Promise<AdvanceImportResult> => {
    const { data, error } = await supabase.rpc('admin_add_advance_credits', { p_event: eventId, p_rows: input.rows, p_source: input.source })
    if (error) throw error
    return data as AdvanceImportResult
  })
}

export function useVoidAdvanceCredit(eventId: string) {
  return useAdvanceMutation(eventId, async (input: { creditId: string; reason: string }) => {
    const { error } = await supabase.rpc('admin_void_advance_credit', { p_credit: input.creditId, p_reason: input.reason })
    if (error) throw error
  })
}

export function useApplyAdvanceCredit(eventId: string) {
  return useAdvanceMutation(eventId, async (input: { registrationId: string; creditId: string; reason: string | null }) => {
    const { error } = await supabase.rpc('admin_apply_advance_credit', { p_registration: input.registrationId, p_credit: input.creditId, p_reason: input.reason })
    if (error) throw error
  })
}

export function useRemoveAdvanceCredit(eventId: string) {
  return useAdvanceMutation(eventId, async (input: { registrationId: string; reason: string }) => {
    const { error } = await supabase.rpc('admin_remove_advance_credit', { p_registration: input.registrationId, p_reason: input.reason })
    if (error) throw error
  })
}

export function useDismissAdvanceReview(eventId: string) {
  return useAdvanceMutation(eventId, async (registrationId: string) => {
    const { error } = await supabase.rpc('admin_dismiss_advance_review', { p_registration: registrationId })
    if (error) throw error
  })
}
