// People -> a registration: its advance paid before the app. Apply one by hand when automatic matching found none or
// more than one, take a wrong one off again, or mark "not a match". Every action is in the activity log.
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, Notice } from '../../components/ui/Display'
import { Field, Input, Select } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import type { Registration } from '../../lib/types'
import { useAdvanceCandidates, useAdvanceCredits, useApplyAdvanceCredit, useDismissAdvanceReview, useRemoveAdvanceCredit, type AdvanceCredit } from './advanceQueries'

const MATCH_LABEL: Record<string, string> = { phone: 'Same mobile number', email: 'Same email', name: 'Same name, batch and branch' }

export function AdvancePanel({ reg, canWrite }: { reg: Registration; canWrite: boolean }) {
  const list = useAdvanceCredits(reg.event_id)
  const advance = reg.advance_paise ?? 0
  const candidates = useAdvanceCandidates(reg.id, advance === 0 && reg.status !== 'cancelled')
  const apply = useApplyAdvanceCredit(reg.event_id)
  const remove = useRemoveAdvanceCredit(reg.event_id)
  const dismiss = useDismissAdvanceReview(reg.event_id)
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')

  const credits = list.data?.credits ?? []
  const mine = credits.find((c) => c.registration_id === reg.id && c.status === 'claimed')
  const open = credits.filter((c) => c.status === 'open')
  const suggested = (candidates.data ?? []).map((m) => ({ c: open.find((c) => c.id === m.id), match: m.match })).filter((x): x is { c: AdvanceCredit; match: 'phone' | 'email' | 'name' } => !!x.c)
  const hasAny = advance > 0 || reg.advance_review || suggested.length > 0
  if (!hasAny && !canWrite) return null
  if (!hasAny && open.length === 0) return null

  function doApply(c: AdvanceCredit) {
    if (!window.confirm(`Apply the advance of ${formatPaise(c.amount_paise)} paid by ${c.full_name} to ${reg.full_name} (${reg.code})?`)) return
    apply.mutate({ registrationId: reg.id, creditId: c.id, reason: reason.trim() || null }, {
      onSuccess: () => { toast.success('Advance applied'); setPick(''); setReason('') },
      onError: (e) => toast.error(friendlyError(e)),
    })
  }
  function doRemove() {
    if (reason.trim().length < 3) return toast.error('Please give a reason (it is kept in the activity log).')
    remove.mutate({ registrationId: reg.id, reason: reason.trim() }, {
      onSuccess: () => { toast.success('Advance removed. It is open again for the right person.'); setReason('') },
      onError: (e) => toast.error(friendlyError(e)),
    })
  }
  const describe = (c: AdvanceCredit) => `${c.full_name} · ${[c.grad_year, c.branch].filter(Boolean).join(' ')} · ${[c.phone_masked, c.email_masked].filter(Boolean).join(' · ')} · ${formatPaise(c.amount_paise)}`

  return (
    <Card className="mt-4 space-y-3 p-4" data-testid="advance-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Advance paid before the app</p>
        {advance > 0 && <Badge tone="success">{`Advance (offline) ${formatPaise(advance)}`}</Badge>}
      </div>
      {reg.advance_review && advance === 0 && (
        <Notice tone="warning" title="Needs review: possible advance match">More than one advance on the list could belong to this person, so none was applied. Pick the right one, or mark it as not a match.</Notice>
      )}
      {advance > 0 && mine && (
        <p className="text-sm text-muted">{describe(mine)}</p>
      )}
      {advance === 0 && suggested.length > 0 && (
        <ul className="space-y-2">
          {suggested.map(({ c, match }) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
              <span className="min-w-0">
                <span className="block break-words font-semibold">{describe(c)}</span>
                <span className="block text-muted">{MATCH_LABEL[match]}</span>
              </span>
              {canWrite && <Button size="sm" loading={apply.isPending} onClick={() => doApply(c)}>Apply advance</Button>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && advance === 0 && reg.status !== 'cancelled' && open.length > 0 && (
        <div className="space-y-2">
          <Field label="Or choose any advance on the list" optional>
            {(p) => (
              <Select {...p} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">—</option>
                {open.map((c) => <option key={c.id} value={c.id}>{describe(c)}</option>)}
              </Select>
            )}
          </Field>
          {pick && <Button size="sm" variant="secondary" loading={apply.isPending} onClick={() => { const c = open.find((x) => x.id === pick); if (c) doApply(c) }}>Apply advance</Button>}
        </div>
      )}
      {canWrite && (advance > 0 || reg.advance_review) && (
        <Field label="Reason (kept in the activity log)" optional={advance === 0}>{(p) => <Input {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {advance > 0 && <Button size="sm" variant="secondary" loading={remove.isPending} onClick={doRemove}>Remove advance</Button>}
          {advance === 0 && reg.advance_review && (
            <Button size="sm" variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate(reg.id, { onSuccess: () => toast.success('Marked as not a match'), onError: (e) => toast.error(friendlyError(e)) })}>
              Not a match
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
