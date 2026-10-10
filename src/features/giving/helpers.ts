// Pure helpers for the Give Back module (unit-tested): amounts in integer paise, progress, countdown, links.
import { parseRupeesToPaise } from '../../lib/money'

/** A single gift is between ₹10 and ₹10,00,000 (the database enforces the same bounds). */
export const MIN_GIFT_PAISE = 1000
export const MAX_GIFT_PAISE = 100_000_000

export const CAMPAIGN_TYPES = ['project', 'scholarship', 'adopt', 'alumni_fund', 'drive'] as const
export type CampaignType = (typeof CAMPAIGN_TYPES)[number]

export function isCampaignType(v: string): v is CampaignType {
  return (CAMPAIGN_TYPES as readonly string[]).includes(v)
}

/** "2,500" or "₹2500.50" typed by a donor, as paise; null when empty, malformed or outside the allowed range. */
export function parseGift(input: string): number | null {
  const p = parseRupeesToPaise(input.trim())
  if (p === null || p < MIN_GIFT_PAISE || p > MAX_GIFT_PAISE) return null
  return p
}

export type GiftProblem = 'empty' | 'invalid' | 'low' | 'high'
export function giftProblem(input: string): GiftProblem | null {
  if (!input.trim()) return 'empty'
  const p = parseRupeesToPaise(input.trim())
  if (p === null) return 'invalid'
  if (p < MIN_GIFT_PAISE) return 'low'
  if (p > MAX_GIFT_PAISE) return 'high'
  return null
}

/** Whole-number percentage of the goal that is raised (can pass 100: the bar is clamped, the number is not). */
export function percentOf(raised: number, goal: number): number {
  if (!goal || goal <= 0) return 0
  return Math.max(0, Math.floor((raised * 100) / goal))
}
export const barWidth = (raised: number, goal: number) => Math.min(100, percentOf(raised, goal))

/** Days left until the end of an appeal; null = no end date; 0 = ended. Counted in whole days, rounding up. */
export function daysLeft(endsAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - now
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

/** How much of an item is still unfunded (verified + waiting for review count as taken). */
export function itemRemaining(item: { price_paise: number; funded_paise: number; pending_paise: number }): number {
  return Math.max(0, item.price_paise - item.funded_paise - item.pending_paise)
}

/** UPI note: short, letters and digits only (some apps reject anything else). */
export function upiNote(slug: string): string {
  return ('JEC ' + slug.replace(/[^a-zA-Z0-9]+/g, ' ')).trim().slice(0, 30)
}

export function whatsappShareUrl(text: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(text)
}

/** Donor wall label: anonymous gifts never carry a name or batch. */
export function donorLabel(d: { anonymous: boolean; name: string | null }, anonymousLabel: string): string {
  return d.anonymous || !d.name ? anonymousLabel : d.name
}

/** The sponsor pipeline, in order. */
export const SPONSOR_STAGES = ['lead', 'contacted', 'proposal_sent', 'committed', 'paid', 'delivered', 'declined'] as const
export type SponsorStage = (typeof SPONSOR_STAGES)[number]

/** A sponsor logo link is only ever an http(s) address. */
export function safeWebsite(url: string | null | undefined): string | null {
  return url && /^https?:\/\/[^\s]{3,255}$/i.test(url) ? url : null
}

/** Rupees typed into a form as paise, or null. Allows an empty string when `optional`. */
export function rupeesToPaise(input: string): number | null {
  const t = input.trim()
  return t ? parseRupeesToPaise(t) : null
}

export const paiseToRupeesText = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100))
