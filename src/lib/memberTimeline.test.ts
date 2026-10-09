import { describe, expect, it } from 'vitest'
import { auditSummary } from './auditText'
import { describeTimelineItem } from './memberTimeline'

describe('member timeline', () => {
  it('reads admin actions with who did them', () => {
    const l = describeTimelineItem({ at: '', kind: 'admin', action: 'set_member_flags', actor_name: 'Boss', details: { verification: { from: 'pending', to: 'verified' }, bulk: true, note: 'batch list' } })
    expect(l).toMatchObject({ group: 'admin', title: 'Changed verification / admin access', by: 'Boss' })
    expect(l.detail).toBe('verification pending → verified · bulk action · “batch list”')
  })

  it('links registrations and payments to the event screen', () => {
    const r = describeTimelineItem({ at: '', kind: 'registration', code: 'JEC-AB12', status: 'under_review', amount_paise: 150000, headcount: 2, event_slug: 'meet', event_title: 'Alumni Meet', checked_in_at: null })
    expect(r.title).toBe('Registered for Alumni Meet')
    expect(r.detail).toContain('payment under review')
    expect(r.detail).toContain('2 people')
    expect(r.href).toBe('/admin/events/meet?tab=people&q=JEC-AB12')
    const p = describeTimelineItem({ at: '', kind: 'payment', code: 'JEC-AB12', status: 'submitted', method: 'upi', amount_paise: 100000, utr: '123456789012', event_slug: 'meet', event_title: 'Alumni Meet' })
    expect(p.title).toMatch(/^UPI payment of/)
    expect(p.detail).toContain('waiting to be verified')
    expect(p.href).toBe('/admin/events/meet?tab=payments&q=JEC-AB12')
  })

  it('reads notes, reports, merges and unknown kinds', () => {
    expect(describeTimelineItem({ at: '', kind: 'note', body: 'Called him', actor_name: 'Asha' })).toMatchObject({ group: 'notes', detail: 'Called him', by: 'Asha' })
    expect(describeTimelineItem({ at: '', kind: 'report_about', target_type: 'post', reason: 'spam', status: 'open', reporter_name: 'Ravi' })).toMatchObject({ title: 'Their post was reported', href: '/admin/reports' })
    expect(describeTimelineItem({ at: '', kind: 'something_new' }).title).toBe('something new')
    expect(auditSummary({ merged_id: 'x', name: 'Kiran Z', email: 'ki•••96@x.com' })).toBe('merged Kiran Z (ki•••96@x.com) into this one')
    expect(auditSummary({ count: 3, contact: true })).toBe('3 members, with phone and e-mail')
  })
})
