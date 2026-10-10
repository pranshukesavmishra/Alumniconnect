// Who can do what. This mirrors the database (has_event_cap / _admin_can / is_moderator); the database enforces it, this
// only decides which buttons and tabs to show. Pure so the matrix and wording are unit-tested.
import { hasAnyPerm, hasPerm, type AdminAccess } from './adminAccess'

export type EventRole = 'checkin' | 'treasurer' | 'content'
export type RoleId = 'admin' | 'treasurer' | 'content' | 'moderator' | 'checkin'

export interface Caps {
  /** payments, refunds, ledger, whole registration rows */
  finance: boolean
  /** waiting list, capacity, attendance report */
  registrations: boolean
  /** messages to attendees */
  messages: boolean
  /** programme, announcements, event questions, photos */
  programme: boolean
  /** scan tickets and see names */
  checkin: boolean
  /** any of the above management roles */
  manage: boolean
  /** verify payments, record cash */
  payments: boolean
  /** refunds and discounts */
  refunds: boolean
  /** the finance ledger */
  ledger: boolean
  /** download lists with money, phones and e-mail */
  exports: boolean
  /** post announcements on the event page */
  announce: boolean
  /** change event details, publish */
  editEvent: boolean
  /** ticket types and prices */
  tickets: boolean
  /** per-event settings (Drive archive...) */
  settings: boolean
  /** give event roles */
  team: boolean
}

export const NO_CAPS: Caps = {
  finance: false, registrations: false, messages: false, programme: false, checkin: false, manage: false,
  payments: false, refunds: false, ledger: false, exports: false, announce: false, editEvent: false, tickets: false, settings: false, team: false,
}

export const ALL_CAPS: Caps = {
  finance: true, registrations: true, messages: true, programme: true, checkin: true, manage: true,
  payments: true, refunds: true, ledger: true, exports: true, announce: true, editEvent: true, tickets: true, settings: true, team: true,
}

/** Capabilities from event roles alone (a treasurer, a content manager, a volunteer). */
function capsFromRoles(roles: readonly EventRole[]): Caps {
  const t = roles.includes('treasurer')
  const c = roles.includes('content')
  return {
    ...NO_CAPS,
    finance: t, registrations: t, payments: t, refunds: t, ledger: t, exports: t,
    messages: c, programme: c, announce: c,
    checkin: t || c || roles.includes('checkin'), manage: t || c,
  }
}

/** A legacy full admin or a super admin: every capability. Otherwise the event roles. */
export function capsFor(isAdmin: boolean, roles: readonly EventRole[]): Caps {
  return isAdmin ? ALL_CAPS : capsFromRoles(roles)
}

/** Event capabilities of an admin with a permission set, plus whatever event roles they hold on top. */
export function capsForAccess(access: AdminAccess | null | undefined, roles: readonly EventRole[]): Caps {
  if (access?.full) return ALL_CAPS
  const r = capsFromRoles(roles)
  if (!access?.is_admin) return r
  const has = (k: string) => hasPerm(access, k)
  return {
    finance: r.finance || hasAnyPerm(access, ['money_*', 'events_registrations']),
    registrations: r.registrations || has('events_registrations'),
    messages: r.messages || has('messages_send'),
    programme: r.programme || has('events_edit'),
    checkin: r.checkin || has('events_checkin') || has('events_registrations'),
    manage: r.manage || hasAnyPerm(access, ['events_*', 'money_*', 'messages_*']),
    payments: r.payments || has('money_payments'),
    refunds: r.refunds || has('money_refunds'),
    ledger: r.ledger || has('money_finance'),
    exports: r.exports || has('money_exports') || has('events_registrations'),
    announce: r.announce || has('messages_announcements'),
    editEvent: has('events_edit'),
    tickets: has('events_tickets'),
    settings: has('events_settings'),
    team: has('events_team'),
  }
}

export const ROLE_INFO: Record<RoleId, { label: string; blurb: string; scope: 'site' | 'event'; tone: 'primary' | 'accent' | 'success' | 'warning' | 'neutral' }> = {
  admin: { label: 'Admin', blurb: 'Runs the site. A super admin chooses exactly what each admin may do.', scope: 'site', tone: 'primary' },
  treasurer: { label: 'Treasurer', blurb: 'Payments, refunds, finance ledger, registrations and the waiting list for one event.', scope: 'event', tone: 'accent' },
  content: { label: 'Content manager', blurb: 'Messages to attendees, programme and announcements for one event.', scope: 'event', tone: 'success' },
  moderator: { label: 'Moderator', blurb: 'Reports, hiding content and slow mode across the community.', scope: 'site', tone: 'warning' },
  checkin: { label: 'Check-in volunteer', blurb: 'Scan tickets and see attendee names at one event.', scope: 'event', tone: 'neutral' },
}

export const ROLE_ORDER: RoleId[] = ['admin', 'treasurer', 'content', 'moderator', 'checkin']

/** Rows of the "what each role can do" table. */
export const MATRIX: { what: string; roles: RoleId[] }[] = [
  { what: 'Scan tickets and see attendee names', roles: ['admin', 'treasurer', 'content', 'checkin'] },
  { what: 'Verify payments, record cash, refunds, finance ledger', roles: ['admin', 'treasurer'] },
  { what: 'See and edit registrations, phone numbers and amounts', roles: ['admin', 'treasurer'] },
  { what: 'Waiting list, capacity, attendance report', roles: ['admin', 'treasurer'] },
  { what: 'Send messages and reminders to attendees', roles: ['admin', 'content'] },
  { what: 'Programme, announcements, event questions, photos', roles: ['admin', 'content'] },
  { what: 'Read reports, hide content, slow mode, hide meetups', roles: ['admin', 'moderator'] },
  { what: 'Create events, tickets and fees', roles: ['admin'] },
  { what: 'Give or remove event roles and moderators', roles: ['admin'] },
  { what: 'Edit, verify, import and merge members', roles: ['admin'] },
  { what: 'Approve messages to more than 200 people (a second admin)', roles: ['admin'] },
  { what: 'Read the activity log, preview what a member sees', roles: ['admin'] },
]

export function roleCan(role: RoleId, what: string): boolean {
  return !!MATRIX.find((m) => m.what === what)?.roles.includes(role)
}

/** What the signed-in person can do, in plain words (admin home and the roles page). */
export function describeAccess(isAdmin: boolean, moderator: boolean, staff: { role: EventRole; title: string }[]): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = []
  if (isAdmin) out.push({ label: ROLE_INFO.admin.label, detail: ROLE_INFO.admin.blurb })
  if (moderator && !isAdmin) out.push({ label: ROLE_INFO.moderator.label, detail: ROLE_INFO.moderator.blurb })
  for (const role of ['treasurer', 'content', 'checkin'] as const) {
    for (const s of staff.filter((x) => x.role === role)) out.push({ label: ROLE_INFO[role].label, detail: `${s.title}: ${ROLE_INFO[role].blurb.replace(/ for one event\.?$| at one event\.?$/, '')}.` })
  }
  return out
}

/** Roles a person holds on one event, strongest first. */
export function rolesOnEvent(staff: { event_id: string; role: EventRole }[], eventId: string): EventRole[] {
  const mine = staff.filter((s) => s.event_id === eventId).map((s) => s.role)
  return (['treasurer', 'content', 'checkin'] as const).filter((r) => mine.includes(r))
}
