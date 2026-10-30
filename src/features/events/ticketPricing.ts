/** Ticket discounts. price_paise is what the member pays; list_price_paise (optional) is the crossed-out original. */

export interface DiscountInfo {
  /** whole percent off, rounded down so a shown "30% off" is never overstated */
  percent: number
  savePaise: number
  listPaise: number
  pricePaise: number
}

export function discountInfo(t: { price_paise: number; list_price_paise?: number | null }): DiscountInfo | null {
  const list = t.list_price_paise
  if (list == null || !(list > t.price_paise) || list <= 0) return null
  const percent = Math.floor(((list - t.price_paise) / list) * 100)
  return { percent, savePaise: list - t.price_paise, listPaise: list, pricePaise: t.price_paise }
}

/** Selling price from an original price and a percent off, in whole rupees (rounded to the nearest rupee). */
export function priceFromPercent(listPaise: number, percent: number): number {
  const p = Math.min(Math.max(percent, 0), 100)
  return Math.round((listPaise * (100 - p)) / 100 / 100) * 100
}

/** Percent off shown in the editor for a given original and selling price (nearest whole percent). */
export function percentFromPrice(listPaise: number, pricePaise: number): number | null {
  if (!(listPaise > pricePaise) || listPaise <= 0) return null
  return Math.round(((listPaise - pricePaise) / listPaise) * 100)
}

/** Total saved on a set of tickets: sum of savePaise × quantity. */
export function totalSavings(tickets: { id: string; price_paise: number; list_price_paise?: number | null }[], qty: Record<string, number>): number {
  return tickets.reduce((sum, t) => sum + (discountInfo(t)?.savePaise ?? 0) * (qty[t.id] ?? 0), 0)
}
