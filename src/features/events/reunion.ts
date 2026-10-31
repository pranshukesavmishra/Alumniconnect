// Pure helpers for the reunion registration (days, family rules, Reunion Fund, organisers' questions, profile snapshot).
// The database enforces every rule again (supabase/migrations/20261012000018_reunion_registration.sql); these keep the
// screen honest so members see the same answer before they submit.
import { FUND_MAX_PAISE, FUND_MIN_PAISE } from '../../lib/constants'
import { isValidPhone } from '../../lib/phone'
import type { AddonPrice, CustomAnswer, EventQuestion, EventRow, Experience, Profile, TicketType } from '../../lib/types'

const TZ = 'Asia/Kolkata'
const DAY_MS = 86_400_000

/** "2026-12-26" for an ISO time, in India time. */
export function istDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** Number of event days (1–14): the date span in India time, or the highest day a ticket covers. */
export function eventDayCount(event: Pick<EventRow, 'starts_at' | 'ends_at'>, tickets: Pick<TicketType, 'days'>[] = []): number {
  let span = 1
  if (event.starts_at && event.ends_at) {
    span = Math.round((Date.parse(istDate(event.ends_at)) - Date.parse(istDate(event.starts_at))) / DAY_MS) + 1
  }
  const maxTicketDay = Math.max(1, ...tickets.flatMap((t) => t.days ?? []))
  return Math.min(14, Math.max(1, span, maxTicketDay))
}

/** "2026-12-27" for day 2 of an event starting 26 Dec (null when the event has no date yet). */
export function dayDate(event: Pick<EventRow, 'starts_at'>, day: number): string | null {
  if (!event.starts_at) return null
  return new Date(Date.parse(istDate(event.starts_at)) + (day - 1) * DAY_MS).toISOString().slice(0, 10)
}

/** "27 Dec" (or "Day 2" without a start date). */
export function dayLabel(event: Pick<EventRow, 'starts_at'>, day: number, locale = 'en-IN'): string {
  const d = dayDate(event, day)
  if (!d) return `Day ${day}`
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`))
}

/** A guest ticket fits a main ticket when it covers only days the main ticket covers (null = every day). */
export function ticketFits(primary: Pick<TicketType, 'days'> | undefined, t: Pick<TicketType, 'days'>): boolean {
  if (!primary || !t.days || !primary.days) return true
  return t.days.every((d) => primary.days!.includes(d))
}

/** Optional extras (add-ons) are per person and can be added whichever main ticket was chosen. */
export function isAddon(t: { is_addon?: boolean | null }): boolean {
  return !!t.is_addon
}

/** The person type (normal ticket id) a person key belongs to: the main person is the chosen main ticket. */
export function personTypeOf(key: string, primaryId: string): string {
  return key === 'me' ? primaryId : key.split(':')[0]!
}

/** What an extra costs for one person type, from the organisers' per-type prices (none = the extra's own price). */
export function addonPriceFor(
  addon: Pick<TicketType, 'id' | 'price_paise'>,
  typeId: string,
  prices: Pick<AddonPrice, 'addon_id' | 'ticket_type_id' | 'price_paise' | 'available'>[] = [],
): { available: boolean; pricePaise: number; overridden: boolean } {
  const o = prices.find((x) => x.addon_id === addon.id && x.ticket_type_id === typeId)
  if (!o) return { available: true, pricePaise: addon.price_paise, overridden: false }
  if (!o.available) return { available: false, pricePaise: addon.price_paise, overridden: false }
  return o.price_paise == null ? { available: true, pricePaise: addon.price_paise, overridden: false } : { available: true, pricePaise: o.price_paise, overridden: true }
}

export interface AddonLine {
  addonId: string
  forId: string
  qty: number
  unitPaise: number
  /** optional names of the people (for the name badge), at most one per counted person */
  names?: string[]
}

/** Counts of an extra per person type: the main ticket's type id is the "Me" tickbox (0/1), every other type a stepper. */
export type AddonCounts = Record<string, Record<string, number>>
export type AddonNames = Record<string, Record<string, string[]>>

/** How many more people may still take the extra (its maximum minus everyone already counted, optionally leaving one type out). */
export function addonRoom(max: number, counts: Record<string, number> | undefined, exceptType?: string): number {
  const others = Object.entries(counts ?? {}).reduce((n, [k, v]) => (k === exceptType ? n : n + Math.max(0, v)), 0)
  return Math.max(0, max - others)
}

/**
 * One line per (extra, person type), independent of the family on the main ticket. "Me" (the main ticket's type) is at most 1,
 * every other type and the total at most the extra's maximum. Types that cannot take the extra are left out
 * (the server would refuse them).
 */
export function addonLinesFromCounts(
  addons: Pick<TicketType, 'id' | 'price_paise' | 'max_per_registration'>[],
  counts: AddonCounts,
  names: AddonNames,
  primaryId: string | undefined,
  prices: Pick<AddonPrice, 'addon_id' | 'ticket_type_id' | 'price_paise' | 'available'>[] = [],
): AddonLine[] {
  if (!primaryId) return []
  const out: AddonLine[] = []
  for (const a of addons) {
    let left = Math.max(0, a.max_per_registration)
    for (const [typeId, raw] of Object.entries(counts[a.id] ?? {})) {
      const pr = addonPriceFor(a, typeId, prices)
      const qty = Math.min(Math.floor(raw) || 0, typeId === primaryId ? 1 : left, left)
      if (qty <= 0 || !pr.available) continue
      left -= qty
      const nm = (names[a.id]?.[typeId] ?? []).slice(0, qty).map((x) => x.trim())
      out.push({ addonId: a.id, forId: typeId, qty, unitPaise: pr.pricePaise, ...(nm.some(Boolean) ? { names: nm.filter(Boolean) } : {}) })
    }
  }
  return out
}

/** Money for the extras: each person type's own price times its count. */
export function addonLinesTotal(lines: AddonLine[]): number {
  return lines.reduce((s, l) => s + l.unitPaise * l.qty, 0)
}

/**
 * Counts (and names) of one extra rebuilt from saved item rows. Typed rows map straight to their person type; an older untyped
 * row is given to "Me" first, then to the first person type that can take it.
 */
export function countsFromItems(
  addonId: string,
  items: { ticket_type_id: string; for_ticket_type_id?: string | null; quantity: number; names?: string[] | null }[],
  primaryId: string | undefined,
  typeIds: string[],
): { counts: Record<string, number>; names: Record<string, string[]> } {
  const counts: Record<string, number> = {}
  const names: Record<string, string[]> = {}
  const rows = items.filter((i) => i.ticket_type_id === addonId)
  for (const r of rows.filter((x) => x.for_ticket_type_id)) {
    counts[r.for_ticket_type_id!] = (counts[r.for_ticket_type_id!] ?? 0) + r.quantity
    if (r.names?.length) names[r.for_ticket_type_id!] = [...r.names]
  }
  let legacy = rows.filter((x) => !x.for_ticket_type_id).reduce((n, x) => n + x.quantity, 0)
  if (primaryId && legacy > 0 && !counts[primaryId]) {
    counts[primaryId] = 1
    legacy--
  }
  const first = typeIds[0]
  if (first && legacy > 0) counts[first] = (counts[first] ?? 0) + legacy
  return { counts, names }
}

/** Named people who join only through an extra, from saved item rows: "Name (27 Dec event, Child)". */
export function extraPeople(items: { label: string; names?: string[] | null }[]): { name: string; label: string }[] {
  return items.flatMap((i) => (i.names ?? []).filter((n) => n.trim()).map((name) => ({ name, label: i.label })))
}

/** People per day for a ticket selection: { 1: 1, 2: 4 }. */
export function dayHeads(tickets: Pick<TicketType, 'id' | 'days'>[], qty: Record<string, number>, days: number): Record<number, number> {
  const out: Record<number, number> = {}
  for (let d = 1; d <= days; d++) {
    out[d] = tickets.reduce((s, t) => s + (!t.days || t.days.includes(d) ? (qty[t.id] ?? 0) : 0), 0)
  }
  return out
}

/** Reunion Fund amount check: whole rupees, ₹100 – ₹10,00,000. */
export function fundOk(paise: number | null | undefined): boolean {
  return typeof paise === 'number' && Number.isInteger(paise) && paise % 100 === 0 && paise >= FUND_MIN_PAISE && paise <= FUND_MAX_PAISE
}

export type AnswerProblem = 'required' | 'option' | 'yesno' | 'long'

/** Same rules as the server: required, options, yes/no, length (short 200, long 2000). Returns problems by question id. */
export function checkCustomAnswers(questions: EventQuestion[], answers: Record<string, CustomAnswer | undefined>): Record<string, AnswerProblem> {
  const out: Record<string, AnswerProblem> = {}
  for (const q of questions.filter((x) => x.is_active)) {
    const v = answers[q.id]
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
    if (empty) {
      if (q.required) out[q.id] = 'required'
      continue
    }
    if (q.kind === 'yes_no' && typeof v !== 'boolean') out[q.id] = 'yesno'
    else if (q.kind === 'single' && (typeof v !== 'string' || !q.options.includes(v))) out[q.id] = 'option'
    else if (q.kind === 'multi' && (!Array.isArray(v) || v.some((x) => !q.options.includes(x)))) out[q.id] = 'option'
    else if ((q.kind === 'short_text' || q.kind === 'long_text') && (typeof v !== 'string' || v.trim().length > (q.kind === 'short_text' ? 200 : 2000))) out[q.id] = 'long'
  }
  return out
}

/** Only the answers worth sending: active questions, trimmed, empty ones left out. */
export function cleanCustomAnswers(questions: EventQuestion[], answers: Record<string, CustomAnswer | undefined>): Record<string, CustomAnswer> {
  const out: Record<string, CustomAnswer> = {}
  for (const q of questions.filter((x) => x.is_active)) {
    const v = answers[q.id]
    if (v === undefined || v === null) continue
    if (typeof v === 'string') {
      if (v.trim()) out[q.id] = v.trim()
    } else if (Array.isArray(v)) {
      if (v.length) out[q.id] = v
    } else out[q.id] = v
  }
  return out
}

/** Text shown for an answer ("Yes", "Panel, Cricket"). */
export function answerText(v: CustomAnswer | undefined, yes = 'Yes', no = 'No'): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'boolean') return v ? yes : no
  if (Array.isArray(v)) return v.join(', ')
  return v
}

export type ProfileField = 'full_name' | 'phone' | 'grad_year' | 'branch' | 'city' | 'country' | 'designation' | 'company'

/** Current role: the profile's title/company, else the current job from experiences (as the server does). */
export function currentRole(profile: Pick<Profile, 'current_title' | 'current_company'>, experiences: Pick<Experience, 'title' | 'company' | 'is_current'>[]) {
  const cur = experiences.find((x) => x.is_current)
  return { designation: profile.current_title?.trim() || cur?.title || '', company: profile.current_company?.trim() || cur?.company || '' }
}

/** Profile details the registration needs but the profile doesn't have yet. */
export function missingProfileFields(
  profile: Pick<Profile, 'full_name' | 'grad_year' | 'branch' | 'city' | 'country' | 'current_title' | 'current_company'>,
  phone: string | null | undefined,
  experiences: Pick<Experience, 'title' | 'company' | 'is_current'>[],
  reunion: boolean,
): ProfileField[] {
  const out: ProfileField[] = []
  if (!profile.full_name.trim()) out.push('full_name')
  if (!phone || !(isValidPhone(phone) || /^\+?[0-9 ]{10,16}$/.test(phone.trim()))) out.push('phone')
  if (!reunion) return out
  if (!profile.grad_year) out.push('grad_year')
  if (!profile.branch) out.push('branch')
  if (!profile.city?.trim()) out.push('city')
  if (!profile.country?.trim()) out.push('country')
  const role = currentRole(profile, experiences)
  if (!role.designation) out.push('designation')
  if (!role.company) out.push('company')
  return out
}

/** "Senior Engineer at Wipro (2010–2014)" for each earlier job, newest first (what the registration will record). */
export function pastJobs(experiences: Pick<Experience, 'title' | 'company' | 'is_current' | 'start_date' | 'end_date'>[]): string[] {
  const year = (d: string | null) => (d ? d.slice(0, 4) : null)
  return experiences
    .filter((x) => !x.is_current)
    .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
    .map((x) => {
      const span = [year(x.start_date), year(x.end_date)].filter(Boolean).join('–')
      return `${x.title} at ${x.company}${span ? ` (${span})` : ''}`
    })
}
