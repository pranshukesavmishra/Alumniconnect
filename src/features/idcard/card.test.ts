import { describe, expect, it } from 'vitest'
import { cardRoles, cardVerifyUrl, formatMembershipNo, normaliseCardToken, tokenFromScan } from './card'

describe('membership number', () => {
  it('matches the database format', () => {
    expect(formatMembershipNo(2008, 123)).toBe('JEC-2008-000123')
    expect(formatMembershipNo(1999, 1)).toBe('JEC-1999-000001')
    expect(formatMembershipNo(null, 5)).toBe('JEC-000005')
    expect(formatMembershipNo(2008, 999999)).toBe('JEC-2008-999999')
    expect(formatMembershipNo(2008, 1234567)).toBe('JEC-2008-1234567') // never truncated
  })
  it('has no number without a serial', () => {
    expect(formatMembershipNo(2008, null)).toBeNull()
    expect(formatMembershipNo(2008, 0)).toBeNull()
    expect(formatMembershipNo(2008, Number.NaN)).toBeNull()
  })
})

describe('card tokens', () => {
  const tok = '0123456789abcdef0123456789abcdef'
  it('accepts 32 hex characters only', () => {
    expect(normaliseCardToken(` ${tok.toUpperCase()} `)).toBe(tok)
    expect(normaliseCardToken('abc')).toBeNull()
    expect(normaliseCardToken(`${tok}0`)).toBeNull()
    expect(normaliseCardToken("x' or 1=1 --")).toBeNull()
    expect(normaliseCardToken(null)).toBeNull()
  })
  it('builds and reads verify links', () => {
    expect(cardVerifyUrl('https://jec.example/', tok)).toBe(`https://jec.example/verify/${tok}`)
    expect(tokenFromScan(`https://jec.example/verify/${tok}`)).toBe(tok)
    expect(tokenFromScan(`https://jec.example/verify/${tok}?ref=qr`)).toBe(tok)
    expect(tokenFromScan(tok)).toBe(tok)
    expect(tokenFromScan('https://evil.example/verify/nothex')).toBeNull()
  })
})

describe('card roles', () => {
  it('orders roles and folds admin into owner', () => {
    expect(cardRoles(['mentor', 'admin', 'organiser', 'owner', 'unknown'])).toEqual(['owner', 'organiser', 'mentor'])
    expect(cardRoles(['moderator', 'batch_rep'])).toEqual(['batch_rep', 'moderator'])
    expect(cardRoles(null)).toEqual([])
  })
})
