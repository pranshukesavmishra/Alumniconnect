import { tr } from '../i18n/core'

// Turn Supabase / network errors into sentences a member can act on.

interface MaybePgError {
  message?: string
  code?: string
  details?: string
  hint?: string
}

export function friendlyError(error: unknown): string {
  if (!error) return tr('err.generic')
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return tr('err.offline')
  }
  const e = error as MaybePgError
  const msg = e.message ?? String(error)
  if (e.code === 'P0001' && msg) return msg // our own RAISE EXCEPTION messages are written for members
  if (e.code === '42501') return tr('err.permission')
  if (e.code === '23505') return tr('err.exists')
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return tr('err.network')
  }
  if (/JWT|session/i.test(msg)) return tr('err.session')
  if (/rate limit/i.test(msg)) return tr('err.rate')
  return msg || tr('err.generic')
}
