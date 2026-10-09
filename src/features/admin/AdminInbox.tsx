import { Banknote, CheckCircle2, Flag, Hourglass, ListChecks, MailCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Badge, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { useInbox, type InboxItem } from './queries'

const KINDS: { id: InboxItem['kind'] | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'report', label: 'Reports' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'refund', label: 'Refunds' },
  { id: 'waitlist', label: 'Waiting list' },
  { id: 'approval', label: 'Approvals' },
]
const ICON: Record<InboxItem['kind'], ReactNode> = {
  report: <Flag className="size-5" aria-hidden />,
  flagged: <Flag className="size-5" aria-hidden />,
  refund: <Banknote className="size-5" aria-hidden />,
  waitlist: <Hourglass className="size-5" aria-hidden />,
  approval: <MailCheck className="size-5" aria-hidden />,
}
const TONE = { report: 'danger', flagged: 'danger', refund: 'warning', waitlist: 'primary', approval: 'warning' } as const

/** One list for everything that waits for a decision. You only see the kinds your role may act on; each row opens the right screen. */
export function AdminInbox() {
  const inbox = useInbox()
  const [kind, setKind] = useState<InboxItem['kind'] | 'all'>('all')
  const items = (inbox.data ?? []).filter((i) => kind === 'all' || i.kind === kind)
  return (
    <div>
      <PageHeader title="Inbox" subtitle="Everything waiting for a decision" back="/admin" />
      <Page className="space-y-3">
        <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
          {KINDS.map((k) => {
            const n = (inbox.data ?? []).filter((i) => k.id === 'all' || i.kind === k.id).length
            return (
              <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${kind === k.id ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted'}`}>
                {k.label}{n > 0 ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>
        {inbox.isError ? (
          <Notice tone="danger" title={friendlyError(inbox.error)} />
        ) : inbox.isLoading ? (
          <PageSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="All caught up">Reports, refunds, waiting lists and messages that need a decision appear here.</EmptyState>
        ) : (
          <ul className="space-y-2" data-testid="inbox">
            {items.map((i) => (
              <li key={i.key}>
                <Link to={i.href} data-kind={i.kind} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:border-primary/40">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">{ICON[i.kind] ?? <ListChecks className="size-5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{i.title}</span>
                    {i.detail && <span className="block text-sm text-muted [overflow-wrap:anywhere]">{i.detail}</span>}
                    <span className="block text-xs text-muted">{relativeTime(i.at)}</span>
                  </span>
                  <Badge tone={TONE[i.kind]}>{KINDS.find((k) => k.id === i.kind)?.label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </div>
  )
}
