// For the verification queue: "LinkedIn shows JEC 2004–2008, Mechanical" with a one-tap Approve.
// Renders nothing for admins without the verify permission or when there is nothing to review.
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, Notice } from '../../components/ui/Display'
import { Switch } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { useT } from '../../i18n'
import { useAdminAccess } from '../admin/access'
import { useAutoVerifyFlag, useReviewHint, useVerificationHints } from './enrichQueries'

export function VerificationHints() {
  const tx = useT()
  const { can, isSuper } = useAdminAccess()
  const allowed = can('members_verify')
  const hints = useVerificationHints(allowed)
  const review = useReviewHint()
  const { flag, set } = useAutoVerifyFlag(allowed && isSuper)
  if (!allowed || (!hints.data?.length && !isSuper)) return null
  return (
    <Card className="space-y-3 p-4" data-testid="linkedin-hints">
      <h2 className="font-bold">{tx('qp.hint.title')}</h2>
      {hints.error && <Notice tone="danger" title={friendlyError(hints.error)} />}
      {(hints.data ?? []).map((h) => {
        const details = [[h.start_year, h.end_year].filter(Boolean).join('–'), h.branch ?? h.field].filter(Boolean).join(', ')
        return (
          <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3" data-hint={h.user_id}>
            <Avatar src={h.avatar_url} name={h.full_name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold">{h.full_name}</p>
              <p className="break-words text-sm text-muted">{tx('qp.hint.line', { school: h.school, details: details || '–' })}</p>
            </div>
            {h.linkedin_url && (
              <a href={h.linkedin_url} target="_blank" rel="noreferrer" className="grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label={tx('qp.hint.open', { name: h.full_name })}>
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="min-h-11"
                aria-label={tx('qp.hint.approveAria', { name: h.full_name })}
                loading={review.isPending && review.variables?.id === h.id && review.variables.approve}
                onClick={() => review.mutate({ id: h.id, approve: true }, { onSuccess: () => toast.success(tx('qp.hint.approved')), onError: (e) => toast.error(friendlyError(e)) })}
              >
                {tx('qp.hint.approve')}
              </Button>
              <Button size="sm" variant="secondary" className="min-h-11" aria-label={tx('qp.hint.dismissAria', { name: h.full_name })} onClick={() => review.mutate({ id: h.id, approve: false })}>
                {tx('qp.hint.dismiss')}
              </Button>
            </div>
          </div>
        )
      })}
      {isSuper && flag.data !== undefined && (
        <div className="border-t border-border pt-3">
          <Switch checked={flag.data} onChange={(on: boolean) => set.mutate(on, { onError: (e) => toast.error(friendlyError(e)) })} label={tx('qp.hint.auto')} />
          <p className="mt-1 text-sm text-muted">{tx('qp.hint.autoHint')}</p>
        </div>
      )}
    </Card>
  )
}
