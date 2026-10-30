// Recent searches for the command search, kept on this device only. Pure helpers are unit-tested.

const KEY = 'jec-recent-searches'
export const MAX_RECENT = 6

/** Adds a query to the front (case-insensitive de-duplication), trimmed, capped. */
export function pushRecent(list: readonly string[], query: string, max = MAX_RECENT): string[] {
  const q = query.trim().replace(/\s+/g, ' ')
  if (q.length < 2) return [...list]
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max)
}

export function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export function writeRecent(list: readonly string[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: nothing remembered */
  }
}

/** Escapes a typed term for a PostgREST ilike filter (no wildcards, no filter separators). */
export function ilikeTerm(q: string): string {
  return q.trim().replace(/[%_\\,()*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Moves a highlighted index through n options, wrapping around. */
export function stepIndex(current: number, delta: 1 | -1, n: number): number {
  if (n <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : n - 1
  return (current + delta + n) % n
}
