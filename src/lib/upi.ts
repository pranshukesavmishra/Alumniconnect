import { paiseToUpiAmount } from './money'

export interface UpiPayment {
  upiId: string
  payeeName: string
  amountPaise: number
  /** Shown in the payer's app and on the bank statement; we use the ticket code. */
  note: string
}

const UPI_ID = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,64}$/

export function isValidUpiId(id: string): boolean {
  return UPI_ID.test(id.trim())
}

/** Standard UPI deep link (NPCI "upi://pay"), opens GPay / PhonePe / Paytm / BHIM with fields filled in. */
export function buildUpiLink({ upiId, payeeName, amountPaise, note }: UpiPayment): string {
  if (!isValidUpiId(upiId)) throw new Error('Invalid UPI ID')
  const params = new URLSearchParams({
    pa: upiId.trim(),
    pn: payeeName.trim().slice(0, 50),
    am: paiseToUpiAmount(amountPaise),
    cu: 'INR',
    tn: note.trim().slice(0, 50),
  })
  // URLSearchParams encodes spaces as "+", which some UPI apps show literally; use %20.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`
}

/** UTR / UPI reference numbers are 12 digits. Accepts spaces the user may paste. */
export function normalizeUtr(input: string): string | null {
  const digits = input.replace(/\s+/g, '')
  return /^\d{12}$/.test(digits) ? digits : null
}
