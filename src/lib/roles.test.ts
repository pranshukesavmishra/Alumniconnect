import { describe, expect, it } from 'vitest'
import { capsFor, describeAccess, MATRIX, NO_CAPS, roleCan, rolesOnEvent } from './roles'

describe('capsFor', () => {
  it('admins can do everything', () => {
    expect(Object.values(capsFor(true, [])).every(Boolean)).toBe(true)
  })
  it('a treasurer handles money and registrations, not messages or the programme', () => {
    const c = capsFor(false, ['treasurer'])
    expect(c).toEqual({ finance: true, registrations: true, messages: false, programme: false, checkin: true, manage: true })
  })
  it('a content manager handles messages and the programme, not money', () => {
    const c = capsFor(false, ['content'])
    expect(c).toEqual({ finance: false, registrations: false, messages: true, programme: true, checkin: true, manage: true })
  })
  it('both roles together add up (what the old manager could do)', () => {
    const c = capsFor(false, ['treasurer', 'content'])
    expect(Object.values(c).every(Boolean)).toBe(true)
  })
  it('a volunteer only checks people in', () => {
    expect(capsFor(false, ['checkin'])).toEqual({ ...NO_CAPS, checkin: true })
    expect(capsFor(false, [])).toEqual(NO_CAPS)
  })
})

describe('matrix', () => {
  it('only admins give roles, only treasurers (and admins) touch money', () => {
    expect(roleCan('admin', 'Give or remove roles')).toBe(true)
    for (const r of ['treasurer', 'content', 'moderator', 'checkin'] as const) expect(roleCan(r, 'Give or remove roles')).toBe(false)
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
