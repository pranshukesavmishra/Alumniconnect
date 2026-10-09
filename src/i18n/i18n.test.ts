import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from './en'
import { hi } from './hi'
import { pluralForm, readStoredLang, translate, type Dict, type Lang } from './core'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('dictionaries', () => {
  const enKeys = Object.keys(en).sort()
  const hiKeys = Object.keys(hi).sort()

  it('hi has exactly the same keys as en', () => {
    expect(hiKeys.filter((k) => !(k in en)), 'extra keys in hi').toEqual([])
    expect(enKeys.filter((k) => !(k in hi)), 'keys missing from hi').toEqual([])
  })

  it('placeholders match for every key', () => {
    const bad = enKeys.filter((k) => JSON.stringify(placeholders((en as Dict)[k]!)) !== JSON.stringify(placeholders((hi as Dict)[k] ?? '')))
    expect(bad).toEqual([])
  })

  it('plural keys come in _one/_other pairs', () => {
    for (const dict of [en, hi] as Dict[]) {
      for (const k of Object.keys(dict)) {
        if (k.endsWith('_one')) expect(dict[k.replace(/_one$/, '_other')], k).toBeDefined()
        if (k.endsWith('_other')) expect(dict[k.replace(/_other$/, '_one')], k).toBeDefined()
      }
    }
  })

  it('has no empty messages and Hindi uses Western digits only', () => {
    for (const [k, v] of Object.entries(hi)) {
      expect(v.trim().length, k).toBeGreaterThan(0)
      expect(/[०-९]/.test(v), `${k} has Devanagari digits`).toBe(false)
    }
  })
})

describe('translate', () => {
  const dicts: Record<Lang, Dict> = {
    en: { hello: 'Hello {name}', only_en: 'English only', item_one: '{count} item', item_other: '{count} items' },
    hi: { hello: 'नमस्ते {name}', item_one: '{count} चीज़', item_other: '{count} चीज़ें' },
  }

  it('interpolates params', () => {
    expect(translate('en', 'hello', { name: 'Asha' }, dicts)).toBe('Hello Asha')
    expect(translate('hi', 'hello', { name: 'आशा' }, dicts)).toBe('नमस्ते आशा')
  })

  it('leaves unknown placeholders visible and handles numbers', () => {
    expect(translate('en', 'hello', {}, dicts)).toBe('Hello {name}')
    expect(translate('en', 'hello', { name: 0 }, dicts)).toBe('Hello 0')
  })

  it('English plural: only 1 is singular', () => {
    expect(translate('en', 'item', { count: 0 }, dicts)).toBe('0 items')
    expect(translate('en', 'item', { count: 1 }, dicts)).toBe('1 item')
    expect(translate('en', 'item', { count: 2 }, dicts)).toBe('2 items')
  })

  it('Hindi plural: 0 and 1 are singular', () => {
    expect(pluralForm('hi', 0)).toBe('one')
    expect(pluralForm('hi', 1)).toBe('one')
    expect(pluralForm('hi', 2)).toBe('other')
    expect(translate('hi', 'item', { count: 0 }, dicts)).toBe('0 चीज़')
    expect(translate('hi', 'item', { count: 5 }, dicts)).toBe('5 चीज़ें')
  })

  it('falls back to English for a missing key, and to the key itself when missing everywhere', () => {
    expect(translate('hi', 'only_en', undefined, dicts)).toBe('English only')
    expect(translate('hi', 'nope', undefined, dicts)).toBe('nope')
  })

  it('works with the real dictionaries', () => {
    expect(translate('en', 'nav.home')).toBe('Home')
    expect(translate('hi', 'nav.home')).toBe('होम')
    expect(translate('en', 'common.people', { count: 1 })).toBe('1 person')
    expect(translate('en', 'common.people', { count: 3 })).toBe('3 people')
    expect(translate('hi', 'common.people', { count: 0 })).toBe('0 व्यक्ति')
  })
})

describe('stored language', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads hi, defaults to en', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'hi' })
    expect(readStoredLang()).toBe('hi')
    vi.stubGlobal('localStorage', { getItem: () => 'fr' })
    expect(readStoredLang()).toBe('en')
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(readStoredLang()).toBe('en')
  })

  it('tolerates localStorage throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readStoredLang()).toBe('en')
  })
})
