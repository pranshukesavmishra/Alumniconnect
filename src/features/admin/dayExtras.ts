// Day-based "optional extra" editing in the ticket cards. A friendlier front end for the existing model:
// an optional extra day is an is_addon ticket row valid on exactly that day, and each person type's price for it is a
// row in event_addon_prices. These pure helpers map the ticket cards to those rows and back.
import { parseRupeesToPaise } from '../../lib/money'
import type { AddonPrice } from '../../lib/types'

export interface DayDraft {
  id?: string
  key?: string
  label: string
  price: string
  days: number[]
  is_addon?: boolean
  is_primary?: boolean
  _delete?: boolean
  /** override prices for extras that are not a single-day extra (kept as they were) */
  prices?: Record<string, { price: string; off: boolean }>
  /** optional extra days of this ticket: day number -> extra price in rupees ('' = the extra's default price) */
  optional?: Record<number, string>
}

export const keyOf = (t: { id?: string; key?: string }) => t.id ?? t.key ?? ''

/** The extra that stands for a day: the first live optional extra valid on exactly that day. */
export function dayExtras<T extends DayDraft>(drafts: T[]): Map<number, T> {
  const m = new Map<number, T>()
  for (const a of drafts) if (a.is_addon && !a._delete && a.days.length === 1 && !m.has(a.days[0]!)) m.set(a.days[0]!, a)
  return m
}

/** Optional days of a saved ticket: every day-extra on a day the ticket does not include and has not switched off. */
export function optionalFromData(ticketId: string, ticketDays: number[], extras: { id: string; days: number[] | null }[], rows: AddonPrice[]): Record<number, string> {
  const out: Record<number, string> = {}
  if (!ticketDays.length) return out // covers every day
  const seen = new Set<number>()
  for (const a of extras) {
    if (!a.days || a.days.length !== 1) continue
    const d = a.days[0]!
    if (seen.has(d)) continue
    seen.add(d)
    if (ticketDays.includes(d)) continue
    const row = rows.find((r) => r.addon_id === a.id && r.ticket_type_id === ticketId)
    if (row && !row.available) continue
    out[d] = row && row.price_paise != null ? String(row.price_paise / 100) : ''
  }
  return out
}

/** Days the ticket really covers: ticked days; none ticked = every day, except the optional ones. null = every day. */
export function includedDays(t: Pick<DayDraft, 'days' | 'optional'>, nDays: number): number[] | null {
  const opt = Object.keys(t.optional ?? {}).map(Number)
  let days = [...t.days]
  if (days.length === 0 && opt.length) days = Array.from({ length: nDays }, (_, i) => i + 1).filter((d) => !opt.includes(d))
  days = days.filter((d) => !opt.includes(d))
  return days.length === 0 || days.length >= nDays ? null : days.sort((a, b) => a - b)
}

const wholeRupees = (v: string) => {
  const p = parseRupeesToPaise(v)
  return p !== null && p % 100 === 0
}

export function validateDayExtras(tickets: DayDraft[], dayName: (d: number) => string): string[] {
  const errs: string[] = []
  for (const t of tickets) {
    if (t._delete || t.is_addon) continue
    for (const [d, v] of Object.entries(t.optional ?? {})) {
      if (t.days.includes(Number(d))) errs.push(`“${t.label || 'ticket'}”: ${dayName(Number(d))} cannot be both included and an optional extra.`)
      if (v.trim() && !wholeRupees(v)) errs.push(`“${t.label || 'ticket'}”: the extra price for ${dayName(Number(d))} must be a whole number of rupees.`)
    }
  }
  return errs
}

/** The most common non-empty entered price (the first entered wins a tie); 0 when none. */
function defaultPrice(tickets: DayDraft[], d: number): string {
  const counts = new Map<string, number>()
  for (const t of tickets) {
    const v = t.optional?.[d]?.trim()
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = '0'
  let n = 0
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c]
  return best
}

export interface DayExtrasOut<T extends DayDraft = DayDraft> {
  /** all drafts to save: the originals plus an extra for each optional day that had none yet */
  drafts: T[]
  addonPrices: { addonKey: string; ticketKey: string; price_paise: number | null; available: boolean }[]
}

export function buildDayExtras<T extends DayDraft>(
  drafts: T[],
  dayName: (d: number) => string,
  makeExtra: (e: Pick<DayDraft, 'key' | 'label' | 'price' | 'days'>) => T,
): DayExtrasOut<T> {
  const tix = drafts.filter((t) => !t._delete && !t.is_addon)
  const out = [...drafts]
  const days = new Set<number>()
  for (const t of tix) for (const k of Object.keys(t.optional ?? {})) days.add(Number(k))
  for (const d of [...days].sort((a, b) => a - b)) {
    if (!dayExtras(out).has(d)) out.push(makeExtra({ key: `day-extra-${d}`, label: `${dayName(d)} (optional)`, price: defaultPrice(tix, d), days: [d] }))
  }
  const byDay = dayExtras(out)
  const dayIds = new Set([...byDay.values()].map(keyOf))
  const rows: DayExtrasOut['addonPrices'] = []
  for (const t of tix) {
    for (const [d, a] of byDay) {
      const v = t.optional?.[d]
      if (v !== undefined) {
        // optional: empty = the extra's default price (no row needed)
        if (v.trim()) rows.push({ addonKey: keyOf(a), ticketKey: keyOf(t), price_paise: parseRupeesToPaise(v) ?? 0, available: true })
      } else {
        // included in the ticket, or not offered to this person type
        rows.push({ addonKey: keyOf(a), ticketKey: keyOf(t), price_paise: null, available: false })
      }
    }
    // other extras (several days, or a second one for the same day): their prices stay as they were
    for (const a of out) {
      if (!a.is_addon || a._delete || dayIds.has(keyOf(a))) continue
      const v = t.prices?.[keyOf(a)]
      if (!v || (!v.off && !v.price.trim())) continue
      rows.push({ addonKey: keyOf(a), ticketKey: keyOf(t), price_paise: v.off ? null : (parseRupeesToPaise(v.price) ?? 0), available: !v.off })
    }
  }
  return { drafts: out, addonPrices: rows }
}
