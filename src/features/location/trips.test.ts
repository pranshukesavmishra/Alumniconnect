import { describe, expect, it } from 'vitest'
import { tripDates, todayIst, validateTrip } from './trips'

const today = '2026-10-09'

describe('validateTrip', () => {
  const ok = { cityId: 1259229, starts: '2026-10-20', ends: '2026-10-22' }
  it('accepts a normal trip, one starting today, and exactly 90 days', () => {
    expect(validateTrip(ok, today)).toBeNull()
    expect(validateTrip({ ...ok, starts: today, ends: today }, today)).toBeNull()
    expect(validateTrip({ ...ok, starts: '2026-10-10', ends: '2027-01-08' }, today)).toBeNull()
  })
  it('needs a city and both dates', () => {
    expect(validateTrip({ ...ok, cityId: null }, today)).toBe('trips.errCity')
    expect(validateTrip({ ...ok, ends: '' }, today)).toBe('trips.errDates')
  })
  it('rejects an end before the start, the past, and over 90 days', () => {
    expect(validateTrip({ ...ok, starts: '2026-10-22', ends: '2026-10-20' }, today)).toBe('trips.errOrder')
    expect(validateTrip({ ...ok, starts: '2026-10-01', ends: '2026-10-20' }, today)).toBe('trips.errPast')
    expect(validateTrip({ ...ok, starts: '2026-10-01', ends: '2026-10-05' }, today)).toBe('trips.errPast')
    expect(validateTrip({ ...ok, starts: '2026-10-10', ends: '2027-01-09' }, today)).toBe('trips.errLong')
  })
  it('lets an edit keep the start of a trip that already began', () => {
    expect(validateTrip({ ...ok, starts: '2026-10-07', ends: '2026-10-12' }, today, '2026-10-07')).toBeNull()
    expect(validateTrip({ ...ok, starts: '2026-10-06', ends: '2026-10-12' }, today, '2026-10-07')).toBe('trips.errPast')
  })
})

describe('dates', () => {
  it('todayIst uses the Indian calendar day', () => {
    expect(todayIst(new Date('2026-10-09T19:00:00Z'))).toBe('2026-10-10') // 00:30 IST next day
    expect(todayIst(new Date('2026-10-09T05:00:00Z'))).toBe('2026-10-09')
  })
  it('formats ranges', () => {
    expect(tripDates('2026-11-12', '2026-11-15', 'en-IN')).toContain('12')
    expect(tripDates('2026-11-12', '2026-11-12', 'en-IN')).not.toContain('–')
    expect(tripDates('2026-12-30', '2027-01-02', 'en-IN')).toContain('2027')
  })
})
