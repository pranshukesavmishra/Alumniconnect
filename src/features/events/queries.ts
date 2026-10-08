import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUserId } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import type { EventRow, Guest, Payment, Registration, RegistrationItem, StaffRole, TicketType } from '../../lib/types'

export const eventKeys = {
  event: (slug: string) => ['event', slug] as const,
  tickets: (eventId: string) => ['event-tickets', eventId] as const,
  stats: (eventId: string) => ['event-stats', eventId] as const,
  mine: (eventId: string, uid: string | null) => ['my-registration', eventId, uid] as const,
  staff: (uid: string | null) => ['my-staff-events', uid] as const,
}

export function useEvent(slug: string) {
  return useQuery({
    queryKey: eventKeys.event(slug),
    staleTime: 5 * 60_000, // event details rarely change: show instantly, refresh in the background
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
      if (error) throw error
      return data as EventRow | null
    },
  })
}

export function useTicketTypes(eventId: string | undefined) {
  return useQuery({
    queryKey: eventKeys.tickets(eventId ?? ''),
    enabled: !!eventId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_ticket_types').select('*').eq('event_id', eventId!).order('sort')
      if (error) throw error
      return data as TicketType[]
    },
  })
}

export interface EventStats {
  registered: number
  people: number
  by_year: { year: number | null; count: number }[]
}

export function useEventStats(eventId: string | undefined) {
  return useQuery({
    queryKey: eventKeys.stats(eventId ?? ''),
    enabled: !!eventId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('event_public_stats', { p_event: eventId })
      if (error) throw error
      return data as EventStats
    },
  })
}

export interface MyRegistration {
  registration: Registration
  items: RegistrationItem[]
  payments: Payment[]
}

export function useMyRegistration(eventId: string | undefined) {
  const uid = useUserId()
  return useQuery({
    queryKey: eventKeys.mine(eventId ?? '', uid),
    enabled: !!eventId && !!uid,
    queryFn: async (): Promise<MyRegistration | null> => {
      const { data: reg, error } = await supabase
        .from('event_registrations')
        .select('*')
        .eq('event_id', eventId!)
        .eq('user_id', uid!)
        .maybeSingle()
      if (error) throw error
      if (!reg) return null
      const [items, payments] = await Promise.all([
        supabase.from('event_registration_items').select('*').eq('registration_id', reg.id),
        supabase.from('event_payments').select('*').eq('registration_id', reg.id).order('created_at', { ascending: false }),
      ])
      if (items.error) throw items.error
      if (payments.error) throw payments.error
      return { registration: reg as Registration, items: items.data as RegistrationItem[], payments: payments.data as Payment[] }
    },
  })
}

export interface RegistrationDetails {
  full_name: string
  email: string
  phone: string
  branch: string
  grad_year: string
  city: string
  tshirt_size: string
  food_pref: string
  needs_accommodation: boolean
  arrival_note: string
  notes: string
  guests: Guest[]
  accept_terms: boolean
  photo_consent: boolean
}

export function useUpsertRegistration(eventId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (input: { details: RegistrationDetails; items: { ticket_type_id: string; quantity: number }[] }) => {
      const { data, error } = await supabase.rpc('upsert_registration', {
        p_event: eventId,
        p_details: input.details,
        p_items: input.items,
      })
      if (error) throw error
      return data as Registration
    },
    // awaited, so callers navigate only after the fresh registration is in the cache
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: eventKeys.mine(eventId, uid) })
      void qc.invalidateQueries({ queryKey: eventKeys.stats(eventId) })
    },
  })
}

export function useSubmitPayment(eventId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (input: { registrationId: string; utr: string; payerName: string; proof: Blob | null; proofExt: string }) => {
      let proofPath: string | null = null
      if (input.proof) {
        proofPath = `${uid}/${input.registrationId}-${Date.now()}.${input.proofExt}`
        const up = await supabase.storage.from('payment-proofs').upload(proofPath, input.proof, {
          contentType: input.proof.type || 'image/jpeg',
          upsert: false,
        })
        if (up.error) throw up.error
      }
      const { data, error } = await supabase.rpc('submit_upi_payment', {
        p_registration: input.registrationId,
        p_utr: input.utr,
        p_payer_name: input.payerName,
        p_proof_path: proofPath,
      })
      if (error) {
        // don't leave an orphaned screenshot behind
        if (proofPath) void supabase.storage.from('payment-proofs').remove([proofPath])
        throw error
      }
      return data as Payment
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: eventKeys.mine(eventId, uid) })
    },
  })
}

export function useCancelRegistration(eventId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (registrationId: string) => {
      const { error } = await supabase.rpc('cancel_my_registration', { p_registration: registrationId })
      if (error) throw error
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: eventKeys.mine(eventId, uid) })
    },
  })
}

export function useMyStaffEvents() {
  const uid = useUserId()
  return useQuery({
    queryKey: eventKeys.staff(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_staff').select('event_id, role').eq('user_id', uid!)
      if (error) throw error
      return data as { event_id: string; role: StaffRole }[]
    },
  })
}

export function registrationOpen(event: EventRow): boolean {
  return !event.registration_closes_at || new Date(event.registration_closes_at) > new Date()
}
