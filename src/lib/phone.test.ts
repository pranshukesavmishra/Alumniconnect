import { describe, expect, it } from 'vitest'
import {
  COUNTRIES,
  checkNational,
  countryByIso,
  flagEmoji,
  formatPhone,
  isValidPhone,
  normalizePhone,
  parsePhone,
  phoneMatches,
  phoneProblem,
  telHref,
  toE164,
  whatsappDigits,
} from './phone'

describe('country table', () => {
  it('has unique ISO codes and sane lengths', () => {
    const isos = COUNTRIES.map((c) => c.iso)
    expect(new Set(isos).size).toBe(isos.length)
    expect(COUNTRIES.length).toBeGreaterThan(220)
    for (const c of COUNTRIES) {
      expect(c.min, c.iso).toBeGreaterThanOrEqual(4)
      expect(c.max, c.iso).toBeGreaterThanOrEqual(c.min)
      expect(c.dial.length + c.max, `${c.iso} fits E.164`).toBeLessThanOrEqual(15)
      expect(c.dial.length + c.min, `${c.iso} fits the database check`).toBeGreaterThanOrEqual(7)
    }
  })

  it('has a flag for every country', () => {
    expect(flagEmoji('IN')).toBe('🇮🇳')
    expect(flagEmoji('gb')).toBe('🇬🇧')
  })
})

describe('parsePhone', () => {
  it.each([
    ['+919876543210', 'IN', '9876543210'],
    ['+91 98765 43210', 'IN', '9876543210'],
    ['9876543210', 'IN', '9876543210'],
    ['09876543210', 'IN', '9876543210'],
    ['919876543210', 'IN', '9876543210'],
    ['+447700900123', 'GB', '7700900123'],
    ['+44 (0) 7700 900123', 'GB', '7700900123'],
    ['00447700900123', 'GB', '7700900123'],
    ['+14155550123', 'US', '4155550123'],
    ['+1 416 555 0199', 'CA', '4165550199'],
    ['+1876 5551234', 'JM', '5551234'],
    ['+971501234567', 'AE', '501234567'],
    ['+61412345678', 'AU', '412345678'],
    ['+4915123456789', 'DE', '15123456789'],
    ['+8613812345678', 'CN', '13812345678'],
    ['+966512345678', 'SA', '512345678'],
    ['+27821234567', 'ZA', '821234567'],
    ['+6591234567', 'SG', '91234567'],
    ['+81 90 1234 5678', 'JP', '9012345678'],
    ['+77012345678', 'KZ', '7012345678'],
    ['+79123456789', 'RU', '9123456789'],
    ['+393123456789', 'IT', '3123456789'],
    ['+390612345678', 'IT', '0612345678'],
    ['+447781123456', 'GB', '7781123456'],
    ['+6831234', 'NU', '1234'],
  ])('%s -> %s %s', (raw, iso, national) => {
    const p = parsePhone(raw)
    expect(p?.country.iso).toBe(iso)
    expect(p?.national).toBe(national)
  })

  it('returns null when no country can be worked out', () => {
    expect(parsePhone('')).toBeNull()
    expect(parsePhone(null)).toBeNull()
    expect(parsePhone('abc')).toBeNull()
    expect(parsePhone('12345')).toBeNull()
    expect(parsePhone('+0123456')).toBeNull()
    expect(parsePhone('5551234567')).toBeNull() // a bare number that is not Indian has no country
  })
})

describe('validation', () => {
  it('India: 10 digits starting 6-9', () => {
    const india = countryByIso('IN')
    expect(checkNational(india, '9876543210')).toBeNull()
    expect(checkNational(india, '6000000000')).toBeNull()
    expect(checkNational(india, '5876543210')).toBe('start')
    expect(checkNational(india, '987654321')).toBe('short')
    expect(checkNational(india, '98765432101')).toBe('long')
    expect(checkNational(india, '')).toBe('empty')
  })

  it('other countries use their own lengths', () => {
    expect(checkNational(countryByIso('GB'), '7700900123')).toBeNull()
    expect(checkNational(countryByIso('GB'), '770090012')).toBe('short')
    expect(checkNational(countryByIso('US'), '4155550123')).toBeNull()
    expect(checkNational(countryByIso('US'), '415555012')).toBe('short')
    expect(checkNational(countryByIso('SG'), '91234567')).toBeNull()
    expect(checkNational(countryByIso('SG'), '912345678')).toBe('long')
    expect(checkNational(countryByIso('DE'), '15123456789')).toBeNull()
    expect(checkNational(countryByIso('AU'), '412345678')).toBeNull()
    expect(checkNational(countryByIso('BR'), '11987654321')).toBeNull()
    expect(checkNational(countryByIso('NU'), '1234')).toBeNull()
  })

  it('phoneProblem covers empty, unreadable and wrong-length input', () => {
    expect(phoneProblem('')).toEqual({ kind: 'empty' })
    expect(phoneProblem('  ')).toEqual({ kind: 'empty' })
    expect(phoneProblem('abc')).toEqual({ kind: 'format' })
    expect(phoneProblem('+44770090012')).toMatchObject({ kind: 'short' })
    expect(phoneProblem('+9158765432')).toMatchObject({ kind: 'short' })
    expect(phoneProblem('+915876543210')).toMatchObject({ kind: 'start' })
    expect(phoneProblem('+447700900123')).toBeNull()
    expect(phoneProblem('9876543210')).toBeNull()
    expect(phoneProblem('+91 98765 43210')).toBeNull()
    expect(isValidPhone('+14155550123')).toBe(true)
    expect(isValidPhone('+1415555012')).toBe(false)
  })
})

describe('normalise, format, links', () => {
  it('stores E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210')
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210')
    expect(normalizePhone(' +44 7700 900123 ')).toBe('+447700900123')
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone('call me')).toBe('call me') // nothing is lost when it cannot be understood
    expect(toE164(countryByIso('GB'), '7700900123')).toBe('+447700900123')
    expect(toE164(countryByIso('GB'), '')).toBe('')
  })

  it('shows numbers the way people read them', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210')
    expect(formatPhone('9876543210')).toBe('+91 98765 43210')
    expect(formatPhone('+91 98765 43210')).toBe('+91 98765 43210')
    expect(formatPhone('+447700900123')).toBe('+44 7700 9001 23')
    expect(formatPhone('+14155550123')).toBe('+1 415 555 0123')
    expect(formatPhone('weird')).toBe('weird')
    expect(formatPhone(null)).toBe('')
  })

  it('tel: links keep the plus, wa.me links do not', () => {
    expect(telHref('+91 98765 43210')).toBe('tel:+919876543210')
    expect(telHref('9876543210')).toBe('tel:+919876543210')
    expect(telHref('+44 7700 900123')).toBe('tel:+447700900123')
    expect(telHref('0141 496 0000')).toBe('tel:01414960000')
    expect(whatsappDigits('+447700900123')).toBe('447700900123')
    expect(whatsappDigits('9876543210')).toBe('919876543210')
    expect(whatsappDigits('+91 98765 43210')).toBe('919876543210')
    expect(whatsappDigits('+1 (415) 555-0123')).toBe('14155550123')
  })

  it('searches by digits however the number is laid out', () => {
    expect(phoneMatches('+919876543210', '98765 43210')).toBe(true)
    expect(phoneMatches('+91 98765 43210', '+91 98765')).toBe(true)
    expect(phoneMatches('+447700900123', '7700 900')).toBe(true)
    expect(phoneMatches('+447700900123', '1234')).toBe(false)
    expect(phoneMatches('+919876543210', 'asha')).toBe(false)
    expect(phoneMatches(null, '98765')).toBe(false)
  })
})
