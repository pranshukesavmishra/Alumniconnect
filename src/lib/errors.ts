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
  if (/violates (row-level security|check constraint|foreign key)|duplicate key|permission denied|invalid input syntax|relation .* does not exist|column .* does not exist/i.test(msg) && !e.code) return tr('err.generic') // never show raw database text
  if (e.code === '42501') return tr('err.permission')
  if (e.code === '23505') return tr('err.exists')
  if (e.code === '23503') return tr('err.inUse')
  if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '22003') return tr('err.invalid')
  if (e.code === '57014') return tr('err.timeout')
  if (e.code === '40001' || e.code === '40P01') return tr('err.conflict')
  if (e.code === '42883' || e.code === 'PGRST202' || e.code === '42703' || e.code === '42P01') return tr('err.outdated')
  if (/non-2xx|FunctionsHttpError|FunctionsFetchError|FunctionsRelayError/i.test(msg)) return tr('err.service')
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return tr('err.network')
  }
  if (/JWT|session/i.test(msg)) return tr('err.session')
  if (/rate limit/i.test(msg)) return tr('err.rate')
  return msg || tr('err.generic')
}
