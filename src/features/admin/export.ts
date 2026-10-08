import Papa from 'papaparse'
import { downloadFile } from '../../lib/ics'
import { FOOD_PREFS } from '../../lib/constants'
import type { EventRow } from '../../lib/types'
import type { AdminData } from './queries'

const food = (v: string | null) => FOOD_PREFS.find((f) => f.value === v)?.label ?? ''
const rupees = (p: number) => (p / 100).toFixed(2)
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')

/** Member-typed text: a leading = + - @ would run as a formula in Excel, so neutralise it. */
const safe = (v: string | null | undefined) => {
  const t = v ?? ''
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
}
/** Long digit strings (phones, UTRs) as text so Excel keeps every digit ("+91…" not "9.19E+11"). */
const asText = (v: string | null | undefined) => (v ? `="${v.replace(/"/g, '')}"` : '')

function save(name: string, rows: Record<string, unknown>[]) {
  // BOM so Excel opens UTF-8 (names, ₹) correctly
  downloadFile(name, '﻿' + Papa.unparse(rows), 'text/csv;charset=utf-8')
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function exportRegistrations(event: EventRow, d: AdminData) {
  const itemsBy = new Map<string, string>()
  for (const i of d.items) itemsBy.set(i.registration_id, [itemsBy.get(i.registration_id), `${i.label} x${i.quantity}`].filter(Boolean).join('; '))
  const paidBy = new Map<string, number>()
  for (const p of d.payments) if (p.status === 'verified' && p.method !== 'waiver') paidBy.set(p.registration_id, (paidBy.get(p.registration_id) ?? 0) + p.amount_paise)
  save(
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
      'Amount due (₹)': rupees(r.amount_paise),
      'Paid, verified (₹)': rupees(paidBy.get(r.id) ?? 0),
      Food: food(r.food_pref),
      'T-shirt': r.tshirt_size ?? '',
      'Needs accommodation': r.needs_accommodation ? 'Yes' : 'No',
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
    rows.push({ Code: r.code, Status: r.status, Name: safe(r.full_name), Type: 'Alumnus', Batch: batch, Food: food(r.food_pref), 'Registered by': safe(r.full_name) })
    for (const g of r.guests) rows.push({ Code: r.code, Status: r.status, Name: safe(g.name), Type: safe(g.relation ?? 'Guest'), Batch: '', Food: food(r.food_pref), 'Registered by': safe(r.full_name) })
  }
  save(`${event.slug}-attendees-${stamp()}.csv`, rows)
}

export function exportPayments(event: EventRow, d: AdminData) {
  const reg = new Map(d.registrations.map((r) => [r.id, r]))
  save(
    `${event.slug}-payments-${stamp()}.csv`,
    d.payments.map((p) => ({
      Code: reg.get(p.registration_id)?.code ?? '',
      Name: safe(reg.get(p.registration_id)?.full_name),
      'Amount (₹)': rupees(p.amount_paise),
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
