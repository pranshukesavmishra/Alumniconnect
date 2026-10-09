import { CreditCard, History, Search, Ticket, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Avatar, Badge, Card, Notice, Skeleton } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import { PaymentBadge, StatusBadge } from '../events/StatusBadge'
import { useAdminSearch } from './queries'

const row = 'flex min-h-14 items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2'

/** One box for members, ticket codes, UTRs, phone numbers and e-mail addresses. Contact details are matched on the server, never shown. */
export function AdminSearch({ members }: { members: boolean }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const [all, setAll] = useState<string | null>(null) // the query "See all" was pressed for
  const { data, isFetching, error } = useAdminSearch(dq, all === dq ? 50 : 8)
  const more = (n: number) => n >= 8 && all !== dq
  const none = !!data && !data.members.length && !data.registrations.length && !data.payments.length

  return (
    <section aria-label="Admin search" className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          type="search"
          aria-label="Search everything"
          placeholder={members ? 'Name, ticket code, UTR, phone, e-mail…' : 'Name, ticket code, UTR, phone…'}
          className="pl-11 pr-11"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {q && (
          <button type="button" aria-label="Clear search" className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setQ('')}>
            <X className="size-4" />
          </button>
        )}
      </div>
      {dq.length >= 2 && (
        <div role="region" aria-label="Search results" aria-live="polite" className="space-y-3">
          {error && <Notice tone="danger" title={friendlyError(error)} />}
          {isFetching && !data && <Skeleton className="h-16" />}
          {none && !isFetching && <Notice tone="info" title={`Nothing found for “${dq}”`}>Try a name, the ticket code (JEC-…), the 12-digit UTR or a phone number.</Notice>}
          {!!data?.members.length && (
            <Group icon={<UserRound className="size-4" aria-hidden />} title="Members" more={more(data.members.length) ? () => setAll(dq) : undefined}>
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center">
                  <Link to={`/admin/members?open=${m.id}`} className={`${row} min-w-0 flex-1`}>
                    <Avatar src={null} name={m.full_name || '?'} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.full_name || '(no name yet)'}</span>
                      <span className="block truncate text-sm text-muted">{[m.branch, m.grad_year, m.city].filter(Boolean).join(' · ') || 'Profile not completed'} · matched {m.matched_on}</span>
                    </span>
                    {m.is_admin && <Badge tone="primary">Admin</Badge>}
                    {m.verification === 'verified' ? <Badge tone="success">Verified</Badge> : m.verification === 'rejected' ? <Badge tone="danger">Rejected</Badge> : <Badge>Not verified</Badge>}
                  </Link>
                  <Link to={`/admin/members/${m.id}`} aria-label={`History of ${m.full_name || 'member'}`} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2">
                    <History className="size-5" aria-hidden />
                  </Link>
                </li>
              ))}
            </Group>
          )}
          {!!data?.registrations.length && (
            <Group icon={<Ticket className="size-4" aria-hidden />} title="Registrations" more={more(data.registrations.length) ? () => setAll(dq) : undefined}>
              {data.registrations.map((r) => (
                <li key={r.id}>
                  <Link to={`/admin/events/${r.event_slug}?tab=people&q=${encodeURIComponent(r.code)}`} className={row}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.full_name || '(no name)'} <span className="font-mono text-sm font-normal text-muted">{r.code}</span></span>
                      <span className="block truncate text-sm text-muted">{r.event_title} · {formatPaise(r.amount_paise)} · matched {r.matched_on}</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </Group>
          )}
          {!!data?.payments.length && (
            <Group icon={<CreditCard className="size-4" aria-hidden />} title="Payments and UTRs" more={more(data.payments.length) ? () => setAll(dq) : undefined}>
              {data.payments.map((p) => (
                <li key={p.id}>
                  <Link to={`/admin/events/${p.event_slug}?tab=${p.status === 'submitted' ? 'payments' : 'people'}&q=${encodeURIComponent(p.code)}`} className={row}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{formatPaise(p.amount_paise)} <span className="font-mono text-sm font-normal text-muted">{p.utr ?? p.method}</span></span>
                      <span className="block truncate text-sm text-muted">{p.full_name} · {p.code} · {p.event_title}</span>
                    </span>
                    <PaymentBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </Group>
          )}
          {data?.by_contact && <p className="text-xs text-muted">Looking people up by phone or e-mail is recorded in the activity log.</p>}
        </div>
      )}
    </section>
  )
}

function Group({ icon, title, children, more }: { icon: React.ReactNode; title: string; children: React.ReactNode; more?: () => void }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-muted">{icon} {title}</h3>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">{children}</ul>
        {more && <button type="button" onClick={more} className="min-h-11 w-full border-t border-border text-sm font-semibold text-primary hover:bg-surface-2">See all</button>}
      </Card>
    </div>
  )
}
