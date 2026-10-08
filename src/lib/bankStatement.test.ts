import { describe, expect, it } from 'vitest'
import { findCreditColumn, matchStatement } from './bankStatement'

const statement = [
  ['State Bank of India', '', '', '', ''],
  ['Account No: 123456789012345', '', '', '', ''],
  ['Txn Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
  ['01-11-2026', 'UPI/412345678901/Asha Rao/okicici', '', '', '2,500.00', '10,000.00'],
  ['02-11-2026', 'UPI/498765432109/Bharat/ybl', '', '', '1500', '11,500.00'],
  ['03-11-2026', 'UPI/411111111111/Refund', '', '2,500.00', '', '9,000.00'],
  ['04-11-2026', 'NEFT 1234567890123 SALARY', '', '', '4000.00', '13,000.00'],
]

describe('bank statement matching', () => {
  it('finds the credit column', () => {
    expect(findCreditColumn(statement)).toEqual({ headerRow: 2, creditCol: 4 })
  })

  it('matches UTR + exact credited amount', () => {
    const res = matchStatement(statement, [
      { id: 'a', utr: '412345678901', amount_paise: 250000 },
      { id: 'b', utr: '498765432109', amount_paise: 250000 }, // paid less than due
      { id: 'c', utr: '400000000000', amount_paise: 250000 }, // not in statement
      { id: 'd', utr: '411111111111', amount_paise: 250000 }, // only appears as a DEBIT
      { id: 'e', utr: null, amount_paise: 100 },
    ])
    expect(res.get('a')?.status).toBe('matched')
    expect(res.get('b')).toMatchObject({ status: 'amount_mismatch', creditedPaise: 150000 })
    expect(res.get('c')?.status).toBe('not_found')
    expect(res.get('d')?.status).toBe('amount_mismatch')
    expect(res.get('e')?.status).toBe('not_found')
  })

  it('never matches part of a longer number', () => {
    const res = matchStatement(statement, [{ id: 'x', utr: '123456789012', amount_paise: 400000 }])
    expect(res.get('x')?.status).toBe('not_found')
  })

  it('works without a header row, using any amount on the row', () => {
    const rows = [['05/11/2026', 'UPI-CR-412345678902-ASHA', 3000.5]]
    expect(matchStatement(rows, [{ id: 'z', utr: '412345678902', amount_paise: 300050 }]).get('z')?.status).toBe('matched')
  })

  it('reads numbers from Excel cells and Cr suffixes', () => {
    const rows = [
      ['Date', 'Narration', 'Deposit Amt.'],
      ['x', 412345678903, '2,000.00 Cr'],
    ]
    expect(matchStatement(rows, [{ id: 'n', utr: '412345678903', amount_paise: 200000 }]).get('n')?.status).toBe('matched')
  })
})
