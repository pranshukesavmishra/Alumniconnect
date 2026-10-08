// Matches submitted UPI payments against the treasurer's bank statement.
// A payment is "matched" only when its 12-digit UTR appears in a statement row AND that row
// credits exactly the payment amount. Anything else is left for a human to check.
import { parseRupeesToPaise } from './money'

export type MatchStatus = 'matched' | 'amount_mismatch' | 'not_found'

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

/** Finds the header row and the credit / deposit column, if the statement has one. */
export function findCreditColumn(rows: unknown[][]): { headerRow: number; creditCol: number } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] ?? []
    const idx = row.findIndex((c) => /^(credit|deposit|deposits|credit amount|credit amt\.?|deposit amt\.?|cr amount|cr\.?)$/i.test(cellText(c)))
    if (idx >= 0) return { headerRow: r, creditCol: idx }
  }
  return null
}

export function matchStatement(rows: unknown[][], payments: PaymentToMatch[]): Map<string, MatchResult> {
  const header = findCreditColumn(rows)
  const start = header ? header.headerRow + 1 : 0

  // UTR -> rows mentioning it
  const byUtr = new Map<string, { text: string; credits: number[] }[]>()
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] ?? []
    const text = row.map(cellText).filter(Boolean).join(' | ')
    // \d{12} not surrounded by other digits (account numbers are usually longer or shorter, and must not match partially)
    const utrs = new Set([...text.matchAll(/(?<!\d)(\d{12})(?!\d)/g)].map((m) => m[1]!))
    if (!utrs.size) continue
    let credits: number[]
    if (header) {
      const v = toPaise(row[header.creditCol])
      credits = v && v > 0 ? [v] : []
    } else {
      credits = row.map(toPaise).filter((v): v is number => v !== null && v > 0)
    }
    for (const u of utrs) {
      const list = byUtr.get(u) ?? []
      list.push({ text, credits })
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
    const exact = hits.find((h) => h.credits.includes(p.amount_paise))
    out.set(
      p.id,
      exact
        ? { status: 'matched', row: exact.text, creditedPaise: p.amount_paise }
        : { status: 'amount_mismatch', row: hits[0]!.text, creditedPaise: header ? (hits[0]!.credits[0] ?? null) : null },
    )
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
