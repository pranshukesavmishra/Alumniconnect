import { describe, expect, it } from 'vitest'
import { fitFontSize, initials, truncateToWidth, wrapText } from './canvasText'

// every character is 10 units wide
const mono = (s: string) => Array.from(s).length * 10

describe('wrapText', () => {
  it('wraps greedily by words', () => {
    expect(wrapText(mono, 'Class of 2008 yearbook is here', 100)).toEqual(['Class of', '2008', 'yearbook', 'is here'])
  })
  it('keeps text that fits on one line', () => {
    expect(wrapText(mono, 'Hello JEC', 200)).toEqual(['Hello JEC'])
  })
  it('honours explicit new lines', () => {
    expect(wrapText(mono, 'One\nTwo', 200)).toEqual(['One', 'Two'])
  })
  it('breaks a word longer than the line', () => {
    expect(wrapText(mono, 'abcdefghijkl', 50)).toEqual(['abcde', 'fghij', 'kl'])
  })
  it('limits lines and ends with an ellipsis', () => {
    const lines = wrapText(mono, 'one two three four five six seven', 100, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(mono(lines[1]!)).toBeLessThanOrEqual(100)
  })
  it('returns nothing for empty text', () => {
    expect(wrapText(mono, '   ', 100)).toEqual([])
  })
  it('keeps Devanagari words whole when they fit', () => {
    expect(wrapText(mono, 'जबलपुर इंजीनियरिंग', 120)).toEqual(['जबलपुर', 'इंजीनियरिंग'])
  })
})

describe('truncateToWidth', () => {
  it('leaves short text alone', () => expect(truncateToWidth(mono, 'Short', 100)).toBe('Short'))
  it('adds an ellipsis when cut', () => {
    const t = truncateToWidth(mono, 'Jabalpur Engineering College', 100)
    expect(t.endsWith('…')).toBe(true)
    expect(mono(t)).toBeLessThanOrEqual(100)
  })
})

describe('fitFontSize', () => {
  const at = (size: number) => (s: string) => Array.from(s).length * size
  it('finds the largest size that fits on one line', () => {
    expect(fitFontSize(at, 'abcdefghij', 200, 40, 10)).toBe(20)
  })
  it('allows more lines', () => {
    expect(fitFontSize(at, 'abcde abcde', 100, 40, 10, 2)).toBe(20)
  })
  it('never goes below the minimum', () => {
    expect(fitFontSize(at, 'a very long name that will not fit', 50, 40, 12)).toBe(12)
  })
})

describe('initials', () => {
  it('uses first and last names', () => expect(initials('Rakesh Kumar Sharma')).toBe('RS'))
  it('handles one name', () => expect(initials('asha')).toBe('A'))
  it('handles empty', () => expect(initials('  ')).toBe(''))
})
