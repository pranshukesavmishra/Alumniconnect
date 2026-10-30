// "Invite your batch": a ready message for the batch's WhatsApp group. The link carries ?batch=YEAR, which prefills the batch
// on the new member's welcome page (batchInvite.ts). No registration counts are shown or collected.
import { Share2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Display'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { useT } from '../../i18n'

export function InviteBatch({ year, className }: { year: number; className?: string }) {
  const tx = useT()
  const url = `${window.location.origin}/?batch=${year}`
  const message = tx('iv.message', { year, url })
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <Card className={`flex flex-wrap items-center gap-3 p-4 ${className ?? ''}`} data-testid="invite-batch">
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-bold">{tx('iv.title')}</p>
        <p className="text-sm text-muted">{tx('iv.body', { year })}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          data-testid="invite-whatsapp"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover"
        >
          <WhatsAppIcon className="size-4" aria-hidden /> {tx('iv.whatsapp')}
        </a>
        {canShare && (
          <Button size="sm" variant="secondary" icon={<Share2 className="size-4" />} onClick={() => void navigator.share({ text: message }).catch(() => undefined)}>
            {tx('iv.share')}
          </Button>
        )}
      </div>
    </Card>
  )
}
