import { describe, expect, it } from 'vitest'
import type { AddonPrice } from '../../lib/types'
import { buildDayExtras, includedDays, optionalFromData, validateDayExtras, type DayDraft } from './dayExtras'

const name = (d: number) => `${25 + d} Dec`
const row = (addon: string, ticket: string, price: number | null, available = true): AddonPrice => ({ addon_id: addon, ticket_type_id: ticket, event_id: 'e', price_paise: price, available })

// the live shape: Alumnus [1], Spouse [1], Child [1]; extra Outdoor tour day 2, default 650, child override 350
const extras = [{ id: 'tour', days: [2] }]
const rows = [row('tour', 'child', 35000)]
const load = (id: string, label: string, price: string, primary = false): DayDraft => ({ id, key: id, label, price, days: [1], is_primary: primary, optional: optionalFromData(id, [1], extras, rows) })
const mk = (e: Pick<DayDraft, 'key' | 'label' | 'price' | 'days'>): DayDraft => ({ ...e, is_addon: true })
const tour: DayDraft = { id: 'tour', key: 'tour', label: 'Outdoor tour', price: '650', days: [2], is_addon: true }

describe('day extras mapping', () => {
  it('loads existing data into per-ticket optional days', () => {
    expect(load('alum', 'Alumnus', '2500', true).optional).toEqual({ 2: '' })
    expect(load('child', 'Child', '500').optional).toEqual({ 2: '350' })
    expect(optionalFromData('x', [], extras, rows)).toEqual({})
    expect(optionalFromData('sp', [1], extras, [row('tour', 'sp', null, false)])).toEqual({})
  })

  it('round-trips the live data without changing any price', () => {
    const drafts = [load('alum', 'Alumnus', '2500', true), load('spouse', 'Spouse', '500'), load('child', 'Child', '500'), tour]
    const out = buildDayExtras(drafts, name, mk)
    expect(out.drafts).toHaveLength(4) // no extra created: the tour already exists
    expect(out.addonPrices).toEqual([{ addonKey: 'tour', ticketKey: 'child', price_paise: 35000, available: true }])
    expect(includedDays(drafts[0]!, 2)).toEqual([1])
  })

  it('creates one extra per optional day with the most common price as default, and writes per-ticket prices', () => {
    const t = (key: string, opt: Record<number, string> | undefined): DayDraft => ({ key, label: key, price: '100', days: [1], optional: opt })
    const out = buildDayExtras([t('a', { 2: '650' }), t('s', { 2: '650' }), t('c', { 2: '350' }), t('x', undefined)], name, mk)
    const created = out.drafts.filter((d) => d.is_addon)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ label: '27 Dec (optional)', price: '650', days: [2], key: 'day-extra-2' })
    expect(out.addonPrices).toEqual([
      { addonKey: 'day-extra-2', ticketKey: 'a', price_paise: 65000, available: true },
      { addonKey: 'day-extra-2', ticketKey: 's', price_paise: 65000, available: true },
      { addonKey: 'day-extra-2', ticketKey: 'c', price_paise: 35000, available: true },
      { addonKey: 'day-extra-2', ticketKey: 'x', price_paise: null, available: false },
    ])
  })

  it('free is 0, empty is the default, and the first entered wins a tie', () => {
    const t = (key: string, v: string): DayDraft => ({ key, label: key, price: '1', days: [1], optional: { 2: v } })
    const out = buildDayExtras([t('a', '0'), t('b', ''), t('c', '500'), t('d', '500'), t('e', '0')], name, mk)
    expect(out.drafts.find((d) => d.is_addon)!.price).toBe('0')
    expect(out.addonPrices.map((r) => r.price_paise)).toEqual([0, 50000, 50000, 0])
  })

  it('a ticket with nothing ticked but an optional day includes the other days; included wins over every day', () => {
    expect(includedDays({ days: [], optional: { 2: '' } }, 3)).toEqual([1, 3])
    expect(includedDays({ days: [1], optional: { 2: '1' } }, 2)).toEqual([1])
    expect(includedDays({ days: [], optional: {} }, 2)).toBeNull()
    expect(includedDays({ days: [1, 2], optional: {} }, 2)).toBeNull()
  })

  it('keeps prices of other (multi-day) extras', () => {
    const multi: DayDraft = { id: 'm', key: 'm', label: 'Gala', price: '100', days: [1, 2], is_addon: true }
    const t: DayDraft = { id: 't', key: 't', label: 'T', price: '1', days: [1], prices: { m: { price: '40', off: false } } }
    const out = buildDayExtras([t, multi], name, mk)
    expect(out.addonPrices).toEqual([{ addonKey: 'm', ticketKey: 't', price_paise: 4000, available: true }])
  })

  it('validates whole rupees and included/optional overlap', () => {
    const base: DayDraft = { key: 'a', label: 'A', price: '1', days: [1], optional: { 2: '12.5' } }
    expect(validateDayExtras([base], name)[0]).toMatch(/whole number/)
    expect(validateDayExtras([{ ...base, optional: { 2: 'abc' } }], name)[0]).toMatch(/whole number/)
    expect(validateDayExtras([{ ...base, optional: { 1: '5' } }], name)[0]).toMatch(/both included/)
    expect(validateDayExtras([{ ...base, optional: { 2: '350' } }], name)).toEqual([])
    expect(validateDayExtras([{ ...base, optional: { 2: '' } }], name)).toEqual([])
  })
})
