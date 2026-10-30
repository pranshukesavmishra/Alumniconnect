import { describe, expect, it } from 'vitest'
import { CARD_W, layoutCard, wrapText, type Measure } from './shareCard'

// a monospace stand-in: every character is (font size × 0.5) wide
const mono: Measure = (s, font) => s.length * Number(/(\d+)px/.exec(font)![1]) * 0.5
const F = '600 20px serif' // 10px per character

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('Asha Rao', 200, F, mono)).toEqual(['Asha Rao'])
  })

  it('wraps at word boundaries within the width', () => {
    const lines = wrapText('Jabalpur Engineering College Alumni Meet', 200, F, mono)
    expect(lines).toEqual(['Jabalpur Engineering', 'College Alumni Meet'])
    for (const l of lines) expect(mono(l, F)).toBeLessThanOrEqual(200)
  })

  it('breaks a single word that is wider than the line', () => {
    expect(wrapText('Venkatasubramanian', 100, F, mono)).toEqual(['Venkatasub', 'ramanian'])
  })

  it('caps the number of lines and ends the last one with an ellipsis', () => {
    const lines = wrapText('one two three four five six seven eight', 100, F, mono, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(mono(lines[1]!, F)).toBeLessThanOrEqual(100)
  })

  it('handles extra spaces and empty text', () => {
    expect(wrapText('  Asha   Rao ', 200, F, mono)).toEqual(['Asha Rao'])
    expect(wrapText('', 200, F, mono)).toEqual([])
  })
})

describe('layoutCard', () => {
  const base = { batch: 'Batch of 2008', line: 'I’m attending', title: 'JEC Alumni Meet 2026', dates: '26–27 Dec 2026', scan: 'Scan to join us', footer: 'JEC Alumni Connect', url: 'https://x/meet' }

  it('uses the large name size for a normal name', () => {
    const l = layoutCard({ ...base, name: 'Asha Rao' }, mono)
    expect(l.nameSize).toBe(112)
    expect(l.nameLines).toEqual(['Asha Rao'])
  })

  it('steps a very long name down so it fits two lines without cutting', () => {
    const l = layoutCard({ ...base, name: 'Lakshminarayanan Venkatasubramanian Iyer Krishnamurthy' }, mono)
    expect(l.nameSize).toBeLessThan(112)
    expect(l.nameLines.length).toBeLessThanOrEqual(2)
    for (const line of l.nameLines) expect(mono(line, `600 ${l.nameSize}px serif`)).toBeLessThanOrEqual(CARD_W - 192)
  })

  it('wraps the title within the card margins', () => {
    const l = layoutCard({ ...base, name: 'A', title: 'Alumni Connect Grand Reunion 2026' }, mono)
    expect(l.titleLines.length).toBeGreaterThan(1)
    for (const line of l.titleLines) expect(mono(line, '600 92px serif')).toBeLessThanOrEqual(CARD_W - 192)
  })
})
