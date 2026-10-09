import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice, SectionTitle } from '../../components/ui/Display'
import { Field, Input, Textarea } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { clock, groupByDay, isoToIstInput, istInputToIso, useAnnouncements, useProgramme, type ProgrammeItem } from '../events/programme'

/** Organisers: build the day's programme and send announcements to everyone who registered. */
export function AdminProgramme({ eventId }: { eventId: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Announcements eventId={eventId} />
      <Programme eventId={eventId} />
    </div>
  )
}

function Announcements({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const { data } = useAnnouncements(eventId, true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const registered = useQuery({
    queryKey: ['announce-audience', eventId],
    queryFn: async () => {
      const { count, error } = await supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', eventId).neq('status', 'cancelled')
      if (error) throw error
      return count ?? 0
    },
  })
  const send = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault()
      if (title.trim().length < 3) throw new Error('Please add a short title.')
      if (body.trim().length < 3) throw new Error('Please write the announcement.')
      const { error } = await supabase.rpc('post_announcement', { p_event: eventId, p_title: title.trim(), p_body: body.trim(), p_pinned: pinned })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Sent to ${registered.data ?? 'everyone registered'}${registered.data ? ' people' : ''}.`)
      setTitle(''); setBody(''); setPinned(false)
      void qc.invalidateQueries({ queryKey: ['announcements', eventId] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const toggle = useMutation({
    mutationFn: async (a: { id: string; pinned: boolean }) => {
      const { error } = await supabase.from('event_announcements').update({ pinned: !a.pinned }).eq('id', a.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements', eventId] }),
    onError: (e) => toast.error(friendlyError(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements', eventId] }),
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <section>
      <SectionTitle>Announcements</SectionTitle>
      <Notice tone="info" title="Reaches everyone who registered">
        {registered.data ?? '…'} people get it in the app, and as a notification on phones where they turned notifications on. Cancelled registrations don’t.
      </Notice>
      <Card className="mt-3 p-4">
        <form onSubmit={send.mutate} className="space-y-4" noValidate>
          <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Parking and gate timings" />}</Field>
          <Field label="Message">{(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />}</Field>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-5 accent-[var(--primary)]" />
            Pin to the top of the Meet page
          </label>
          <Button type="submit" icon={<Megaphone className="size-4" />} loading={send.isPending}>Send announcement</Button>
        </form>
      </Card>
      {!!data?.length && (
        <Card className="mt-3 divide-y divide-border">
          {data.map((a) => (
            <div key={a.id} className="space-y-1 p-4">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">{a.pinned && <Pin className="mr-1 inline size-4 text-primary" aria-label="Pinned" />}{a.title}</p>
                <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-primary-soft hover:text-primary" aria-label={a.pinned ? `Unpin ${a.title}` : `Pin ${a.title}`} onClick={() => toggle.mutate(a)}>
                  <Pin className="size-4" />
                </button>
                <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${a.title}`} onClick={() => window.confirm('Delete this announcement? People who already received it keep their notification.') && remove.mutate(a.id)}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <p className="whitespace-pre-line text-[15px] text-muted">{a.body}</p>
              <p className="text-xs text-muted">{relativeTime(a.created_at)}</p>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}

const EMPTY = { starts: '', ends: '', title: '', venue: '', details: '' }

function Programme({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const { data } = useProgramme(eventId)
  const [f, setF] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['programme', eventId] })

  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault()
      const starts = istInputToIso(f.starts)
      const ends = f.ends ? istInputToIso(f.ends) : null
      if (f.title.trim().length < 2) throw new Error('Please enter the session name.')
      if (!starts) throw new Error('Please choose the start date and time.')
      if (f.ends && !ends) throw new Error('Please check the end time.')
      if (ends && ends <= starts) throw new Error('The end time must be after the start.')
      const row = { event_id: eventId, starts_at: starts, ends_at: ends, title: f.title.trim(), venue: f.venue.trim() || null, details: f.details.trim() || null }
      const { error } = editing ? await supabase.from('event_programme').update(row).eq('id', editing) : await supabase.from('event_programme').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(editing ? 'Session updated' : 'Session added')
      setF(EMPTY); setEditing(null); setOpen(false)
      void refresh()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_programme').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(friendlyError(e)),
  })
  function edit(it: ProgrammeItem) {
    setEditing(it.id)
    setF({ starts: isoToIstInput(it.starts_at), ends: isoToIstInput(it.ends_at), title: it.title, venue: it.venue ?? '', details: it.details ?? '' })
    setOpen(true)
  }

  return (
    <section>
      <SectionTitle action={!open && <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setF(EMPTY); setOpen(true) }}>Add session</Button>}>Programme</SectionTitle>
      <p className="mb-3 text-[15px] text-muted">Times are in Indian time. Everyone can see the programme on the Meet page.</p>
      {open && (
        <Card className="mb-3 p-4">
          <form onSubmit={save.mutate} className="space-y-4" noValidate>
            <Field label="Session">{(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={120} placeholder="e.g. Registration and tea" />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={f.starts} onChange={set('starts')} />}</Field>
              <Field label="Ends" optional>{(p) => <Input {...p} type="datetime-local" value={f.ends} onChange={set('ends')} />}</Field>
            </div>
            <Field label="Venue" optional>{(p) => <Input {...p} value={f.venue} onChange={set('venue')} maxLength={120} placeholder="e.g. Main auditorium" />}</Field>
            <Field label="Details" optional>{(p) => <Textarea {...p} value={f.details} onChange={set('details')} maxLength={1000} />}</Field>
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Add session'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setEditing(null); setF(EMPTY) }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      {!data?.length ? (
        !open && <p className="text-[15px] text-muted">No sessions yet. Add the day’s schedule so attendees know what to expect.</p>
      ) : (
        groupByDay(data).map((d) => (
          <div key={d.day} className="mb-4">
            <h3 className="mb-1 text-sm font-bold">{d.heading}</h3>
            <Card className="divide-y divide-border">
              {d.items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 p-3.5">
                  <p className="w-24 shrink-0 text-sm font-semibold tabular-nums">{clock(it.starts_at)}{it.ends_at ? <span className="block text-xs font-normal text-muted">to {clock(it.ends_at)}</span> : null}</p>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{it.title}</p>
                    {it.venue && <p className="truncate text-sm text-muted">{it.venue}</p>}
                  </div>
                  <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-primary-soft hover:text-primary" aria-label={`Edit ${it.title}`} onClick={() => edit(it)}>
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${it.title}`} onClick={() => window.confirm(`Delete “${it.title}”?`) && remove.mutate(it.id)}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </Card>
          </div>
        ))
      )}
    </section>
  )
}
