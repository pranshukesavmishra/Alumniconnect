import clsx from 'clsx'
import { Plus, Send, Trash2, UserMinus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Checkbox, Field, Input, Stepper } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { formatDate, plural, relativeTime } from '../../lib/format'
import type { EventRow } from '../../lib/types'
import { MemberPicker } from './MemberPicker'
import { useEventOps, useWaitlist, useWaitlistActions, type DayCapacity, type WaitlistEntry } from './opsQueries'

const STATUS: Record<WaitlistEntry['status'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'danger' }> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  offered: { label: 'Place offered', tone: 'accent' },
  registered: { label: 'Registered', tone: 'success' },
  expired: { label: 'Offer expired', tone: 'danger' },
}

/** Capacity, the waiting list for a full event, and how many people each day can take. */
export function AdminWaitlist({ event }: { event: EventRow }) {
  const wl = useWaitlist(event.id)
  const ops = useEventOps(event.id)
  const act = useWaitlistActions(event.id)
  const [adding, setAdding] = useState(false)
  const [heads, setHeads] = useState(1)

  if (wl.isLoading || ops.isLoading) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
  if (wl.error || !wl.data) return <Notice tone="danger" title={friendlyError(wl.error)} />
  const w = wl.data
  const waiting = w.entries.filter((e) => e.status === 'waiting' || e.status === 'offered' || e.status === 'expired')
  const done = w.entries.filter((e) => e.status === 'registered')

  function setAuto(v: boolean) {
    act.saveOps.mutate({ autoPromote: v, days: ops.data?.days ?? [] }, { onSuccess: () => toast.success(v ? 'Free places will be offered automatically' : 'Automatic offers switched off'), onError: (e) => toast.error(friendlyError(e)) })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center" data-testid="capacity-figures">
          <Card className="p-3"><p className="text-xs text-muted">Capacity</p><p className="text-xl font-bold tabular-nums">{w.capacity ?? 'None'}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">Places left</p><p className="text-xl font-bold tabular-nums" data-testid="seats-left">{w.seats_left ?? '—'}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">Free after offers</p><p className="text-xl font-bold tabular-nums">{w.free_after_offers ?? '—'}</p></Card>
        </div>
        {w.capacity === null && <Notice tone="info" title="This event has no capacity limit">Set a capacity under Settings and a waiting list starts working when it fills up.</Notice>}
        <Card className="space-y-3 p-4">
          <Checkbox checked={w.auto_promote} onChange={setAuto}>
            <span className="font-semibold">Offer free places automatically</span>
            <span className="block text-sm text-muted">When a registration is cancelled (or the capacity is raised), the next people in line who fit are told. Offers last 48 hours and hold their places.</span>
          </Checkbox>
          <Button variant="secondary" icon={<Send className="size-4" />} loading={act.run.isPending} onClick={() => act.run.mutate(undefined, {
            onSuccess: (n) => toast.success(n ? `${plural(n, 'person', 'people')} told about a free place` : 'No one to offer a place to right now'),
            onError: (e) => toast.error(friendlyError(e)),
          })}>
            Offer free places now
          </Button>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle action={<Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding((a) => !a)}>Add someone</Button>}>Waiting list</SectionTitle>
        {adding && (
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">How many places do they need?</p>
              <Stepper value={heads} min={1} max={20} onChange={setHeads} label="people" />
            </div>
            <MemberPicker actionLabel="Add" busy={act.add.isPending} onPick={(id, name) => act.add.mutate({ userId: id, headcount: heads }, { onSuccess: () => { toast.success(`${name} is on the waiting list`); setAdding(false) }, onError: (e) => toast.error(friendlyError(e)) })} />
          </Card>
        )}
        {waiting.length === 0 ? (
          <EmptyState icon={<UserMinus />} title="No one is waiting">Members can join the waiting list from the event page once all places are taken.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {waiting.map((e, i) => (
              <li key={e.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold"><span className="text-muted">{i + 1}.</span> {e.full_name}</p>
                      <p className="text-sm text-muted">{[e.branch, e.grad_year, e.city].filter(Boolean).join(' · ')} · needs {plural(e.headcount, 'place', 'places')} · joined {relativeTime(e.created_at)}</p>
                    </div>
                    <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" loading={act.promote.isPending && act.promote.variables === e.id} aria-label={`Offer a place to ${e.full_name}`} onClick={() => act.promote.mutate(e.id, { onSuccess: () => toast.success(`${e.full_name} was told a place is theirs`), onError: (er) => toast.error(friendlyError(er)) })}>
                      {e.status === 'waiting' ? 'Offer a place' : 'Offer again'}
                    </Button>
                    <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} aria-label={`Remove ${e.full_name} from the list`} onClick={() => {
                      if (!window.confirm(`Remove ${e.full_name} from the waiting list?`)) return
                      act.remove.mutate({ entryId: e.id, reason: '' }, { onSuccess: () => toast.success('Removed'), onError: (er) => toast.error(friendlyError(er)) })
                    }}>
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && <p className="text-sm text-muted">{plural(done.length, 'person', 'people')} from the list went on to register.</p>}
      </section>

      <DayCapacityEditor key={JSON.stringify(ops.data?.days ?? [])} event={event} days={ops.data?.days ?? []} auto={w.auto_promote} />
    </div>
  )
}

function DayCapacityEditor({ event, days, auto }: { event: EventRow; days: DayCapacity[]; auto: boolean }) {
  const act = useWaitlistActions(event.id)
  const [rows, setRows] = useState<{ day: string; capacity: string; label: string }[]>(days.map((d) => ({ day: d.day, capacity: String(d.capacity), label: d.label ?? '' })))
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  function addDay() {
    const last = rows.at(-1)?.day ?? event.starts_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
    const d = new Date(`${last}T00:00:00Z`)
    if (rows.length) d.setUTCDate(d.getUTCDate() + 1)
    setRows([...rows, { day: d.toISOString().slice(0, 10), capacity: String(event.capacity ?? 100), label: '' }])
  }

  function save() {
    const out: DayCapacity[] = []
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return toast.error('Every day needs a date.')
      if (!/^\d{1,6}$/.test(r.capacity) || Number(r.capacity) < 1) return toast.error('Every day needs a capacity of at least 1.')
      out.push({ day: r.day, capacity: Number(r.capacity), label: r.label.trim() || null })
    }
    if (new Set(out.map((d) => d.day)).size !== out.length) return toast.error('Each day can only be listed once.')
    act.saveOps.mutate({ autoPromote: auto, days: out }, { onSuccess: () => toast.success('Day limits saved'), onError: (e) => toast.error(friendlyError(e)) })
  }

  return (
    <section className="space-y-3" aria-label="Capacity per day">
      <SectionTitle action={<Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={addDay}>Add a day</Button>}>Capacity per day</SectionTitle>
      <p className="text-sm text-muted">How many people each day can take. Arrivals are shown against these limits on the Day-of tab, so the gate sees when a day is full.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No daily limits set.</p>
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 p-3 sm:grid-cols-[9rem_6rem_1fr_auto]">
              <Field label="Date">{(p) => <Input {...p} type="date" value={r.day} onChange={(e) => set(i, { day: e.target.value })} />}</Field>
              <Field label="People">{(p) => <Input {...p} inputMode="numeric" value={r.capacity} onChange={(e) => set(i, { capacity: e.target.value })} />}</Field>
              <Field label="Label" optional className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto">{(p) => <Input {...p} maxLength={40} placeholder="e.g. Saturday" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />}</Field>
              <button type="button" aria-label={`Remove ${formatDate(r.day)}`} className={clsx('grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
      <Button loading={act.saveOps.isPending} onClick={save}>Save day limits</Button>
    </section>
  )
}
