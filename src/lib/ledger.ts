// The event finance ledger: the shapes the database returns, words for the discrepancy flags, and the spreadsheet rows.

export type FlagKind = 'confirmed_underpaid' | 'overpaid' | 'cancelled_holds_money' | 'stale_submitted' | 'amount_mismatch' | 'status_mismatch'

export interface LedgerFlag {
  kind: FlagKind
  registration_id: string
  code: string
  full_name: string
  amount_paise: number
  detail: string
}

export interface Ledger {
  period: { from: string | null; to: string | null }
  totals: { verified: number; refunded: number; net: number; pending: number; pending_count: number; waived: number; payments: number; refunds: number }
  by_method: { method: string; verified: number; refunded: number; pending: number }[]
  by_day: { day: string; verified: number; refunded: number; pending: number; waived: number }[]
  position: { booked: number; covered: number; awaiting: number; outstanding: number; registrations: number }
  by_ticket: { ticket_type_id: string; label: string; quantity: number; booked: number; collected: number }[]
  flags: LedgerFlag[]
  flag_total: number
}

export interface LedgerRow {
  at: string
  type: 'payment' | 'refund'
  status: string
  method: string
  amount_paise: number
  code: string
  full_name: string
  utr: string | null
  payer_name: string | null
  reference: string | null
  note: string | null
  by: string | null
}

export const FLAGS: Record<FlagKind, { title: string; tone: 'danger' | 'warning'; what: string }> = {
  overpaid: { title: 'Paid more than the price', tone: 'danger', what: 'More money was verified than the registration costs. Refund the excess or correct the tickets.' },
  confirmed_underpaid: { title: 'Confirmed but not fully paid', tone: 'danger', what: 'The registration is confirmed but verified money covers only part of its price.' },
  cancelled_holds_money: { title: 'Cancelled but money still held', tone: 'warning', what: 'The registration was cancelled and the payment was never refunded. Refund it or keep it on purpose.' },
  amount_mismatch: { title: 'Waiting payment is the wrong amount', tone: 'warning', what: 'The payment waiting for verification is not the amount still due.' },
  status_mismatch: { title: 'Status does not match the payments', tone: 'warning', what: 'The registration status says one thing and the payments say another.' },
  stale_submitted: { title: 'Waiting more than 3 days', tone: 'warning', what: 'A payment has been waiting for verification for over 3 days.' },
}

export const FLAG_ORDER: FlagKind[] = ['overpaid', 'confirmed_underpaid', 'cancelled_holds_money', 'amount_mismatch', 'status_mismatch', 'stale_submitted']

export const METHOD_LABELS: Record<string, string> = { upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank transfer', waiver: 'Waiver', other: 'Other' }

/** Member-typed text: a leading = + - @ would run as a formula in Excel. */
export const spreadsheetSafe = (v: string | null | undefined) => {
  const t = v ?? ''
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
}
const rupees = (p: number) => (p / 100).toFixed(2)
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')
const asText = (v: string | null | undefined) => (v ? `="${v.replace(/"/g, '')}"` : '')

/** One spreadsheet row per payment or refund, in time order. */
export function ledgerRowsToRecords(rows: LedgerRow[]): Record<string, string>[] {
  return rows.map((r) => ({
    'Date (IST)': ist(r.at),
    Type: r.type === 'refund' ? 'Refund (money out)' : 'Payment',
    Status: r.status,
    Method: METHOD_LABELS[r.method] ?? r.method,
    // refunds are negative so the column sums to the net
    'Amount (₹)': rupees(r.type === 'refund' ? -r.amount_paise : r.amount_paise),
    Code: r.code,
    Name: spreadsheetSafe(r.full_name),
    UTR: asText(r.utr),
    'Paid by': spreadsheetSafe(r.payer_name),
    'Refund reference': spreadsheetSafe(r.reference),
    Note: spreadsheetSafe(r.note),
    'Recorded by': spreadsheetSafe(r.by),
  }))
}

/** The reconciliation summary as a spreadsheet: totals, then each breakdown, then the flags. */
export function ledgerSummaryRecords(l: Ledger): Record<string, string>[] {
  const out: Record<string, string>[] = []
  const add = (section: string, item: string, verified: number | '', refunded: number | '', pending: number | '', note = '') =>
    out.push({
      Section: section, Item: item,
      'Verified (₹)': verified === '' ? '' : rupees(verified), 'Refunded (₹)': refunded === '' ? '' : rupees(refunded),
      'Net (₹)': verified === '' || refunded === '' ? '' : rupees(verified - refunded), 'Awaiting verification (₹)': pending === '' ? '' : rupees(pending), Note: note,
    })
  const t = l.totals
  add('Totals', l.period.from || l.period.to ? `${l.period.from ?? 'start'} to ${l.period.to ?? 'today'}` : 'All time', t.verified, t.refunded, t.pending, `${t.waived ? `Waived: ₹${rupees(t.waived)}` : ''}`)
  for (const m of l.by_method) add('By method', METHOD_LABELS[m.method] ?? m.method, m.verified, m.refunded, m.pending)
  for (const d of l.by_day) add('By day', d.day, d.verified, d.refunded, d.pending, d.waived ? `Waived: ₹${rupees(d.waived)}` : '')
  for (const k of l.by_ticket) add('By ticket type (booked, estimate of collected)', `${k.label} × ${k.quantity}`, k.collected, '', '', `Booked ₹${rupees(k.booked)}`)
  add('Position now', 'Booked / covered / still to collect', l.position.covered, '', l.position.awaiting, `Booked ₹${rupees(l.position.booked)}; outstanding ₹${rupees(l.position.outstanding)}`)
  for (const f of l.flags) out.push({ Section: 'Flags', Item: `${f.code} ${spreadsheetSafe(f.full_name)}`, 'Verified (₹)': '', 'Refunded (₹)': '', 'Net (₹)': '', 'Awaiting verification (₹)': '', Note: `${FLAGS[f.kind]?.title ?? f.kind}: ${f.detail} (₹${rupees(f.amount_paise)})` })
  return out
}

/** Flags grouped in a stable, most-serious-first order. */
export function groupFlags(flags: LedgerFlag[]): { kind: FlagKind; items: LedgerFlag[] }[] {
  return FLAG_ORDER.map((kind) => ({ kind, items: flags.filter((f) => f.kind === kind) })).filter((g) => g.items.length > 0)
}

/** Share of the price that has been collected, 0..100. */
export function percentCollected(p: Ledger['position']): number {
  return p.booked <= 0 ? 0 : Math.min(100, Math.round((p.covered / p.booked) * 100))
}
