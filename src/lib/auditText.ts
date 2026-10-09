import { formatPaise } from './money'

// Plain words for activity-log entries: shared by the activity log and each member's timeline.

export const AUDIT_LABELS: Record<string, string> = {
  update_member: 'Edited a member profile',
  set_member_flags: 'Changed verification / admin access',
  update_registration: 'Edited a registration',
  cancel_registration: 'Cancelled a registration',
  reopen_registration: 'Reopened a registration',
  verify_payment: 'Verified a payment',
  reject_payment: 'Marked a payment as not received',
  record_cash: 'Recorded a cash payment',
  record_bank_transfer: 'Recorded a bank transfer',
  record_waiver: 'Waived a fee',
  post_announcement: 'Sent an announcement',
  event_programme_insert: 'Added a programme session',
  event_programme_update: 'Changed a programme session',
  event_programme_delete: 'Removed a programme session',
  hide_help: 'Hid a help request',
  restore_help: 'Restored a help request',
  hide_job: 'Hid a job posting',
  restore_job: 'Restored a job posting',
  hide_business: 'Hid a business listing',
  meetup_hidden: 'Hid a city meetup',
  meetup_closed: 'Closed a city meetup',
  meetup_restored: 'Restored a city meetup',
  meetup_member_removed: 'Removed someone from a city meetup',
  restore_business: 'Restored a business listing',
  hide_post: 'Hid a post',
  restore_post: 'Restored a post',
  hide_comment: 'Hid a comment',
  restore_comment: 'Restored a comment',
  create_member: 'Added a member',
  view_member_email: 'Looked up a member’s email',
  remove_message: 'Removed a chat message',
  dismiss_reports: 'Dismissed reports',
  slow_mode: 'Changed slow mode in a group',
  events_insert: 'Created an event',
  events_update: 'Edited an event',
  events_delete: 'Deleted an event',
  event_ticket_types_insert: 'Added a ticket type',
  event_ticket_types_update: 'Edited a ticket type',
  event_ticket_types_delete: 'Removed a ticket type',
  event_staff_insert: 'Added a team member',
  event_staff_update: 'Changed a team member’s role',
  event_staff_delete: 'Removed a team member',
  event_settings_insert: 'Set up event payment details',
  event_settings_update: 'Changed event payment settings',
  event_settings_delete: 'Removed event payment settings',
  search_contact: 'Looked people up by phone or e-mail',
  export_members: 'Exported members',
  add_member_note: 'Added a private note',
  delete_member_note: 'Removed a private note',
  save_member_view: 'Saved a member view',
  delete_member_view: 'Removed a member view',
  import_preview: 'Checked a member import file',
  dismiss_duplicate: 'Marked two members as different people',
  merge_member: 'Merged a duplicate profile',
  send_event_message: 'Sent a message to event attendees',
  schedule_event_message: 'Scheduled a message to event attendees',
  cancel_event_message: 'Cancelled a scheduled message',
  record_refund: 'Recorded a refund',
  refund_payment: 'Marked a payment as refunded',
  export_ledger: 'Downloaded the finance ledger',
  transfer_registration: 'Transferred a registration to another member',
  promote_waitlist: 'Offered a place to someone on the waiting list',
  run_waitlist: 'Offered free places to the waiting list',
  remove_waitlist: 'Removed someone from the waiting list',
  add_waitlist: 'Added someone to the waiting list',
  save_event_ops: 'Changed waiting list or daily capacity settings',
}

export function auditSummary(details: Record<string, unknown>): string {
  const d = details as Record<string, any>
  const parts: string[] = []
  if (d.code) parts.push(String(d.code))
  if (typeof d.amount === 'number') parts.push(formatPaise(d.amount))
  if (d.amount?.from !== undefined && d.amount.from !== d.amount.to) parts.push(`${formatPaise(d.amount.from)} → ${formatPaise(d.amount.to)}`)
  if (d.status?.from && d.status.from !== d.status.to) parts.push(`${d.status.from} → ${d.status.to}`)
  if (d.utr) parts.push(`UTR ${d.utr}`)
  if (d.changed) parts.push(`changed: ${(Array.isArray(d.changed) ? d.changed : Object.keys(d.changed)).join(', ')}`)
  if (typeof d.seconds === 'number') parts.push(d.seconds ? `${d.seconds}s between messages` : 'off')
  if (d.verification?.from !== d.verification?.to && d.verification) parts.push(`verification ${d.verification.from} → ${d.verification.to}`)
  if (d.is_admin && d.is_admin.from !== d.is_admin.to) parts.push(d.is_admin.to ? 'made admin' : 'admin removed')
  if (d.bulk) parts.push('bulk action')
  if (typeof d.count === 'number' && typeof d.title !== 'string') parts.push(`${d.count} member${d.count === 1 ? '' : 's'}${d.contact ? ', with phone and e-mail' : ''}`)
  if (d.merged_id) parts.push(`merged ${d.name || 'a profile'}${d.email ? ` (${d.email})` : ''} into this one`)
  if (typeof d.new === 'number') parts.push(`${d.new} new, ${d.exists} already members, ${d.duplicate} possible duplicates, ${d.invalid} with problems`)
  if (d.from?.name && d.to?.name) parts.push(`${d.from.name} → ${d.to.name}`)
  else if (d.name && d.headcount !== undefined) parts.push(`${String(d.name)} (${d.headcount})`)
  if (typeof d.title === 'string') parts.push(`“${d.title}”${typeof d.count === 'number' ? ` to ${d.count}` : ''}`)
  if (typeof d.offered === 'number') parts.push(`${d.offered} offered`)
  if (d.method && d.amount && d.payment_id) parts.push(`via ${String(d.method).replace('_', ' ')}${d.reference ? ` (${d.reference})` : ''}`)
  if (d.reason) parts.push(`“${d.reason}”`)
  else if (d.note) parts.push(`“${d.note}”`)
  return parts.join(' · ')
}
