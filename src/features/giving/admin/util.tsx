import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '../../../lib/errors'
import { rupeesToPaise } from '../helpers'

/** Runs a write, refreshes every Give Back screen, and answers with a toast. Returns true on success. */
export function useRunner() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      setBusy(true)
      try {
        await fn()
        await qc.invalidateQueries({ queryKey: ['giving'] })
        if (ok) toast.success(ok)
        return true
      } catch (e) {
        toast.error(friendlyError(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [qc],
  )
  return { run, busy }
}

/** Rupee text field to paise, with a message for the form. */
export function money(input: string, what: string, opts: { min?: number; optional?: boolean } = {}): { paise: number | null; error: string | null } {
  if (!input.trim()) return opts.optional ? { paise: null, error: null } : { paise: null, error: `Enter ${what}.` }
  const p = rupeesToPaise(input)
  if (p === null) return { paise: null, error: `${what} must be an amount in rupees, like 2500 or 2500.50.` }
  if (opts.min && p < opts.min) return { paise: null, error: `${what} is too small.` }
  return { paise: p, error: null }
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** datetime-local value for an ISO timestamp (shown in the admin's own time zone). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
