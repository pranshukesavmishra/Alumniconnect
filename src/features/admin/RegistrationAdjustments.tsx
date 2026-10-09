import { ArrowRightLeft, BadgePercent, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { METHOD_LABELS } from '../../lib/ledger'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import type { Payment, Registration } from '../../lib/types'
import { MemberPicker } from './MemberPicker'
import { useRefreshMoney, useRegistrationRefunds } from './opsQueries'

type Panel = null | 'transfer' | 'discount' | 'refund'
type RefundMethod = 'upi' | 'cash' | 'bank_transfer' | 'other'

/** Managers: move a ticket to someone else, give a discount, or record money given back. Each is validated on the server and written to the activity log. */
export function RegistrationAdjustments({ reg, payments, due, onClose }: { reg: Registration; payments: Payment[]; due: number; onClose?: () => void }) {
  const [panel, setPanel] = useState<Panel>(null)
  const refunds = useRegistrationRefunds(reg.id)
  const refresh = useRefreshMoney(reg.event_id)
  const cancelled = reg.status === 'cancelled'
  const refundedOn = (paymentId: string) => (refunds.data ?? []).filter((r) => r.payment_id === paymentId).reduce((a, r) => a + r.amount_paise, 0)
  const refundable = payments
    .filter((p) => p.status === 'verified' && p.method !== 'waiver')
    .map((p) => ({ p, left: p.amount_paise - refundedOn(p.id) }))
    .filter((x) => x.left > 0)

  return (
    <div className="mt-6 space-y-3" aria-label="Adjustments">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">Adjust this registration</h3>
      <div className="flex flex-wrap gap-2">
        {!cancelled && <Button size="sm" variant={panel === 'transfer' ? 'primary' : 'secondary'} icon={<ArrowRightLeft className="size-4" />} onClick={() => setPanel(panel === 'transfer' ? null : 'transfer')}>Transfer ticket</Button>}
        {!cancelled && due > 0 && <Button size="sm" variant={panel === 'discount' ? 'primary' : 'secondary'} icon={<BadgePercent className="size-4" />} onClick={() => setPanel(panel === 'discount' ? null : 'discount')}>Discount</Button>}
        {refundable.length > 0 && <Button size="sm" variant={panel === 'refund' ? 'primary' : 'secondary'} icon={<Undo2 className="size-4" />} onClick={() => setPanel(panel === 'refund' ? null : 'refund')}>Record a refund</Button>}
      </div>

      {panel === 'transfer' && <Transfer reg={reg} onDone={() => { refresh(); setPanel(null); onClose?.() }} />}
      {panel === 'discount' && <Discount reg={reg} due={due} onDone={() => { refresh(); setPanel(null) }} />}
      {panel === 'refund' && <Refund reg={reg} items={refundable} onDone={() => { refresh(); setPanel(null) }} />}

      {!!refunds.data?.length && (
        <Card className="divide-y divide-border" aria-label="Refunds recorded">
          {refunds.data.map((r) => (
            <div key={r.id} className="p-3 text-sm">
              <p className="font-semibold tabular-nums">Refunded {formatPaise(r.amount_paise)} · {METHOD_LABELS[r.method] ?? r.method}</p>
              <p className="text-muted">{[r.reference, r.note, formatDateTime(r.created_at)].filter(Boolean).join(' · ')}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Transfer({ reg, onDone }: { reg: Registration; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function go(userId: string, name: string) {
    if (reason.trim().length < 3) return toast.error('Please write the reason first (it is kept in the activity log).')
    if (!window.confirm(`Move ticket ${reg.code} from ${reg.full_name} to ${name}? Payments stay with the ticket. Both people are told.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_transfer_registration', { p_registration: reg.id, p_to_user: userId, p_reason: reason.trim() })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success(`Ticket moved to ${name}`)
    onDone()
  }
  return (
    <Card className="space-y-3 p-4">
      <p className="font-semibold">Transfer to another member</p>
      <p className="text-sm text-muted">The ticket keeps its code, tickets and payments. The new person’s name, batch and city replace the old ones.</p>
      <Field label="Reason">{(p) => <Input {...p} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asha cannot travel; her batchmate takes the place" />}</Field>
      <MemberPicker actionLabel="Transfer" busy={busy} onPick={(id, name) => void go(id, name)} />
    </Card>
  )
}

function Discount({ reg, due, onDone }: { reg: Registration; due: number; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    const paise = parseRupeesToPaise(amount)
    if (!paise || paise > due) return toast.error(`Enter an amount up to ${formatPaise(due)}.`)
    if (reason.trim().length < 3) return toast.error('Please note who approved the discount.')
    if (!window.confirm(`Take ${formatPaise(paise)} off what ${reg.full_name} owes? No money is recorded as received.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_apply_discount', { p_registration: reg.id, p_amount_paise: paise, p_reason: reason.trim() })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Discount applied')
    onDone()
  }
  return (
    <Card className="space-y-3 p-4">
      <p className="font-semibold">Discount · {formatPaise(due)} still due</p>
      <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      <Field label="Approved by / reason">{(p) => <Input {...p} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Button loading={busy} onClick={go}>Apply discount</Button>
    </Card>
  )
}

function Refund({ reg, items, onDone }: { reg: Registration; items: { p: Payment; left: number }[]; onDone: () => void }) {
  const [paymentId, setPaymentId] = useState(items[0]!.p.id)
  const picked = items.find((i) => i.p.id === paymentId) ?? items[0]!
  const [amount, setAmount] = useState(String(picked.left / 100))
  const [method, setMethod] = useState<RefundMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [cancel, setCancel] = useState(false)
  const [busy, setBusy] = useState(false)

  async function go() {
    const paise = parseRupeesToPaise(amount)
    if (!paise || paise > picked.left) return toast.error(`Enter an amount up to ${formatPaise(picked.left)}.`)
    if (reason.trim().length < 3) return toast.error('Please write the reason (it is kept in the activity log).')
    if (!window.confirm(`Record that ${formatPaise(paise)} was given back to ${reg.full_name}${cancel ? ' and cancel the registration' : ''}? This only records it; send the money yourself first.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_record_refund', {
      p_payment: picked.p.id, p_amount_paise: paise, p_method: method, p_reference: reference.trim() || null, p_note: reason.trim(), p_cancel: cancel,
    })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Refund recorded')
    onDone()
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="font-semibold">Record a refund</p>
      <p className="text-sm text-muted">Use this after you have sent the money back. A fully refunded payment stops counting as collected.</p>
      {items.length > 1 && (
        <ChoiceGroup
          label="Which payment"
          value={paymentId}
          onChange={(v) => { setPaymentId(v); const it = items.find((i) => i.p.id === v); if (it) setAmount(String(it.left / 100)) }}
          options={items.map((i) => ({ value: i.p.id, label: `${formatPaise(i.p.amount_paise)} · ${METHOD_LABELS[i.p.method] ?? i.p.method}`, hint: `${formatPaise(i.left)} refundable${i.p.utr ? ` · ${i.p.utr}` : ''}` }))}
        />
      )}
      <Field label="Amount (₹)" hint={`Up to ${formatPaise(picked.left)}`}>{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      <ChoiceGroup<RefundMethod>
        label="Returned by"
        columns={2}
        value={method}
        onChange={setMethod}
        options={[{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' }]}
      />
      <Field label="Reference" optional hint="UTR or receipt number of the refund">{(p) => <Input {...p} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}</Field>
      <Field label="Reason">{(p) => <Input {...p} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Checkbox checked={cancel} onChange={setCancel}>Also cancel this registration</Checkbox>
      <Button loading={busy} onClick={go}>Record refund</Button>
    </Card>
  )
}
