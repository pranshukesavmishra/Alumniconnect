// Who can do what. This mirrors the database (has_event_cap / is_moderator / is_admin); the database enforces it, this
// only decides which buttons and tabs to show. Pure so the matrix and wording are unit-tested.

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
}

export const NO_CAPS: Caps = { finance: false, registrations: false, messages: false, programme: false, checkin: false, manage: false }

export function capsFor(isAdmin: boolean, roles: readonly EventRole[]): Caps {
  if (isAdmin) return { finance: true, registrations: true, messages: true, programme: true, checkin: true, manage: true }
  const t = roles.includes('treasurer')
  const c = roles.includes('content')
  return { finance: t, registrations: t, messages: c, programme: c, checkin: t || c || roles.includes('checkin'), manage: t || c }
}

export const ROLE_INFO: Record<RoleId, { label: string; blurb: string; scope: 'site' | 'event'; tone: 'primary' | 'accent' | 'success' | 'warning' | 'neutral' }> = {
  admin: { label: 'Admin', blurb: 'Everything: members, every event, roles, the activity log.', scope: 'site', tone: 'primary' },
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
  { what: 'Give or remove roles', roles: ['admin'] },
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
