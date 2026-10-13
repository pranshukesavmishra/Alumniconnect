// Countdown and anniversary math for the Home highlights (pure, testable).

export interface Countdown {
  /** whole days, hours (0-23), minutes (0-59), seconds (0-59) left */
  days: number
  hours: number
  minutes: number
  seconds: number
  totalMs: number
  /** the moment has passed (all parts are 0) */
  past: boolean
  /** under 24 hours to go */
  today: boolean
}

/**
 * Time left until `target`. `offsetMs` corrects the device clock with the server's (see clockOffset), so a phone whose clock
 * is wrong still counts down correctly.
 */
export function countdown(target: string | number | Date, now: number | Date = Date.now(), offsetMs = 0): Countdown {
  const t = typeof target === 'string' ? Date.parse(target) : target instanceof Date ? target.getTime() : target
  const n = (now instanceof Date ? now.getTime() : now) + offsetMs
  if (!Number.isFinite(t) || !Number.isFinite(n)) return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, past: true, today: false }
  const total = Math.max(0, t - n)
  const s = Math.floor(total / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    totalMs: total,
    past: total === 0,
    today: total > 0 && total < 86_400_000,
  }
}

/** Server clock minus device clock, from a response's server_now and the device time when it arrived (half the round trip). */
export function clockOffset(serverNow: string, sentAt: number, receivedAt: number): number {
  const server = Date.parse(serverNow)
  if (!Number.isFinite(server)) return 0
  return Math.round(server - (sentAt + receivedAt) / 2)
}

/** Calendar days from today to the day of `target` in India time (0 = today, 1 = tomorrow), like the server's days_left. */
export function daysUntilIST(target: string | Date, now: Date = new Date()): number {
  const day = (d: Date) => {
    const ist = new Date(d.getTime() + 330 * 60_000)
    return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  }
  const t = typeof target === 'string' ? new Date(target) : target
  return Math.round((day(t) - day(now)) / 86_400_000)
}

export type AnniversaryKind = 'first' | 'silver' | 'pearl' | 'ruby' | 'golden' | 'milestone' | 'plain' | 'none'

/** How special a batch anniversary is: 25 silver, 30 pearl, 40 ruby, 50 golden, other multiples of 5 milestone. */
export function anniversaryKind(years: number | null | undefined): AnniversaryKind {
  if (years === null || years === undefined || !Number.isFinite(years) || years <= 0) return 'none'
  if (years === 1) return 'first'
  if (years === 25) return 'silver'
  if (years === 30) return 'pearl'
  if (years === 40) return 'ruby'
  if (years === 50) return 'golden'
  return years % 5 === 0 ? 'milestone' : 'plain'
}
