// Who an event message goes to: the draft the organiser builds on screen, and the plain JSON the database understands.

export type Segment = 'registered' | 'unpaid' | 'under_review' | 'confirmed' | 'not_checked_in' | 'checked_in' | 'cancelled' | 'not_registered' | 'waitlist'

export const SEGMENTS: { value: Segment; label: string; hint: string }[] = [
  { value: 'registered', label: 'Everyone registered', hint: 'Anyone with a registration that is not cancelled' },
  { value: 'unpaid', label: 'Registered, not paid yet', hint: 'Payment pending: they have not submitted a payment' },
  { value: 'under_review', label: 'Payment being verified', hint: 'They paid and are waiting for the treasurer' },
  { value: 'confirmed', label: 'Confirmed', hint: 'Paid and verified' },
  { value: 'not_checked_in', label: 'Confirmed, not arrived yet', hint: 'Confirmed but not checked in' },
  { value: 'checked_in', label: 'Already arrived', hint: 'Checked in at the gate' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Cancelled registrations' },
  { value: 'not_registered', label: 'Eligible, not registered yet', hint: 'Verified members of the eligible batches with no active registration' },
  { value: 'waitlist', label: 'On the waiting list', hint: 'Waiting for a place or holding an offer' },
]

export interface AudienceDraft {
  segment: Segment
  batchFrom: string
  batchTo: string
  city: string
  ticketTypeId: string
  viewId: string
}

export const emptyAudience = (segment: Segment = 'registered'): AudienceDraft => ({ segment, batchFrom: '', batchTo: '', city: '', ticketTypeId: '', viewId: '' })

/** Ticket types only make sense for people who registered. */
export const supportsTicketFilter = (s: Segment) => s !== 'not_registered' && s !== 'waitlist'

/** The JSON sent to the database: empty filters are left out. */
export function audienceJson(d: AudienceDraft): Record<string, string> {
  const out: Record<string, string> = { segment: d.segment }
  if (d.batchFrom.trim()) out.batch_from = d.batchFrom.trim()
  if (d.batchTo.trim()) out.batch_to = d.batchTo.trim()
  if (d.city.trim()) out.city = d.city.trim()
  if (d.ticketTypeId && supportsTicketFilter(d.segment)) out.ticket_type_id = d.ticketTypeId
  if (d.viewId) out.view_id = d.viewId
  return out
}

/** A message for the organiser if the draft cannot work, else null. */
export function validateAudience(d: AudienceDraft): string | null {
  const year = /^\d{4}$/
  if (d.batchFrom.trim() && !year.test(d.batchFrom.trim())) return 'Batch years look like 2005.'
  if (d.batchTo.trim() && !year.test(d.batchTo.trim())) return 'Batch years look like 2005.'
  if (d.batchFrom.trim() && d.batchTo.trim() && Number(d.batchFrom) > Number(d.batchTo)) return 'The first batch year is after the last one.'
  return null
}

export function describeAudience(aud: Record<string, unknown>, names: { tickets?: Map<string, string>; views?: Map<string, string> } = {}): string {
  const seg = SEGMENTS.find((s) => s.value === aud.segment)
  const parts: string[] = [seg?.label ?? 'Everyone registered']
  const from = aud.batch_from ? String(aud.batch_from) : ''
  const to = aud.batch_to ? String(aud.batch_to) : ''
  if (from && to) parts.push(from === to ? `batch ${from}` : `batches ${from}–${to}`)
  else if (from) parts.push(`batch ${from} or later`)
  else if (to) parts.push(`batch ${to} or earlier`)
  if (aud.city) parts.push(`city: ${String(aud.city)}`)
  if (aud.ticket_type_id) parts.push(`ticket: ${names.tickets?.get(String(aud.ticket_type_id)) ?? 'one type'}`)
  if (aud.view_id) parts.push(`view: ${names.views?.get(String(aud.view_id)) ?? 'saved view'}`)
  return parts.join(' · ')
}

/** Starting points: one tap fills the audience and a sensible message the organiser can edit. */
export const TEMPLATES: { id: string; label: string; segment: Segment; kind: 'announcement' | 'payment_reminder' | 'reminder'; title: string; body: string }[] = [
  { id: 'pay', label: 'Payment reminder', segment: 'unpaid', kind: 'payment_reminder', title: 'Complete your payment', body: 'Your Alumni Meet seat is not confirmed until the payment is submitted. Open the app to pay.' },
  { id: 'verify', label: 'Payment received', segment: 'under_review', kind: 'announcement', title: 'We are verifying your payment', body: 'Thank you. The treasurer will confirm your payment shortly. No action is needed.' },
  { id: 'arrive', label: 'Arrival reminder', segment: 'not_checked_in', kind: 'reminder', title: 'See you at the Alumni Meet', body: 'Bring your QR ticket (Me > My ticket). Registration desk opens at 9 am.' },
  { id: 'nudge', label: 'Invite eligible members', segment: 'not_registered', kind: 'announcement', title: 'Register for the Alumni Meet', body: 'Seats are filling up. Register now from the Meet tab.' },
]
