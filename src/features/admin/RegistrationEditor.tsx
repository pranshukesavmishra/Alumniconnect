import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select, Stepper } from '../../components/ui/Form'
import { FOOD_PREFS, TSHIRT_SIZES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import type { Registration, RegistrationItem } from '../../lib/types'
import { useTicketTypes } from '../events/queries'
import { adminDataKey } from './queries'

/** Managers: change tickets/details on a member's behalf, or cancel / reopen. Re-priced on the server and audited. */
export function RegistrationEditor({ reg, items }: { reg: Registration; items: RegistrationItem[] }) {
  const qc = useQueryClient()
  const { data: tickets } = useTicketTypes(reg.event_id)
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(items.map((i) => [i.ticket_type_id, i.quantity])))
  const [food, setFood] = useState(reg.food_pref ?? '')
  const [tshirt, setTshirt] = useState(reg.tshirt_size ?? '')
  const [phone, setPhone] = useState(reg.phone)
  const [fund, setFund] = useState(String(reg.fund_paise / 100))
  const [feedback, setFeedback] = useState(reg.feedback ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const fundPaise = parseRupeesToPaise(fund || '0')
  const ticketsTotal = (tickets ?? []).reduce((s, t) => s + t.price_paise * (qty[t.id] ?? 0), 0)
  const total = ticketsTotal + (fundPaise ?? 0)
  const done = () => qc.invalidateQueries({ queryKey: adminDataKey(reg.event_id) })

  async function save() {
    if (!reason.trim()) return toast.error('Please write the reason for this change.')
    if (fundPaise === null) return toast.error('Reunion Fund: enter a valid amount in rupees (0 for none).')
    setBusy(true)
    const { error } = await supabase.rpc('admin_update_registration', {
      p_registration: reg.id,
      p_details: { food_pref: food, tshirt_size: tshirt, phone, feedback, ...(fundPaise !== reg.fund_paise ? { fund_paise: fundPaise } : {}) },
      p_items: (tickets ?? []).map((t) => ({ ticket_type_id: t.id, quantity: qty[t.id] ?? 0 })),
      p_reason: reason.trim(),
    })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Registration updated')
    setOpen(false)
    setReason('')
    await done()
  }

  async function setCancelled(cancel: boolean) {
    const why = window.prompt(cancel ? 'Reason for cancelling (kept in the activity log):' : 'Reason for reopening:')
    if (!why?.trim()) return
    // cancelling a paid registration: was the money given back? (then it stops counting as collected)
    const refunded = cancel && reg.amount_paise > 0 && window.confirm('Has the money been refunded to the member?\n\nOK = refunded (it stops counting as collected and they can register and pay again).\nCancel = keep the payment on record.')
    const { error } = await supabase.rpc('admin_set_registration_status', { p_registration: reg.id, p_cancel: cancel, p_reason: why.trim(), p_refunded: refunded })
    if (error) return toast.error(friendlyError(error))
    toast.success(cancel ? 'Registration cancelled' : 'Registration reopened')
    await done()
  }

  if (reg.status === 'cancelled') {
    return (
      <Button variant="secondary" className="mt-4" onClick={() => setCancelled(false)}>
        Reopen registration
      </Button>
    )
  }

  return (
    <div className="mt-4 space-y-3">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Edit registration
          </Button>
          <Button variant="danger-ghost" onClick={() => setCancelled(true)}>
            Cancel registration
          </Button>
        </div>
      ) : (
        <Card className="space-y-4 p-4">
          <p className="font-semibold">Edit on the member’s behalf</p>
          {(tickets ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{t.label}</p>
                <p className="text-sm text-muted">{formatPaise(t.price_paise)}</p>
              </div>
              <Stepper value={qty[t.id] ?? 0} max={t.max_per_registration} onChange={(v) => setQty((q) => ({ ...q, [t.id]: v }))} label={t.label} />
            </div>
          ))}
          <p className="text-sm">
            New total <strong>{formatPaise(total)}</strong> (was {formatPaise(reg.amount_paise)})
          </p>
          {total > reg.amount_paise && reg.status !== 'pending_payment' && (
            <Notice tone="warning" title="The member will owe the difference">The registration goes back to “payment pending” until the balance is paid.</Notice>
          )}
          <ChoiceGroup label="Food" columns={3} options={FOOD_PREFS} value={(food || null) as never} onChange={(v) => setFood(v)} />
          <Field label="T-shirt">
            {(p) => (
              <Select {...p} value={tshirt} onChange={(e) => setTshirt(e.target.value)}>
                <option value="">—</option>
                {TSHIRT_SIZES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reunion Fund (₹)" hint="0 for none, otherwise ₹100 to ₹10,00,000. Changing it changes the amount due.">{(p) => <Input {...p} inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} />}</Field>
          <Field label="Feedback from the member" optional>{(p) => <Input {...p} value={feedback} maxLength={2000} onChange={(e) => setFeedback(e.target.value)} />}</Field>
          <Field label="Mobile">{(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="Reason for change" hint="Kept in the activity log.">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Called the desk: spouse also coming" />}</Field>
          <div className="flex gap-2">
            <Button loading={busy} onClick={save}>Save</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
