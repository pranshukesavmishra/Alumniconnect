import { ExternalLink, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Card, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { friendlyError } from '../../../lib/errors'
import { formatDate } from '../../../lib/format'
import { formatPaise } from '../../../lib/money'
import { useAdminAccess } from '../../admin/access'
import { admin, coverUrl, uploadGivingImage, useAdminCampaigns, useAdminEvents, useAdminExpenses, type Expense } from '../api'
import { money, todayIst, useRunner } from './util'

function ExpenseSheet({ e, onClose }: { e: Expense | null; onClose: () => void }) {
  const campaigns = useAdminCampaigns()
  const events = useAdminEvents()
  const { run, busy } = useRunner()
  const [scope, setScope] = useState(e?.campaign_id ? `c:${e.campaign_id}` : e?.event_id ? `e:${e.event_id}` : '')
  const [desc, setDesc] = useState(e?.description ?? '')
  const [amount, setAmount] = useState(e ? String(e.amount_paise / 100) : '')
  const [date, setDate] = useState(e?.spent_on ?? todayIst())
  const [receipt, setReceipt] = useState(e?.receipt_path ?? '')
  const [up, setUp] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    const a = money(amount, 'The amount', { min: 100 })
    if (a.error) return setErr(a.error)
    setErr(null)
    const ok = await run(() => admin.saveExpense(e?.id ?? null, { campaign_id: scope.startsWith('c:') ? scope.slice(2) : null, event_id: scope.startsWith('e:') ? scope.slice(2) : null, description: desc, amount_paise: a.paise, spent_on: date, receipt_path: receipt || null }), 'Expense saved.')
    if (ok) onClose()
  }
  return (
    <Sheet open onClose={onClose} label="Expense">
      <div className="space-y-4 p-5" data-testid="expense-sheet">
        <h2 className="text-lg font-bold">{e ? 'Edit expense' : 'Add an expense'}</h2>
        <Field label="Spent on" hint="Choose an appeal or an event, or leave empty for general costs.">
          {(p) => (
            <Select {...p} value={scope} onChange={(x) => setScope(x.target.value)} data-testid="exp-scope">
              <option value="">General</option>
              {(campaigns.data ?? []).map((c) => <option key={c.id} value={`c:${c.id}`}>{c.title}</option>)}
              {(events.data ?? []).map((ev) => <option key={ev.id} value={`e:${ev.id}`}>Event: {ev.title}</option>)}
            </Select>
          )}
        </Field>
        <Field label="What was it for?">{(p) => <Textarea {...p} rows={2} maxLength={300} value={desc} onChange={(x) => setDesc(x.target.value)} data-testid="exp-desc" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} data-testid="exp-amount" />}</Field>
          <Field label="Date">{(p) => <Input {...p} type="date" max={todayIst()} value={date} onChange={(x) => setDate(x.target.value)} />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary">
            <ImagePlus className="size-4" aria-hidden /> {up ? 'Uploading…' : receipt ? 'Change bill photo' : 'Add a bill or receipt photo'}
            <input type="file" accept="image/*" className="sr-only" data-testid="exp-file" disabled={up}
              onChange={async (x) => { const f = x.target.files?.[0]; x.target.value = ''; if (!f) return; setUp(true); try { setReceipt(await uploadGivingImage(f)) } catch (er) { toast.error(friendlyError(er)) } finally { setUp(false) } }} />
          </label>
          {receipt && <img src={coverUrl(receipt) ?? ''} alt="" className="h-11 w-11 rounded-lg object-cover" />}
        </div>
        {err && <Notice tone="danger" title={err} />}
        <Button block loading={busy} onClick={save} data-testid="exp-save">Save expense</Button>
      </div>
    </Sheet>
  )
}

export function FundsExpenses() {
  const { can } = useAdminAccess()
  const { data, isLoading, error } = useAdminExpenses()
  const { run } = useRunner()
  const [edit, setEdit] = useState<Expense | 'new' | null>(null)
  const manage = can('funds_manage')
  return (
    <section className="space-y-3" aria-label="Where the money went">
      <p className="text-sm text-muted">Everything entered here is shown to members on “Where the money went”.</p>
      {manage && <Button icon={<Plus className="size-4" />} onClick={() => setEdit('new')} data-testid="add-expense">Add an expense</Button>}
      {error && <Notice tone="danger" title={friendlyError(error)} />}
      {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <EmptyState title="No expenses yet" /> : (
        <Card className="divide-y divide-border">
          {data.map((x) => (
            <div key={x.id} className="flex items-start gap-3 p-3.5" data-testid="exp-row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{x.description}</p>
                <p className="text-sm text-muted">{formatDate(x.spent_on)}{x.campaign_title ? ` · ${x.campaign_title}` : ''}</p>
                {x.receipt_path && <a href={coverUrl(x.receipt_path) ?? '#'} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary"><ExternalLink className="size-4" aria-hidden /> Bill</a>}
              </div>
              <b className="tabular-nums">{formatPaise(x.amount_paise, { zeroAsFree: false })}</b>
              {manage && <>
                <Button size="sm" variant="ghost" aria-label="Edit expense" onClick={() => setEdit(x)}><Pencil className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete expense" onClick={() => { if (window.confirm('Delete this expense?')) void run(() => admin.deleteExpense(x.id), 'Expense deleted.') }}><Trash2 className="size-4" /></Button>
              </>}
            </div>
          ))}
        </Card>
      )}
      {edit && <ExpenseSheet e={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  )
}
