import { describe, expect, it } from 'vitest'
import { dayKey, groupByDay, isoToIstInput, istInputToIso, type ProgrammeItem } from './programme'

const item = (id: string, starts_at: string): ProgrammeItem => ({ id, event_id: 'e', starts_at, ends_at: null, title: id, venue: null, details: null })

describe('programme times (Indian time)', () => {
  it('a typed time is always IST, whatever the phone clock says', () => {
    expect(istInputToIso('2026-12-26T10:00')).toBe('2026-12-26T04:30:00.000Z')
    expect(isoToIstInput('2026-12-26T04:30:00.000Z')).toBe('2026-12-26T10:00')
  })
  it('round-trips and rejects junk', () => {
    expect(isoToIstInput(istInputToIso('2026-12-26T23:45')!)).toBe('2026-12-26T23:45')
    expect(istInputToIso('26/12/2026 10:00')).toBeNull()
    expect(istInputToIso('')).toBeNull()
    expect(isoToIstInput(null)).toBe('')
  })
  it('groups by the Indian calendar day, so a late-night session stays on its own day', () => {
    // 23:30 IST on 26 Dec is 18:00 UTC the same day; 00:30 IST on 27 Dec is 19:00 UTC on the 26th
    expect(dayKey('2026-12-26T18:00:00Z')).toBe('2026-12-26')
    expect(dayKey('2026-12-26T19:00:00Z')).toBe('2026-12-27')
    const g = groupByDay([item('c', '2026-12-26T19:00:00Z'), item('a', '2026-12-26T04:30:00Z'), item('b', '2026-12-26T18:00:00Z')])
    expect(g.map((d) => [d.day, d.items.map((i) => i.id)])).toEqual([['2026-12-26', ['a', 'b']], ['2026-12-27', ['c']]])
    expect(g[0]!.heading).toBe('Saturday, 26 December')
  })
})
