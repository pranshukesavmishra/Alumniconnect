import { describe, expect, it } from 'vitest'
import { buildBadges, paginate, short } from './badges'

const reg = (o: Partial<Parameters<typeof buildBadges>[0][number]> & { id: string }) => ({
  code: `JEC-${o.id}`, status: 'confirmed' as const, full_name: 'Name ' + o.id, branch: 'Computer Science & Engineering', grad_year: 2005, city: 'Pune', guests: [], food_pref: null, ...o,
})

describe('badges', () => {
  it('makes one badge per person: the registrant and each guest', () => {
    const b = buildBadges([reg({ id: 'A', full_name: 'Asha Rao', guests: [{ name: 'Ravi Rao', relation: 'Spouse' }, { name: '', relation: 'Child' }], food_pref: 'veg' })], { statuses: ['confirmed'], includeGuests: true })
    expect(b.map((x) => x.name)).toEqual(['Asha Rao', 'Ravi Rao', 'Guest of Asha Rao'])
    expect(b[0]).toMatchObject({ role: 'Alumnus', batch: 'CSE 2005', city: 'Pune', code: 'JEC-A', host: null, food: 'Veg' })
    expect(b[1]).toMatchObject({ role: 'Spouse', host: 'Asha Rao', code: 'JEC-A', batch: '' })
    expect(b[2]!.role).toBe('Child')
  })
  it('can leave guests out and filter by status or selection', () => {
    const regs = [reg({ id: 'A', guests: [{ name: 'G', relation: 'Spouse' }] }), reg({ id: 'B', status: 'under_review' }), reg({ id: 'C', status: 'cancelled' })]
    expect(buildBadges(regs, { statuses: ['confirmed'], includeGuests: false }).map((x) => x.key)).toEqual(['A'])
    expect(buildBadges(regs, { statuses: ['confirmed', 'under_review'], includeGuests: false }).map((x) => x.key)).toEqual(['A', 'B'])
    expect(buildBadges(regs, { statuses: ['confirmed', 'under_review'], includeGuests: false, only: new Set(['B']) }).map((x) => x.key)).toEqual(['B'])
  })
  it('sorts by name or by batch', () => {
    const regs = [reg({ id: 'A', full_name: 'Zed', grad_year: 2001 }), reg({ id: 'B', full_name: 'Amy', grad_year: 2010 })]
    expect(buildBadges(regs, { statuses: ['confirmed'], includeGuests: false }).map((x) => x.name)).toEqual(['Amy', 'Zed'])
    expect(buildBadges(regs, { statuses: ['confirmed'], includeGuests: false, sort: 'batch' }).map((x) => x.name)).toEqual(['Zed', 'Amy'])
  })
  it('shortens branch names and paginates', () => {
    expect(short('Computer Science & Engineering')).toBe('CSE')
    expect(short('Civil')).toBe('Civil')
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(paginate([], 8)).toEqual([])
  })
})
