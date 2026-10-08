// Turn Supabase / network errors into sentences a member can act on.

interface MaybePgError {
  message?: string
  code?: string
  details?: string
  hint?: string
}

export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.'
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You seem to be offline. Check your internet connection and try again.'
  }
  const e = error as MaybePgError
  const msg = e.message ?? String(error)
  if (e.code === 'P0001' && msg) return msg // our own RAISE EXCEPTION messages are written for members
  if (e.code === '42501') return 'You don’t have permission to do that.'
  if (e.code === '23505') return 'This already exists.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'We couldn’t reach the server. Check your connection and try again.'
  }
  if (/JWT|session/i.test(msg)) return 'Your session has expired. Please sign in again.'
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.'
  return msg || 'Something went wrong. Please try again.'
}
