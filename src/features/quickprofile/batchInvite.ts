// A link like /?batch=1993 (from "Invite your batch") pre-fills the batch on the welcome page of a new member.
import { CURRENT_YEAR } from '../../lib/constants'

const KEY = 'jec.invite.batch'

/** A valid batch year from a query string, else null. */
export function parseBatchParam(search: string): number | null {
  const v = new URLSearchParams(search).get('batch')
  if (!v || !/^\d{4}$/.test(v)) return null
  const n = Number(v)
  return n >= 1947 && n <= CURRENT_YEAR + 5 ? n : null
}

/** Remember the batch from the landing URL until the new member reaches the welcome page. */
export function captureBatch(search: string): void {
  const n = parseBatchParam(search)
  if (!n) return
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    /* storage blocked: the field is simply not prefilled */
  }
}

export function invitedBatch(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isInteger(n) && n >= 1947 && n <= CURRENT_YEAR + 5 ? n : null
  } catch {
    return null
  }
}

export function clearInvitedBatch(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
