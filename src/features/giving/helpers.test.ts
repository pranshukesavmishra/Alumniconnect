import { describe, expect, it } from 'vitest'
import { barWidth, daysLeft, donorLabel, giftProblem, itemRemaining, parseGift, percentOf, safeWebsite, upiNote, whatsappShareUrl } from './helpers'

describe('gift amounts', () => {
  it('accepts ₹10 to ₹10,00,000 and returns integer paise', () => {
    expect(parseGift('10')).toBe(1000)
    expect(parseGift('₹2,500.50')).toBe(250050)
    expect(parseGift('1000000')).toBe(100_000_000)
  })
  it('refuses outside the bounds and non-numbers', () => {
    expect(parseGift('9.99')).toBeNull()
    expect(parseGift('1000000.01')).toBeNull()
    expect(parseGift('abc')).toBeNull()
    expect(parseGift('')).toBeNull()
    expect(giftProblem('')).toBe('empty')
    expect(giftProblem('5')).toBe('low')
    expect(giftProblem('2000000')).toBe('high')
    expect(giftProblem('x')).toBe('invalid')
    expect(giftProblem('500')).toBeNull()
  })
})

describe('progress and countdown', () => {
  it('computes whole percentages and clamps the bar', () => {
    expect(percentOf(250, 1000)).toBe(25)
    expect(percentOf(1500, 1000)).toBe(150)
    expect(barWidth(1500, 1000)).toBe(100)
    expect(percentOf(5, 0)).toBe(0)
  })
  it('counts days left, 0 when ended, null without a date', () => {
    const now = Date.parse('2026-10-10T00:00:00Z')
    expect(daysLeft(null, now)).toBeNull()
    expect(daysLeft('2026-10-09T00:00:00Z', now)).toBe(0)
    expect(daysLeft('2026-10-12T06:00:00Z', now)).toBe(3)
  })
})

describe('items, links and labels', () => {
  it('knows what is left of an item', () => {
    expect(itemRemaining({ price_paise: 6000000, funded_paise: 1000000, pending_paise: 500000 })).toBe(4500000)
    expect(itemRemaining({ price_paise: 100, funded_paise: 100, pending_paise: 50 })).toBe(0)
  })
  it('builds a safe UPI note and share link', () => {
    expect(upiNote('build-the-convocation-hall')).toBe('JEC build the convocation hall'.slice(0, 30))
    expect(whatsappShareUrl('a b & c')).toBe('https://wa.me/?text=a%20b%20%26%20c')
  })
  it('never labels an anonymous donor with a name', () => {
    expect(donorLabel({ anonymous: true, name: 'Secret' }, 'A JECian')).toBe('A JECian')
    expect(donorLabel({ anonymous: false, name: 'Asha' }, 'A JECian')).toBe('Asha')
    expect(donorLabel({ anonymous: false, name: null }, 'A JECian')).toBe('A JECian')
  })
  it('only links to http(s) websites', () => {
    expect(safeWebsite('https://example.com')).toBe('https://example.com')
    expect(safeWebsite('javascript:alert(1)')).toBeNull()
    expect(safeWebsite(null)).toBeNull()
  })
})
