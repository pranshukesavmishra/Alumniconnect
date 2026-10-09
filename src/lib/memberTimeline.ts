// One member's history (admin_member_timeline) in plain words: what happened, who did it, where to look.
import { AUDIT_LABELS, auditSummary } from './auditText'
import { formatPaise } from './money'

export type TimelineGroup = 'admin' | 'events' | 'reports' | 'notes' | 'account'

/** The shape the database returns; kept loose so new kinds never break the screen. */
export interface RawTimelineItem {
  at: string
  kind: string
  [k: string]: unknown
}

export interface TimelineLine {
  group: TimelineGroup
  title: string
  detail: string
  by: string | null
  href: string | null
}

const REG_STATUS: Record<string, string> = { pending_payment: 'payment due', under_review: 'payment under review', confirmed: 'confirmed', cancelled: 'cancelled' }
const PAY_STATUS: Record<string, string> = { submitted: 'waiting to be verified', verified: 'verified', rejected: 'not received', refunded: 'refunded' }
const METHOD: Record<string, string> = { upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank transfer', waiver: 'Fee waived' }
const TARGET: Record<string, string> = { post: 'a post', comment: 'a comment', profile: 'a profile', message: 'a chat message' }
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function describeTimelineItem(i: RawTimelineItem): TimelineLine {
  switch (i.kind) {
    case 'joined':
      return { group: 'account', title: 'Joined the app', detail: '', by: null, href: null }
    case 'signin':
      return { group: 'account', title: 'Last signed in', detail: '', by: null, href: null }
    case 'admin':
    case 'admin_registration': {
      const details = (i.details ?? {}) as Record<string, unknown>
      const label = AUDIT_LABELS[s(i.action)] ?? s(i.action).replace(/_/g, ' ')
      return {
        group: 'admin',
        title: i.kind === 'admin_registration' ? `${label} (their registration)` : label,
        detail: auditSummary(details),
        by: s(i.actor_name) || (i.actor_id ? 'An admin' : 'System'),
        href: null,
      }
    }
    case 'did': {
      const details = (i.details ?? {}) as Record<string, unknown>
      return { group: 'admin', title: `They: ${(AUDIT_LABELS[s(i.action)] ?? s(i.action).replace(/_/g, ' ')).toLowerCase()}`, detail: auditSummary(details), by: null, href: null }
    }
    case 'registration': {
      const people = Number(i.headcount ?? 1)
      return {
        group: 'events',
        title: `Registered for ${s(i.event_title)}`,
        detail: [s(i.code), REG_STATUS[s(i.status)] ?? s(i.status), formatPaise(Number(i.amount_paise ?? 0)), people > 1 ? `${people} people` : '', i.checked_in_at ? 'checked in' : '']
          .filter(Boolean).join(' · '),
        by: null,
        href: `/admin/events/${s(i.event_slug)}?tab=people&q=${encodeURIComponent(s(i.code))}`,
      }
    }
    case 'payment':
      return {
        group: 'events',
        title: `${METHOD[s(i.method)] ?? s(i.method)} payment of ${formatPaise(Number(i.amount_paise ?? 0))}`,
        detail: [s(i.event_title), s(i.code), PAY_STATUS[s(i.status)] ?? s(i.status), i.utr ? `UTR ${s(i.utr)}` : ''].filter(Boolean).join(' · '),
        by: null,
        href: `/admin/events/${s(i.event_slug)}?tab=${i.status === 'submitted' ? 'payments' : 'people'}&q=${encodeURIComponent(s(i.code))}`,
      }
    case 'report_by':
      return { group: 'reports', title: `Reported ${TARGET[s(i.target_type)] ?? 'something'}`, detail: `“${s(i.reason)}” · ${s(i.status)}`, by: null, href: null }
    case 'report_about':
      return {
        group: 'reports',
        title: s(i.target_type) === 'profile' ? 'Their profile was reported' : `Their ${s(i.target_type) === 'message' ? 'chat message' : s(i.target_type)} was reported`,
        detail: `“${s(i.reason)}” · ${s(i.status)}`,
        by: s(i.reporter_name) || null,
        href: s(i.status) === 'open' ? '/admin/reports' : null,
      }
    case 'note':
      return { group: 'notes', title: 'Private note', detail: s(i.body), by: s(i.actor_name) || 'An admin', href: null }
    default:
      return { group: 'admin', title: s(i.kind).replace(/_/g, ' '), detail: '', by: null, href: null }
  }
}

export const TIMELINE_GROUPS: { id: TimelineGroup | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'admin', label: 'Admin actions' },
  { id: 'events', label: 'Events & payments' },
  { id: 'reports', label: 'Reports' },
  { id: 'notes', label: 'Notes' },
]
