// Member-list filters for the admin Members screen: one shape shared by the URL (so a filtered list can be
// bookmarked or deep-linked from the admin home), saved views (stored as JSON in the database) and the
// admin_list_members function (which validates the same keys again on the server).

export type MemberStatus = 'all' | 'pending' | 'verified' | 'rejected' | 'admins'
export type MemberSort = 'newest' | 'oldest' | 'name' | 'batch'

export interface MemberFilter {
  q?: string
  status?: MemberStatus
  onboarded?: 'yes' | 'no'
  /** joined more than this many days ago */
  older?: number
  signin?: 'yes' | 'never'
  branch?: string
  batch_from?: number
  batch_to?: number
  city?: string
  type?: 'alumnus' | 'student' | 'faculty'
  sort?: MemberSort
}

const STATUSES: MemberStatus[] = ['all', 'pending', 'verified', 'rejected', 'admins']
const SORTS: MemberSort[] = ['newest', 'oldest', 'name', 'batch']
const TYPES = ['alumnus', 'student', 'faculty'] as const

const year = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^(19|20)\d{2}$/.test(s) ? Number(s) : undefined
}
const days = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^\d{1,4}$/.test(s) && Number(s) > 0 ? Number(s) : undefined
}
const text = (v: unknown, max = 80) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  return s || undefined
}
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined)

/** Keeps only known keys with valid values; drops defaults so equal filters compare equal. */
export function cleanFilter(raw: Record<string, unknown> | null | undefined): MemberFilter {
  const r = raw ?? {}
  const f: MemberFilter = {
    q: text(r.q, 100),
    status: oneOf(r.status, STATUSES),
    onboarded: oneOf(r.onboarded, ['yes', 'no'] as const),
    older: days(r.older),
    signin: oneOf(r.signin, ['yes', 'never'] as const),
    branch: text(r.branch),
    batch_from: year(r.batch_from),
    batch_to: year(r.batch_to),
    city: text(r.city),
    type: oneOf(r.type, TYPES),
    sort: oneOf(r.sort, SORTS),
  }
  if (f.status === 'all') delete f.status
  if (f.sort === 'newest') delete f.sort
  for (const k of Object.keys(f) as (keyof MemberFilter)[]) if (f[k] === undefined) delete f[k]
  return f
}

// URL names: "filter" stays the status key so links from the admin home (?filter=pending) keep working.
const URL_KEYS: [keyof MemberFilter, string][] = [
  ['q', 'q'], ['status', 'filter'], ['onboarded', 'profile'], ['older', 'older'], ['signin', 'signin'], ['branch', 'branch'],
  ['batch_from', 'from'], ['batch_to', 'to'], ['city', 'city'], ['type', 'type'], ['sort', 'sort'],
]

export function filterFromParams(p: URLSearchParams): MemberFilter {
  const raw: Record<string, unknown> = {}
  for (const [k, name] of URL_KEYS) if (p.has(name)) raw[k] = p.get(name)
  return cleanFilter(raw)
}

export function filterToParams(f: MemberFilter): Record<string, string> {
  const c = cleanFilter(f as Record<string, unknown>)
  const out: Record<string, string> = {}
  for (const [k, name] of URL_KEYS) if (c[k] !== undefined) out[name] = String(c[k])
  return out
}

/** What the database function receives: strings, as it validates them itself. */
export function toRpcFilter(f: MemberFilter): Record<string, string> {
  const c = cleanFilter(f as Record<string, unknown>)
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)]))
}

export function sameFilter(a: MemberFilter, b: MemberFilter): boolean {
  return JSON.stringify(toRpcFilter(a)) === JSON.stringify(toRpcFilter(b))
}

/** How many of the "more filters" are on (search box and status have their own controls). */
export function extraFilterCount(f: MemberFilter): number {
  const c = cleanFilter(f as Record<string, unknown>)
  return (['onboarded', 'older', 'signin', 'branch', 'batch_from', 'batch_to', 'city', 'type', 'sort'] as const).filter((k) => c[k] !== undefined).length
}

const STATUS_WORDS: Record<MemberStatus, string> = { all: 'All members', pending: 'Not yet verified', verified: 'Verified', rejected: 'Rejected', admins: 'Admins' }
const SORT_WORDS: Record<MemberSort, string> = { newest: 'Newest first', oldest: 'Oldest first', name: 'By name', batch: 'By batch' }

/** Plain words for each active filter, e.g. ["Not yet verified", "Joined over 3 days ago", "Batch 2001–2005"]. */
export function describeFilter(f: MemberFilter): string[] {
  const c = cleanFilter(f as Record<string, unknown>)
  const out: string[] = []
  if (c.status) out.push(STATUS_WORDS[c.status])
  if (c.q) out.push(`“${c.q}”`)
  if (c.onboarded) out.push(c.onboarded === 'yes' ? 'Profile completed' : 'Profile not completed')
  if (c.older) out.push(`Joined over ${c.older} day${c.older === 1 ? '' : 's'} ago`)
  if (c.signin) out.push(c.signin === 'never' ? 'Never signed in' : 'Has signed in')
  if (c.branch) out.push(c.branch)
  if (c.batch_from && c.batch_to) out.push(c.batch_from === c.batch_to ? `Batch ${c.batch_from}` : `Batch ${c.batch_from}–${c.batch_to}`)
  else if (c.batch_from) out.push(`Batch ${c.batch_from} or later`)
  else if (c.batch_to) out.push(`Batch ${c.batch_to} or earlier`)
  if (c.city) out.push(`City: ${c.city}`)
  if (c.type) out.push(c.type === 'alumnus' ? 'Alumni' : c.type === 'student' ? 'Students' : 'Faculty')
  if (c.sort) out.push(SORT_WORDS[c.sort])
  return out
}

/** Ready-made views every admin gets, next to the ones the committee saves. */
export const PRESET_VIEWS: { id: string; name: string; filter: MemberFilter }[] = [
  { id: 'waiting-3', name: 'Waiting over 3 days', filter: { status: 'pending', onboarded: 'yes', older: 3, sort: 'oldest' } },
  { id: 'waiting', name: 'Not yet verified', filter: { status: 'pending' } },
  { id: 'never', name: 'Never signed in', filter: { signin: 'never' } },
  { id: 'incomplete', name: 'Profile not completed', filter: { onboarded: 'no' } },
  { id: 'admins', name: 'Admins', filter: { status: 'admins' } },
]
