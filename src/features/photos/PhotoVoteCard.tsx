import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Trophy, Vote } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card } from '../../components/ui/Display'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { formatDateTime } from '../../lib/format'
import { publicUrl, supabase } from '../../lib/supabase'
import { photoError, useCurrentVote } from './api'

/** The best-photo vote: open for a while, one vote per member, the winner announced when it closes. */
export function PhotoVoteCard({ eventId, manager }: { eventId: string; manager: boolean }) {
  const tx = useT()
  const qc = useQueryClient()
  const { data: vote } = useCurrentVote(eventId)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!vote) return null
  const refresh = () => qc.invalidateQueries({ queryKey: ['photo-vote', eventId] })
  const winner = vote.candidates.find((c) => c.id === vote.winner)

  async function cast() {
    if (!pick) return
    setBusy(true)
    const { error } = await supabase.rpc('cast_photo_vote', { p_vote: vote!.id, p_photo: pick })
    setBusy(false)
    if (error) {
      void refresh()
      return toast.error(photoError(error))
    }
    toast.success(tx('photos.voteThanks'))
    setOpen(false)
    void refresh()
  }
  async function close() {
    if (!window.confirm(tx('photos.confirmCloseVote'))) return
    const { error } = await supabase.rpc('admin_close_photo_vote', { p_vote: vote!.id })
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.voteClosed'))
    void refresh()
  }

  return (
    <Card className="space-y-3 border-accent/50 bg-accent-soft p-4" aria-label={tx('photos.voteHeading')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">{vote.closed ? <Trophy className="size-4" aria-hidden /> : <Vote className="size-4" aria-hidden />}{vote.closed ? tx('photos.voteResult') : tx('photos.voteHeading')}</p>
          <p className="mt-0.5 font-bold">{vote.title}</p>
          {!vote.closed && <p className="text-sm text-muted">{tx('photos.voteCloses', { when: formatDateTime(vote.closes_at) })}</p>}
        </div>
        {manager && !vote.closed && <Button size="sm" variant="secondary" onClick={close}>{tx('photos.closeVote')}</Button>}
      </div>
      {vote.closed ? (
        winner ? (
          <div className="flex items-center gap-3">
            <img src={publicUrl('event-photos', winner.thumb_path) ?? ''} alt={winner.alt ?? ''} className="size-20 rounded-xl object-cover" />
            <p className="text-sm"><Badge tone="success">{tx('photos.winner')}</Badge><span className="mt-1 block text-muted">{tx('photos.voteCount', { count: winner.votes ?? 0, total: vote.total ?? 0 })}</span></p>
          </div>
        ) : (
          <p className="text-sm text-muted">{tx('photos.noWinner')}</p>
        )
      ) : vote.my_vote ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-success"><Check className="size-4" aria-hidden />{tx('photos.youVoted')}</p>
      ) : (
        <Button onClick={() => setOpen(true)} icon={<Vote className="size-4" />}>{tx('photos.voteNow')}</Button>
      )}
      {manager && !vote.closed && <p className="text-sm text-muted">{tx('photos.votesSoFar', { count: vote.total ?? 0 })}</p>}
      <Sheet open={open} onClose={() => setOpen(false)} label={tx('photos.voteHeading')}>
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-bold">{vote.title}</h2>
          <p className="text-sm text-muted">{tx('photos.voteOne')}</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tx('photos.voteHeading')}>
            {vote.candidates.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} aria-label={c.alt ?? tx('photos.photo')} data-candidate={c.id} onClick={() => setPick(c.id)} className={clsx('relative aspect-square overflow-hidden rounded-xl border-2', pick === c.id ? 'border-primary' : 'border-transparent')}>
                <img src={publicUrl('event-photos', c.thumb_path) ?? ''} alt="" className="size-full object-cover" />
                {pick === c.id && <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-primary text-on-primary"><Check className="size-4" /></span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button block variant="secondary" onClick={() => setOpen(false)}>{tx('common.cancel')}</Button>
            <Button block loading={busy} disabled={!pick} onClick={cast}>{tx('photos.castVote')}</Button>
          </div>
        </div>
      </Sheet>
    </Card>
  )
}
