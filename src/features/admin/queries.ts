import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMyProfile } from '../auth/AuthProvider'
import { useMyStaffEvents } from '../events/queries'
import { supabase } from '../../lib/supabase'
import type { EventRow, Payment, Profile, Registration, RegistrationItem, StaffRole, TicketType } from '../../lib/types'

/** PostgREST returns at most 1000 rows per request; page through everything. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export function useManagedEvents() {
  const { data: me } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  return useQuery({
    queryKey: ['managed-events', me?.id, me?.is_admin, staff?.length],
    enabled: !!me && staff !== undefined,
    queryFn: async () => {
      let q = supabase.from('events').select('*').order('starts_at', { ascending: false })
      if (!me!.is_admin) q = q.in('id', staff!.map((s) => s.event_id))
      const { data, error } = await q
      if (error) throw error
      return (data as EventRow[]).map((e) => ({ event: e, role: (me!.is_admin ? 'manager' : staff!.find((s) => s.event_id === e.id)?.role) as StaffRole }))
    },
  })
}

export function useEventRole(eventId: string | undefined): StaffRole | null {
  const { data: me } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  if (me?.is_admin) return 'manager'
  return staff?.find((s) => s.event_id === eventId)?.role ?? null
}

export function useAdminEvent(slug: string) {
  return useQuery({
    queryKey: ['admin-event', slug],
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
      if (error) throw error
      if (!data) return null
      const t = await supabase.from('event_ticket_types').select('*').eq('event_id', data.id).order('sort')
      if (t.error) throw t.error
      return { event: data as EventRow, tickets: t.data as TicketType[] }
    },
  })
}

export interface AdminData {
  registrations: Registration[]
  items: RegistrationItem[]
  payments: Payment[]
}

export const adminDataKey = (eventId: string) => ['admin-data', eventId] as const

export function useAdminData(eventId: string | undefined, role: StaffRole | null) {
  return useQuery({
    queryKey: adminDataKey(eventId ?? ''),
    enabled: !!eventId && !!role,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminData> => {
      // Managers read whole rows. Check-in volunteers get the attendee list without phone, email, notes or amounts.
      const registrations = await fetchAll<Registration>((a, b) =>
        role === 'manager'
          ? supabase.from('event_registrations').select('*').eq('event_id', eventId!).order('created_at', { ascending: false }).range(a, b)
          : supabase.rpc('event_attendees', { p_event: eventId! }).range(a, b),
      )
      if (role !== 'manager') return { registrations, items: [], payments: [] }
      const ids = new Set(registrations.map((r) => r.id))
      // items/payments are filtered by RLS to events I manage; filter to this event client-side
      const [items, payments] = await Promise.all([
        fetchAll<RegistrationItem>((a, b) => supabase.from('event_registration_items').select('*, event_registrations!inner(event_id)').eq('event_registrations.event_id', eventId!).range(a, b)),
        fetchAll<Payment>((a, b) =>
          supabase.from('event_payments').select('*, event_registrations!inner(event_id)').eq('event_registrations.event_id', eventId!).order('created_at').range(a, b),
        ),
      ])
      return { registrations, items: items.filter((i) => ids.has(i.registration_id)), payments: payments.filter((p) => ids.has(p.registration_id)) }
    },
  })
}

export function useReviewPayment(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { paymentId: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc('review_payment', { p_payment: input.paymentId, p_approve: input.approve, p_note: input.note ?? null })
      if (error) throw error
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: adminDataKey(eventId) }),
  })
}

export function useRecordOfflinePayment(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { registrationId: string; method: 'cash' | 'bank_transfer' | 'waiver'; amountPaise: number | null; note: string }) => {
      const { error } = await supabase.rpc('record_offline_payment', {
        p_registration: input.registrationId,
        p_method: input.method,
        p_amount_paise: input.amountPaise,
        p_note: input.note,
      })
      if (error) throw error
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: adminDataKey(eventId) }),
  })
}

export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}

export function useSaveEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { event: Partial<EventRow> & { id?: string }; tickets: (Partial<TicketType> & { id?: string; _delete?: boolean })[] }) => {
      const { id, ...fields } = input.event
      let eventId = id
      if (eventId) {
        const { error } = await supabase.from('events').update(fields).eq('id', eventId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('events').insert(fields).select('id').single()
        if (error) throw error
        eventId = data.id as string
      }
      for (const [i, t] of input.tickets.entries()) {
        const { id: tid, _delete, ...tf } = t
        if (_delete) {
          if (tid) {
            const { error } = await supabase.from('event_ticket_types').delete().eq('id', tid)
            if (error) throw new Error(`Couldn’t remove “${t.label}”: it may already be used by registrations. Set its price instead.`)
          }
          continue
        }
        const row = { ...tf, event_id: eventId, sort: i }
        const { error } = tid ? await supabase.from('event_ticket_types').update(row).eq('id', tid) : await supabase.from('event_ticket_types').insert(row)
        if (error) throw error
      }
      return eventId
    },
    // On success AND on a partial failure, reload from the server: the settings form re-mounts with
    // real ids, so saving again can never insert the same ticket twice.
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-event'] })
      void qc.invalidateQueries({ queryKey: ['event'] })
      void qc.invalidateQueries({ queryKey: ['event-tickets'] })
      void qc.invalidateQueries({ queryKey: ['managed-events'] })
    },
  })
}

export function useEventStaff(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-staff', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_staff').select('role, user_id, profiles(id, full_name, avatar_url, grad_year, branch)').eq('event_id', eventId!)
      if (error) throw error
      return data as unknown as { role: StaffRole; user_id: string; profiles: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grad_year' | 'branch'> }[]
    },
  })
}

export function useStaffMutations(eventId: string) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: ['event-staff', eventId] })
  return {
    add: useMutation({
      mutationFn: async (input: { userId: string; role: StaffRole }) => {
        const { error } = await supabase.from('event_staff').upsert({ event_id: eventId, user_id: input.userId, role: input.role })
        if (error) throw error
      },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (userId: string) => {
        const { error } = await supabase.from('event_staff').delete().eq('event_id', eventId).eq('user_id', userId)
        if (error) throw error
      },
      onSuccess: done,
    }),
  }
}

export async function searchProfiles(q: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').ilike('full_name', `%${q.replace(/[%_]/g, '')}%`).limit(10)
  if (error) throw error
  return data as Profile[]
}
