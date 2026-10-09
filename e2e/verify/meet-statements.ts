// Realistic bank-statement fixtures (layout of the net-banking downloads of SBI, HDFC, ICICI, Axis and Kotak):
// junk/header rows above the table, Indian digit grouping, credit/debit in separate columns,
// the UPI narration formats each bank uses, and a footer.
export type Cell = string | number | null

export interface Utrs {
  /** exact credit of the amount due -> matched */
  exact: string
  /** credited 50 paise less than due -> needs_review */
  short: string
  /** credited, then reversed (debit) -> needs_review */
  reversed: string
  /** only appears as a debit -> needs_review */
  debitOnly: string
  /** not in the statement at all -> not_found */
  absent: string
  /** only appears inside a longer number -> not_found (never a partial match) */
  embedded: string
}

export const DUE_RUPEES = '2,500.50'
export const DUE_NUM = 2500.5
export const SHORT_RUPEES = '2,500.00'

/** SBI "Account Statement" (Excel download saved as CSV): key/value junk rows, then the table. */
export function sbi(u: Utrs, numeric = false): Cell[][] {
  const amt = (s: string, n: number) => (numeric ? n : s)
  return [
    ['Account Name', ':', 'JEC ALUMNI ASSOCIATION'],
    ['Address', ':', 'JABALPUR ENGINEERING COLLEGE, GOKALPUR, JABALPUR-482011'],
    ['Date', ':', '8 Oct 2026'],
    ['Account Number', ':', '_00000041234567890'],
    ['Account Description', ':', 'SAVINGS ACCOUNT-ASSOCIATIONS'],
    ['Branch', ':', 'JABALPUR MAIN'],
    ['Drawing Power', ':', '0.00'],
    ['Interest Rate(% p.a.)', ':', '2.7'],
    ['MOD Balance', ':', '0.00'],
    ['CIF No.', ':', '_88123456789'],
    ['IFS Code', ':', 'SBIN0001234'],
    ['MICR Code', ':', '482002002'],
    ['Nomination Registered', ':', 'No'],
    ['Balance as on 1 Oct 2026', ':', '1,00,000.00'],
    [],
    ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', '        Debit', 'Credit', 'Balance'],
    ['1 Oct 2026', '1 Oct 2026', `BY TRANSFER-UPI/CR/${u.exact}/ASHA RAO/SBIN/asha.rao@oksbi/JEC-7KQ4M2--`, 'TRANSFER FROM 4897691162095', '', amt(DUE_RUPEES, DUE_NUM), amt('1,02,500.50', 102500.5)],
    ['1 Oct 2026', '1 Oct 2026', `BY TRANSFER-UPI/CR/${u.short}/BHARAT K/HDFC/bharat@okhdfc/JEC-AB2CD3--`, 'TRANSFER FROM 3199412345678', '', amt(SHORT_RUPEES, 2500), amt('1,05,000.50', 105000.5)],
    ['2 Oct 2026', '2 Oct 2026', `BY TRANSFER-UPI/CR/${u.reversed}/CHITRA/ICIC/chitra@okicici/JEC--`, 'TRANSFER FROM 3199412345679', '', amt(DUE_RUPEES, DUE_NUM), amt('1,07,501.00', 107501)],
    ['3 Oct 2026', '3 Oct 2026', `TO TRANSFER-UPI/DR/${u.reversed}/CHITRA/ICIC/chitra@okicici/REVERSAL--`, 'TRANSFER TO 3199412345679', amt(DUE_RUPEES, DUE_NUM), '', amt('1,05,000.50', 105000.5)],
    ['4 Oct 2026', '4 Oct 2026', `TO TRANSFER-UPI/DR/${u.debitOnly}/TENT HOUSE/YESB/tent@ybl/advance--`, 'TRANSFER TO 4897000000001', amt(DUE_RUPEES, DUE_NUM), '', amt('1,02,500.00', 102500)],
    ['5 Oct 2026', '5 Oct 2026', `BY TRANSFER-IMPS/P2A/1${u.embedded}/DEEPAK/JEC-ZZ9YY8--`, 'TRANSFER FROM 1234567890123', '', amt(DUE_RUPEES, DUE_NUM), amt('1,05,000.50', 105000.5)],
    ['6 Oct 2026', '6 Oct 2026', 'BY TRANSFER-NEFT*HDFC0000001*N279261234567890*SPONSOR LTD--', 'TRANSFER FROM 1234567890124', '', amt('50,000.00', 50000), amt('1,55,000.50', 155000.5)],
    [],
    ['**This is a computer generated statement and does not require a signature.'],
  ]
}

/** HDFC "Delimited" download (padded columns, Debit/Credit Amount, 16-digit zero-padded ref). */
export function hdfc(u: Utrs): Cell[][] {
  return [
    [' Date     ', 'Narration                                                                                                                ', 'Value Dat', 'Debit Amount       ', 'Credit Amount      ', 'Chq/Ref Number   ', 'Closing Balance'],
    [' 01/10/26  ', `UPI-ASHA RAO-ASHA.RAO@OKHDFCBANK-HDFC0000123-${u.exact}-JEC-7KQ4M2`, '01/10/26 ', '0.00', '2500.50', `0000${u.exact}`, '102500.50'],
    [' 01/10/26  ', `UPI-BHARAT KUMAR-BHARAT@YBL-YESB0YBLUPI-${u.short}-UPI`, '01/10/26 ', '0.00', '2500.00', `0000${u.short}`, '105000.50'],
    [' 02/10/26  ', `UPI-CHITRA S-CHITRA@OKICICI-ICIC0000001-${u.reversed}-JEC`, '02/10/26 ', '0.00', '2500.50', `0000${u.reversed}`, '107501.00'],
    [' 03/10/26  ', `REV-UPI-CHITRA S-CHITRA@OKICICI-ICIC0000001-${u.reversed}-JEC`, '03/10/26 ', '2500.50', '0.00', `0000${u.reversed}`, '105000.50'],
    [' 04/10/26  ', `UPI-TENT HOUSE-TENT@YBL-YESB0YBLUPI-${u.debitOnly}-ADVANCE`, '04/10/26 ', '2500.50', '0.00', `0000${u.debitOnly}`, '102500.00'],
    [' 05/10/26  ', `IMPS-1${u.embedded}-DEEPAK-HDFC-XXXXXXXX1234-JEC`, '05/10/26 ', '0.00', '2500.50', `000001${u.embedded.slice(0, 10)}`, '105000.50'],
  ]
}

/** HDFC net-banking .xls layout (re-saved as .xlsx): long preamble, asterisk ruler, Withdrawal/Deposit Amt. */
export function hdfcXls(u: Utrs): Cell[][] {
  return [
    ['HDFC BANK Ltd.', null, null, null, null, null, 'Page No .: 1'],
    ['JEC ALUMNI ASSOCIATION', null, null, null, null, 'Account Branch :', 'JABALPUR - CIVIL LINES'],
    ['GOKALPUR', null, null, null, null, 'Address :', 'CIVIL LINES'],
    ['JABALPUR 482011', null, null, null, null, 'City :', 'JABALPUR 482001'],
    [null, null, null, null, null, 'Account No :', '50100123456789   OTHER'],
    [null, null, null, null, null, 'A/C Open Date :', '01/04/2024'],
    ['Statement From : 01/10/2026 To : 08/10/2026'],
    [],
    ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
    ['********', '********', '********', '********', '********', '********', '********'],
    ['01/10/26', `UPI-ASHA RAO-ASHA.RAO@OKHDFCBANK-HDFC0000123-${u.exact}-JEC-7KQ4M2`, `0000${u.exact}`, '01/10/26', null, 2500.5, 102500.5],
    ['01/10/26', `UPI-BHARAT KUMAR-BHARAT@YBL-YESB0YBLUPI-${u.short}-UPI`, `0000${u.short}`, '01/10/26', null, 2500, 105000.5],
    ['02/10/26', `UPI-CHITRA S-CHITRA@OKICICI-ICIC0000001-${u.reversed}-JEC`, `0000${u.reversed}`, '02/10/26', null, 2500.5, 107501],
    ['03/10/26', `REV-UPI-CHITRA S-CHITRA@OKICICI-ICIC0000001-${u.reversed}-JEC`, `0000${u.reversed}`, '03/10/26', 2500.5, null, 105000.5],
    ['04/10/26', `UPI-TENT HOUSE-TENT@YBL-YESB0YBLUPI-${u.debitOnly}-ADVANCE`, `0000${u.debitOnly}`, '04/10/26', 2500.5, null, 102500],
    ['05/10/26', `IMPS-1${u.embedded}-DEEPAK-HDFC-XXXXXXXX1234-JEC`, `000001${u.embedded.slice(0, 10)}`, '05/10/26', null, 2500.5, 105000.5],
    ['********', '********', '********', '********', '********', '********', '********'],
    ['STATEMENT SUMMARY  :-'],
    ['Opening Balance', 'Dr Count', 'Cr Count', 'Debits', 'Credits', 'Closing Bal'],
    [100000, 2, 4, 5001, 10001.5, 105000.5],
    ['Generated On: 08/10/2026 10:15:12'],
  ]
}

/** ICICI "Detailed Statement" .xls (re-saved as .xlsx): blank first column, "(INR )" headers, numeric amounts. */
export function icici(u: Utrs): Cell[][] {
  return [
    [],
    [null, 'DETAILED STATEMENT'],
    [],
    [null, 'Transactions List - JEC ALUMNI ASSOCIATION (INR) - 123401234567'],
    [],
    [null, 'Transaction Date from: 01/10/2026 to 08/10/2026'],
    [],
    [null, 'S No.', 'Value Date', 'Transaction Date', 'Cheque Number', 'Transaction Remarks', 'Withdrawal Amount (INR )', 'Deposit Amount (INR )', 'Balance (INR )'],
    [null, 1, '01/10/2026', '01/10/2026', '-', `UPI/${u.exact}/Payment from Ph/asha.rao@ybl/YES BANK LIMITED YBS/YBL1234567890`, 0, DUE_NUM, 102500.5],
    [null, 2, '01/10/2026', '01/10/2026', '-', `UPI/${u.short}/JEC/bharat@paytm/Paytm Payments Ba/PTM9876543210`, 0, 2500, 105000.5],
    [null, 3, '02/10/2026', '02/10/2026', '-', `UPI/${u.reversed}/JEC/chitra@okaxis/Axis Bank Ltd/AXIS1234`, 0, DUE_NUM, 107501],
    [null, 4, '03/10/2026', '03/10/2026', '-', `REV/UPI/${u.reversed}/JEC/chitra@okaxis`, DUE_NUM, 0, 105000.5],
    [null, 5, '04/10/2026', '04/10/2026', '-', `UPI/${u.debitOnly}/advance/tent@ybl/YES BANK`, DUE_NUM, 0, 102500],
    [null, 6, '05/10/2026', '05/10/2026', '-', `MMT/IMPS/1${u.embedded}/JEC/DEEPAK/HDFC Bank`, 0, DUE_NUM, 105000.5],
    [],
    [null, 'Legends Used in Account Statement'],
    [null, 'BCTT - Banking Cash Transaction Tax', 'MMT - Mobile Money Transfer'],
  ]
}

/** Axis Bank CSV: period line, SRL NO / DR / CR columns, P2A UPI narration. */
export function axis(u: Utrs): Cell[][] {
  return [
    ['Statement of Account No - 912010012345678 for the period (From : 01-10-2026 To : 08-10-2026)'],
    [],
    ['SRL NO', 'Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL', 'SOL'],
    ['1', '01-10-2026', '', `UPI/P2A/${u.exact}/ASHA RAO/State Bank Of I/JEC-7KQ4M2`, '', '2500.50', '102500.50', '1234'],
    ['2', '01-10-2026', '', `UPI/P2A/${u.short}/BHARAT KUMAR/HDFC BANK/UPI`, '', '2500.00', '105000.50', '1234'],
    ['3', '02-10-2026', '', `UPI/P2A/${u.reversed}/CHITRA S/ICICI Bank/JEC`, '', '2500.50', '107501.00', '1234'],
    ['4', '03-10-2026', '', `UPI/REV/${u.reversed}/CHITRA S/ICICI Bank/JEC`, '2500.50', '', '105000.50', '1234'],
    ['5', '04-10-2026', '', `UPI/P2M/${u.debitOnly}/TENT HOUSE/YES BANK/advance`, '2500.50', '', '102500.00', '1234'],
    ['6', '05-10-2026', '', `IMPS/P2A/1${u.embedded}/DEEPAK/HDFC/JEC`, '', '2500.50', '105000.50', '1234'],
    [],
    ['Unless the constituent notifies the bank immediately of any discrepancy found by him in this statement of Account, it will be taken that he has found the account correct.'],
  ]
}

/** Kotak CSV: "Withdrawal (Dr)" / "Deposit (Cr)" columns. */
export function kotak(u: Utrs): Cell[][] {
  return [
    ['Kotak Mahindra Bank'],
    ['Account Statement', '', '01/10/2026 to 08/10/2026'],
    [],
    ['Sl. No.', 'Transaction Date', 'Value Date', 'Description', 'Chq / Ref No.', 'Withdrawal (Dr)', 'Deposit (Cr)', 'Balance'],
    ['1', '01-10-2026', '01-10-2026', `UPI/ASHA RAO/${u.exact}/JEC-7KQ4M2`, `UPI-${u.exact}`, '', '2,500.50', '1,02,500.50(Cr)'],
    ['2', '01-10-2026', '01-10-2026', `UPI/BHARAT/${u.short}/UPI`, `UPI-${u.short}`, '', '2,500.00', '1,05,000.50(Cr)'],
    ['3', '02-10-2026', '02-10-2026', `UPI/CHITRA/${u.reversed}/JEC`, `UPI-${u.reversed}`, '', '2,500.50', '1,07,501.00(Cr)'],
    ['4', '03-10-2026', '03-10-2026', `UPI/REVERSAL/${u.reversed}/JEC`, `UPI-${u.reversed}`, '2,500.50', '', '1,05,000.50(Cr)'],
    ['5', '04-10-2026', '04-10-2026', `UPI/TENT HOUSE/${u.debitOnly}/advance`, `UPI-${u.debitOnly}`, '2,500.50', '', '1,02,500.00(Cr)'],
    ['6', '05-10-2026', '05-10-2026', `IMPS/DEEPAK/1${u.embedded}/JEC`, `IMPS-1${u.embedded}`, '', '2,500.50', '1,05,000.50(Cr)'],
  ]
}

/** Statement that has one "Amount" column plus a Dr/Cr flag (SBI YONO / some current accounts). */
export function amountWithFlag(u: Utrs): Cell[][] {
  return [
    ['Date', 'Narration', 'Ref', 'Amount', 'Dr/Cr', 'Balance'],
    ['01-10-2026', `UPI/CR/${u.exact}/ASHA RAO`, '', '2500.50', 'CR', '102500.50'],
    ['04-10-2026', `UPI/DR/${u.debitOnly}/TENT`, '', '2500.50', 'DR', '100000.00'],
  ]
}

export function toCsv(rows: Cell[][], sep = ','): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c === null || c === undefined ? '' : String(c)
          return /[",\n\t;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(sep),
    )
    .join('\r\n')
}
