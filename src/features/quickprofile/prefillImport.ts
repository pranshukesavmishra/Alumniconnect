// Reunion list (Google Form responses) -> prefill rows. Columns are recognised whatever the form called them
// ("Email Address", "Current Organisation", "Batch (passing year)"...). Phones become E.164, branches the app's names.
import Papa from 'papaparse'
import { mapColumns, normaliseType, normaliseYear } from '../../lib/memberImport'
import { e164OrNull, mapBranch } from './mapping'

export type PrefillField =
  | 'full_name' | 'email' | 'phone' | 'member_type' | 'grad_year' | 'join_year' | 'branch' | 'city' | 'country' | 'organisation' | 'designation'

export interface PrefillRow {
  line: number
  full_name: string
  email: string | null
  phone: string | null
  member_type: string | null
  grad_year: string | null
  join_year: string | null
  branch: string | null
  city: string | null
  country: string | null
  organisation: string | null
  designation: string | null
  /** why the row cannot be used ('' when fine) */
  problem: '' | 'no_name' | 'no_contact'
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

/** Exact aliases from the member import first, then looser "contains" rules for form-style questions. */
export function mapPrefillColumns(headers: string[]): Partial<Record<PrefillField, string>> {
  const { columns } = mapColumns(headers)
  const out: Partial<Record<PrefillField, string>> = {
    full_name: columns.full_name,
    email: columns.email,
    phone: columns.phone,
    member_type: columns.member_type,
    grad_year: columns.grad_year,
    join_year: columns.join_year,
    branch: columns.branch,
    city: columns.city,
    designation: columns.current_title,
    organisation: columns.current_company,
  }
  const used = new Set(Object.values(out).filter(Boolean) as string[])
  const rules: [PrefillField, (n: string) => boolean][] = [
    ['email', (n) => n.includes('email') || n.includes('mailid')],
    ['phone', (n) => /mobile|phone|whatsapp|contact/.test(n)],
    ['organisation', (n) => /organi[sz]ation|company|employer|workplace|firm/.test(n)],
    ['designation', (n) => /designation|jobtitle|position|currentrole/.test(n)],
    ['join_year', (n) => /joining|admission|yearofjoin/.test(n)],
    ['grad_year', (n) => /batch|passing|passout|graduation|yearofpass/.test(n)],
    ['branch', (n) => /branch|department|discipline|stream/.test(n)],
    ['country', (n) => n.includes('country')],
    ['city', (n) => /city|location|residence|basedin|place/.test(n)],
    ['full_name', (n) => n.includes('name') && !/organi|company|father|spouse|guest|user/.test(n)],
  ]
  for (const [field, test] of rules) {
    if (out[field]) continue
    const h = headers.find((x) => !used.has(x) && test(norm(x)))
    if (h) {
      out[field] = h
      used.add(h)
    }
  }
  for (const k of Object.keys(out) as PrefillField[]) if (!out[k]) delete out[k]
  return out
}

export const MAX_PREFILL_ROWS = 5000

export interface ParsedPrefill {
  rows: PrefillRow[]
  columns: Partial<Record<PrefillField, string>>
  error: 'empty' | 'no_name' | 'no_contact' | 'too_many' | null
}

/** Rows from a table whose first row is the column names (CSV text or the cells of an Excel sheet). */
export function prefillFromTable(table: string[][]): ParsedPrefill {
  const [head, ...body] = table
  const headers = (head ?? []).map((h) => String(h ?? '').trim())
  const columns = mapPrefillColumns(headers)
  const data = body.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!headers.length || !data.length) return { rows: [], columns, error: 'empty' }
  if (!columns.full_name) return { rows: [], columns, error: 'no_name' }
  if (!columns.email && !columns.phone) return { rows: [], columns, error: 'no_contact' }
  if (data.length > MAX_PREFILL_ROWS) return { rows: [], columns, error: 'too_many' }
  const idx = (f: PrefillField) => (columns[f] ? headers.indexOf(columns[f]!) : -1)
  const at = (r: string[], f: PrefillField) => {
    const i = idx(f)
    return i < 0 ? '' : String(r[i] ?? '').trim().replace(/\s+/g, ' ')
  }
  const orNull = (v: string) => (v ? v : null)
  const rows = data.map((r, i): PrefillRow => {
    const email = at(r, 'email').toLowerCase()
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null
    const phone = e164OrNull(at(r, 'phone').replace(/^'/, ''))
    const year = normaliseYear(at(r, 'grad_year'))
    const join = normaliseYear(at(r, 'join_year'))
    const type = normaliseType(at(r, 'member_type'))
    const full_name = at(r, 'full_name')
    return {
      line: i + 1,
      full_name,
      email: validEmail,
      phone,
      member_type: ['alumnus', 'student', 'faculty'].includes(type) ? type : null,
      grad_year: /^(19|20)\d{2}$/.test(year) ? year : null,
      join_year: /^(19|20)\d{2}$/.test(join) ? join : null,
      branch: mapBranch(at(r, 'branch')) ?? orNull(at(r, 'branch').slice(0, 80)),
      city: orNull(at(r, 'city').slice(0, 80)),
      country: orNull(at(r, 'country').slice(0, 80)),
      organisation: orNull(at(r, 'organisation').slice(0, 120)),
      designation: orNull(at(r, 'designation').slice(0, 120)),
      problem: full_name.length < 2 ? 'no_name' : !validEmail && !phone ? 'no_contact' : '',
    }
  })
  return { rows, columns, error: null }
}

export function prefillFromCsv(text: string): ParsedPrefill {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  return prefillFromTable(parsed.data)
}

/** CSV or Excel (.xlsx), read on the device. */
export async function readPrefillFile(file: File): Promise<ParsedPrefill> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) {
    const { readSheet } = await import('read-excel-file/browser')
    const sheet = (await readSheet(file)) as unknown[][]
    return prefillFromTable(sheet.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? '' : String(c)))))
  }
  return prefillFromCsv(await file.text())
}

/** The payload for admin_prefill_import (usable rows only). */
export const toImportPayload = (rows: PrefillRow[]) => rows.filter((r) => !r.problem).map(({ line: _l, problem: _p, ...r }) => r)
