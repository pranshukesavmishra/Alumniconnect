import clsx from 'clsx'
import { BellRing, CalendarClock, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { audienceJson, describeAudience, emptyAudience, SEGMENTS, supportsTicketFilter, TEMPLATES, validateAudience, type AudienceDraft, type Segment } from '../../lib/audience'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, plural, relativeTime } from '../../lib/format'
import { useTicketTypes } from '../events/queries'
import { useMyProfile } from '../auth/AuthProvider'
import { useCancelMessage, useEventMessages, useMessagePreview, useReviewMessage, useSendMessage, sendDueMessages, type EventMessage } from './opsQueries'
import { useMemberViews } from './queries'

type Kind = 'announcement' | 'payment_reminder' | 'reminder'
const KIND_LABEL: Record<Kind, string> = { announcement: 'Announcement', payment_reminder: 'Payment reminder', reminder: 'Reminder' }

/** `datetime-local` value for "in 1 hour", in the organiser's own clock. */
function inAnHour(): string {
  const d = new Date(Date.now() + 3600_000)
  d.setMinutes(0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Organisers: message exactly the people who need it (by payment state, batch, city, ticket), now or later. Delivered as app notifications and push. */
export function AdminMessages({ eventId, isAdmin, canViews = isAdmin }: { eventId: string; isAdmin: boolean; canViews?: boolean }) {
  const messages = useEventMessages(eventId)
  const tickets = useTicketTypes(eventId)
  const views = useMemberViews(canViews)
  const send = useSendMessage(eventId)
  const cancel = useCancelMessage(eventId)
  const review = useReviewMessage(eventId)
  const { data: me } = useMyProfile()

  const [aud, setAud] = useState<AudienceDraft>(emptyAudience('registered'))
  const [kind, setKind] = useState<Kind>('announcement')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [sendAt, setSendAt] = useState(inAnHour)

  // Scheduled messages go out on their own (server clock); while an organiser has this tab open, also nudge it along.
  useEffect(() => {
    let off = false
    const run = () =>
      sendDueMessages()
        .then((n) => { if (n > 0 && !off) void messages.refetch() })
        .catch(() => undefined)
    void run()
    const t = setInterval(run, 60_000)
    return () => { off = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const problem = validateAudience(aud)
  const json = useMemo(() => audienceJson(aud), [aud])
  const [debounced, setDebounced] = useState(json)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(json), 300)
    return () => clearTimeout(t)
  }, [json])
  const preview = useMessagePreview(eventId, debounced, !problem)

  const ticketNames = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t.label])), [tickets.data])
  const viewNames = useMemo(() => new Map((views.data ?? []).map((v) => [v.id, v.name])), [views.data])
  const set = (patch: Partial<AudienceDraft>) => setAud((a) => ({ ...a, ...patch }))

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    setAud(emptyAudience(t.segment))
    setKind(t.kind)
    setTitle(t.title)
    setBody(t.body)
  }

  const count = preview.data?.count
  const sendAtIso = when === 'later' ? new Date(sendAt).toISOString() : null
  const ready = !problem && title.trim().length >= 3 && body.trim().length >= 3 && (when === 'now' || (sendAt && new Date(sendAt).getTime() > Date.now()))

  function submit() {
    if (!ready) return
    const who = count === undefined ? 'the audience' : plural(count, 'person', 'people')
    const final = `“${title.trim()}”\n${body.trim()}`
    const text = preview.data?.needs_approval
      ? `${final}\n\nThis goes to ${who}. Because that is more than ${preview.data.approval_over} people, a second admin must approve it before anyone receives it. Submit it for approval?`
      : when === 'now' ? `${final}\n\nSend this to ${who} now? It cannot be recalled.` : `${final}\n\nSchedule this for ${formatDateTime(sendAtIso)}? The audience is looked up again when it is sent.`
    if (!window.confirm(text)) return
    send.mutate(
      { kind, title: title.trim(), body: body.trim(), audience: json, sendAt: sendAtIso },
      {
        onSuccess: (m) => {
          toast.success(m.status === 'pending_approval' ? 'Saved. A second admin must approve it before it is sent.' : m.status === 'sent' ? `Sent to ${plural(m.recipient_count ?? 0, 'person', 'people')}.` : `Scheduled for ${formatDateTime(m.scheduled_for)}.`)
          setTitle('')
          setBody('')
          setWhen('now')
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-4">
        <SectionTitle>New message</SectionTitle>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Start from a template">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => applyTemplate(t.id)} className="min-h-11 shrink-0 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft">
              {t.label}
            </button>
          ))}
        </div>

        <Card className="space-y-4 p-4">
          <Field label="Who should get it?" hint={SEGMENTS.find((s) => s.value === aud.segment)?.hint}>
            {(p) => (
              <Select {...p} value={aud.segment} onChange={(e) => set({ segment: e.target.value as Segment })}>
                {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch from" optional>{(p) => <Input {...p} inputMode="numeric" maxLength={4} placeholder="2001" value={aud.batchFrom} onChange={(e) => set({ batchFrom: e.target.value })} />}</Field>
            <Field label="Batch to" optional>{(p) => <Input {...p} inputMode="numeric" maxLength={4} placeholder="2010" value={aud.batchTo} onChange={(e) => set({ batchTo: e.target.value })} />}</Field>
          </div>
          <Field label="City" optional>{(p) => <Input {...p} placeholder="e.g. Pune" maxLength={80} value={aud.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
          {supportsTicketFilter(aud.segment) && (tickets.data?.length ?? 0) > 0 && (
            <Field label="Ticket type" optional>
              {(p) => (
                <Select {...p} value={aud.ticketTypeId} onChange={(e) => set({ ticketTypeId: e.target.value })}>
                  <option value="">Any ticket</option>
                  {tickets.data!.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              )}
            </Field>
          )}
          {canViews && (views.data?.length ?? 0) > 0 && (
            <Field label="Only members in a saved view" optional hint="Saved views come from the Members screen. The list is fixed when you send or schedule.">
              {(p) => (
                <Select {...p} value={aud.viewId} onChange={(e) => set({ viewId: e.target.value })}>
                  <option value="">Any member</option>
                  {views.data!.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              )}
            </Field>
          )}

          <div aria-live="polite" data-testid="audience-preview">
            {problem ? (
              <Notice tone="warning" title={problem} />
            ) : preview.isError ? (
              <Notice tone="danger" title={friendlyError(preview.error)} />
            ) : count === undefined ? (
              <p className="text-sm text-muted">Counting…</p>
            ) : count === 0 ? (
              <Notice tone="warning" title="Nobody matches this audience right now" />
            ) : (
              <Notice tone="info" title={`This will reach ${plural(count, 'person', 'people')}`}>
                {preview.data!.sample.length > 0 && <>e.g. {preview.data!.sample.join(', ')}{count > preview.data!.sample.length ? ' …' : ''}</>}
              </Notice>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <ChoiceGroup<Kind>
            label="Type"
            columns={3}
            value={kind}
            onChange={setKind}
            options={[{ value: 'announcement', label: 'News' }, { value: 'payment_reminder', label: 'Payment' }, { value: 'reminder', label: 'Reminder' }]}
          />
          <Field label="Title" hint={`${title.trim().length}/60`}>{(p) => <Input {...p} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Message" hint={`${body.trim().length}/130. Shown in the notification, so keep it short.`}>
            {(p) => <Textarea {...p} maxLength={130} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <ChoiceGroup<'now' | 'later'>
            label="When"
            columns={2}
            value={when}
            onChange={setWhen}
            options={[{ value: 'now', label: 'Send now' }, { value: 'later', label: 'Schedule' }]}
          />
          {when === 'later' && (
            <Field label="Send at" hint="Your local time. The audience is checked again at that moment, so someone who has paid by then is not reminded.">
              {(p) => <Input {...p} type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
            </Field>
          )}
          {ready && (
            <div data-testid="message-preview" className="rounded-2xl border border-border bg-surface-2 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">How it will look</p>
              <p className="mt-1 font-semibold">{title.trim()}</p>
              <p className="text-[15px]">{body.trim()}</p>
              <p className="mt-1 text-xs text-muted">{count === undefined ? 'Counting…' : `To ${plural(count, 'person', 'people')}`}{when === 'later' ? `, ${formatDateTime(sendAtIso)}` : ''}</p>
            </div>
          )}
          {preview.data?.needs_approval && (
            <Notice tone="warning" title={`More than ${preview.data.approval_over} people`}>A second admin must approve this message before anyone receives it.</Notice>
          )}
          <Button block size="lg" loading={send.isPending} disabled={!ready || count === 0} icon={when === 'now' ? <Send className="size-5" /> : <CalendarClock className="size-5" />} onClick={submit}>
            {preview.data?.needs_approval ? 'Submit for approval' : when === 'now' ? (count ? `Send to ${plural(count, 'person', 'people')}` : 'Send') : 'Schedule message'}
          </Button>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Sent and scheduled</SectionTitle>
        {messages.isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : messages.isError ? (
          <Notice tone="danger" title={friendlyError(messages.error)} />
        ) : !messages.data?.length ? (
          <EmptyState icon={<BellRing />} title="No messages yet">Messages you send here appear in each person’s notifications (and as a push if they turned it on).</EmptyState>
        ) : (
          <ul className="space-y-3">
            {messages.data.map((m) => (
              <MessageCard key={m.id} m={m} ticketNames={ticketNames} viewNames={viewNames}
                canReview={isAdmin && m.status === 'pending_approval' && m.created_by !== me?.id}
                onReview={(approve) => {
                  if (!window.confirm(approve ? `Approve “${m.title}”? It goes out to the whole audience now.` : `Reject “${m.title}”? It will never be sent.`)) return
                  review.mutate({ id: m.id, approve }, { onSuccess: () => toast.success(approve ? 'Approved and sent' : 'Rejected'), onError: (e) => toast.error(friendlyError(e)) })
                }}
                onCancel={() => {
                if (!window.confirm(`Cancel “${m.title}”? It will not be sent.`)) return
                cancel.mutate(m.id, { onSuccess: () => toast.success('Cancelled'), onError: (e) => toast.error(friendlyError(e)) })
              }} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MessageCard({ m, ticketNames, viewNames, onCancel, canReview, onReview }: { m: EventMessage; ticketNames: Map<string, string>; viewNames: Map<string, string>; onCancel: () => void; canReview: boolean; onReview: (approve: boolean) => void }) {
  const tone = m.status === 'sent' ? 'success' : m.status === 'scheduled' || m.status === 'pending_approval' ? 'accent' : 'neutral'
  return (
    <li>
      <Card className={clsx('space-y-2 p-4', m.status === 'cancelled' && 'opacity-70')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{m.title}</p>
            <p className="text-sm text-muted">{KIND_LABEL[m.kind]} · {describeAudience(m.audience, { tickets: ticketNames, views: viewNames })}</p>
          </div>
          <Badge tone={tone}>
            {m.status === 'sent' ? `Sent to ${m.recipient_count ?? 0}` : m.status === 'scheduled' ? `Scheduled ${formatDateTime(m.scheduled_for)}` : m.status === 'sending' ? 'Sending…' : m.status === 'pending_approval' ? 'Waiting for a second admin' : m.status === 'rejected' ? 'Rejected' : 'Cancelled'}
          </Badge>
        </div>
        <p className="text-[15px]">{m.body}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>{m.author?.full_name ?? 'An organiser'} · {relativeTime(m.status === 'sent' && m.sent_at ? m.sent_at : m.created_at)}</span>
          {canReview && (
            <span className="flex gap-2">
              <Button size="sm" onClick={() => onReview(true)}>Approve</Button>
              <Button size="sm" variant="danger-ghost" onClick={() => onReview(false)}>Reject</Button>
            </span>
          )}
          {(m.status === 'scheduled' || m.status === 'pending_approval') && !canReview && (
            <Button size="sm" variant="danger-ghost" icon={<X className="size-4" />} onClick={onCancel} aria-label={`Cancel ${m.title}`}>
              Cancel
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}
