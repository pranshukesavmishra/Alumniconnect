import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hourglass } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { Stepper } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

interface Mine {
  status: 'waiting' | 'offered' | 'expired'
  headcount: number
  position: number
  offered_at: string | null
}

/** Shown on the event page when every place is taken: join the waiting list, see your place in line, or take an offered place. */
export function WaitlistCard({ eventId }: { eventId: string }) {
  const uid = useUserId()
  const qc = useQueryClient()
  const [heads, setHeads] = useState(1)
  const seats = useQuery({
    queryKey: ['event-seats', eventId],
    enabled: !!uid,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('event_seats_left', { p_event: eventId })
      if (error) throw error
      return data as number | null
    },
  })
  const mine = useQuery({
    queryKey: ['my-waitlist', eventId, uid],
    enabled: !!uid,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_waitlist', { p_event: eventId })
      if (error) throw error
      return (data ?? null) as Mine | null
    },
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-waitlist', eventId, uid] })
    void qc.invalidateQueries({ queryKey: ['event-seats', eventId] })
  }
  const join = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('join_waitlist', { p_event: eventId, p_headcount: heads })
      if (error) throw error
    },
    onSuccess: () => { toast.success('You are on the waiting list. We will tell you if a place opens up.'); refresh() },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_waitlist', { p_event: eventId })
      if (error) throw error
    },
    onSuccess: () => { toast.success('You left the waiting list'); refresh() },
    onError: (e) => toast.error(friendlyError(e)),
  })

  const m = mine.data
  const offered = m?.status === 'offered'
  if (!uid || seats.data === undefined || seats.data === null) return null
  if (seats.data > 0 && !offered) return null

  if (offered) {
    return (
      <Card className="space-y-3 border-success p-4" data-testid="waitlist-card">
        <Notice tone="success" title="A place is being held for you">Register within 48 hours of the message. Places go to whoever completes registration first.</Notice>
        <ButtonLink to="/meet/register" block size="lg">Register now</ButtonLink>
      </Card>
    )
  }
  if (m && m.status === 'waiting') {
    return (
      <Card className="space-y-3 p-4" data-testid="waitlist-card">
        <p className="flex items-center gap-2 font-semibold"><Hourglass className="size-5 text-primary" aria-hidden /> You are on the waiting list</p>
        <p className="text-[15px] text-muted">You are number <strong className="text-text">{m.position}</strong> in line for {m.headcount === 1 ? '1 place' : `${m.headcount} places`}. We will send you a notification if one opens up.</p>
        <Button variant="secondary" loading={leave.isPending} onClick={() => leave.mutate()}>Leave the waiting list</Button>
      </Card>
    )
  }
  return (
    <Card className="space-y-3 p-4" data-testid="waitlist-card">
      <p className="flex items-center gap-2 font-semibold"><Hourglass className="size-5 text-primary" aria-hidden /> All places are taken</p>
      <p className="text-[15px] text-muted">{m?.status === 'expired' ? 'Your earlier offer ran out. ' : ''}Join the waiting list and we will tell you if someone cancels.</p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">How many places do you need?</span>
        <Stepper value={heads} min={1} max={10} onChange={setHeads} label="places" />
      </div>
      <Button block loading={join.isPending} onClick={() => join.mutate()}>Join the waiting list</Button>
    </Card>
  )
}
