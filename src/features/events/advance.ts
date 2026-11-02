// Advance payments made before the app (Google Form days). The server matches and applies them
// (supabase/migrations/20261102000140_advance_credits.sql); these helpers MIRROR its normalisation exactly so the import
// import and the admin screens agree with it. advanceVectors.json holds the shared test vectors: the vitest suite and
// the database test (supabase/tests/99_advance_credits.sql) both check every vector.

/** Phone -> E.164 (as public._adv_phone). Indian numbers in any common form; others only when written with + or 00. */
export function advPhone(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  const dg = t.replace(/[^0-9]/g, '')
  const intl = t.startsWith('+') ? dg : /^00[1-9]/.test(dg) && dg.length > 8 ? dg.slice(2) : null
  if (intl !== null) {
    if (/^910?[6-9][0-9]{9}$/.test(intl)) return `+91${intl.slice(-10)}`
    if (/^91/.test(intl)) return null
    return intl.length >= 8 && intl.length <= 15 ? `+${intl}` : null
  }
  const noZero = dg.replace(/^0+/, '')
  if (/^[6-9][0-9]{9}$/.test(noZero)) return `+91${noZero}`
  if (/^910?[6-9][0-9]{9}$/.test(dg)) return `+91${dg.slice(-10)}`
  return null
}

/** Email: lower case, all spaces removed; null without exactly one @ (as public._adv_email). */
export function advEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/\s/g, '').toLowerCase()
  return /^[^@]+@[^@]+$/.test(v) ? v : null
}

const TITLE = /^(dr|mr|mrs|ms|er|prof|shri|smt|miss)(\.\s*|\s+)/

/** Name key: titles dropped, dots and apostrophes removed, other punctuation a space (as public._adv_name). */
export function advName(raw: string | null | undefined): string {
  let v = (raw ?? '').trim().toLowerCase()
  for (let prev = ''; prev !== v; ) {
    prev = v
    v = v.replace(TITLE, '')
  }
  return v.replace(/[.'`’]/g, '').replace(/[^\p{L}]+/gu, ' ').trim()
}

/** First and last word of the name key; null for a one-word name (as public._adv_name_fl). */
export function advNameFirstLast(raw: string | null | undefined): string | null {
  const w = advName(raw).split(' ').filter(Boolean)
  return w.length >= 2 ? `${w[0]} ${w[w.length - 1]}` : null
}

const STOP = new Set(['in', 'and', 'of', 'the', 'engineering', 'engg', 'eng', 'dept', 'department', 'branch'])
const SYNONYMS: [string, string[]][] = [
  ['electronic telecommunication', ['electronic telecommunication', 'e tc', 'etc', 'entc', 'extc', 'e and tc', 'ece', 'ec', 'e c', 'et', 'e t', 'electronic',
    'electronic communication', 'electronic telecom', 'electronic tele communication', 'electronic and telecommunication']],
  ['computer science', ['computer science', 'cse', 'cs', 'c s', 'c s e', 'computer', 'co', 'computer sc', 'computer science technology']],
  ['information technology', ['information technology', 'it', 'i t']],
  ['electrical', ['electrical', 'ee', 'e e']],
  ['mechanical', ['mechanical', 'mech']],
  ['civil', ['civil', 'ce', 'c e']],
  ['industrial production', ['industrial production', 'ip', 'ipe', 'i p', 'production', 'industrial', 'production industrial']],
  ['mca', ['mca', 'master computer application', 'master of computer application']],
]

/** Tolerant branch key (as public._adv_branch): "B.E. in Electronics & Telecommunications" = "E&TC" = "ECE". */
export function advBranch(raw: string | null | undefined): string {
  let v = (raw ?? '').toLowerCase().replace(/&/g, ' and ')
  v = ` ${v.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  v = v.replace(/ (b e|be|b tech|btech|bachelor of engineering|bachelor of technology|bachelors of engineering) /g, ' ')
  v = v.replace(/ (m e|m tech|mtech) /g, ' me ')
  const words = v.trim().split(' ').filter((w) => w !== '' && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  const key = words.join(' ')
  return SYNONYMS.find(([, list]) => list.includes(key))?.[0] ?? key
}

export interface AdvancePerson {
  phones: (string | null | undefined)[]
  emails: (string | null | undefined)[]
  name: string | null | undefined
  year: number | null | undefined
  branch: string | null | undefined
}
export interface AdvanceCreditKey {
  full_name: string
  grad_year: number | null
  branch: string | null
  phone: string | null
  email: string | null
}

/** How a credit matches a person (as public._adv_match): 'phone', 'email', 'name' or null. */
export function advMatch(c: AdvanceCreditKey, p: AdvancePerson): 'phone' | 'email' | 'name' | null {
  const phones = p.phones.map(advPhone).filter(Boolean)
  const emails = p.emails.map(advEmail).filter(Boolean)
  if (c.phone && phones.includes(c.phone)) return 'phone'
  if (c.email && emails.includes(c.email)) return 'email'
  const cb = advBranch(c.branch)
  const cn = advName(c.full_name)
  const fl = advNameFirstLast(c.full_name)
  if (c.grad_year != null && c.grad_year === p.year && cb !== '' && cb === advBranch(p.branch) && cn !== '' &&
      (cn === advName(p.name) || (fl !== null && fl === advNameFirstLast(p.name)))) return 'name'
  return null
}

/** What the member still pays: the ticket total less every payment received or waiting (the advance is one of them). */
export function amountDue(totalPaise: number, payments: { amount_paise: number; status: string }[]): number {
  return Math.max(0, totalPaise - payments.filter((p) => p.status === 'submitted' || p.status === 'verified').reduce((s, p) => s + p.amount_paise, 0))
}
