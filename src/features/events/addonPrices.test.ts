import { describe, expect, it } from 'vitest'
import { addonLinesFromCounts, addonLinesTotal, addonPriceFor, addonRoom, countsFromItems, extraPeople, personTypeOf } from './reunion'

describe('optional extras priced per person type', () => {
  const tour = { id: 'tour', price_paise: 65000, max_per_registration: 6 }
  const prices = [
    { addon_id: 'tour', ticket_type_id: 'child', price_paise: 35000, available: true },
    { addon_id: 'tour', ticket_type_id: 'spouse', price_paise: null, available: false },
    { addon_id: 'tour', ticket_type_id: 'baby', price_paise: 0, available: true },
    { addon_id: 'tour', ticket_type_id: 'kin', price_paise: null, available: true },
  ]
  it("uses the person type price, else the extra's own price", () => {
    expect(addonPriceFor(tour, 'alumnus', prices)).toEqual({ available: true, pricePaise: 65000, overridden: false })
    expect(addonPriceFor(tour, 'child', prices)).toEqual({ available: true, pricePaise: 35000, overridden: true })
    expect(addonPriceFor(tour, 'baby', prices)).toEqual({ available: true, pricePaise: 0, overridden: true })
    expect(addonPriceFor(tour, 'kin', prices).pricePaise).toBe(65000)
    expect(addonPriceFor(tour, 'spouse', prices).available).toBe(false)
    expect(addonPriceFor(tour, 'child').pricePaise).toBe(65000)
  })
  it('knows the person type of each person', () => {
    expect(personTypeOf('me', 'alumnus')).toBe('alumnus')
    expect(personTypeOf('child:1', 'alumnus')).toBe('child')
  })
  it('builds one line per extra and person type from independent counts', () => {
    const lines = addonLinesFromCounts([tour], { tour: { alumnus: 1, child: 2, kin: 3, spouse: 1 } }, {}, 'alumnus', prices)
    expect(lines).toEqual([
      { addonId: 'tour', forId: 'alumnus', qty: 1, unitPaise: 65000 },
      { addonId: 'tour', forId: 'child', qty: 2, unitPaise: 35000 },
      { addonId: 'tour', forId: 'kin', qty: 3, unitPaise: 65000 },
    ])
    expect(addonLinesTotal(lines)).toBe(65000 + 2 * 35000 + 3 * 65000)
  })
  it('does not depend on the family tickets: 3 adults and 2 children with nobody else', () => {
    const lines = addonLinesFromCounts([tour], { tour: { kin: 3, child: 2 } }, {}, 'alumnus', prices)
    expect(addonLinesTotal(lines)).toBe(3 * 65000 + 2 * 35000)
  })
  it('caps Me at 1, each type and the total at the maximum, and drops nothing-lines', () => {
    expect(addonLinesFromCounts([tour], { tour: { alumnus: 5 } }, {}, 'alumnus', prices)).toEqual([{ addonId: 'tour', forId: 'alumnus', qty: 1, unitPaise: 65000 }])
    const capped = addonLinesFromCounts([tour], { tour: { kin: 9, child: 2 } }, {}, 'alumnus', prices)
    expect(capped.reduce((n, l) => n + l.qty, 0)).toBe(6)
    expect(addonLinesFromCounts([tour], { tour: { child: 0 } }, {}, 'alumnus', prices)).toEqual([])
    expect(addonLinesFromCounts([tour], { tour: { alumnus: 1 } }, {}, undefined, prices)).toEqual([])
    expect(addonRoom(6, { child: 2, kin: 1 }, 'kin')).toBe(4)
    expect(addonRoom(6, { child: 9 })).toBe(0)
  })
  it('keeps optional names, one per counted person, blanks dropped', () => {
    const lines = addonLinesFromCounts([tour], { tour: { kin: 2 } }, { tour: { kin: [' Asha ', '', 'Extra'] } }, 'alumnus', prices)
    expect(lines[0]!.names).toEqual(['Asha'])
    expect(addonLinesFromCounts([tour], { tour: { kin: 2 } }, {}, 'alumnus', prices)[0]!.names).toBeUndefined()
  })
  it('restores counts and names from saved rows, typed and older untyped', () => {
    const typed = [
      { ticket_type_id: 'tour', for_ticket_type_id: 'alumnus', quantity: 1 },
      { ticket_type_id: 'tour', for_ticket_type_id: 'child', quantity: 3, names: ['Mini'] },
      { ticket_type_id: 'other', for_ticket_type_id: 'child', quantity: 2 },
    ]
    expect(countsFromItems('tour', typed, 'alumnus', ['kin', 'child'])).toEqual({ counts: { alumnus: 1, child: 3 }, names: { child: ['Mini'] } })
    expect(countsFromItems('tour', [{ ticket_type_id: 'tour', for_ticket_type_id: null, quantity: 3 }], 'alumnus', ['kin', 'child']).counts).toEqual({ alumnus: 1, kin: 2 })
    expect(countsFromItems('tour', [], 'alumnus', ['kin']).counts).toEqual({})
  })
  it('lists the named extra-only people for the admin screens', () => {
    expect(extraPeople([{ label: 'Outdoor (Child)', names: ['Mini', ' '] }, { label: 'Dinner' }])).toEqual([{ name: 'Mini', label: 'Outdoor (Child)' }])
  })
})
