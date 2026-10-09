// The confirmed entry pass is kept on the phone so it can be shown at the gate with no network.

export interface CachedTicket {
  code: string
  name: string
  headcount: number
  title: string
  when: string
}

export const ticketKey = (uid: string | null) => `ticket:${uid ?? ''}`

/**
 * The entry pass saved on this phone. Without a sign-in to go by (offline, expired session) the single saved pass is used:
 * it is only ever written by this device's own member.
 */
export function readCachedTicket(uid: string | null): CachedTicket | null {
  try {
    const raw = uid ? localStorage.getItem(ticketKey(uid)) : null
    if (raw) return JSON.parse(raw) as CachedTicket
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('ticket:')) return JSON.parse(localStorage.getItem(k) ?? 'null') as CachedTicket | null
    }
  } catch {
    /* ignore */
  }
  return null
}
