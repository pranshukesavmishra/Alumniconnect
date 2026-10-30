import { describe, expect, it } from 'vitest'
import { ilikeTerm, pushRecent, stepIndex } from './recent'

describe('recent searches', () => {
  it('puts the newest first, de-duplicates case-insensitively and caps the list', () => {
    expect(pushRecent([], '  jobs  ')).toEqual(['jobs'])
    expect(pushRecent(['Jobs', 'pune'], 'jobs')).toEqual(['jobs', 'pune'])
    expect(pushRecent(['a1', 'b2', 'c3'], 'd4', 3)).toEqual(['d4', 'a1', 'b2'])
    expect(pushRecent(['pune'], 'x')).toEqual(['pune']) // too short to remember
  })

  it('makes a typed term safe for ilike', () => {
    expect(ilikeTerm('100%_off, (now)')).toBe('100 off now')
    expect(ilikeTerm('  reunion  ')).toBe('reunion')
  })

  it('moves the highlight with wrap-around', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})
