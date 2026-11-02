// Organisers' advance list (CSV or Excel) -> rows for admin_add_advance_credits. Columns are recognised whatever the
// sheet called them (reuses the reunion-list mapping): Name, JEC Graduation Year, Branch, Contact Number, Email Id,
// Advance amount (blank or "Paid" = the default advance), Note.
import Papa from 'papaparse'
import { mapPrefillColumns } from '../quickprofile/prefillImport'
import { mapBranch } from '../quickprofile/mapping'
import { normaliseYear } from '../../lib/memberImport'
import { advBranch, advEmail, advPhone } from '../events/advance'

export const DEFAULT_ADVANCE_PAISE = 50000

/** "500", "Rs. 500/-", "₹1,000" -> paise; blank / "Paid" / "Yes" -> the default advance; "No" / "0" / "unpaid" -> null (skip). */
export function parseAdvanceAmount(raw: string | null | undefined, fallbackPaise = DEFAULT_ADVANCE_PAISE): number | null {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t || /^(paid|yes|y|done|received|advance paid)$/.test(t)) return fallbackPaise
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
