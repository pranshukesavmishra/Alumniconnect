import { describe, expect, it } from 'vitest'
import { ALL_CAPS, capsFor, capsForAccess, describeAccess, MATRIX, NO_CAPS, roleCan, rolesOnEvent } from './roles'
import type { AdminAccess } from './adminAccess'

describe('capsFor', () => {
  it('admins can do everything', () => {
    expect(Object.values(capsFor(true, [])).every(Boolean)).toBe(true)
  })
  it('a treasurer handles money and registrations, not messages or the programme', () => {
    const c = capsFor(false, ['treasurer'])
    expect(c).toEqual({ ...NO_CAPS, finance: true, registrations: true, payments: true, refunds: true, ledger: true, exports: true, checkin: true, manage: true })
  })
  it('a content manager handles messages and the programme, not money', () => {
    const c = capsFor(false, ['content'])
    expect(c).toEqual({ ...NO_CAPS, messages: true, programme: true, announce: true, checkin: true, manage: true })
  })
  it('both roles together add up (what the old manager could do)', () => {
    const c = capsFor(false, ['treasurer', 'content'])
    expect(c).toEqual({ ...ALL_CAPS, editEvent: false, tickets: false, settings: false, team: false })
  })
  it('a volunteer only checks people in', () => {
    expect(capsFor(false, ['checkin'])).toEqual({ ...NO_CAPS, checkin: true })
    expect(capsFor(false, [])).toEqual(NO_CAPS)
  })
})

describe('matrix', () => {
  it('only admins give roles, only treasurers (and admins) touch money', () => {
    expect(roleCan('admin', 'Give or remove event roles and moderators')).toBe(true)
    for (const r of ['treasurer', 'content', 'moderator', 'checkin'] as const) expect(roleCan(r, 'Give or remove event roles and moderators')).toBe(false)
    expect(roleCan('content', 'Verify payments, record cash, refunds, finance ledger')).toBe(false)
    expect(roleCan('moderator', 'Read reports, hide content, slow mode, hide meetups')).toBe(true)
  })
  it('lists every row once', () => {
    expect(new Set(MATRIX.map((m) => m.what)).size).toBe(MATRIX.length)
  })
})

describe('describeAccess / rolesOnEvent', () => {
  it('names each role with its event', () => {
    const a = describeAccess(false, true, [{ role: 'treasurer', title: 'Meet' }, { role: 'checkin', title: 'Dinner' }])
    expect(a.map((x) => x.label)).toEqual(['Moderator', 'Treasurer', 'Check-in volunteer'])
    expect(a[1]!.detail.startsWith('Meet:')).toBe(true)
  })
  it('orders roles on one event', () => {
    expect(rolesOnEvent([{ event_id: 'e', role: 'checkin' }, { event_id: 'f', role: 'content' }, { event_id: 'e', role: 'treasurer' }], 'e')).toEqual(['treasurer', 'checkin'])
  })
})

describe('capsForAccess (limited admins)', () => {
  const limited = (permissions: string[]): AdminAccess => ({ is_admin: true, is_super: false, full: false, permissions })
  it('a full admin and a super admin hold every capability', () => {
    expect(capsForAccess({ is_admin: true, is_super: false, full: true, permissions: [] }, [])).toEqual(ALL_CAPS)
  })
  it('a moderation-only admin holds no event capability', () => {
    expect(capsForAccess(limited(['moderation_reports', 'moderation_hide']), [])).toEqual(NO_CAPS)
  })
  it('each money permission opens only its own part', () => {
    const c = capsForAccess(limited(['money_refunds']), [])
    expect(c).toEqual({ ...NO_CAPS, finance: true, refunds: true, manage: true })
    expect(capsForAccess(limited(['money_payments']), []).payments).toBe(true)
    expect(capsForAccess(limited(['money_finance']), []).ledger).toBe(true)
    expect(capsForAccess(limited(['money_exports']), [])).toEqual({ ...NO_CAPS, finance: true, exports: true, manage: true })
  })
  it('event permissions: registrations also open the door and exports', () => {
    const c = capsForAccess(limited(['events_registrations']), [])
    expect(c).toEqual({ ...NO_CAPS, finance: true, registrations: true, checkin: true, exports: true, manage: true })
    expect(capsForAccess(limited(['events_checkin']), [])).toEqual({ ...NO_CAPS, checkin: true, manage: true })
    expect(capsForAccess(limited(['events_edit']), [])).toEqual({ ...NO_CAPS, programme: true, editEvent: true, manage: true })
  })
  it('event roles add to the permissions', () => {
    const c = capsForAccess(limited(['members_view']), ['content'])
    expect(c).toEqual(capsFor(false, ['content']))
  })
  it('a member without admin access gets only their event roles', () => {
    expect(capsForAccess({ is_admin: false, is_super: false, full: false, permissions: [] }, ['checkin'])).toEqual(capsFor(false, ['checkin']))
    expect(capsForAccess(null, [])).toEqual(NO_CAPS)
  })
})
