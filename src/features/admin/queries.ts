import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMyProfile } from '../auth/AuthProvider'
import { useMySiteRoles, useMyStaffEvents } from '../events/queries'
import { capsFor, rolesOnEvent, type Caps, type EventRole } from '../../lib/roles'
import { supabase } from '../../lib/supabase'
import type { Attention } from '../../lib/adminAttention'
import type { EventRow, Payment, PaymentStatus, Profile, Registration, RegistrationItem, RegistrationStatus, TicketType, VerificationStatus } from '../../lib/types'

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

export function useIsModerator(): boolean {
  const { data: me } = useMyProfile()
  const { data: site } = useMySiteRoles()
  return !!me?.is_admin || !!site?.includes('moderator')
}

export function useManagedEvents() {
  const { data: me } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  return useQuery({
    queryKey: ['managed-events', me?.id, me?.is_admin, staff?.map((s) => `${s.event_id}:${s.role}`).join()],
    enabled: !!me && staff !== undefined,
    queryFn: async () => {
      let q = supabase.from('events').select('*').order('starts_at', { ascending: false })
      if (!me!.is_admin) q = q.in('id', [...new Set(staff!.map((s) => s.event_id))])
      const { data, error } = await q
      if (error) throw error
      return (data as EventRow[]).map((e) => {
        const roles = me!.is_admin ? [] : rolesOnEvent(staff!, e.id)
        return { event: e, roles, caps: capsFor(!!me!.is_admin, roles) }
      })
    },
  })
}

/** What I may do on one event (null when I have no role there). */
export function useEventCaps(eventId: string | undefined): Caps | null {
  const { data: me } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  if (me?.is_admin) return capsFor(true, [])
  if (!eventId || !staff) return null
  const roles = rolesOnEvent(staff, eventId)
  return roles.length ? capsFor(false, roles) : null
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

export function useAdminData(eventId: string | undefined, caps: Caps | null) {
  return useQuery({
    queryKey: [...adminDataKey(eventId ?? ''), caps?.finance ? 'full' : 'names'],
    enabled: !!eventId && !!caps,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminData> => {
      // Managers read whole rows. Check-in volunteers get the attendee list without phone, email, notes or amounts.
      const registrations = await fetchAll<Registration>((a, b) =>
        caps!.finance
          ? supabase.from('event_registrations').select('*').eq('event_id', eventId!).order('created_at', { ascending: false }).range(a, b)
          : supabase.rpc('event_attendees', { p_event: eventId! }).range(a, b),
      )
      if (!caps!.finance) return { registrations, items: [], payments: [] }
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

export type StaffRow = { role: EventRole; user_id: string; profiles: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'grad_year' | 'branch'> }

export function useEventStaff(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-staff', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from('event_staff').select('role, user_id, profiles!event_staff_user_id_fkey(id, full_name, avatar_url, grad_year, branch)').eq('event_id', eventId!)
      if (error) throw error
      return data as unknown as StaffRow[]
    },
  })
}

export type GrantableRole = 'admin' | 'moderator' | 'treasurer' | 'content' | 'checkin'

/** Give or remove one role. Both return false when nothing changed (already had / never had it), so a double tap is harmless. */
export function useRoleMutations(eventId?: string) {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['event-staff'] })
    void qc.invalidateQueries({ queryKey: ['admin-roles'] })
    void qc.invalidateQueries({ queryKey: ['my-staff-events'] })
    void qc.invalidateQueries({ queryKey: ['my-site-roles'] })
    void qc.invalidateQueries({ queryKey: ['managed-events'] })
    void qc.invalidateQueries({ queryKey: ['admin-audit'] })
  }
  return {
    grant: useMutation({
      mutationFn: async (input: { userId: string; role: GrantableRole; eventId?: string; note?: string }) => {
        const { data, error } = await supabase.rpc('admin_grant_role', { p_user: input.userId, p_role: input.role, p_event: input.eventId ?? eventId ?? null, p_note: input.note ?? null })
        if (error) throw error
        return data as boolean
      },
      onSuccess: done,
    }),
    revoke: useMutation({
      mutationFn: async (input: { userId: string; role: GrantableRole; eventId?: string; note?: string }) => {
        const { data, error } = await supabase.rpc('admin_revoke_role', { p_user: input.userId, p_role: input.role, p_event: input.eventId ?? eventId ?? null, p_note: input.note ?? null })
        if (error) throw error
        return data as boolean
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

// ------------------------------------------------------------------ command centre
export const attentionKey = ['admin-attention'] as const

/** The "needs your attention" summary: admins get site-wide counts, treasurers only their own events. Refreshes every minute. */
export function useAttention(enabled: boolean) {
  return useQuery({
    queryKey: attentionKey,
    enabled,
    refetchInterval: 60_000,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_attention')
      if (error) throw error
      return data as unknown as Attention
    },
  })
}

export interface SearchResults {
  members: { id: string; full_name: string; grad_year: number | null; branch: string | null; city: string | null; verification: VerificationStatus; is_admin: boolean; onboarded: boolean; matched_on: string }[]
  registrations: { id: string; code: string; full_name: string; status: RegistrationStatus; amount_paise: number; headcount: number; event_slug: string; event_title: string; user_id: string; matched_on: string }[]
  payments: { id: string; utr: string | null; amount_paise: number; status: PaymentStatus; method: string; payer_name: string | null; created_at: string; registration_id: string; code: string; full_name: string; event_slug: string; event_title: string }[]
  by_contact: boolean
  limit: number
}

/** limit: results per group (8 by default; "See all" asks for up to 50). */
export function useAdminSearch(q: string, limit = 8) {
  return useQuery({
    queryKey: ['admin-search', q, limit],
    enabled: q.length >= 2,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search', { p_q: q, p_limit: limit })
      if (error) throw error
      return data as unknown as SearchResults
    },
  })
}

export interface RolesOverview {
  admins: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null }[]
  moderators: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null; granted_at: string }[]
  staff: { user_id: string; full_name: string; avatar_url: string | null; role: EventRole; event_id: string; event_slug: string; event_title: string; is_admin: boolean; granted_at: string }[]
  circle_admins: number
}

export function useRolesOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-roles'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_roles_overview')
      if (error) throw error
      return data as unknown as RolesOverview
    },
  })
}

// ------------------------------------------------------------------ member management
export interface MemberListRow {
  id: string
  full_name: string
  avatar_url: string | null
  member_type: string | null
  branch: string | null
  grad_year: number | null
  city: string | null
  verification: VerificationStatus
  is_admin: boolean
  onboarded: boolean
  created_at: string
  last_sign_in_at: string | null
  notes: number
}

export const MEMBER_PAGE = 40

/** The filtered member list (admin_list_members), 40 at a time, with the total that matches. */
export function useMemberList(filter: Record<string, string>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['admin-members', filter],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('admin_list_members', { p_filter: filter, p_limit: MEMBER_PAGE, p_offset: pageParam })
      if (error) throw error
      return data as unknown as { total: number; rows: MemberListRow[] }
    },
    getNextPageParam: (last, all) => (last.rows.length === MEMBER_PAGE ? all.length * MEMBER_PAGE : undefined),
  })
}

/** Every id matching the filter (up to 2000), for "select all". */
export async function fetchMemberIds(filter: Record<string, string>): Promise<{ total: number; ids: string[] }> {
  const { data, error } = await supabase.rpc('admin_list_members', { p_filter: filter, p_ids_only: true })
  if (error) throw error
  return data as unknown as { total: number; ids: string[] }
}

export interface MemberView {
  id: string
  name: string
  filter: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export function useMemberViews(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-member-views'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('admin_member_views').select('*').order('name')
      if (error) throw error
      return data as MemberView[]
    },
  })
}

export type TimelineItem =
  | { at: string; kind: 'joined' | 'signin' }
  | { at: string; kind: 'admin' | 'admin_registration' | 'did'; action: string; details: Record<string, unknown>; actor_id?: string | null; actor_name?: string | null; target_table?: string }
  | { at: string; kind: 'registration'; code: string; status: RegistrationStatus; amount_paise: number; headcount: number; event_slug: string; event_title: string; checked_in_at: string | null }
  | { at: string; kind: 'payment'; code: string; status: PaymentStatus; method: string; amount_paise: number; utr: string | null; event_slug: string; event_title: string; reviewed_at: string | null }
  | { at: string; kind: 'report_by' | 'report_about'; target_type: string; reason: string; status: string; reporter_name?: string | null }
  | { at: string; kind: 'note'; id: string; body: string; actor_id: string | null; actor_name: string | null }

export interface Timeline {
  member: {
    id: string; full_name: string; avatar_url: string | null; branch: string | null; grad_year: number | null; city: string | null
    verification: VerificationStatus; is_admin: boolean; onboarded: boolean; created_at: string; last_sign_in_at: string | null; added_by_admin: boolean
  }
  items: TimelineItem[]
}

export function useMemberTimeline(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-member-timeline', id],
    enabled: enabled && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_member_timeline', { p_id: id! })
      if (error) throw error
      return data as unknown as Timeline
    },
  })
}

export interface DuplicateSide {
  id: string; full_name: string; grad_year: number | null; branch: string | null; city: string | null; verification: VerificationStatus
  is_admin: boolean; onboarded: boolean; created_at: string; last_sign_in_at: string | null
}
export interface DuplicatePair { a: DuplicateSide; b: DuplicateSide; reasons: ('phone' | 'name' | 'similar_name')[] }

export function useDuplicates(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-duplicates', q],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_member_duplicates', { p_q: q || null })
      if (error) throw error
      return data as unknown as DuplicatePair[]
    },
  })
}

export interface MergeSide extends Omit<DuplicateSide, never> { current_company: string | null; email: string | null; has_phone: boolean }
export interface MergePreview { keep: MergeSide; drop: MergeSide; moves: Record<string, number>; blocks: string[] }

export function useMergePreview(keep: string | null, drop: string | null) {
  return useQuery({
    queryKey: ['admin-merge-preview', keep, drop],
    enabled: !!keep && !!drop,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_merge_preview', { p_keep: keep!, p_drop: drop! })
      if (error) throw error
      return data as unknown as MergePreview
    },
  })
}

// ------------------------------------------------------------------ inbox, activity log, view as member
export interface InboxItem {
  kind: 'report' | 'flagged' | 'refund' | 'waitlist' | 'approval'
  key: string
  at: string
  count: number
  title: string
  detail: string | null
  href: string
  event_slug?: string
}

/** Everything waiting for a decision that my roles allow me to act on. */
export function useInbox(enabled = true) {
  return useQuery({
    queryKey: ['admin-inbox'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_inbox')
      if (error) throw error
      return (data as unknown as { items: InboxItem[] }).items
    },
  })
}

export interface AuditRow {
  id: number
  action: string
  target_table: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
  actor: string | null
  actor_name: string | null
}
export interface AuditFilter { actions: string[]; actor: string; q: string; from: string; to: string }
export const AUDIT_PAGE = 50

function auditArgs(f: AuditFilter, limit: number, before?: number) {
  return {
    p_actions: f.actions.length ? f.actions : null,
    p_actor: f.actor || null,
    p_q: f.q.trim() || null,
    p_from: f.from ? new Date(f.from).toISOString() : null,
    p_to: f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : null,
    p_limit: limit,
    p_before: before ?? null,
  }
}

export function useAuditSearch(filter: AuditFilter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['admin-audit', filter],
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('admin_audit_search', auditArgs(filter, AUDIT_PAGE, pageParam))
      if (error) throw error
      return data as unknown as AuditRow[]
    },
    getNextPageParam: (last) => (last.length === AUDIT_PAGE ? last[last.length - 1]!.id : undefined),
  })
}

/** Up to 1000 rows for the CSV download. */
export async function fetchAuditForExport(filter: AuditFilter): Promise<AuditRow[]> {
  const { data, error } = await supabase.rpc('admin_audit_search', auditArgs(filter, 1000))
  if (error) throw error
  return data as unknown as AuditRow[]
}

export interface MemberPreview {
  profile: { id: string; full_name: string; avatar_url: string | null; headline: string | null; branch: string | null; grad_year: number | null; city: string | null; current_title: string | null; current_company: string | null; verification: VerificationStatus; onboarded: boolean; is_admin: boolean; language: string | null; roles: string[] }
  registrations: { id: string; code: string; status: RegistrationStatus; headcount: number; amount_paise: number; event_title: string; event_slug: string; starts_at: string | null; checked_in: boolean; payments: { status: PaymentStatus; amount_paise: number; method: string }[] }[]
  groups: { id: string; name: string; kind: string; role: string }[]
  notifications: { kind: string; body: string | null; created_at: string; unread: boolean }[]
  unread: number
}

export function useViewAsMember(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-view-as', id],
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_view_as_member', { p_member: id! })
      if (error) throw error
      return data as unknown as MemberPreview
    },
  })
}

// ------------------------------------------------------------------ member import jobs and health
export interface ImportJob {
  id: string
  created_at: string
  total: number
  verified: boolean
  by: string | null
  pending: number
  processing: number
  done: number
  failed: number
  failures: { id: number; line: number; name: string | null; email: string | null; error: string | null }[]
}

/** The latest import jobs with progress; polls while anything is unfinished. */
export function useImportJobs(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-import-jobs'],
    enabled,
    refetchInterval: (q) => ((q.state.data as ImportJob[] | undefined)?.some((j) => j.pending + j.processing > 0) ? 2000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_import_jobs')
      if (error) throw error
      return data as unknown as ImportJob[]
    },
  })
}

export interface Health {
  generated_at: string
  database_bytes: number
  backup: { last: { at: string; ok: boolean; detail: string | null } | null; last_ok_at: string | null }
  storage: { bucket: string; objects: number; bytes: number }[]
  push: { subscriptions: number; last_used_at: string | null; requests_24h: number | null; failures_24h: number | null; configured: boolean }
  members: number
  import_failed_rows: number
  import_unfinished_rows: number
  audit_last_day: number
}

export function useHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-health'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_health')
      if (error) throw error
      return data as unknown as Health
    },
  })
}
