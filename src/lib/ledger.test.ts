import { describe, expect, it } from 'vitest'
import { groupFlags, ledgerRowsToRecords, ledgerSummaryRecords, percentCollected, spreadsheetSafe, type Ledger, type LedgerRow } from './ledger'

const row = (o: Partial<LedgerRow>): LedgerRow => ({
  at: '2026-10-09T10:00:00Z', type: 'payment', status: 'verified', method: 'upi', amount_paise: 100000, code: 'JEC-AAAAAA', full_name: 'Asha', utr: '123456789012', payer_name: null, reference: null, note: null, by: 'Treasurer', ...o,
})
const ledger: Ledger = {
  period: { from: null, to: null },
  totals: { verified: 300000, refunded: 30000, net: 270000, pending: 100000, pending_count: 1, waived: 25000, payments: 3, refunds: 1 },
  by_method: [{ method: 'cash', verified: 200000, refunded: 0, pending: 0 }, { method: 'upi', verified: 100000, refunded: 30000, pending: 100000 }],
  by_day: [{ day: '2026-10-09', verified: 300000, refunded: 30000, pending: 100000, waived: 25000 }],
  position: { booked: 500000, covered: 325000, awaiting: 100000, outstanding: 75000, registrations: 5 },
  by_ticket: [{ ticket_type_id: 't', label: 'Alumnus', quantity: 4, booked: 400000, collected: 260000 }],
  flags: [
    { kind: 'stale_submitted', registration_id: 'r1', code: 'JEC-1', full_name: '=cmd', amount_paise: 100000, detail: 'old' },
    { kind: 'overpaid', registration_id: 'r2', code: 'JEC-2', full_name: 'Bela', amount_paise: 40000, detail: 'too much' },
  ],
  flag_total: 2,
}

describe('ledger', () => {
  it('makes refunds negative so the column adds up to the net', () => {
    const recs = ledgerRowsToRecords([row({}), row({ type: 'refund', status: 'refunded', amount_paise: 30000, method: 'bank_transfer', reference: 'REF1', note: 'smaller ticket' })])
    expect(recs.map((r) => r['Amount (₹)'])).toEqual(['1000.00', '-300.00'])
    expect(recs[1]).toMatchObject({ Type: 'Refund (money out)', Method: 'Bank transfer', 'Refund reference': 'REF1' })
    expect(recs[0]!.UTR).toBe('="123456789012"')
  })
  it('neutralises formulas typed by members', () => {
    expect(spreadsheetSafe('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(spreadsheetSafe('Asha')).toBe('Asha')
    expect(ledgerRowsToRecords([row({ full_name: '+91evil', note: '@x' })])[0]).toMatchObject({ Name: "'+91evil", Note: "'@x" })
  })
  it('writes a summary with every section', () => {
    const recs = ledgerSummaryRecords(ledger)
    expect(recs.map((r) => r.Section)).toEqual(['Totals', 'By method', 'By method', 'By day', 'By ticket type (booked, estimate of collected)', 'Position now', 'Flags', 'Flags'])
    expect(recs[0]).toMatchObject({ 'Verified (₹)': '3000.00', 'Refunded (₹)': '300.00', 'Net (₹)': '2700.00', 'Awaiting verification (₹)': '1000.00' })
    expect(recs.at(-2)!.Item).toContain("'=cmd")
  })
  it('puts the serious flags first', () => {
    expect(groupFlags(ledger.flags).map((g) => g.kind)).toEqual(['overpaid', 'stale_submitted'])
    expect(groupFlags([])).toEqual([])
  })
  it('computes the share collected', () => {
    expect(percentCollected(ledger.position)).toBe(65)
    expect(percentCollected({ booked: 0, covered: 0, awaiting: 0, outstanding: 0, registrations: 0 })).toBe(0)
    expect(percentCollected({ booked: 100, covered: 500, awaiting: 0, outstanding: 0, registrations: 1 })).toBe(100)
  })
})
