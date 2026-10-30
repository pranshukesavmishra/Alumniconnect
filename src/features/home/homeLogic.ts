// Pure helpers for the Home dashboard (time of day, once-a-day celebrations).
import type { AnniversaryKind } from '../highlights/countdown'

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'

/** The hour (0-23) in India time. */
export function istHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 330 * 60_000).getUTCHours()
}

/** Morning 5-11, afternoon 12-16, evening 17-20, night otherwise. Drives the greeting and the hero's light. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

/** The India-time calendar day, "2026-10-13". */
export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/**
 * True the first time it is asked for `key` on a given India-time day (remembered in `store`, usually localStorage),
 * false afterwards. No storage, or storage that throws (private mode), gives false: never celebrate on every visit.
 */
export function firstTimeToday(key: string, store: Pick<Storage, 'getItem' | 'setItem'> | null, now: Date = new Date()): boolean {
  const day = istDay(now)
  try {
    if (!store) return false
    if (store.getItem(key) === day) return false
    store.setItem(key, day)
    return true
  } catch {
    return false
  }
}

/** Anniversaries worth confetti (1st, 25th silver, 30th pearl, 40th ruby, 50th golden, other multiples of 5). */
export function isMilestone(kind: AnniversaryKind): boolean {
  return kind !== 'none' && kind !== 'plain'
}
