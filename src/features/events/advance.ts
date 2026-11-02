// Advance payments made before the app (Google Form days). The server matches and applies them
// (supabase/migrations/20261102000140_advance_credits.sql); these helpers MIRROR its normalisation exactly so the import
// preview can tell the organiser what will match. advanceVectors.json holds the shared test vectors: the vitest suite and
// the database test (supabase/tests/99_advance_credits.sql) both check every vector.
import Papa from 'papaparse'
import { mapPrefillColumns } from '../quickprofile/prefillImport'
import { mapBranch } from '../quickprofile/mapping'
import { normaliseYear } from '../../lib/memberImport'

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

// ---------------------------------------------------------------- import (CSV / Excel), reusing the reunion-list column mapping

export const DEFAULT_ADVANCE_PAISE = 50000

/** "500", "Rs. 500/-", "₹1,000" -> paise; blank / "Paid" / "Yes" -> the default advance; "No" / "0" / "unpaid" -> null (skip). */
export function parseAdvanceAmount(raw: string | null | undefined, fallbackPaise = DEFAULT_ADVANCE_PAISE): number | null {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t || /^(paid|yes|y|done|received|advance paid|✓)$/.test(t)) return fallbackPaise
  if (/^(no|n|unpaid|not paid|nil|-|0|0\.0+)$/.test(t)) return null
  const m = t.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  if (!m) return /paid/.test(t) && !/not|un/.test(t) ? fallbackPaise : null
  const paise = Math.round(Number(m[1]) * 100)
  return paise >= 100 ? paise : null
}

export interface AdvanceRow {
  line: number
  full_name: string
  grad_year: number | null
  branch: string | null
  phone: string | null
  email: string | null
  amount_paise: number | null
  note: string | null
  problem: '' | 'no_name' | 'no_key' | 'no_amount'
}

export interface ParsedAdvance {
  rows: AdvanceRow[]
  error: 'empty' | 'no_name' | 'too_many' | null
}

const normHead = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

/** Rows from a table whose first row is the column names. Columns: Name, JEC Graduation Year, Branch, Contact Number, Email Id, Advance amount, Note. */
export function advanceFromTable(table: string[][], fallbackPaise = DEFAULT_ADVANCE_PAISE): ParsedAdvance {
  const [head, ...body] = table
  const headers = (head ?? []).map((h) => String(h ?? '').trim())
  const amountCol = headers.find((h) => /advance|amount|paid|payment|rupees|inr/.test(normHead(h)))
  const noteCol = headers.find((h) => h !== amountCol && /note|remark|comment/.test(normHead(h)))
  const cols = mapPrefillColumns(headers.map((h) => (h === amountCol || h === noteCol ? '' : h)))
  const data = body.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!headers.length || !data.length) return { rows: [], error: 'empty' }
  if (!cols.full_name) return { rows: [], error: 'no_name' }
  if (data.length > 5000) return { rows: [], error: 'too_many' }
  const at = (r: string[], h: string | undefined) => (h ? String(r[headers.indexOf(h)] ?? '').trim().replace(/\s+/g, ' ') : '')
  const rows = data.map((r, i): AdvanceRow => {
    const full_name = at(r, cols.full_name).slice(0, 120)
    const year = normaliseYear(at(r, cols.grad_year))
    const grad_year = /^(19|20)\d{2}$/.test(year) ? Number(year) : null
    const rawBranch = at(r, cols.branch)
    const branch = rawBranch ? (mapBranch(rawBranch) ?? rawBranch.slice(0, 120)) : null
    const phone = advPhone(at(r, cols.phone).replace(/^'/, ''))
    const email = advEmail(at(r, cols.email))
    const amount_paise = parseAdvanceAmount(at(r, amountCol), fallbackPaise)
    const note = at(r, noteCol).slice(0, 500) || null
    const problem: AdvanceRow['problem'] =
      full_name.length < 2 ? 'no_name' : amount_paise === null ? 'no_amount' : !phone && !email && !(grad_year && advBranch(branch)) ? 'no_key' : ''
    return { line: i + 1, full_name, grad_year, branch, phone, email, amount_paise, note, problem }
  })
  return { rows, error: null }
}

export function advanceFromCsv(text: string, fallbackPaise?: number): ParsedAdvance {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  return advanceFromTable(parsed.data, fallbackPaise)
}

/** CSV or Excel (.xlsx), read on the device. */
export async function readAdvanceFile(file: File, fallbackPaise?: number): Promise<ParsedAdvance> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) {
    const { readSheet } = await import('read-excel-file/browser')
    const sheet = (await readSheet(file)) as unknown[][]
    return advanceFromTable(sheet.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? '' : String(c)))), fallbackPaise)
  }
  return advanceFromCsv(await file.text(), fallbackPaise)
}

/** The payload for admin_add_advance_credits (usable rows only). */
export const toAdvancePayload = (rows: AdvanceRow[]) =>
  rows.filter((r) => !r.problem).map(({ full_name, grad_year, branch, phone, email, amount_paise, note }) => ({ full_name, grad_year, branch, phone, email, amount_paise, note }))

/** What the member still pays: the ticket total less every payment received or waiting (the advance is one of them). */
export function amountDue(totalPaise: number, payments: { amount_paise: number; status: string }[]): number {
  return Math.max(0, totalPaise - payments.filter((p) => p.status === 'submitted' || p.status === 'verified').reduce((s, p) => s + p.amount_paise, 0))
}
