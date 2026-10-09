import { describe, expect, it } from 'vitest'
import { ADMIN_HI } from './adminHi'
import { compile, translateAdmin } from './adminTranslate'

describe('translateAdmin', () => {
  it('translates exact text and keeps surrounding spaces', () => {
    expect(translateAdmin('Needs your attention')).toBe('आपके ध्यान की ज़रूरत')
    expect(translateAdmin('  Inbox ')).toBe('  इनबॉक्स ')
  })
  it('fills the changing parts of a pattern, translating them too', () => {
    expect(translateAdmin('Call Asha Rao')).toBe('Asha Rao को कॉल करें')
    expect(translateAdmin('This will reach 5 people')).toBe('यह 5 लोग तक पहुँचेगा')
    expect(translateAdmin('3 reports to review')).toBe('देखने को 3 रिपोर्ट')
  })
  it('a leading count only matches numbers, so ordinary phrases are left alone', () => {
    expect(translateAdmin('Select members')).toBe('Select members')
    expect(translateAdmin('12 members')).toBe('12 सदस्य')
  })
  it('leaves unknown text, numbers and names as they are', () => {
    expect(translateAdmin('Quillwaiter xyz')).toBe('Quillwaiter xyz')
    expect(translateAdmin('12,345')).toBe('12,345')
    expect(translateAdmin('')).toBe('')
  })
})

describe('the dictionary', () => {
  const placeholders = (s: string) => (s.match(/\{\}/g) ?? []).length
  it('every Hindi placeholder refers to a part that exists in the English key', () => {
    for (const [en, hi] of Object.entries(ADMIN_HI)) {
      const refs = [...hi.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]))
      for (const r of refs) expect(r, `${en} -> ${hi}`).toBeLessThanOrEqual(placeholders(en))
      if (placeholders(en) === 0) expect(refs, en).toEqual([])
    }
  })
  it('has no empty or Devanagari-digit values', () => {
    for (const [en, hi] of Object.entries(ADMIN_HI)) {
      expect(hi.trim().length, en).toBeGreaterThan(0)
      expect(/[०-९]/.test(hi), en).toBe(false)
    }
  })
  it('compiles every key', () => {
    const c = compile(ADMIN_HI)
    expect(c.exact.size + c.patterns.length).toBe(Object.keys(ADMIN_HI).length)
  })
})
