// All amounts are integers in paise. Format for display only.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })

export function formatPaise(paise: number): string {
  if (paise === 0) return 'Free'
  return inr.format(paise / 100)
}

/** "2500" or "2500.50" for UPI links (UPI expects rupees with up to 2 decimals). */
export function paiseToUpiAmount(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new Error('Invalid amount')
  const rupees = Math.floor(paise / 100)
  const rest = paise % 100
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`
}

/** Parses "2,500.50" or "₹2500" into paise. Returns null when it is not a valid amount. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '0', frac = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}
