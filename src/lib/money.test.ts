import { describe, expect, it } from 'vitest'
import { formatPaise, paiseToUpiAmount, parseRupeesToPaise } from './money'
import { buildUpiLink, isValidUpiId, normalizeUtr } from './upi'

describe('money', () => {
  it('formats paise as rupees', () => {
    expect(formatPaise(250000)).toBe('₹2,500')
    expect(formatPaise(250050)).toBe('₹2,500.50')
    expect(formatPaise(0)).toBe('Free')
  })
  it('creates UPI amounts without floating point errors', () => {
    expect(paiseToUpiAmount(250000)).toBe('2500')
    expect(paiseToUpiAmount(250005)).toBe('2500.05')
    expect(paiseToUpiAmount(1)).toBe('0.01')
    expect(() => paiseToUpiAmount(-1)).toThrow()
    expect(() => paiseToUpiAmount(1.5)).toThrow()
  })
  it('parses rupee input', () => {
    expect(parseRupeesToPaise('2,500')).toBe(250000)
    expect(parseRupeesToPaise('₹ 2500.5')).toBe(250050)
    expect(parseRupeesToPaise('Rs. 10')).toBe(1000)
    expect(parseRupeesToPaise('12.345')).toBeNull()
    expect(parseRupeesToPaise('abc')).toBeNull()
  })
})

describe('upi', () => {
  it('validates UPI IDs', () => {
    expect(isValidUpiId('jecalumni@okicici')).toBe(true)
    expect(isValidUpiId('jec.alumni-2026@ybl')).toBe(true)
    expect(isValidUpiId('no-at-sign')).toBe(false)
    expect(isValidUpiId('a@1')).toBe(false)
  })
  it('builds a standard upi:// link', () => {
    const link = buildUpiLink({ upiId: 'jecalumni@okicici', payeeName: 'JEC Alumni Association', amountPaise: 400050, note: 'JEC-7KQ4M2' })
    const url = new URL(link)
    expect(url.protocol).toBe('upi:')
    expect(link).not.toContain('+')
    const p = new URLSearchParams(link.split('?')[1])
    expect(p.get('pa')).toBe('jecalumni@okicici')
    expect(p.get('pn')).toBe('JEC Alumni Association')
    expect(p.get('am')).toBe('4000.50')
    expect(p.get('cu')).toBe('INR')
    expect(p.get('tn')).toBe('JEC-7KQ4M2')
  })
  it('rejects bad UPI IDs', () => {
    expect(() => buildUpiLink({ upiId: 'bad', payeeName: 'x', amountPaise: 100, note: 'n' })).toThrow()
  })
  it('normalizes UTRs', () => {
    expect(normalizeUtr('4123 4567 8901')).toBe('412345678901')
    expect(normalizeUtr('41234567890')).toBeNull()
    expect(normalizeUtr('41234567890a')).toBeNull()
  })
})
