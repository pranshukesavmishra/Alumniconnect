import Papa from 'papaparse'
import { downloadFile } from '../../lib/ics'
import { FOOD_PREFS } from '../../lib/constants'
import type { EventRow } from '../../lib/types'
import type { AdminData } from './queries'

export const food = (v: string | null) => FOOD_PREFS.find((f) => f.value === v)?.label ?? ''
export const rupees = (p: number) => (p / 100).toFixed(2)
export const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')

/** Member-typed text: a leading = + - @ would run as a formula in Excel, so neutralise it. */
export const safe = (v: string | null | undefined) => {
  const t = v ?? ''
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
}
export const spreadsheetSafe = safe
/** Long digit strings (phones, UTRs) as text so Excel keeps every digit ("+91…" not "9.19E+11"). */
export const asText = (v: string | null | undefined) => (v ? `="${v.replace(/"/g, '')}"` : '')

/**
 * Last line of defence for every spreadsheet we hand out: any text cell that starts with = + - @ tab or CR gets a leading quote so
 * Excel / Sheets show it instead of running it. Plain numbers (including negatives such as refunds) and the deliberate
 * ="digits" text cells made by asText are left alone. Cells already neutralised by safe() start with a quote and pass through.
 */
export function neutralise(v: unknown): unknown {
  if (typeof v !== 'string') return v
  if (!/^[=+\-@\t\r]/.test(v)) return v
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^="[A-Za-z0-9+\-() ]*"$/.test(v)) return v
  return `'${v}`
}

export function saveCsv(name: string, rows: Record<string, unknown>[]) {
  // BOM so Excel opens UTF-8 (names, ₹) correctly
  downloadFile(name, '\ufeff' + Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, neutralise(v)])))), 'text/csv;charset=utf-8')
}

export const stamp = () => new Date().toISOString().slice(0, 10)

export function exportRegistrations(event: EventRow, d: AdminData) {
  const itemsBy = new Map<string, string>()
  for (const i of d.items) itemsBy.set(i.registration_id, [itemsBy.get(i.registration_id), `${i.label} x${i.quantity}`].filter(Boolean).join('; '))
  const paidBy = new Map<string, number>()
  for (const p of d.payments) if (p.status === 'verified' && p.method !== 'waiver') paidBy.set(p.registration_id, (paidBy.get(p.registration_id) ?? 0) + p.amount_paise)
  saveCsv(
    `${event.slug}-registrations-${stamp()}.csv`,
    d.registrations.map((r) => ({
      Code: r.code,
      Status: r.status,
      Name: safe(r.full_name),
      Phone: asText(r.phone),
      Email: safe(r.email),
      Branch: r.branch ?? '',
      Batch: r.grad_year ?? '',
      City: safe(r.city),
      People: r.headcount,
      Tickets: itemsBy.get(r.id) ?? '',
      'With them': safe(r.guests.map((g) => `${g.name || '(no name)'} (${g.relation ?? ''})`).join('; ')),
      'Tickets (₹)': rupees(r.amount_paise - r.fund_paise),
      'Reunion Fund (₹)': rupees(r.fund_paise),
      'Amount due (₹)': rupees(r.amount_paise),
      'Paid, verified (₹)': rupees(paidBy.get(r.id) ?? 0),
      Food: food(r.food_pref),
      'T-shirt': r.tshirt_size ?? '',
      'Needs accommodation': r.needs_accommodation ? 'Yes' : 'No',
      'Needs local travel': r.needs_local_travel ? 'Yes' : 'No',
      Arrival: safe(r.arrival_note),
      Notes: safe(r.notes),
      'Photo consent': r.photo_consent ? 'Yes' : 'No',
      'Checked in': ist(r.checked_in_at),
      Registered: ist(r.created_at),
    })),
  )
}

/** One row per person: for name badges and headcounts. */
export function exportAttendees(event: EventRow, d: AdminData) {
  const rows: Record<string, unknown>[] = []
  for (const r of d.registrations.filter((x) => x.status === 'confirmed' || x.status === 'under_review')) {
    const batch = [r.branch, r.grad_year].filter(Boolean).join(' ')
    rows.push({ Code: r.code, Status: r.status, Name: safe(r.full_name), 'Badge name': safe(r.nickname), Type: 'Alumnus', Batch: batch, Food: food(r.food_pref), 'T-shirt': r.tshirt_size ?? '', 'Registered by': safe(r.full_name) })
    for (const g of r.guests) rows.push({ Code: r.code, Status: r.status, Name: safe(g.name), 'Badge name': '', Type: safe(g.relation ?? 'Guest'), Batch: '', Food: food(g.food ?? r.food_pref), 'T-shirt': '', 'Registered by': safe(r.full_name) })
  }
  saveCsv(`${event.slug}-attendees-${stamp()}.csv`, rows)
}

export function exportPayments(event: EventRow, d: AdminData) {
  const reg = new Map(d.registrations.map((r) => [r.id, r]))
  saveCsv(
    `${event.slug}-payments-${stamp()}.csv`,
    d.payments.map((p) => ({
      Code: reg.get(p.registration_id)?.code ?? '',
      Name: safe(reg.get(p.registration_id)?.full_name),
      'Amount (₹)': rupees(p.amount_paise),
      'Of which Reunion Fund (₹)': rupees(Math.min(p.amount_paise, reg.get(p.registration_id)?.fund_paise ?? 0)),
      Method: p.method,
      UTR: asText(p.utr),
      'Paid by': safe(p.payer_name),
      Status: p.status,
      'Review note': safe(p.review_note),
      Submitted: ist(p.created_at),
      Reviewed: ist(p.reviewed_at),
    })),
  )
}

export interface MemberExportRow {
  full_name: string
  member_type: string | null
  branch: string | null
  grad_year: number | null
  join_year: number | null
  city: string | null
  country: string | null
  current_title: string | null
  current_company: string | null
  linkedin_url: string | null
  verification: string
  is_admin: boolean
  onboarded: boolean
  created_at: string
  last_sign_in_at: string | null
  phone?: string | null
  email?: string | null
}

/** Members as a spreadsheet. Phone and e-mail columns only appear when the admin asked for them (a logged export). */
export function exportMembers(rows: MemberExportRow[], contact: boolean) {
  saveCsv(
    `members-${stamp()}.csv`,
    rows.map((m) => ({
      Name: safe(m.full_name),
      ...(contact ? { Mobile: asText(m.phone), Email: safe(m.email) } : {}),
      Type: m.member_type ?? '',
      Branch: m.branch ?? '',
      'Passing-out year': m.grad_year ?? '',
      'Joining year': m.join_year ?? '',
      City: safe(m.city),
      Country: safe(m.country),
      Role: safe(m.current_title),
      Company: safe(m.current_company),
      LinkedIn: safe(m.linkedin_url),
      Verification: m.verification === 'pending' ? 'not yet verified' : m.verification,
      Admin: m.is_admin ? 'Yes' : 'No',
      'Profile completed': m.onboarded ? 'Yes' : 'No',
      Joined: ist(m.created_at),
      'Last sign-in': ist(m.last_sign_in_at),
    })),
  )
}
