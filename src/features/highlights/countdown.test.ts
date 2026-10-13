import { describe, expect, it } from 'vitest'
import { landingNumber } from '../landing/api'
import { isSafeFameLink } from '../fame/api'
import { anniversaryKind, clockOffset, countdown, daysUntilIST } from './countdown'

describe('countdown', () => {
  const now = Date.parse('2026-10-13T10:00:00Z')
  it('splits the time left', () => {
    const c = countdown('2026-10-15T12:30:45Z', now)
    expect(c).toMatchObject({ days: 2, hours: 2, minutes: 30, seconds: 45, past: false, today: false })
    expect(c.totalMs).toBe(((2 * 24 + 2) * 3600 + 30 * 60 + 45) * 1000)
  })
  it('flags today and the past', () => {
    expect(countdown('2026-10-13T20:00:00Z', now)).toMatchObject({ days: 0, hours: 10, today: true, past: false })
    expect(countdown('2026-10-13T09:00:00Z', now)).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0, past: true, today: false })
    expect(countdown('not a date', now).past).toBe(true)
  })
  it('corrects a wrong device clock with the server offset', () => {
    // device is 5 minutes slow: the server says it is 10:05
    const offset = clockOffset('2026-10-13T10:05:00Z', now - 200, now + 200)
    expect(offset).toBe(5 * 60_000)
    expect(countdown('2026-10-13T10:10:00Z', now, offset)).toMatchObject({ minutes: 5, seconds: 0 })
    expect(clockOffset('garbage', now, now)).toBe(0)
  })
  it('counts calendar days in India time', () => {
    // 26 Dec 2026 10:00 IST, from 13 Oct 2026 23:00 IST (17:30 UTC) and from 14 Oct 00:30 IST (19:00 UTC)
    expect(daysUntilIST('2026-12-26T04:30:00Z', new Date('2026-10-13T17:30:00Z'))).toBe(74)
    expect(daysUntilIST('2026-12-26T04:30:00Z', new Date('2026-10-13T19:00:00Z'))).toBe(73)
    expect(daysUntilIST('2026-10-13T20:00:00Z', new Date('2026-10-13T19:00:00Z'))).toBe(0)
    expect(daysUntilIST('2026-10-13T18:00:00Z', new Date('2026-10-13T19:00:00Z'))).toBe(-1)
  })
})

describe('anniversaries', () => {
  it('names the special years', () => {
    expect(anniversaryKind(18)).toBe('plain')
    expect(anniversaryKind(20)).toBe('milestone')
    expect(anniversaryKind(25)).toBe('silver')
    expect(anniversaryKind(50)).toBe('golden')
    expect(anniversaryKind(1)).toBe('first')
    expect(anniversaryKind(0)).toBe('none')
    expect(anniversaryKind(null)).toBe('none')
  })
})

describe('landing numbers and links', () => {
  it('hides small numbers and rounds large ones', () => {
    expect(landingNumber(3)).toEqual({ show: false, value: 3, plus: false })
    expect(landingNumber(42)).toEqual({ show: true, value: 42, plus: false })
    expect(landingNumber(1234)).toEqual({ show: true, value: 1200, plus: true })
    expect(landingNumber(1200)).toEqual({ show: true, value: 1200, plus: false })
    expect(landingNumber(null, 0)).toEqual({ show: true, value: 0, plus: false })
  })
  it('allows https links only', () => {
    expect(isSafeFameLink('https://example.com/story')).toBe(true)
    expect(isSafeFameLink('http://example.com')).toBe(false)
    expect(isSafeFameLink('javascript:alert(1)')).toBe(false)
    expect(isSafeFameLink('https://exa mple.com')).toBe(false)
    expect(isSafeFameLink('https://example.com/"><script>')).toBe(false)
  })
})
