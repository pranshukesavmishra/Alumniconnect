import clsx from 'clsx'
import { Download, Phone, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, KeyValue, Notice } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input } from '../../components/ui/Form'
import { FOOD_PREFS } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import type { EventRow, Registration, RegistrationStatus } from '../../lib/types'
import { PaymentBadge, StatusBadge } from '../events/StatusBadge'
import { exportAttendees, exportPayments, exportRegistrations } from './export'
import { useRecordOfflinePayment, type AdminData } from './queries'
import { RegistrationAdjustments } from './RegistrationAdjustments'
import { AdminReunionDetail } from './AdminReunionDetail'
import { RegistrationEditor } from './RegistrationEditor'
import { usePaged } from '../../lib/paging'

const FILTERS: { id: RegistrationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_payment', label: 'Unpaid' },
  { id: 'under_review', label: 'Being verified' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'cancelled', label: 'Cancelled' },
]

export function AdminPeople({ event, data, manager, initialQuery = '' }: { event: EventRow; data: AdminData; manager: boolean; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery)
  const [filter, setFilter] = useState<RegistrationStatus | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(() => data.registrations.find((r) => initialQuery && r.code.toLowerCase() === initialQuery.toLowerCase())?.id ?? null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.registrations.filter(
      (r) =>
        (filter === 'all' ? needle !== '' || r.status !== 'cancelled' : r.status === filter) &&
        (!needle || [r.full_name, r.code, r.phone, r.email, r.city, String(r.grad_year ?? '')].some((v) => v?.toLowerCase().includes(needle))),
    )
  }, [data.registrations, q, filter])
  const open = data.registrations.find((r) => r.id === openId)
  const paged = usePaged(list, 100, `${q}|${filter}`)

  return (
    <div className="space-y-4">
      {manager && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => exportRegistrations(event, data)}>
            Registrations (Excel)
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => exportAttendees(event, data)}>
            Attendees / badges
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => exportPayments(event, data)}>
            Payments
          </Button>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" aria-label="Search registrations" placeholder="Name, code, phone, batch…" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const n = f.id === 'all' ? data.registrations.filter((r) => r.status !== 'cancelled').length : data.registrations.filter((r) => r.status === f.id).length
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={clsx('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', filter === f.id ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}
            >
              {f.label} · {n}
            </button>
          )
        })}
      </div>

      {list.length === 0 ? (
        <EmptyState title="No registrations here" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {paged.shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-surface-2" onClick={() => setOpenId(r.id)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.full_name}</p>
                  <p className="truncate text-sm text-muted">
                    <span className="font-mono">{r.code}</span> · {[r.branch, r.grad_year].filter(Boolean).join(' ')} · {r.headcount} {r.headcount === 1 ? 'person' : 'people'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={r.status} />
                  {manager && <span className="text-sm font-semibold tabular-nums">{formatPaise(r.amount_paise)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {paged.hidden > 0 && <Button variant="secondary" block onClick={paged.more}>Show {Math.min(100, paged.hidden)} more ({paged.hidden} not shown)</Button>}
      {open && <Detail reg={open} data={data} manager={manager} event={event} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Detail({ reg, data, manager, event, onClose }: { reg: Registration; data: AdminData; manager: boolean; event: EventRow; onClose: () => void }) {
  const eventId = event.id
  const items = data.items.filter((i) => i.registration_id === reg.id)
  const payments = data.payments.filter((p) => p.registration_id === reg.id)
  const covered = payments.filter((p) => p.status === 'submitted' || p.status === 'verified').reduce((a, p) => a + p.amount_paise, 0)
  const due = Math.max(0, reg.amount_paise - covered)
  const offline = useRecordOfflinePayment(eventId)
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'waiver'>('cash')
  const [amount, setAmount] = useState(String(due / 100))
  const [note, setNote] = useState('')

  function record() {
    const paise = method === 'waiver' ? null : parseRupeesToPaise(amount)
    if (method !== 'waiver' && (!paise || paise > due)) return toast.error(`Enter an amount up to ${formatPaise(due)}.`)
    if (method === 'waiver' && !note.trim()) return toast.error('Please note who approved the waiver.')
    if (!window.confirm(method === 'waiver' ? `Waive ${formatPaise(due)} for ${reg.full_name}?` : `Record ${formatPaise(paise!)} ${method === 'cash' ? 'cash' : 'bank transfer'} from ${reg.full_name}?`)) return
    offline.mutate(
      { registrationId: reg.id, method, amountPaise: paise, note: note.trim() },
      { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Payment recorded') },
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={reg.full_name} className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-bg p-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{reg.full_name}</h2>
            <p className="font-mono text-sm text-muted">{reg.code}</p>
          </div>
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-2" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={reg.status} />
          {manager && (<>
          <a href={`tel:${reg.phone.replace(/\s/g, '')}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-sm font-semibold text-primary">
            <Phone className="size-3.5" aria-hidden /> {reg.phone}
          </a>
          <a href={`https://wa.me/${reg.phone.replace(/[^\d]/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm font-semibold text-primary">
            WhatsApp
          </a>
          </>)}
        </div>
        {manager && reg.admin_note && reg.status !== 'confirmed' && <Notice tone="warning" className="mb-4" title="Note to member" >{reg.admin_note}</Notice>}
        <Card className="px-4">
          <dl className="divide-y divide-border">
            <KeyValue label="Batch">{[reg.branch, reg.grad_year].filter(Boolean).join(' ') || '—'}</KeyValue>
            <KeyValue label="City">{reg.city ?? '—'}</KeyValue>
            {manager && <KeyValue label="Email">{reg.email ?? '—'}</KeyValue>}
            {items.map((i) => (
              <KeyValue key={i.ticket_type_id} label={`${i.label} × ${i.quantity}`}>
                {manager ? formatPaise(i.unit_price_paise * i.quantity) : ''}
              </KeyValue>
            ))}
            <KeyValue label="People">{reg.headcount}</KeyValue>
            {reg.guests.length > 0 && <KeyValue label="With them">{reg.guests.map((g) => `${g.name || '—'} (${g.relation})`).join(', ')}</KeyValue>}
            <KeyValue label="Food">{FOOD_PREFS.find((f) => f.value === reg.food_pref)?.label ?? '—'}</KeyValue>
            <KeyValue label="T-shirt">{reg.tshirt_size ?? '—'}</KeyValue>
            <KeyValue label="Accommodation">{reg.needs_accommodation ? 'Needs help' : 'No'}</KeyValue>
            {reg.arrival_note && <KeyValue label="Arrival">{reg.arrival_note}</KeyValue>}
            {manager && reg.notes && <KeyValue label="Notes">{reg.notes}</KeyValue>}
            <KeyValue label="Photo consent">{reg.photo_consent ? 'Yes' : 'No'}</KeyValue>
            <KeyValue label="Registered">{formatDateTime(reg.created_at)}</KeyValue>
            {reg.checked_in_at && <KeyValue label="Checked in">{formatDateTime(reg.checked_in_at)}</KeyValue>}
            {manager && <KeyValue label="Total">{formatPaise(reg.amount_paise)}</KeyValue>}
          </dl>
        </Card>

        <AdminReunionDetail event={event} reg={reg} manager={manager} />

        {manager && <RegistrationEditor key={`${reg.id}:${reg.updated_at}`} reg={reg} items={items} />}
        {manager && <RegistrationAdjustments key={`adj:${reg.id}:${reg.updated_at}`} reg={reg} payments={payments} due={due} onClose={onClose} />}

        {manager && (
          <>
            <h3 className="mb-2 mt-6 text-[13px] font-bold uppercase tracking-wide text-muted">Payments</h3>
            {payments.length === 0 ? (
              <p className="text-sm text-muted">No payments yet.</p>
            ) : (
              <Card className="divide-y divide-border">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums">
                        {formatPaise(p.amount_paise)} · {p.method.replace('_', ' ')}
                      </p>
                      <p className="truncate text-muted">{[p.utr, p.review_note].filter(Boolean).join(' · ') || formatDateTime(p.created_at)}</p>
                    </div>
                    <PaymentBadge status={p.status} />
                  </div>
                ))}
              </Card>
            )}
            {due > 0 && reg.status !== 'cancelled' && (
              <Card className="mt-4 space-y-3 p-4">
                <p className="font-semibold">Record a desk payment · {formatPaise(due)} due</p>
                <p className="-mt-1 text-sm text-muted">Part payments are fine: the rest stays due. “Waive” clears everything still due (a comp ticket).</p>
                <ChoiceGroup
                  label="Method"
                  columns={3}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank_transfer', label: 'Bank' },
                    { value: 'waiver', label: 'Waive' },
                  ]}
                />
                {method !== 'waiver' && <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>}
                <Field label={method === 'waiver' ? 'Approved by / reason' : 'Note'} optional={method !== 'waiver'}>
                  {(p) => <Input {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <Button loading={offline.isPending} onClick={record}>
                  {method === 'waiver' ? 'Waive and confirm' : 'Record payment'}
                </Button>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
