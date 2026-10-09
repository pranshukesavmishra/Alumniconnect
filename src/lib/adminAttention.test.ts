import { describe, expect, it } from 'vitest'
import { attentionTotal, buildQueue, type Attention, type AttentionEvent } from './adminAttention'

const NOW = Date.parse('2026-10-09T10:00:00Z')
const ev = (o: Partial<AttentionEvent> = {}): AttentionEvent => ({
  id: 'e1', slug: 'meet', title: 'Alumni Meet', is_published: true, starts_at: null, registration_closes_at: null, capacity: null,
  payments_to_verify: 0, oldest_payment_at: null, unpaid: 0, seats_taken: 0, closes_soon: false, closed: false, missing_upi: false, ...o,
})
const att = (o: Partial<Attention> = {}): Attention => ({ generated_at: '', is_admin: true, global: null, events: [], ...o })
const global = { members_pending: 0, oldest_member_pending_at: null, reports_open: 0, circles_waiting: 0, jobs_expiring: 0 }

describe('buildQueue', () => {
  it('is empty when nothing waits', () => {
    expect(buildQueue(att({ global, events: [ev()] }), NOW)).toEqual([])
  })

  it('links each item to the screen that fixes it', () => {
    const q = buildQueue(
      att({ global: { ...global, members_pending: 3, reports_open: 1, circles_waiting: 2 }, events: [ev({ payments_to_verify: 4 })] }),
      NOW,
    )
    expect(Object.fromEntries(q.map((i) => [i.id, i.href]))).toEqual({
      'pay-e1': '/admin/events/meet?tab=payments',
      reports: '/admin/reports',
      members: '/admin/members?filter=pending',
      circles: '/admin/community',
    })
    expect(q.find((i) => i.id === 'members')?.count).toBe(3)
  })

  it('puts the most urgent first and keeps order stable within a level', () => {
    const q = buildQueue(
      att({ global: { ...global, members_pending: 1, reports_open: 2, circles_waiting: 1, jobs_expiring: 5 }, events: [ev({ payments_to_verify: 1, oldest_payment_at: '2026-10-09T09:00:00Z' })] }),
      NOW,
    )
    expect(q.map((i) => i.id)).toEqual(['reports', 'pay-e1', 'members', 'circles', 'jobs'])
  })

  it('turns an old unverified payment red and says how long it has waited', () => {
    const [fresh] = buildQueue(att({ events: [ev({ payments_to_verify: 1, oldest_payment_at: '2026-10-09T08:00:00Z' })] }), NOW)
    const [old] = buildQueue(att({ events: [ev({ payments_to_verify: 2, oldest_payment_at: '2026-10-05T10:00:00Z' })] }), NOW)
    expect(fresh!.tone).toBe('warning')
    expect(old!.tone).toBe('danger')
    expect(old!.detail).toContain('oldest 4 days ago')
    expect(old!.title).toBe('2 payments to verify')
  })

  it('uses singular wording', () => {
    const q = buildQueue(att({ global: { ...global, members_pending: 1, reports_open: 1, circles_waiting: 1, jobs_expiring: 1 } }), NOW)
    expect(q.map((i) => i.title)).toEqual(['1 report to review', '1 member to verify', '1 circle waiting for approval', '1 job expiring this week'])
  })

  it('warns about a published paid event without a UPI id, a nearly full event, closing dates and drafts', () => {
    const q = buildQueue(
      att({
        events: [
          ev({ missing_upi: true }),
          ev({ id: 'e2', slug: 'b', capacity: 100, seats_taken: 95 }),
          ev({ id: 'e3', slug: 'c', capacity: 10, seats_taken: 10 }),
          ev({ id: 'e4', slug: 'd', closes_soon: true, registration_closes_at: '2026-10-11T10:00:00Z', unpaid: 6 }),
          ev({ id: 'e5', slug: 'e', is_published: false, starts_at: '2026-10-20T10:00:00Z' }),
          ev({ id: 'e6', slug: 'f', is_published: false, starts_at: '2027-06-01T10:00:00Z' }),
        ],
      }),
      NOW,
    )
    const by = Object.fromEntries(q.map((i) => [i.id, i]))
    expect(by['upi-e1']!.tone).toBe('danger')
    expect(by['upi-e1']!.href).toBe('/admin/events/meet?tab=settings')
    expect(by['cap-e2']!.title).toBe('Almost full')
    expect(by['cap-e3']!.title).toBe('Event is full')
    expect(by['close-e4']!.title).toBe('Registration closes in 2 days')
    expect(by['close-e4']!.count).toBe(6)
    expect(by['draft-e5']).toBeDefined()
    expect(by['draft-e6']).toBeUndefined() // far-off drafts are not nagging
  })

  it('shows a treasurer only their events (no site-wide items without the global block)', () => {
    const q = buildQueue(att({ is_admin: false, events: [ev({ payments_to_verify: 1 })] }), NOW)
    expect(q.map((i) => i.id)).toEqual(['pay-e1'])
  })
})

describe('attentionTotal', () => {
  it('adds up what needs a decision', () => {
    expect(attentionTotal(undefined)).toBe(0)
    expect(attentionTotal(att({ global: { ...global, members_pending: 2, reports_open: 1, circles_waiting: 1, jobs_expiring: 9 }, events: [ev({ payments_to_verify: 3 }), ev({ payments_to_verify: 1 })] }))).toBe(8)
  })
})

describe('moderators and approvals', () => {
  it('a moderator sees only the reports', () => {
    const q = buildQueue(att({ global: { reports_open: 2 }, events: [] }), NOW)
    expect(q.map((x) => x.id)).toEqual(['reports'])
  })
  it('messages waiting for a second admin get their own item and count', () => {
    const a = att({ global: { ...global, messages_to_approve: 2 }, events: [] })
    const q = buildQueue(a, NOW)
    expect(q.find((x) => x.id === 'approvals')).toMatchObject({ count: 2, href: '/admin/inbox' })
    expect(attentionTotal(a)).toBe(2)
  })
})
