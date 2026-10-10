import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Card, Notice, Skeleton } from '../../../components/ui/Display'
import { Field, Input, Textarea } from '../../../components/ui/Form'
import { friendlyError } from '../../../lib/errors'
import { admin, useAdminSettings } from '../api'
import { useRunner } from './util'

export function FundsSettings() {
  const { data, isLoading, error } = useAdminSettings()
  const { run, busy } = useRunner()
  const [f, setF] = useState({ default_upi_id: '', payee_name: '', assoc_name: '', assoc_details: '', receipt_footer: '', tax_text: '', foreign_notice: '' })
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (data && !loaded) {
      setF({ default_upi_id: data.default_upi_id ?? '', payee_name: data.payee_name ?? '', assoc_name: data.assoc_name ?? '', assoc_details: data.assoc_details ?? '', receipt_footer: data.receipt_footer ?? '', tax_text: data.tax_text ?? '', foreign_notice: data.foreign_notice ?? '' })
      setLoaded(true)
    }
  }, [data, loaded])
  if (isLoading) return <Skeleton className="h-40" />
  if (error) return <Notice tone="danger" title={friendlyError(error)} />
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  return (
    <Card className="space-y-4 p-4" aria-label="Fund settings">
      <Field label="Default UPI id" hint="Used by every appeal that has no UPI id of its own. Money goes straight to this account.">{(p) => <Input {...p} autoCapitalize="none" value={f.default_upi_id} onChange={(e) => set('default_upi_id', e.target.value)} data-testid="s-upi" />}</Field>
      <Field label="Payee name" hint="Shown in the donor’s UPI app (up to 50 letters).">{(p) => <Input {...p} maxLength={50} value={f.payee_name} onChange={(e) => set('payee_name', e.target.value)} data-testid="s-payee" />}</Field>
      <Field label="Association name (receipts)">{(p) => <Input {...p} maxLength={120} value={f.assoc_name} onChange={(e) => set('assoc_name', e.target.value)} data-testid="s-assoc" />}</Field>
      <Field label="Association details (receipts)" optional hint="Address, registration number, PAN…">{(p) => <Textarea {...p} rows={3} maxLength={600} value={f.assoc_details} onChange={(e) => set('assoc_details', e.target.value)} />}</Field>
      <Field label="Receipt footer" optional>{(p) => <Textarea {...p} rows={2} maxLength={600} value={f.receipt_footer} onChange={(e) => set('receipt_footer', e.target.value)} data-testid="s-footer" />}</Field>
      <Field label="Tax-exemption text" optional hint="Shown on receipts only if you fill it in. Enter it only when the association really holds the certificate (for example 80G).">{(p) => <Textarea {...p} rows={3} maxLength={600} value={f.tax_text} onChange={(e) => set('tax_text', e.target.value)} data-testid="s-tax" />}</Field>
      <Field label="Notice for donors abroad" optional hint="Shown in the give flow and on receipts. Foreign-contribution rules are the committee’s legal responsibility.">{(p) => <Textarea {...p} rows={3} maxLength={600} value={f.foreign_notice} onChange={(e) => set('foreign_notice', e.target.value)} data-testid="s-foreign" />}</Field>
      <Button block loading={busy} data-testid="s-save" onClick={() => run(() => admin.saveSettings(f), 'Settings saved.')}>Save settings</Button>
      <Button block variant="secondary" loading={busy} onClick={() => run(() => admin.runReminders(), 'Reminders sent.')}>Send due reminders now</Button>
    </Card>
  )
}
