import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice, SectionTitle } from '../../components/ui/Display'
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Form'
import { PhoneInput, usePhoneError } from '../../components/ui/PhoneInput'
import { normalizePhone } from '../../lib/phone'
import { MEET_SLUG } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import type { AddonPrice, EventRow, TicketType } from '../../lib/types'
import { isValidUpiId } from '../../lib/upi'
import { dayLabel, eventDayCount } from '../events/reunion'
import { discountInfo, percentFromPrice, priceFromPercent } from '../events/ticketPricing'
import { DriveArchive } from './DriveArchive'
import { QuestionsEditor } from './AdminQuestions'
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

/** Optional discount: original price + percent off → the price now. Members see the original crossed out, the new price and "Save X%". */
function TicketDiscountEditor({ t, onChange }: { t: TicketDraft; onChange: (patch: Partial<TicketDraft>) => void }) {
  const [open, setOpen] = useState(!!t.list.trim())
  const lp = t.list.trim() ? parseRupeesToPaise(t.list) : null
  const np = parseRupeesToPaise(t.price)
  const info = lp != null && np != null ? discountInfo({ price_paise: np, list_price_paise: lp }) : null
  const percent = lp != null && np != null ? percentFromPrice(lp, np) : null
  if (!open) {
    return (
      <button type="button" className="min-h-11 rounded-full border border-dashed border-border-strong px-4 text-sm font-semibold text-primary hover:bg-primary-soft" onClick={() => setOpen(true)}>
        + Add a discount
      </button>
    )
  }
  return (
    <fieldset className="space-y-3 rounded-2xl border border-accent/40 bg-accent-soft/40 p-3">
      <legend className="px-1 text-sm font-semibold">Discount</legend>
      <p className="text-sm text-muted">Enter the original price and the percent off. “Price (₹)” above becomes the price members pay; the original shows crossed out.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Original price (₹)">{(p) => <Input {...p} inputMode="decimal" value={t.list} onChange={(ev) => onChange({ list: ev.target.value })} />}</Field>
        <Field label="Percent off" hint={info ? `Members save ${formatPaise(info.savePaise)}` : undefined}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={percent != null ? String(percent) : ''}
              onChange={(ev) => {
                const v = ev.target.value.replace(/[^0-9]/g, '')
                if (lp != null && v !== '') onChange({ price: String(priceFromPercent(lp, Number(v)) / 100) })
              }}
              placeholder="e.g. 20"
            />
          )}
        </Field>
        <Field label="Offer name" optional>{(p) => <Input {...p} value={t.offer} maxLength={40} placeholder="Early bird" onChange={(ev) => onChange({ offer: ev.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {info ? (
          <p className="text-sm font-semibold" data-testid="discount-preview">
            Members see <s className="text-muted">{formatPaise(info.listPaise)}</s> {formatPaise(info.pricePaise)} · Save {info.percent}%
          </p>
        ) : (
          <p className="text-sm text-muted">Set the original price higher than the price now.</p>
        )}
        <button type="button" className="min-h-11 rounded-full px-3 text-sm font-semibold text-danger hover:bg-danger-soft" onClick={() => { onChange({ list: '', offer: '' }); setOpen(false) }}>
          Remove discount
        </button>
      </div>
    </fieldset>
  )
}

/** Saved overrides of the extras as the draft's text fields (keyed by the extra's id). */
function pricesFor(ticketId: string, rows: AddonPrice[]): Record<string, { price: string; off: boolean }> {
  const out: Record<string, { price: string; off: boolean }> = {}
  for (const r of rows) if (r.ticket_type_id === ticketId) out[r.addon_id] = { price: r.available && r.price_paise != null ? String(r.price_paise / 100) : '', off: !r.available }
  return out
}

interface TicketDraft {
  id?: string
  label: string
  description: string
  price: string
  /** original price (crossed out) and the offer's name; empty = no discount */
  list: string
  offer: string
  is_primary: boolean
  /** optional per-person extra: any registrant can add it, whichever main ticket; never the main ticket */
  is_addon?: boolean
  max: string
  days: number[]
  _delete?: boolean
  /** stable key for new tickets that have no id yet */
  key?: string
  /** on a normal ticket: the price of each optional extra for this person type, by the extra's key. Empty price = the extra's own price; off = not available */
  prices?: Record<string, { price: string; off: boolean }>
}

let newKeyCounter = 0
const newKey = () => `new-${++newKeyCounter}`
const keyOf = (t: { id?: string; key?: string }) => t.id ?? t.key ?? ''

/** The overrides of one optional extra for one person type: empty price = the extra's own price, 0 = free, off = this ticket cannot take it. */
function ExtraPriceFields({ ticket, extras, onChange }: { ticket: TicketDraft; extras: TicketDraft[]; onChange: (patch: Partial<TicketDraft>) => void }) {
  if (extras.length === 0) return null
  const set = (k: string, v: { price: string; off: boolean }) => onChange({ prices: { ...ticket.prices, [k]: v } })
  return (
    <fieldset className="space-y-3 rounded-2xl border border-border p-3" data-testid="extra-prices">
      <legend className="px-1 text-sm font-semibold">Optional extras for this ticket</legend>
      {extras.map((a) => {
        const k = keyOf(a)
        const v = ticket.prices?.[k] ?? { price: '', off: false }
        const dflt = parseRupeesToPaise(a.price)
        return (
          <div key={k} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="extra-price-row">
            <Field label={`Price of ${a.label.trim() || 'the extra'} for this ticket (₹)`} hint={v.off ? undefined : dflt !== null ? `Empty = the extra’s own price, ${formatPaise(dflt)}. 0 = free.` : 'Empty = the extra’s own price. 0 = free.'}>
              {(p) => <Input {...p} inputMode="decimal" value={v.price} disabled={v.off} onChange={(ev) => set(k, { ...v, price: ev.target.value })} />}
            </Field>
            <Checkbox checked={v.off} onChange={(on) => set(k, { price: on ? '' : v.price, off: on })}>
              Not available for this ticket
            </Checkbox>
          </div>
        )
      })}
    </fieldset>
  )
}

export function AdminSettings({ existing }: { existing?: { event: EventRow; tickets: TicketType[]; addonPrices?: AddonPrice[] } }) {
  const phoneError = usePhoneError()
  const navigate = useNavigate()
  const save = useSaveEvent()
  const e = existing?.event
  const [f, setF] = useState({
    slug: e?.slug ?? MEET_SLUG,
    title: e?.title ?? '',
    tagline: e?.tagline ?? '',
    description: e?.description ?? '',
    venue: e?.venue ?? 'Jabalpur Engineering College, Jabalpur',
    venue_map_url: e?.venue_map_url ?? '',
    starts_at: toLocalIst(e?.starts_at ?? null),
    ends_at: toLocalIst(e?.ends_at ?? null),
    registration_closes_at: toLocalIst(e?.registration_closes_at ?? null),
    eligible_from_year: String(e?.eligible_from_year ?? 2003),
    eligible_to_year: String(e?.eligible_to_year ?? 2012),
    capacity: e?.capacity ? String(e.capacity) : '',
    upi_id: e?.upi_id ?? '',
    upi_payee_name: e?.upi_payee_name ?? '',
    payment_note: e?.payment_note ?? 'Pay the exact amount shown. Keep the 12-digit UPI reference (UTR) from your payment app.',
    contact_phone: e?.contact_phone ?? '',
    contact_email: e?.contact_email ?? '',
    is_published: e?.is_published ?? false,
    ask_reunion_questions: e?.ask_reunion_questions ?? false,
  })
  const [tickets, setTickets] = useState<TicketDraft[]>(
    existing?.tickets.length
      ? existing.tickets.map((t) => ({ id: t.id, key: t.id, prices: pricesFor(t.id, existing.addonPrices ?? []), label: t.label, description: t.description ?? '', price: String(t.price_paise / 100), list: t.list_price_paise ? String(t.list_price_paise / 100) : '', offer: t.discount_label ?? '', is_primary: t.is_primary, is_addon: !!t.is_addon, max: String(t.max_per_registration), days: t.days ?? [] }))
      : [
          { key: newKey(), label: 'Alumnus / Alumna', description: '', price: '', list: '', offer: '', is_primary: true, max: '1', days: [] },
          { key: newKey(), label: 'Spouse', description: '', price: '', list: '', offer: '', is_primary: false, max: '1', days: [] },
          { key: newKey(), label: 'Child (5–12 years)', description: '', price: '', list: '', offer: '', is_primary: false, max: '4', days: [] },
          { key: newKey(), label: 'Child (under 5)', description: 'Free', price: '0', list: '', offer: '', is_primary: false, max: '4', days: [] },
        ],
  )
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value }))
  const setT = (i: number, patch: Partial<TicketDraft>) => setTickets((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  /** Swap with the nearest ticket that isn't marked for deletion. */
  const move = (i: number, dir: -1 | 1) =>
    setTickets((ts) => {
      let j = i + dir
      while (j >= 0 && j < ts.length && (ts[j]!._delete || ts[j]!.is_addon)) j += dir
      if (j < 0 || j >= ts.length) return ts
      const c = [...ts]
      ;[c[i], c[j]] = [c[j]!, c[i]!]
      return c
    })
  const nDays = eventDayCount({ starts_at: fromLocalIst(f.starts_at), ends_at: fromLocalIst(f.ends_at) })
  const visibleIdx = tickets.map((t, i) => (t._delete || t.is_addon ? -1 : i)).filter((i) => i >= 0)
  const live = tickets.filter((t) => !t._delete)

  function validate(): string[] {
    const errs: string[] = []
    if (!/^[a-z0-9-]{3,60}$/.test(f.slug)) errs.push('Web address name: use lowercase letters, numbers and dashes.')
    if (!f.title.trim()) errs.push('Title is required.')
    const pe = phoneError(f.contact_phone)
    if (pe) errs.push(pe)
    if (f.upi_id && !isValidUpiId(f.upi_id)) errs.push('UPI ID looks wrong (expected something like name@okicici).')
    if (f.upi_id && !f.upi_payee_name.trim()) errs.push('Enter the payee name exactly as UPI apps show it.')
    for (const [k, label] of [['capacity', 'Max people'], ['eligible_from_year', 'Batches from'], ['eligible_to_year', 'Batches to']] as const) {
      if (f[k].trim() && !/^\d+$/.test(f[k].trim())) errs.push(`${label}: enter a whole number without commas.`)
    }
    if (f.eligible_from_year && f.eligible_to_year && Number(f.eligible_from_year) > Number(f.eligible_to_year)) errs.push('Batch range: “from” is after “to”.')
    if (f.starts_at && f.ends_at && f.ends_at < f.starts_at) errs.push('The end date is before the start date.')
    if (live.filter((t) => t.is_primary).length < 1) errs.push('At least one main (alumnus) ticket is needed.')
    for (const t of live) {
      if (t.is_addon && t.is_primary) errs.push(`“${t.label || 'extra'}”: an optional extra cannot be the main ticket.`)
      if (!t.label.trim()) errs.push(t.is_addon ? 'Every optional extra needs a name.' : 'Every ticket needs a name.')
      if (parseRupeesToPaise(t.price) === null) errs.push(`Price for “${t.label || 'ticket'}” is not a valid amount.`)
      if (!(Number(t.max) >= 1 && Number(t.max) <= 20)) errs.push(`“${t.label}”: max per registration must be 1–20.`)
      if (t.list.trim()) {
        const lp = parseRupeesToPaise(t.list)
        const np = parseRupeesToPaise(t.price)
        if (lp === null) errs.push(`Original price for “${t.label || 'ticket'}” is not a valid amount.`)
        else if (np !== null && lp <= np) errs.push(`“${t.label || 'ticket'}”: the original price must be higher than the price now, or leave it empty for no discount.`)
      }
    }
    for (const t of live.filter((x) => !x.is_addon)) {
      for (const a of live.filter((x) => x.is_addon)) {
        const v = t.prices?.[keyOf(a)]
        if (v && !v.off && v.price.trim() && parseRupeesToPaise(v.price) === null) errs.push(`Price of “${a.label || 'extra'}” for “${t.label || 'ticket'}” is not a valid amount.`)
      }
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
          contact_phone: n(normalizePhone(f.contact_phone)),
          contact_email: n(f.contact_email),
          is_published: f.is_published,
          ask_reunion_questions: f.ask_reunion_questions,
        },
        addonPrices: tickets
          .filter((t) => !t._delete && !t.is_addon)
          .flatMap((t) =>
            tickets
              .filter((a) => !a._delete && a.is_addon)
              .flatMap((a) => {
                const v = t.prices?.[keyOf(a)]
                if (!v || (!v.off && !v.price.trim())) return []
                return [{ addonKey: keyOf(a), ticketKey: keyOf(t), price_paise: v.off ? null : (parseRupeesToPaise(v.price) ?? 0), available: !v.off }]
              }),
          ),
        tickets: tickets.map((t) => ({
          id: t.id,
          _key: keyOf(t),
          _delete: t._delete,
          label: t.label.trim(),
          description: n(t.description),
          price_paise: parseRupeesToPaise(t.price) ?? 0,
          list_price_paise: t.list.trim() ? parseRupeesToPaise(t.list) : null,
          discount_label: t.list.trim() && t.offer.trim() ? t.offer.trim() : null,
          is_primary: t.is_addon ? false : t.is_primary,
          is_addon: !!t.is_addon,
          max_per_registration: Number(t.max),
          days: t.days.length === 0 || t.days.length >= nDays ? null : [...t.days].sort((a, b) => a - b),
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
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={120} placeholder="e.g. Alumni Connect Grand Reunion 2026" />}</Field>
        <Field label="Tagline" optional>{(p) => <Input {...p} value={f.tagline} onChange={set('tagline')} maxLength={200} placeholder="e.g. Batches 2003–2012 · A Decade of JECians" />}</Field>
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
        <Card className="p-4">
          <Checkbox checked={f.ask_reunion_questions} onChange={(v) => setF((s) => ({ ...s, ask_reunion_questions: v }))}>
            <strong>Ask the reunion questions</strong>: profile snapshot, days and family, organising teams, help needed, Reunion Fund, sponsorship, performances and memories
          </Checkbox>
        </Card>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Batches from" optional>{(p) => <Input {...p} inputMode="numeric" value={f.eligible_from_year} onChange={set('eligible_from_year')} />}</Field>
          <Field label="to" optional>{(p) => <Input {...p} inputMode="numeric" value={f.eligible_to_year} onChange={set('eligible_to_year')} />}</Field>
          <Field label="Max people" optional>{(p) => <Input {...p} inputMode="numeric" placeholder="No limit" value={f.capacity} onChange={set('capacity')} />}</Field>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          action={
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setTickets((t) => [...t, { key: newKey(), label: '', description: '', price: '', list: '', offer: '', is_primary: false, max: '1', days: [] }])}>
              Add ticket
            </Button>
          }
        >
          Fees
        </SectionTitle>
        {tickets.map((t, i) =>
          t._delete || t.is_addon ? null : (
            <Card key={keyOf(t) || `new-${i}`} className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
                <Field label="Ticket name">{(p) => <Input {...p} value={t.label} onChange={(ev) => setT(i, { label: ev.target.value })} maxLength={80} />}</Field>
                <Field label="Price (₹)" hint={parseRupeesToPaise(t.price) !== null ? formatPaise(parseRupeesToPaise(t.price)!) : undefined}>
                  {(p) => <Input {...p} inputMode="decimal" value={t.price} onChange={(ev) => setT(i, { price: ev.target.value })} />}
                </Field>
                <Field label="Max each">{(p) => <Input {...p} inputMode="numeric" value={t.max} onChange={(ev) => setT(i, { max: ev.target.value })} />}</Field>
              </div>
              <TicketDiscountEditor t={t} onChange={(patch) => setT(i, patch)} />
              <ExtraPriceFields ticket={t} extras={tickets.filter((a) => a.is_addon && !a._delete)} onChange={(patch) => setT(i, patch)} />
              <Field label="What it includes" optional>{(p) => <Input {...p} value={t.description} onChange={(ev) => setT(i, { description: ev.target.value })} maxLength={200} />}</Field>
              {nDays > 1 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-semibold">Valid on <span className="font-normal text-muted">(none ticked = every day)</span></legend>
                  <div className="flex flex-wrap gap-x-5">
                    {Array.from({ length: nDays }, (_, d) => d + 1).map((d) => (
                      <Checkbox key={d} checked={t.days.includes(d)} onChange={(on) => setT(i, { days: on ? [...t.days, d] : t.days.filter((x) => x !== d) })}>
                        {dayLabel({ starts_at: fromLocalIst(f.starts_at) }, d)}
                      </Checkbox>
                    ))}
                  </div>
                  {!t.is_primary && <p className="text-sm text-muted">A family ticket can only be bought with a main ticket that covers all of its days.</p>}
                </fieldset>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox checked={t.is_primary} onChange={(v) => setT(i, { is_primary: v })}>
                  Main ticket (the alumnus; exactly one per registration)
                </Checkbox>
                <div className="flex">
                  <button type="button" disabled={i === visibleIdx[0]} aria-label="Move up" className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" disabled={i === visibleIdx[visibleIdx.length - 1]} aria-label="Move down" className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label="Remove ticket" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setT(i, { _delete: true })}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </Card>
          ),
        )}
      </section>

      <section className="space-y-3" data-testid="addon-editor">
        <SectionTitle
          action={
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setTickets((t) => [...t, { key: newKey(), label: '', description: '', price: '', list: '', offer: '', is_primary: false, is_addon: true, max: '10', days: [] }])}>
              Add optional extra
            </Button>
          }
        >
          Optional extras
        </SectionTitle>
        <p className="text-sm text-muted">
          An extra is priced per person and any registered person can add it, whichever main ticket they chose (for example an outdoor tour on the last day). The main alumnus can join too.
          Members tick it for themselves and for each family member who joins. Set “Max” to the most people you expect in one registration.
          The price here is the default. To charge a different amount per person type (for example a lower price for a child), set it in that ticket’s card under Fees; leave it empty there to use this price.
        </p>
        {tickets.map((t, i) =>
          t._delete || !t.is_addon ? null : (
            <Card key={keyOf(t) || `new-${i}`} className="space-y-3 p-4" data-testid="addon-card">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
                <Field label="Name of the extra">{(p) => <Input {...p} value={t.label} onChange={(ev) => setT(i, { label: ev.target.value })} maxLength={80} placeholder="Outdoor tour" />}</Field>
                <Field label="Extra price per person (₹)" hint={parseRupeesToPaise(t.price) !== null ? formatPaise(parseRupeesToPaise(t.price)!) : undefined}>
                  {(p) => <Input {...p} inputMode="decimal" value={t.price} onChange={(ev) => setT(i, { price: ev.target.value })} />}
                </Field>
                <Field label="Max">{(p) => <Input {...p} inputMode="numeric" value={t.max} onChange={(ev) => setT(i, { max: ev.target.value })} />}</Field>
              </div>
              {nDays > 1 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-semibold">Valid on <span className="font-normal text-muted">(none ticked = every day)</span></legend>
                  <div className="flex flex-wrap gap-x-5">
                    {Array.from({ length: nDays }, (_, d) => d + 1).map((d) => (
                      <Checkbox key={d} checked={t.days.includes(d)} onChange={(on) => setT(i, { days: on ? [...t.days, d] : t.days.filter((x) => x !== d) })}>
                        {dayLabel({ starts_at: fromLocalIst(f.starts_at) }, d)}
                      </Checkbox>
                    ))}
                  </div>
                </fieldset>
              )}
              <TicketDiscountEditor t={t} onChange={(patch) => setT(i, patch)} />
              <Field label="Description" optional>{(p) => <Input {...p} value={t.description} onChange={(ev) => setT(i, { description: ev.target.value })} maxLength={200} />}</Field>
              <div className="flex justify-end">
                <button type="button" aria-label="Remove optional extra" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setT(i, { _delete: true })}>
                  <Trash2 className="size-4" />
                </button>
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

      {e && <DriveArchive eventId={e.id} />}
      {e && <QuestionsEditor eventId={e.id} />}

      <section className="space-y-4">
        <SectionTitle>Contact</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone for questions" optional>{(p) => <PhoneInput {...p} value={f.contact_phone} onChange={(v) => setF((s) => ({ ...s, contact_phone: v }))} />}</Field>
          <Field label="Email for questions" optional>{(p) => <Input {...p} type="email" value={f.contact_email} onChange={set('contact_email')} />}</Field>
        </div>
      </section>

      <Card className="p-4">
        <Checkbox checked={f.is_published} onChange={(v) => setF((s) => ({ ...s, is_published: v }))}>
          <strong>Published</strong>: members can see the event and register
        </Checkbox>
      </Card>

      {save.error && <Notice tone="danger" title={friendlyError(save.error)} />}
      <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
        <Button type="submit" size="lg" block loading={save.isPending}>
          {e ? 'Save changes' : 'Create event'}
        </Button>
      </div>
    </form>
  )
}
