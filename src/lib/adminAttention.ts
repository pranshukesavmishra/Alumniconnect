// Turns the server's admin_attention() summary into the ordered "needs your attention" queue.
// Pure (no React, no network) so the ordering, wording and links are unit-tested.

export interface AttentionEvent {
  id: string
  slug: string
  title: string
  is_published: boolean
  starts_at: string | null
  registration_closes_at: string | null
  capacity: number | null
  payments_to_verify: number
  oldest_payment_at: string | null
  unpaid: number
  seats_taken: number
  closes_soon: boolean
  closed: boolean
  missing_upi: boolean
}

/** Admins get every field; a moderator only gets reports_open. */
export interface AttentionGlobal {
  members_pending?: number
  oldest_member_pending_at?: string | null
  reports_open: number
  circles_waiting?: number
  jobs_expiring?: number
  messages_to_approve?: number
}

export interface Attention {
  generated_at: string
  is_admin: boolean
  global: AttentionGlobal | null
  events: AttentionEvent[]
}

export type QueueTone = 'danger' | 'warning' | 'primary' | 'neutral'

export interface QueueItem {
  id: string
  tone: QueueTone
  /** How many things are waiting (shown as the badge); 0 for warnings without a count. */
  count: number
  title: string
  detail: string
  href: string
}

const DAY = 86_400_000

function waiting(iso: string | null, now: number): string {
  if (!iso) return ''
  const days = Math.floor((now - new Date(iso).getTime()) / DAY)
  return days >= 1 ? `, oldest ${days} ${days === 1 ? 'day' : 'days'} ago` : ''
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Money first (payments), then safety (reports), then people, then housekeeping. */
export function buildQueue(a: Attention, now: number = Date.now()): QueueItem[] {
  const out: QueueItem[] = []
  for (const e of a.events) {
    const base = `/admin/events/${e.slug}`
    if (e.payments_to_verify > 0) {
      const old = e.oldest_payment_at ? (now - new Date(e.oldest_payment_at).getTime()) / DAY : 0
      out.push({
        id: `pay-${e.id}`,
        tone: old >= 3 ? 'danger' : 'warning',
        count: e.payments_to_verify,
        title: `${plural(e.payments_to_verify, 'payment', 'payments')} to verify`,
        detail: `${e.title}${waiting(e.oldest_payment_at, now)}`,
        href: `${base}?tab=payments`,
      })
    }
    if (e.missing_upi) {
      out.push({ id: `upi-${e.id}`, tone: 'danger', count: 0, title: 'No UPI ID set', detail: `${e.title} is published with paid tickets but members cannot pay`, href: `${base}?tab=settings` })
    }
    if (e.capacity && e.seats_taken >= e.capacity * 0.9 && e.is_published) {
      out.push({
        id: `cap-${e.id}`,
        tone: 'warning',
        count: 0,
        title: e.seats_taken >= e.capacity ? 'Event is full' : 'Almost full',
        detail: `${e.title}: ${e.seats_taken} of ${e.capacity} seats taken`,
        href: `${base}?tab=people`,
      })
    }
    if (e.closes_soon && e.registration_closes_at) {
      const days = Math.max(0, Math.ceil((new Date(e.registration_closes_at).getTime() - now) / DAY))
      out.push({
        id: `close-${e.id}`,
        tone: 'primary',
        count: e.unpaid,
        title: `Registration closes ${days <= 1 ? 'within a day' : `in ${days} days`}`,
        detail: e.unpaid > 0 ? `${e.title}: ${plural(e.unpaid, 'registration is', 'registrations are')} still unpaid` : e.title,
        href: `${base}?tab=people`,
      })
    }
    if (!e.is_published && e.starts_at && new Date(e.starts_at).getTime() - now < 30 * DAY && new Date(e.starts_at).getTime() > now) {
      out.push({ id: `draft-${e.id}`, tone: 'warning', count: 0, title: 'Still a draft', detail: `${e.title} is not visible to members yet`, href: `${base}?tab=settings` })
    }
  }
  const g = a.global
  if (g) {
    if (g.reports_open > 0) {
      out.push({ id: 'reports', tone: 'danger', count: g.reports_open, title: `${plural(g.reports_open, 'report', 'reports')} to review`, detail: 'Posts, comments and messages members flagged', href: '/admin/reports' })
    }
    if ((g.messages_to_approve ?? 0) > 0) {
      out.push({
        id: 'approvals',
        tone: 'warning',
        count: g.messages_to_approve!,
        title: `${plural(g.messages_to_approve!, 'message', 'messages')} to approve`,
        detail: 'Sent to more than 200 people: a second admin must approve',
        href: '/admin/inbox',
      })
    }
    if ((g.members_pending ?? 0) > 0) {
      out.push({
        id: 'members',
        tone: 'warning',
        count: g.members_pending!,
        title: `${plural(g.members_pending!, 'member', 'members')} to verify`,
        detail: `Finished their profile and wait for approval${waiting(g.oldest_member_pending_at ?? null, now)}`,
        href: '/admin/members?filter=pending&profile=yes&sort=oldest', // exactly the people the count is about: finished profile, waiting, longest first
      })
    }
    if ((g.circles_waiting ?? 0) > 0) {
      out.push({ id: 'circles', tone: 'primary', count: g.circles_waiting!, title: `${plural(g.circles_waiting!, 'circle', 'circles')} waiting for approval`, detail: 'Proposed by members', href: '/admin/community' })
    }
    if ((g.jobs_expiring ?? 0) > 0) {
      out.push({ id: 'jobs', tone: 'neutral', count: g.jobs_expiring!, title: `${plural(g.jobs_expiring!, 'job', 'jobs')} expiring this week`, detail: 'They disappear from the board when they expire', href: '/jobs' })
    }
  }
  const rank: Record<QueueTone, number> = { danger: 0, warning: 1, primary: 2, neutral: 3 }
  return out.map((x, i) => [x, i] as const).sort((p, q) => rank[p[0].tone] - rank[q[0].tone] || p[1] - q[1]).map(([x]) => x)
}

/** Total number of things waiting, for the badge on the admin entry point. */
export function attentionTotal(a: Attention | undefined): number {
  if (!a) return 0
  return a.events.reduce((n, e) => n + e.payments_to_verify, 0) + (a.global ? (a.global.members_pending ?? 0) + a.global.reports_open + (a.global.circles_waiting ?? 0) + (a.global.messages_to_approve ?? 0) : 0)
}
