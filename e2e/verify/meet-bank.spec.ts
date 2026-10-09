// Bank statement matching (src/lib/bankStatement.ts) against realistic SBI / HDFC / ICICI / Axis / Kotak exports,
// read exactly the way the admin page reads them (PapaParse for CSV, read-excel-file for .xlsx).
// The in-browser upload path is covered in meet-ui.spec.ts.
import { expect, test } from '@playwright/test'
import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/node'
import { matchStatement, type MatchStatus } from '../../src/lib/bankStatement'
import { amountWithFlag, axis, hdfc, hdfcXls, icici, kotak, sbi, toCsv, type Cell, type Utrs } from './meet-statements'
import { writeXlsx } from './meet-xlsx'

const DUE = 250050

function utrs(seed: number): Utrs {
  const base = 627400000000 + seed * 100
  return {
    exact: String(base + 1),
    short: String(base + 2),
    reversed: String(base + 3),
    debitOnly: String(base + 4),
    absent: String(base + 5),
    embedded: String(base + 6),
  }
}

const EXPECTED: Record<keyof Utrs, MatchStatus> = {
  exact: 'matched',
  short: 'needs_review',
  reversed: 'needs_review',
  debitOnly: 'needs_review',
  absent: 'not_found',
  embedded: 'not_found',
}

function run(rows: unknown[][], u: Utrs) {
  const payments = (Object.keys(u) as (keyof Utrs)[]).map((k) => ({ id: k, utr: u[k], amount_paise: DUE }))
  const res = matchStatement(rows, payments)
  return Object.fromEntries(payments.map((p) => [p.id, res.get(p.id)!])) as Record<keyof Utrs, ReturnType<typeof res.get> & object>
}

const csvRows = (rows: Cell[][], sep = ',') => Papa.parse<string[]>(toCsv(rows, sep), { skipEmptyLines: true }).data
const xlsxRows = async (rows: Cell[][]) => (await readSheet(await writeXlsx(rows))) as unknown[][]

const banks: [string, (u: Utrs) => Cell[][]][] = [
  ['SBI', (u) => sbi(u)],
  ['SBI (numeric cells)', (u) => sbi(u, true)],
  ['HDFC delimited', hdfc],
  ['HDFC xls layout', hdfcXls],
  ['ICICI detailed', icici],
  ['Axis', axis],
  ['Kotak', kotak],
]

test.describe('bank statement matching', () => {
  for (const [i, [name, build]] of banks.entries()) {
    for (const format of ['csv', 'xlsx'] as const) {
      test(`${name} ${format}: matched / needs_review / not_found are correct, no false auto-match`, async () => {
        const u = utrs(i * 2 + (format === 'csv' ? 0 : 1))
        const rows = format === 'csv' ? csvRows(build(u)) : await xlsxRows(build(u))
        const res = run(rows, u)
        for (const k of Object.keys(EXPECTED) as (keyof Utrs)[]) expect(res[k].status, `${name} ${format} ${k}`).toBe(EXPECTED[k])
        expect(res.exact.creditedPaise).toBe(DUE)
        expect(res.short.creditedPaise).toBe(250000)
        expect(res.reversed.reason).toMatch(/debit/i)
      })
    }
  }

  test('SBI download saved as tab-separated text is still read (PapaParse auto-detects the delimiter)', () => {
    const u = utrs(40)
    const res = run(csvRows(sbi(u), '\t'), u)
    expect(res.exact.status).toBe('matched')
    expect(res.debitOnly.status).toBe('needs_review')
  })

  test('single "Amount" + Dr/Cr flag statements are never auto-matched', () => {
    const u = utrs(41)
    const res = run(csvRows(amountWithFlag(u)), u)
    // Finding (Low): a data cell "CR" in the flag column is mistaken for the header row, so the first credit row is
    // skipped and reported "not in statement" instead of "check manually". Safe (never auto-verified), but misleading.
    expect(res.exact.status).not.toBe('matched')
    expect(res.debitOnly.status).not.toBe('matched')
  })

  test('a payment whose UTR is credited twice (bank double-posting) is still matched once, never a debit', () => {
    const u = utrs(42)
    const rows = csvRows([
      ['Date', 'Narration', 'Debit', 'Credit'],
      ['1', `UPI/CR/${u.exact}/ASHA`, '', '2,500.50'],
      ['1', `UPI/CR/${u.exact}/ASHA`, '', '2,500.50'],
    ])
    expect(run(rows, u).exact.status).toBe('matched')
  })

  // BUG (no false auto-match rule broken): the FIRST row containing a cell such as "Credits"/"Debits" is taken
  // as the table header. Statements that print an account summary ABOVE the transactions (e.g. "Opening Balance |
  // Dr Count | Cr Count | Debits | Credits | Closing Bal") make the matcher read the Withdrawal column as the
  // credit column, so an OUTGOING payment of the same amount is reported as "Matches bank statement" and can be
  // bulk-verified, while genuine credits drop to "needs review".
  test('summary block above the table must not shift the credit column (no false auto-match)', () => {
    const u = utrs(43)
    const rows = csvRows([
      ['JEC ALUMNI ASSOCIATION - Statement of account 01/10/2026 to 08/10/2026'],
      ['Opening Balance', 'Dr Count', 'Cr Count', 'Debits', 'Credits', 'Closing Bal'],
      ['1,00,000.00', '1', '1', '2,500.50', '2,500.50', '1,00,000.00'],
      [],
      ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
      ['01/10/26', `UPI-ASHA RAO-ASHA@OKSBI-SBIN0000001-${u.exact}-JEC`, `0000${u.exact}`, '01/10/26', '', '2,500.50', '1,02,500.50'],
      ['04/10/26', `UPI-TENT HOUSE-TENT@YBL-YESB0YBLUPI-${u.debitOnly}-ADVANCE`, `0000${u.debitOnly}`, '04/10/26', '2,500.50', '', '1,00,000.00'],
    ])
    const res = run(rows, u)
    expect(res.debitOnly.status, 'an outgoing payment was auto-matched as a credit').not.toBe('matched')
    expect(res.exact.status).toBe('matched')
  })

  // Usability: most Indian net-banking "Excel" downloads (SBI, HDFC, ICICI) are legacy .xls; readStatementFile
  // refuses them with a clear message (checked in meet-ui.spec.ts) – the treasurer must re-save as .xlsx/.csv.
})
