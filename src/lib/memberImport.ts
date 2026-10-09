// CSV import of members: read a spreadsheet export, recognise its columns whatever they are called
// ("Name", "Batch", "Mobile No."...), and normalise values the way the app stores them. The database
// checks every row again (admin_import_preview) before anything is created.
import Papa from 'papaparse'
import { BRANCHES } from './constants'

export interface ImportRow {
  /** 1-based line in the file, header excluded */
  line: number
  full_name: string
  email: string
  phone: string
  member_type: string
  branch: string
  grad_year: string
  join_year: string
  city: string
  current_title: string
  current_company: string
}
export type ImportField = Exclude<keyof ImportRow, 'line'>

const ALIASES: Record<ImportField, string[]> = {
  full_name: ['full name', 'name', 'member name', 'alumni name', 'alumnus name', 'student name'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail', 'email id', 'mail id'],
  phone: ['phone', 'mobile', 'mobile number', 'mobile no', 'phone number', 'phone no', 'contact', 'contact number', 'whatsapp', 'whatsapp number'],
  member_type: ['member type', 'type', 'category', 'role'],
  branch: ['branch', 'department', 'dept', 'stream', 'discipline'],
  grad_year: ['passing-out year', 'passing out year', 'passout year', 'pass out year', 'passing year', 'graduation year', 'grad year', 'batch', 'year of passing'],
  join_year: ['joining year', 'join year', 'admission year', 'year of joining', 'year of admission'],
  city: ['city', 'current city', 'location', 'place'],
  current_title: ['current role', 'role / title', 'designation', 'title', 'job title', 'position'],
  current_company: ['company', 'current company', 'organisation', 'organization', 'employer', 'workplace'],
}
export const IMPORT_FIELDS = Object.keys(ALIASES) as ImportField[]
export const FIELD_LABELS: Record<ImportField, string> = {
  full_name: 'Full name', email: 'Email', phone: 'Mobile', member_type: 'Member type', branch: 'Branch', grad_year: 'Passing-out year',
  join_year: 'Joining year', city: 'City', current_title: 'Current role', current_company: 'Company',
}

/** "E-mail ID", "email_id" and "Email Id." all become "emailid" */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

/** Which header holds which field. The first matching header wins; unknown headers are reported, not guessed. */
export function mapColumns(headers: string[]): { columns: Partial<Record<ImportField, string>>; unknown: string[] } {
  const columns: Partial<Record<ImportField, string>> = {}
  const used = new Set<string>()
  for (const field of IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && ALIASES[field].some((a) => norm(a) === norm(x)))
    if (h !== undefined) {
      columns[field] = h
      used.add(h)
    }
  }
  return { columns, unknown: headers.filter((h) => !used.has(h) && h.trim() !== '') }
}

const B = {
  cse: 'B.E. in Computer Science & Engineering',
  it: 'B.E. in Information Technology',
  etc: 'B.E. in Electronics & Telecommunications',
  ee: 'B.E. in Electrical Engineering',
  me: 'B.E. in Mechanical Engineering',
  ce: 'B.E. in Civil Engineering',
  ip: 'B.E. Industrial & Production Engineering',
} as const
const SHORT_BRANCHES: Record<string, string> = {
  cse: B.cse, cs: B.cse, 'computer science': B.cse, 'computer science engineering': B.cse,
  it: B.it, 'information technology': B.it,
  ece: B.etc, ec: B.etc, etc: B.etc, entc: B.etc, electronics: B.etc, 'electronics telecommunication': B.etc,
  'electronics telecommunications': B.etc, 'electronics telecommunication engineering': B.etc,
  ee: B.ee, electrical: B.ee, 'electrical engineering': B.ee,
  me: B.me, mech: B.me, mechanical: B.me, 'mechanical engineering': B.me,
  ce: B.ce, civil: B.ce, 'civil engineering': B.ce,
  ip: B.ip, ipe: B.ip, production: B.ip, 'industrial production': B.ip, 'industrial production engineering': B.ip,
  'ai ds': 'Artificial Intelligence & Data Science', aids: 'Artificial Intelligence & Data Science',
}

export function normaliseBranch(v: string): string {
  const t = v.trim()
  if (!t) return ''
  const exact = BRANCHES.find((b) => b.toLowerCase() === t.toLowerCase())
  if (exact) return exact
  const key = t.toLowerCase().replace(/[.&/,-]/g, ' ').replace(/^(b e|be)( in)?\s+/, '').replace(/\s+/g, ' ').trim()
  return SHORT_BRANCHES[key] ?? t
}

export function normaliseType(v: string): string {
  const t = v.trim().toLowerCase()
  if (!t) return ''
  if (/^(alumn(us|a|i|ae)?|alumni)$/.test(t)) return 'alumnus'
  if (/^(student|current student)s?$/.test(t)) return 'student'
  if (/^(faculty|staff|teacher|professor)s?$/.test(t)) return 'faculty'
  return t
}

/** "2005", "Batch of 2005", "2001-2005" (takes the last year), "05" stays as typed so the server can flag it. */
export function normaliseYear(v: string): string {
  const years = v.match(/(19|20)\d{2}/g)
  return years ? years[years.length - 1]! : v.trim()
}

/** Indian numbers typed in a spreadsheet: keeps digits, + and spaces; Excel's "9.19876E+11" is reported as-is. */
export function normalisePhone(v: string): string {
  return v.replace(/^'/, '').replace(/[()\-.]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface ParsedImport {
  rows: ImportRow[]
  columns: Partial<Record<ImportField, string>>
  unknown: string[]
  /** what stops the import entirely (no rows, no name/email column) */
  error: string | null
}

export const MAX_IMPORT_ROWS = 2000

export function parseMemberCsv(textIn: string): ParsedImport {
  const text = textIn.replace(/^﻿/, '')
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  const headers = parsed.meta.fields ?? []
  const { columns, unknown } = mapColumns(headers)
  const empty: ParsedImport = { rows: [], columns, unknown, error: null }
  if (!headers.length || !parsed.data.length) return { ...empty, error: 'The file has no rows. The first line should be the column names.' }
  if (!columns.full_name || !columns.email) {
    return { ...empty, error: 'The file needs a "Full name" column and an "Email" column. Download the template to see the layout.' }
  }
  if (parsed.data.length > MAX_IMPORT_ROWS) return { ...empty, error: `At most ${MAX_IMPORT_ROWS} rows at a time. Split the file and import it in parts.` }
  const get = (r: Record<string, string>, f: ImportField) => (columns[f] ? String(r[columns[f]!] ?? '').trim() : '')
  const rows = parsed.data.map((r, i) => ({
    line: i + 1,
    full_name: get(r, 'full_name').replace(/\s+/g, ' '),
    email: get(r, 'email').toLowerCase(),
    phone: normalisePhone(get(r, 'phone')),
    member_type: normaliseType(get(r, 'member_type')),
    branch: normaliseBranch(get(r, 'branch')),
    grad_year: normaliseYear(get(r, 'grad_year')),
    join_year: normaliseYear(get(r, 'join_year')),
    city: get(r, 'city'),
    current_title: get(r, 'current_title'),
    current_company: get(r, 'current_company'),
  }))
  return { rows, columns, unknown, error: null }
}

export const IMPORT_TEMPLATE =
  'Full name,Email,Mobile,Member type,Branch,Passing-out year,Joining year,City,Current role,Company\n' +
  'Asha Rao,asha.rao@example.com,+91 98765 43210,alumnus,B.E. in Computer Science & Engineering,2005,2001,Pune,Engineering Manager,Acme Ltd\n'
