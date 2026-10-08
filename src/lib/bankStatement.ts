// Matches submitted UPI payments against the treasurer's bank statement.
// A payment is "matched" (safe to verify in bulk) only when ALL of these hold:
//  - the statement has a recognisable credit/deposit column,
//  - a row mentioning its 12-digit UTR credits exactly the payment amount,
//  - no row mentioning that UTR is a debit (refund / reversal).
// Anything else that mentions the UTR is "needs_review", for a human to check.
import { parseRupeesToPaise } from './money'

export type MatchStatus = 'matched' | 'needs_review' | 'not_found'

export interface PaymentToMatch {
  id: string
  utr: string | null
  amount_paise: number
}

export interface MatchResult {
  status: MatchStatus
  /** the statement row that mentions this UTR (for display) */
  row?: string
  /** credited amount found on that row */
  creditedPaise?: number | null
  /** why a human should look (for needs_review) */
  reason?: string
}

function cellText(c: unknown): string {
  if (c === null || c === undefined) return ''
  if (c instanceof Date) return c.toISOString().slice(0, 10)
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : c.toFixed(2)
  return String(c).trim()
}

function toPaise(c: unknown): number | null {
  if (typeof c === 'number') return Number.isFinite(c) && c >= 0 ? Math.round(c * 100) : null
  const s = cellText(c).replace(/\s*(cr|dr)\.?$/i, '')
  return s ? parseRupeesToPaise(s) : null
}

const CREDIT = /^(credit|credits|deposit|deposits|credit amount|credit amt\.?|deposit amt\.?|deposit amount|cr|cr\.|cr amount|credit \(inr\)|deposit \(inr\)|deposit amount \(inr\)|deposit \(cr\))$/i
const DEBIT = /^(debit|debits|withdrawal|withdrawals|debit amount|debit amt\.?|withdrawal amt\.?|withdrawal amount|dr|dr\.|dr amount|debit \(inr\)|withdrawal \(inr\)|withdrawal amount \(inr\)|withdrawal \(dr\))$/i

const norm = (c: unknown) => cellText(c).replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').trim()

/** Finds the header row and the credit / debit columns, if the statement has them. */
export function findCreditColumn(rows: unknown[][]): { headerRow: number; creditCol: number; debitCol: number } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] ?? []
    const creditCol = row.findIndex((c) => CREDIT.test(norm(c)))
    if (creditCol >= 0) return { headerRow: r, creditCol, debitCol: row.findIndex((c) => DEBIT.test(norm(c))) }
  }
  return null
}

export function matchStatement(rows: unknown[][], payments: PaymentToMatch[]): Map<string, MatchResult> {
  const header = findCreditColumn(rows)
  const start = header ? header.headerRow + 1 : 0

  // UTR -> rows mentioning it
  const byUtr = new Map<string, { text: string; credit: number | null; debit: number | null }[]>()
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] ?? []
    const text = row.map(cellText).filter(Boolean).join(' | ')
    // 12 digits not surrounded by other digits (never part of a longer account number)
    const utrs = new Set([...text.matchAll(/(?<!\d)(\d{12})(?!\d)/g)].map((m) => m[1]!))
    if (!utrs.size) continue
    const credit = header ? toPaise(row[header.creditCol]) : null
    const debit = header && header.debitCol >= 0 ? toPaise(row[header.debitCol]) : null
    for (const u of utrs) {
      const list = byUtr.get(u) ?? []
      list.push({ text, credit: credit && credit > 0 ? credit : null, debit: debit && debit > 0 ? debit : null })
      byUtr.set(u, list)
    }
  }

  const out = new Map<string, MatchResult>()
  for (const p of payments) {
    const hits = p.utr ? byUtr.get(p.utr) : undefined
    if (!hits?.length) {
      out.set(p.id, { status: 'not_found' })
      continue
    }
    const first = hits[0]!
    if (!header) {
      out.set(p.id, { status: 'needs_review', row: first.text, reason: 'UTR found, but the credit column couldn’t be identified in this statement' })
      continue
    }
    const exact = hits.find((h) => h.credit === p.amount_paise)
    const reversal = hits.find((h) => h.debit !== null || (h.credit === null && h !== exact))
    if (exact && !reversal) {
      out.set(p.id, { status: 'matched', row: exact.text, creditedPaise: p.amount_paise })
    } else if (reversal) {
      out.set(p.id, { status: 'needs_review', row: reversal.text, creditedPaise: exact?.credit ?? first.credit, reason: 'This UTR also appears as a debit (refund or reversal)' })
    } else {
      out.set(p.id, { status: 'needs_review', row: first.text, creditedPaise: first.credit, reason: first.credit ? 'Amount credited is different' : 'No credit amount on this row' })
    }
  }
  return out
}

/** Reads CSV or .xlsx into rows of cells (in the browser). */
export async function readStatementFile(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    return Papa.parse<string[]>(text, { skipEmptyLines: true }).data
  }
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    return (await readSheet(file)) as unknown[][]
  }
  if (name.endsWith('.xls')) {
    throw new Error('Old Excel (.xls) files can’t be read directly. Open the file in Excel or Google Sheets and download it as .xlsx or .csv.')
  }
  throw new Error('Please upload the bank statement as a .csv or .xlsx file.')
}
