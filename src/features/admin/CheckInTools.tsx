import clsx from 'clsx'
import { CheckCircle2, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Card } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { Button } from '../../components/ui/Button'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { searchGate, useArrivals, type GateMatch } from './opsQueries'

/** Live "people in" counter for the gate: refreshes every few seconds. */
export function ArrivalsCounter({ eventId, compact }: { eventId: string | undefined; compact?: boolean }) {
  const { data } = useArrivals(eventId)
  if (!data) return <div className="skeleton h-16 rounded-2xl" aria-hidden />
  const pct = data.expected_people > 0 ? Math.min(100, Math.round((data.arrived_people / data.expected_people) * 100)) : 0
  return (
    <div className={clsx('rounded-2xl border border-border bg-surface', compact ? 'p-3' : 'p-4')} data-testid="arrivals-counter" aria-live="polite">
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-muted"><Users className="size-4" aria-hidden /> Arrived</p>
        <p className="text-2xl font-bold tabular-nums">
          <span data-testid="arrived-people">{data.arrived_people}</span>
          <span className="text-base font-semibold text-muted"> / {data.expected_people} people</span>
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of confirmed people who have arrived">
        <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {!compact && <p className="mt-1 text-xs text-muted">{data.arrived_registrations} of {data.expected_registrations} confirmed registrations are in.</p>}
    </div>
  )
}

/** Find someone by name, ticket code or the last digits of their mobile number, and check them in. */
export function GateSearch({ eventId, onPick }: { eventId: string; onPick: (code: string) => void | Promise<void> }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  const res = useQuery({ queryKey: ['gate-search', eventId, term], enabled: term.length >= 2, queryFn: () => searchGate(eventId, term), placeholderData: (prev) => prev })

  async function pick(m: GateMatch) {
    setBusy(m.code)
    try {
      await onPick(m.code)
    } finally {
      setBusy(null)
      void res.refetch()
    }
  }

  return (
    <div className="space-y-2" role="search" aria-label="Find an attendee">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" aria-label="Find by name, code or last digits of mobile" placeholder="Name, code or last 4 digits of mobile" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {term.length >= 2 && res.isError && <p className="text-sm text-danger" role="alert">{friendlyError(res.error)}</p>}
      {term.length >= 2 && res.data && res.data.length === 0 && <p className="text-sm text-muted">No one found for “{term}”.</p>}
      {!!res.data?.length && term.length >= 2 && (
        <Card className="divide-y divide-border" data-testid="gate-results">
          {res.data.map((m) => (
            <div key={m.code} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.full_name}</p>
                <p className="truncate text-sm text-muted">
                  <span className="font-mono">{m.code}</span> · {[m.branch, m.grad_year].filter(Boolean).join(' ')} · {m.headcount} {m.headcount === 1 ? 'person' : 'people'}
                </p>
              </div>
              {m.checked_in_at ? (
                <Badge tone="success"><CheckCircle2 className="size-3.5" aria-hidden /> In {formatDateTime(m.checked_in_at)}</Badge>
              ) : m.status === 'confirmed' ? (
                <Button size="sm" loading={busy === m.code} aria-label={`Check in ${m.full_name}`} onClick={() => void pick(m)}>Check in</Button>
              ) : m.status === 'cancelled' ? (
                <Badge tone="danger">Cancelled</Badge>
              ) : (
                <Badge tone="warning">{m.status === 'under_review' ? 'Payment not verified' : 'Not paid'}</Badge>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
