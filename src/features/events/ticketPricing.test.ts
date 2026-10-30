import { describe, expect, it } from 'vitest'
import { discountInfo, percentFromPrice, priceFromPercent, totalSavings } from './ticketPricing'

describe('ticket discounts', () => {
  it('shows nothing without a higher original price', () => {
    expect(discountInfo({ price_paise: 150000 })).toBeNull()
    expect(discountInfo({ price_paise: 150000, list_price_paise: null })).toBeNull()
    expect(discountInfo({ price_paise: 150000, list_price_paise: 150000 })).toBeNull()
    expect(discountInfo({ price_paise: 150000, list_price_paise: 100000 })).toBeNull()
  })
  it('computes percent (rounded down) and the saving', () => {
    expect(discountInfo({ price_paise: 150000, list_price_paise: 200000 })).toEqual({ percent: 25, savePaise: 50000, listPaise: 200000, pricePaise: 150000 })
    expect(discountInfo({ price_paise: 66700, list_price_paise: 100000 })!.percent).toBe(33)
    expect(discountInfo({ price_paise: 0, list_price_paise: 50000 })!.percent).toBe(100)
  })
  it('turns a percent into a whole-rupee selling price and back', () => {
    expect(priceFromPercent(200000, 25)).toBe(150000)
    expect(priceFromPercent(300000, 10)).toBe(270000)
    expect(priceFromPercent(99900, 15)).toBe(84900)
    expect(priceFromPercent(200000, 0)).toBe(200000)
    expect(priceFromPercent(200000, 150)).toBe(0)
    expect(percentFromPrice(200000, 150000)).toBe(25)
    expect(percentFromPrice(200000, 200000)).toBeNull()
  })
  it('adds up what a registration saves', () => {
    const tickets = [
      { id: 'a', price_paise: 150000, list_price_paise: 200000 },
      { id: 'b', price_paise: 50000 },
    ]
    expect(totalSavings(tickets, { a: 2, b: 3 })).toBe(100000)
    expect(totalSavings(tickets, {})).toBe(0)
  })
})
