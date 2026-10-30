// "We found your details from the reunion list. Is this you?" One tap fills the empty profile fields.
import { ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, KeyValue, Notice } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { useT } from '../../i18n'
import { useClaimPrefill, useDismissPrefill, type PrefillMatch } from './queries'

export function PrefillClaimCard({ match, phone, name, onClaimed }: { match: PrefillMatch; phone?: string | null; name?: string | null; onClaimed?: (filled: string[]) => void }) {
  const tx = useT()
  const claim = useClaimPrefill()
  const dismiss = useDismissPrefill()
  const role = [match.designation, match.organisation].filter(Boolean).join(', ')
  return (
    <Card className="space-y-3 border-primary/40 p-4" data-testid="prefill-claim">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <p className="font-semibold leading-snug">{tx('qp.claimTitle')}</p>
      </div>
      <div className="space-y-1 rounded-xl bg-surface-2 p-3 text-[15px]">
        <p className="break-words text-lg font-bold">{match.full_name}</p>
        {(match.grad_year || match.branch) && <p className="break-words text-muted">{[match.grad_year ? tx('qp.claimBatch', { year: match.grad_year }) : null, match.branch].filter(Boolean).join(' · ')}</p>}
        {role && <KeyValue label={tx('qp.field.current_title')}>{role}</KeyValue>}
        {match.city && <KeyValue label={tx('qp.field.city')}>{[match.city, match.country].filter(Boolean).join(', ')}</KeyValue>}
      </div>
      {(claim.error || dismiss.error) && <Notice tone="danger" title={friendlyError(claim.error ?? dismiss.error)} />}
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-[2fr_1fr]">
        <Button
          size="lg"
          loading={claim.isPending}
          onClick={() =>
            claim.mutate(
              { id: match.id, phone: match.match_kind === 'phone' ? phone : null, name: match.match_kind === 'phone' ? name : null },
              {
                onSuccess: (filled) => {
                  toast.success(tx('qp.claimDone'))
                  onClaimed?.(filled)
                },
              },
            )
          }
        >
          {tx('qp.claimYes')}
        </Button>
        <Button size="lg" variant="secondary" loading={dismiss.isPending} onClick={() => dismiss.mutate(match.id)}>
          {tx('qp.claimNo')}
        </Button>
      </div>
    </Card>
  )
}
