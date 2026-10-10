// What an admin may do. The database decides (every admin function and policy asks _admin_can('<permission>')); this file only
// decides which tiles, tabs and buttons to show, and describes permissions in plain words. Pure, so it is unit-tested.
// The list of keys mirrors admin_permission_catalog() in the database; an end-to-end check compares the two.

export interface Permission {
  key: string
  group: string
  label: string
  description: string
}

export const PERMISSIONS: readonly Permission[] = [
  { key: 'members_view', group: 'Members', label: 'See members', description: 'Search and open members, see their details, notes, timeline and what they see; saved views.' },
  { key: 'members_edit', group: 'Members', label: 'Edit members', description: 'Change a member’s profile and phone number, write private notes about them.' },
  { key: 'members_verify', group: 'Members', label: 'Verify members', description: 'Approve or reject new members, one by one or in bulk.' },
  { key: 'members_import', group: 'Members', label: 'Import members', description: 'Add many members at once from a spreadsheet.' },
  { key: 'members_merge', group: 'Members', label: 'Merge duplicates', description: 'Find duplicate members and merge them.' },
  { key: 'members_export', group: 'Members', label: 'Download member lists', description: 'Download member lists, with or without phone numbers and e-mail.' },
  { key: 'events_create', group: 'Events', label: 'Create and delete events', description: 'Start a new event; delete an event that has no registrations.' },
  { key: 'events_edit', group: 'Events', label: 'Edit events', description: 'Change event details, publish or hide an event, programme, questions, photos.' },
  { key: 'events_settings', group: 'Events', label: 'Event settings', description: 'Per-event settings such as the Drive archive and reminders.' },
  { key: 'events_tickets', group: 'Events', label: 'Tickets and fees', description: 'Ticket types, prices and day passes.' },
  { key: 'events_team', group: 'Events', label: 'Event teams', description: 'Give or remove treasurer, content manager and check-in roles for an event.' },
  { key: 'events_registrations', group: 'Events', label: 'Registrations and waiting list', description: 'See and edit registrations, waiting list, capacity, attendance report.' },
  { key: 'events_checkin', group: 'Events', label: 'Check-in', description: 'Scan tickets at the door and use day-of tools.' },
  { key: 'money_payments', group: 'Money', label: 'Verify payments', description: 'Approve or reject payments, record cash and bank payments, see payment proofs.' },
  { key: 'money_refunds', group: 'Money', label: 'Refunds and discounts', description: 'Record refunds and give discounts.' },
  { key: 'money_finance', group: 'Money', label: 'Finance ledger', description: 'The finance ledger and reconciliation report.' },
  { key: 'money_exports', group: 'Money', label: 'Money exports', description: 'Download registration, payment and ledger lists.' },
  { key: 'messages_announcements', group: 'Messages', label: 'Event announcements', description: 'Post announcements on an event page.' },
  { key: 'messages_send', group: 'Messages', label: 'Messages to registrants', description: 'Send, schedule, cancel and approve messages to registrants.' },
  { key: 'moderation_reports', group: 'Moderation', label: 'Reports', description: 'Read member reports and dismiss them.' },
  { key: 'moderation_hide', group: 'Moderation', label: 'Hide and restore content', description: 'Hide or restore posts, comments, chat messages and hidden items.' },
  { key: 'moderation_slowmode', group: 'Moderation', label: 'Slow mode', description: 'Slow down a busy group.' },
  { key: 'moderation_meetups', group: 'Moderation', label: 'City meetups', description: 'Hide, close or restore city meetups.' },
  { key: 'community_circles', group: 'Community', label: 'Circles and groups', description: 'Approve circles, manage groups and channels.' },
  { key: 'community_spotlight', group: 'Community', label: 'Spotlight', description: 'Choose the members in the spotlight.' },
  { key: 'community_batches', group: 'Community', label: 'Batch sizes', description: 'Set how many people each batch has.' },
  { key: 'gallery_manage', group: 'Photos', label: 'College gallery', description: 'Curate the college gallery: add, edit, feature and remove photos, albums and chips, and review member suggestions.' },
  { key: 'photos_moderate', group: 'Photos', label: 'Event photos', description: 'Approve, hide, delete and reorder event photos, choose who may upload, open photo votes and download an event photo ZIP.' },
  { key: 'analytics', group: 'Insight', label: 'Analytics', description: 'Growth and activity numbers.' },
  { key: 'audit', group: 'Insight', label: 'Activity log', description: 'Read and download the log of everything admins did.' },
  { key: 'health', group: 'Insight', label: 'Health and backups', description: 'Backup status, errors, storage, site health.' },
  { key: 'admins', group: 'Admins', label: 'See who the admins are', description: 'See the list of admins and owners (changing it is for super admins only).' },
]

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key)
export const PERMISSION_GROUPS: readonly string[] = [...new Set(PERMISSIONS.map((p) => p.group))]

export function permissionLabel(key: string): string {
  return PERMISSIONS.find((p) => p.key === key)?.label ?? key
}

export function permissionsByGroup(): { group: string; items: Permission[] }[] {
  return PERMISSION_GROUPS.map((group) => ({ group, items: PERMISSIONS.filter((p) => p.group === group) }))
}

export interface AdminAccess {
  is_admin: boolean
  is_super: boolean
  /** a super admin, or an admin without a limited grant: holds every permission, now and in future */
  full: boolean
  permissions: string[]
}

export const NO_ACCESS: AdminAccess = { is_admin: false, is_super: false, full: false, permissions: [] }

/** True when the person holds the permission. A trailing * asks about a whole family ('events_*'). */
export function hasPerm(a: AdminAccess | null | undefined, key: string): boolean {
  if (!a?.is_admin) return false
  if (a.full) return true
  if (key.endsWith('*')) return a.permissions.some((k) => k.startsWith(key.slice(0, -1)))
  return a.permissions.includes(key)
}

export function hasAnyPerm(a: AdminAccess | null | undefined, keys: readonly string[]): boolean {
  return keys.some((k) => hasPerm(a, k))
}

// ------------------------------------------------------------------ presets for "Make admin"
export interface Preset {
  id: string
  label: string
  blurb: string
  /** null = a FULL admin (every permission, including ones added later); [] = pick your own */
  permissions: string[] | null
}

const family = (prefix: string) => PERMISSION_KEYS.filter((k) => k.startsWith(prefix))

export const PRESETS: readonly Preset[] = [
  { id: 'full', label: 'Full admin', blurb: 'Everything an admin can do. Cannot make or remove admins: only a super admin can.', permissions: null },
  {
    id: 'finance_events',
    label: 'Finance & events',
    blurb: 'Create and run events, verify payments, refunds, the ledger, messages to registrants.',
    permissions: [...family('events_'), ...family('money_'), ...family('messages_')],
  },
  {
    id: 'content_community',
    label: 'Content & community',
    blurb: 'Edit events and announcements, approve circles, spotlight, batch sizes, analytics.',
    permissions: ['events_edit', 'messages_announcements', 'messages_send', ...family('community_'), 'photos_moderate', 'gallery_manage', 'analytics'],
  },
  { id: 'moderation', label: 'Moderation only', blurb: 'Reports, hiding content, slow mode and city meetups. Nothing else.', permissions: family('moderation_') },
  {
    id: 'members',
    label: 'Members & verification',
    blurb: 'See, edit, verify, import, merge and download members.',
    permissions: family('members_'),
  },
  {
    id: 'photos',
    label: 'Photos & gallery',
    blurb: 'Approve and organise event photos, run photo votes and curate the college gallery. Nothing else.',
    permissions: ['photos_moderate', 'gallery_manage'],
  },
  { id: 'custom', label: 'Custom', blurb: 'Tick exactly what this admin may do.', permissions: [] },
]

/** Which preset a saved permission set matches (null = full), or 'custom'. */
export function presetFor(perms: readonly string[] | null): string {
  if (perms === null) return 'full'
  const set = [...perms].sort().join()
  return PRESETS.find((p) => p.permissions && p.permissions.length > 0 && [...p.permissions].sort().join() === set)?.id ?? 'custom'
}

/** "12 of 29 permissions: Reports, Slow mode, ..." for review screens and tooltips. */
export function summarize(perms: readonly string[] | null): string {
  if (perms === null) return 'Full admin: everything except making or removing admins'
  if (perms.length === 0) return 'Nothing selected'
  const names = PERMISSION_KEYS.filter((k) => perms.includes(k)).map(permissionLabel)
  return `${names.length} of ${PERMISSION_KEYS.length} permissions: ${names.join(', ')}`
}

/** Permissions the admin does NOT hold, by label (the "may not" half of the review screen). */
export function missing(perms: readonly string[] | null): string[] {
  if (perms === null) return []
  return PERMISSION_KEYS.filter((k) => !perms.includes(k)).map(permissionLabel)
}

/** Keys the server would reject (unknown) in a list: used by the custom picker. */
export function unknownKeys(perms: readonly string[]): string[] {
  return perms.filter((k) => !PERMISSION_KEYS.includes(k))
}

// ------------------------------------------------------------------ tiles on the admin home
export interface Tile {
  id: 'members' | 'analytics' | 'community' | 'reports' | 'roles' | 'health' | 'activity' | 'inbox' | 'search'
  /** permission families that open it (any one of them) */
  any: string[]
}

export const TILES: readonly Tile[] = [
  { id: 'members', any: ['members_view'] },
  { id: 'analytics', any: ['analytics'] },
  { id: 'community', any: ['community_*'] },
  { id: 'reports', any: ['moderation_reports', 'moderation_hide', 'moderation_slowmode', 'moderation_meetups'] },
  { id: 'roles', any: ['admins', 'events_team'] },
  { id: 'health', any: ['health'] },
  { id: 'activity', any: ['audit'] },
  { id: 'inbox', any: ['moderation_reports', 'messages_send', 'money_refunds', 'events_registrations'] },
]

export function visibleTiles(a: AdminAccess | null | undefined): Tile['id'][] {
  return TILES.filter((t) => hasAnyPerm(a, t.any)).map((t) => t.id)
}
