import type { ImportedProfile } from '../../features/profile/queries'

export type { ImportedProfile }

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** "Jan 2020", "January 2020", "2020", "01/2020", "2020-01" -> "2020-01-01" (null if unknown/"Present"). */
export function parseLinkedInDate(input: string | undefined | null): string | null {
  if (!input) return null
  const s = input.trim().toLowerCase()
  if (!s || /present|current|now/.test(s)) return null
  let m = s.match(/^([a-z]{3,9})\.?\s+(\d{4})$/)
  if (m) {
    const mon = MONTHS[m[1]!.slice(0, m[1] === 'sept' ? 4 : 3)]
    if (mon) return `${m[2]}-${String(mon).padStart(2, '0')}-01`
  }
  m = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}-01`
  m = s.match(/^(\d{4})-(\d{2})(-\d{2})?$/)
  if (m) return `${m[1]}-${m[2]}-01`
  m = s.match(/^(\d{4})$/)
  if (m) return `${m[1]}-01-01`
  return null
}

export function yearOf(input: string | undefined | null): number | null {
  const m = input?.match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : null
}

/** LinkedIn sometimes leaves HTML entities in exported text ("P&amp;L"). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => safeChar(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d: string) => safeChar(Number(d), m))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_m, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()]!)
}
function safeChar(code: number, fallback: string): string {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback
}

export function cleanText(s: string | undefined | null, max = 3000): string | undefined {
  const t = s?.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t ? t.slice(0, max) : undefined
}

export function isLinkedInUrl(url: string): boolean {
  return /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[\p{L}\p{N}\-_%]+\/?$/u.test(url.trim())
}

export function normalizeLinkedInUrl(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!/^https?:\/\//.test(s)) s = `https://${s.replace(/^\/+/, '')}`
  s = s.replace(/^http:\/\//, 'https://').replace(/\?.*$/, '').replace(/#.*$/, '')
  const m = s.match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([\p{L}\p{N}\-_%]+)\/?$/u)
  if (!m) return null
  let slug = m[1]!
  try {
    slug = decodeURIComponent(slug)
  } catch {
    /* keep as typed */
  }
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`
}

/** Is this education entry Jabalpur Engineering College? */
export function isJec(school: string): boolean {
  return /jabalpur engineering college|\bjec\b.*jabalpur|government engineering college,? jabalpur/i.test(school)
}

/** A web address typed by a member: adds https:// when missing; returns null for anything that isn't a real http(s) address. */
export function normalizeWebUrl(input: string): string | null {
  const t = input.trim()
  if (!t || /\s/.test(t)) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Days in a month for birthdays (February allows the 29th). */
export function maxBirthDay(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31
}
