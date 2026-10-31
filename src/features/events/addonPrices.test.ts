import { describe, expect, it } from 'vitest'
import { addonLines, addonLinesTotal, addonPriceFor, personTypeOf, ticksFromItems } from './reunion'

describe('optional extras priced per person type', () => {
  const tour = { id: 'tour', price_paise: 65000 }
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
  it("builds one line per extra and person type and totals each person's own amount", () => {
    const persons = ['me', 'spouse:0', 'child:0', 'child:1']
    const lines = addonLines([tour], { tour: ['me', 'child:0', 'child:1', 'spouse:0'] }, persons, 'alumnus', prices)
    expect(lines).toEqual([
      { addonId: 'tour', forId: 'alumnus', qty: 1, unitPaise: 65000 },
      { addonId: 'tour', forId: 'child', qty: 2, unitPaise: 35000 },
    ])
    expect(addonLinesTotal(lines)).toBe(65000 + 2 * 35000)
  })
  it('drops ticks of people who left the registration and of types without the extra', () => {
    expect(addonLines([tour], { tour: ['me', 'child:3', 'ghost:0'] }, ['me', 'child:0'], 'alumnus', prices)).toEqual([{ addonId: 'tour', forId: 'alumnus', qty: 1, unitPaise: 65000 }])
    expect(addonLines([tour], { tour: ['me'] }, ['me'], undefined, prices)).toEqual([])
    expect(addonLines([tour], {}, ['me'], 'alumnus', prices)).toEqual([])
  })
  it('restores the ticks from saved rows, typed and older untyped', () => {
    const persons = ['me', 'spouse:0', 'child:0', 'child:1']
    const typed = [
      { ticket_type_id: 'tour', for_ticket_type_id: 'alumnus', quantity: 1 },
      { ticket_type_id: 'tour', for_ticket_type_id: 'child', quantity: 1 },
      { ticket_type_id: 'other', for_ticket_type_id: 'child', quantity: 2 },
    ]
    expect(ticksFromItems('tour', typed, persons, 'alumnus').sort()).toEqual(['child:0', 'me'])
    expect(ticksFromItems('tour', [{ ticket_type_id: 'tour', for_ticket_type_id: null, quantity: 2 }], persons, 'alumnus')).toEqual(['me', 'spouse:0'])
    expect(ticksFromItems('tour', [], persons, 'alumnus')).toEqual([])
  })
})
