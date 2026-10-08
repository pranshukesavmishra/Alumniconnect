import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice, SectionTitle } from '../../components/ui/Display'
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Form'
import { MEET_SLUG } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import type { EventRow, TicketType } from '../../lib/types'
import { isValidUpiId } from '../../lib/upi'
import { useSaveEvent } from './queries'

/** ISO -> "2026-12-26T10:00" in India time, for <input type="datetime-local"> */
function toLocalIst(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 330 * 60_000)
  return d.toISOString().slice(0, 16)
}
/** "2026-12-26T10:00" entered in India time -> ISO */
function fromLocalIst(v: string): string | null {
  return v ? new Date(`${v}:00+05:30`).toISOString() : null
}

interface TicketDraft {
  id?: string
  label: string
  description: string
  price: string
  is_primary: boolean
  max: string
  _delete?: boolean
}

export function AdminSettings({ existing }: { existing?: { event: EventRow; tickets: TicketType[] } }) {
  const navigate = useNavigate()
  const save = useSaveEvent()
  const e = existing?.event
  const [f, setF] = useState({
    slug: e?.slug ?? MEET_SLUG,
    title: e?.title ?? 'JEC Alumni Meet 2026',
    tagline: e?.tagline ?? 'Batches 2001–2010',
    description: e?.description ?? '',
    venue: e?.venue ?? 'Jabalpur Engineering College, Jabalpur',
    venue_map_url: e?.venue_map_url ?? '',
    starts_at: toLocalIst(e?.starts_at ?? null),
    ends_at: toLocalIst(e?.ends_at ?? null),
    registration_closes_at: toLocalIst(e?.registration_closes_at ?? null),
    eligible_from_year: String(e?.eligible_from_year ?? 2001),
    eligible_to_year: String(e?.eligible_to_year ?? 2010),
    capacity: e?.capacity ? String(e.capacity) : '',
    upi_id: e?.upi_id ?? '',
    upi_payee_name: e?.upi_payee_name ?? '',
    payment_note: e?.payment_note ?? 'Pay the exact amount shown. Keep the 12-digit UPI reference (UTR) from your payment app.',
    contact_phone: e?.contact_phone ?? '',
    contact_email: e?.contact_email ?? '',
    is_published: e?.is_published ?? false,
  })
  const [tickets, setTickets] = useState<TicketDraft[]>(
    existing?.tickets.length
      ? existing.tickets.map((t) => ({ id: t.id, label: t.label, description: t.description ?? '', price: String(t.price_paise / 100), is_primary: t.is_primary, max: String(t.max_per_registration) }))
      : [
          { label: 'Alumnus / Alumna', description: '', price: '', is_primary: true, max: '1' },
          { label: 'Spouse', description: '', price: '', is_primary: false, max: '1' },
          { label: 'Child (5–12 years)', description: '', price: '', is_primary: false, max: '4' },
          { label: 'Child (under 5)', description: 'Free', price: '0', is_primary: false, max: '4' },
        ],
  )
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value }))
  const setT = (i: number, patch: Partial<TicketDraft>) => setTickets((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const live = tickets.filter((t) => !t._delete)

  function validate(): string[] {
    const errs: string[] = []
    if (!/^[a-z0-9-]{3,60}$/.test(f.slug)) errs.push('Web address name: use lowercase letters, numbers and dashes.')
    if (!f.title.trim()) errs.push('Title is required.')
    if (f.upi_id && !isValidUpiId(f.upi_id)) errs.push('UPI ID looks wrong (expected something like name@okicici).')
    if (f.upi_id && !f.upi_payee_name.trim()) errs.push('Enter the payee name exactly as UPI apps show it.')
    if (f.starts_at && f.ends_at && f.ends_at < f.starts_at) errs.push('The end date is before the start date.')
    if (live.filter((t) => t.is_primary).length < 1) errs.push('At least one main (alumnus) ticket is needed.')
    for (const t of live) {
      if (!t.label.trim()) errs.push('Every ticket needs a name.')
      if (parseRupeesToPaise(t.price) === null) errs.push(`Price for “${t.label || 'ticket'}” is not a valid amount.`)
      if (!(Number(t.max) >= 1 && Number(t.max) <= 20)) errs.push(`“${t.label}”: max per registration must be 1–20.`)
    }
    if (f.is_published && !f.upi_id && live.some((t) => (parseRupeesToPaise(t.price) ?? 0) > 0)) errs.push('Add the UPI ID before publishing an event with paid tickets.')
    return errs
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (errs.length) return window.scrollTo({ top: 0, behavior: 'smooth' })
    if (f.is_published && !e?.is_published && !window.confirm('Publish now? Members will be able to see the event and register.')) return
    const n = (v: string) => (v.trim() ? v.trim() : null)
    try {
      const id = await save.mutateAsync({
        event: {
          id: e?.id,
          slug: f.slug,
          title: f.title.trim(),
          tagline: n(f.tagline),
          description: n(f.description),
          venue: n(f.venue),
          venue_map_url: n(f.venue_map_url),
          starts_at: fromLocalIst(f.starts_at),
          ends_at: fromLocalIst(f.ends_at),
          registration_closes_at: fromLocalIst(f.registration_closes_at),
          eligible_from_year: f.eligible_from_year ? Number(f.eligible_from_year) : null,
          eligible_to_year: f.eligible_to_year ? Number(f.eligible_to_year) : null,
          capacity: f.capacity ? Number(f.capacity) : null,
          upi_id: n(f.upi_id),
          upi_payee_name: n(f.upi_payee_name),
          payment_note: n(f.payment_note),
          contact_phone: n(f.contact_phone),
          contact_email: n(f.contact_email),
          is_published: f.is_published,
        },
        tickets: tickets.map((t) => ({
          id: t.id,
          _delete: t._delete,
          label: t.label.trim(),
          description: n(t.description),
          price_paise: parseRupeesToPaise(t.price) ?? 0,
          is_primary: t.is_primary,
          max_per_registration: Number(t.max),
        })),
      })
      toast.success('Event saved')
      if (!e) navigate(`/admin/events/${f.slug}?tab=settings`, { replace: true })
      void id
    } catch {
      /* shown below */
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-2xl space-y-8">
      {errors.length > 0 && (
        <Notice tone="danger" title="Please fix these">
          <ul className="list-disc pl-5">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}
      {e?.is_published && (
        <Notice tone="warning" title="This event is live">
          Changing prices affects only new registrations. Existing registrations keep the price they registered with.
        </Notice>
      )}

      <section className="space-y-4">
        <SectionTitle>Event</SectionTitle>
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={120} />}</Field>
        <Field label="Tagline" optional>{(p) => <Input {...p} value={f.tagline} onChange={set('tagline')} maxLength={200} />}</Field>
        <Field label="Description / programme" optional>{(p) => <Textarea {...p} rows={6} value={f.description} onChange={set('description')} maxLength={5000} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts (India time)">{(p) => <Input {...p} type="datetime-local" value={f.starts_at} onChange={set('starts_at')} />}</Field>
          <Field label="Ends (India time)" optional>{(p) => <Input {...p} type="datetime-local" value={f.ends_at} onChange={set('ends_at')} />}</Field>
        </div>
        <Field label="Venue" optional>{(p) => <Input {...p} value={f.venue} onChange={set('venue')} maxLength={200} />}</Field>
        <Field label="Google Maps link" optional>{(p) => <Input {...p} inputMode="url" value={f.venue_map_url} onChange={set('venue_map_url')} />}</Field>
        {!e && (
          <Field label="Web address name" hint={`The event page will be at /${f.slug === MEET_SLUG ? 'meet' : `… (${f.slug})`}. Keep “${MEET_SLUG}” for the meet.`}>
            {(p) => <Input {...p} value={f.slug} onChange={set('slug')} />}
          </Field>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle>Registration</SectionTitle>
        <Field label="Registration closes (India time)" optional>{(p) => <Input {...p} type="datetime-local" value={f.registration_closes_at} onChange={set('registration_closes_at')} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Batches from" optional>{(p) => <Input {...p} inputMode="numeric" value={f.eligible_from_year} onChange={set('eligible_from_year')} />}</Field>
          <Field label="to" optional>{(p) => <Input {...p} inputMode="numeric" value={f.eligible_to_year} onChange={set('eligible_to_year')} />}</Field>
          <Field label="Max people" optional>{(p) => <Input {...p} inputMode="numeric" placeholder="No limit" value={f.capacity} onChange={set('capacity')} />}</Field>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          action={
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setTickets((t) => [...t, { label: '', description: '', price: '', is_primary: false, max: '1' }])}>
              Add ticket
            </Button>
          }
        >
          Fees
        </SectionTitle>
        {tickets.map((t, i) =>
          t._delete ? null : (
            <Card key={t.id ?? `new-${i}`} className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
                <Field label="Ticket name">{(p) => <Input {...p} value={t.label} onChange={(ev) => setT(i, { label: ev.target.value })} maxLength={80} />}</Field>
                <Field label="Price (₹)" hint={parseRupeesToPaise(t.price) !== null ? formatPaise(parseRupeesToPaise(t.price)!) : undefined}>
                  {(p) => <Input {...p} inputMode="decimal" value={t.price} onChange={(ev) => setT(i, { price: ev.target.value })} />}
                </Field>
                <Field label="Max each">{(p) => <Input {...p} inputMode="numeric" value={t.max} onChange={(ev) => setT(i, { max: ev.target.value })} />}</Field>
              </div>
              <Field label="What it includes" optional>{(p) => <Input {...p} value={t.description} onChange={(ev) => setT(i, { description: ev.target.value })} maxLength={200} />}</Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox checked={t.is_primary} onChange={(v) => setT(i, { is_primary: v })}>
                  Main ticket (the alumnus; exactly one per registration)
                </Checkbox>
                <div className="flex">
                  <button type="button" disabled={i === 0} aria-label="Move up" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => setTickets((ts) => { const c = [...ts]; [c[i - 1], c[i]] = [c[i]!, c[i - 1]!]; return c })}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" disabled={i === tickets.length - 1} aria-label="Move down" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => setTickets((ts) => { const c = [...ts]; [c[i + 1], c[i]] = [c[i]!, c[i + 1]!]; return c })}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label="Remove ticket" className="grid size-10 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setT(i, { _delete: true })}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </Card>
          ),
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle>Payment (UPI)</SectionTitle>
        <Notice tone="warning" title="Double-check with a ₹1 test payment">
          Before publishing, pay ₹1 to this UPI ID from your phone and confirm it reaches the association’s account. Two people should check it.
        </Notice>
        <Field label="UPI ID" hint="e.g. jecalumni@okicici. Use the association’s account, ideally a free business UPI.">
          {(p) => <Input {...p} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.upi_id} onChange={set('upi_id')} />}
        </Field>
        <Field label="Payee name (as shown in UPI apps)">{(p) => <Input {...p} value={f.upi_payee_name} onChange={set('upi_payee_name')} maxLength={80} />}</Field>
        <Field label="Payment instructions" optional>{(p) => <Textarea {...p} rows={2} value={f.payment_note} onChange={set('payment_note')} maxLength={1000} />}</Field>
      </section>

      <section className="space-y-4">
        <SectionTitle>Contact</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone for questions" optional>{(p) => <Input {...p} type="tel" value={f.contact_phone} onChange={set('contact_phone')} />}</Field>
          <Field label="Email for questions" optional>{(p) => <Input {...p} type="email" value={f.contact_email} onChange={set('contact_email')} />}</Field>
        </div>
      </section>

      <Card className="p-4">
        <Checkbox checked={f.is_published} onChange={(v) => setF((s) => ({ ...s, is_published: v }))}>
          <strong>Published</strong>: members can see the event and register
        </Checkbox>
      </Card>

      {save.error && <Notice tone="danger" title={friendlyError(save.error)} />}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
        <Button type="submit" size="lg" block loading={save.isPending}>
          {e ? 'Save changes' : 'Create event'}
        </Button>
      </div>
    </form>
  )
}
