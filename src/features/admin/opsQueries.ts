import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Ledger, LedgerRow } from '../../lib/ledger'
import { supabase } from '../../lib/supabase'
import { adminDataKey } from './queries'

// Data hooks for event operations (admin pass 3): messages, finance, waiting list, day-of tools.

// ------------------------------------------------------------------ messages
export interface EventMessage {
  id: string
  event_id: string
  kind: 'announcement' | 'payment_reminder' | 'reminder'
  title: string
  body: string
  audience: Record<string, unknown>
  status: 'pending_approval' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'rejected'
  created_by: string | null
  review_note: string | null
  scheduled_for: string
  sent_at: string | null
  recipient_count: number | null
  created_at: string
  author: { full_name: string } | null
}

const messagesKey = (eventId: string) => ['event-messages', eventId] as const

export function useEventMessages(eventId: string) {
  return useQuery({
    queryKey: messagesKey(eventId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_messages')
        .select('id, event_id, kind, title, body, audience, status, created_by, review_note, scheduled_for, sent_at, recipient_count, created_at, author:profiles!event_messages_created_by_fkey(full_name)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as unknown as EventMessage[]
    },
  })
}

export interface MessagePreview {
  count: number
  sample: string[]
  needs_approval: boolean
  approval_over: number
}

export function useMessagePreview(eventId: string, audience: Record<string, string>, enabled: boolean) {
  return useQuery({
    queryKey: ['event-message-preview', eventId, audience],
    enabled,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_message_preview', { p_event: eventId, p_audience: audience })
      if (error) throw error
      return data as unknown as MessagePreview
    },
  })
}

export function useSendMessage(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { kind: string; title: string; body: string; audience: Record<string, string>; sendAt: string | null }) => {
      const { data, error } = await supabase.rpc('admin_send_event_message', {
        p_event: eventId, p_kind: input.kind, p_title: input.title, p_body: input.body, p_audience: input.audience, p_send_at: input.sendAt,
      })
      if (error) throw error
      return data as unknown as EventMessage
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: messagesKey(eventId) }),
  })
}

export function useReviewMessage(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_review_event_message', { p_id: input.id, p_approve: input.approve, p_note: input.note ?? null })
      if (error) throw error
      return data as unknown as EventMessage
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: messagesKey(eventId) })
      void qc.invalidateQueries({ queryKey: ['admin-inbox'] })
      void qc.invalidateQueries({ queryKey: ['admin-attention'] })
    },
  })
}

export function useCancelMessage(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('admin_cancel_event_message', { p_id: id })
      if (error) throw error
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: messagesKey(eventId) }),
  })
}

/** Sends scheduled messages that have come due (the server clock decides). Returns how many went out. */
export async function sendDueMessages(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_send_due_messages')
  if (error) throw error
  return (data as number) ?? 0
}

// ------------------------------------------------------------------ finance
export function useLedger(eventId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['event-ledger', eventId, from, to],
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_event_ledger', { p_event: eventId, p_from: from || null, p_to: to || null })
      if (error) throw error
      return data as unknown as Ledger
    },
  })
}

/** Every payment and refund as rows. With log=true the download is written to the activity log. */
export async function fetchLedgerRows(eventId: string, from: string, to: string, log: boolean): Promise<LedgerRow[]> {
  const { data, error } = await supabase.rpc('admin_event_ledger_rows', { p_event: eventId, p_from: from || null, p_to: to || null, p_log: log })
  if (error) throw error
  return data as unknown as LedgerRow[]
}

export interface Refund {
  id: string
  payment_id: string
  registration_id: string
  amount_paise: number
  method: string
  reference: string | null
  note: string
  created_at: string
}

export function useRegistrationRefunds(registrationId: string) {
  return useQuery({
    queryKey: ['registration-refunds', registrationId],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_refunds').select('*').eq('registration_id', registrationId).order('created_at')
      if (error) throw error
      return data as Refund[]
    },
  })
}

/** After a money change: reload the registrations, the ledger and the refunds. */
export function useRefreshMoney(eventId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: adminDataKey(eventId) })
    void qc.invalidateQueries({ queryKey: ['event-ledger', eventId] })
    void qc.invalidateQueries({ queryKey: ['registration-refunds'] })
    void qc.invalidateQueries({ queryKey: ['event-waitlist', eventId] })
  }
}

// ------------------------------------------------------------------ waiting list and capacity
export interface WaitlistEntry {
  id: string
  user_id: string
  full_name: string
  grad_year: number | null
  branch: string | null
  city: string | null
  headcount: number
  status: 'waiting' | 'offered' | 'registered' | 'expired'
  created_at: string
  offered_at: string | null
}
export interface WaitlistData {
  capacity: number | null
  seats_left: number | null
  free_after_offers: number | null
  auto_promote: boolean
  entries: WaitlistEntry[]
}
export interface DayCapacity {
  day: string
  capacity: number
  label: string | null
}

export function useWaitlist(eventId: string) {
  return useQuery({
    queryKey: ['event-waitlist', eventId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_waitlist', { p_event: eventId })
      if (error) throw error
      return data as unknown as WaitlistData
    },
  })
}

export function useEventOps(eventId: string) {
  return useQuery({
    queryKey: ['event-ops', eventId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_event_ops', { p_event: eventId })
      if (error) throw error
      return data as unknown as { auto_promote: boolean; days: DayCapacity[] }
    },
  })
}

export function useWaitlistActions(eventId: string) {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['event-waitlist', eventId] })
    void qc.invalidateQueries({ queryKey: ['event-ops', eventId] })
  }
  return {
    promote: useMutation({
      mutationFn: async (entryId: string) => {
        const { error } = await supabase.rpc('admin_promote_waitlist', { p_entry: entryId })
        if (error) throw error
      },
      onSettled: done,
    }),
    run: useMutation({
      mutationFn: async () => {
        const { data, error } = await supabase.rpc('admin_run_waitlist', { p_event: eventId })
        if (error) throw error
        return data as number
      },
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: async (input: { entryId: string; reason: string }) => {
        const { error } = await supabase.rpc('admin_remove_waitlist', { p_entry: input.entryId, p_reason: input.reason || null })
        if (error) throw error
      },
      onSettled: done,
    }),
    add: useMutation({
      mutationFn: async (input: { userId: string; headcount: number }) => {
        const { error } = await supabase.rpc('admin_add_waitlist', { p_event: eventId, p_user: input.userId, p_headcount: input.headcount })
        if (error) throw error
      },
      onSettled: done,
    }),
    saveOps: useMutation({
      mutationFn: async (input: { autoPromote: boolean; days: DayCapacity[] }) => {
        const { error } = await supabase.rpc('admin_save_event_ops', { p_event: eventId, p_auto_promote: input.autoPromote, p_days: input.days })
        if (error) throw error
      },
      onSettled: () => {
        done()
        void qc.invalidateQueries({ queryKey: ['event-arrivals', eventId] })
      },
    }),
  }
}

// ------------------------------------------------------------------ day of the event
export interface Arrivals {
  expected_people: number
  arrived_people: number
  expected_registrations: number
  arrived_registrations: number
  recent: { full_name: string; code: string; headcount: number; at: string }[]
  hourly: { hour: string; people: number }[]
  days: { day: string; people: number; capacity: number | null; label: string | null }[]
}

export function useArrivals(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-arrivals', eventId],
    enabled: !!eventId,
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('event_arrivals', { p_event: eventId! })
      if (error) throw error
      return data as unknown as Arrivals
    },
  })
}

export interface GateMatch {
  code: string
  full_name: string
  branch: string | null
  grad_year: number | null
  headcount: number
  status: 'pending_payment' | 'under_review' | 'confirmed' | 'cancelled'
  checked_in_at: string | null
  guests: number
}

export async function searchGate(eventId: string, q: string): Promise<GateMatch[]> {
  const { data, error } = await supabase.rpc('checkin_search', { p_event: eventId, p_q: q })
  if (error) throw error
  return data as unknown as GateMatch[]
}

export interface Attendance {
  by_batch: { batch: number | null; confirmed: number; arrived: number; no_show: number }[]
  no_shows: { code: string; full_name: string; batch: number | null; branch: string | null; headcount: number; phone: string }[]
}

export function useAttendance(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['event-attendance', eventId],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_attendance_report', { p_event: eventId })
      if (error) throw error
      return data as unknown as Attendance
    },
  })
}

// ------------------------------------------------------------------ payments
/** Verify or reject many payments in one go; the server handles each separately and reports the ones that failed. */
export function useBulkReview(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { ids: string[]; approve: boolean; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_bulk_review_payments', { p_ids: input.ids, p_approve: input.approve, p_note: input.note ?? null })
      if (error) throw error
      return data as unknown as { done: number; failed: { id: string; error: string }[] }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminDataKey(eventId) })
      void qc.invalidateQueries({ queryKey: ['event-ledger', eventId] })
    },
  })
}
