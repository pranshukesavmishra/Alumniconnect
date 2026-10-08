import clsx from 'clsx'
import { Check, Pencil } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, KeyValue, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Stepper, Textarea } from '../../components/ui/Form'
import { useDraft } from '../../hooks/useDraft'
import { FOOD_PREFS, MEET_SLUG, TSHIRT_SIZES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import type { Guest, TicketType } from '../../lib/types'
import { useAuth, useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMyPrivate } from '../profile/queries'
import { registrationOpen, useEvent, useMyRegistration, useTicketTypes, useUpsertRegistration } from './queries'

interface FormState {
  qty: Record<string, number>
  guestNames: Record<string, string[]>
  tshirt_size: string
  food_pref: string
  needs_accommodation: boolean
  arrival_note: string
  notes: string
  photo_consent: boolean
  accept_terms: boolean
}

const STEPS = ['Who’s coming', 'Preferences', 'Review'] as const

export function RegisterPage() {
  const uid = useUserId()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { data: event, isLoading: le } = useEvent(MEET_SLUG)
  const { data: tickets, isLoading: lt } = useTicketTypes(event?.id)
  const { data: mine, isLoading: lm } = useMyRegistration(event?.id)
  const { data: profile } = useMyProfile()
  const { data: priv } = useMyPrivate()
  const upsert = useUpsertRegistration(event?.id ?? '')
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const topRef = useRef<HTMLDivElement>(null)

  const [form, setForm, clearDraft] = useDraft<FormState>(uid && event ? `reg-draft:${event.id}:${uid}` : null, () => ({
    qty: {},
    guestNames: {},
    tshirt_size: '',
    food_pref: '',
    needs_accommodation: false,
    arrival_note: '',
    notes: '',
    photo_consent: true,
    accept_terms: false,
  }))

  // Prefill from an existing registration once.
  const [prefilled, setPrefilled] = useState(false)
  useEffect(() => {
    if (prefilled || lm || !tickets) return
    const reg = mine?.registration
    if (reg && reg.status !== 'cancelled') {
      const qty: Record<string, number> = {}
      for (const it of mine.items) qty[it.ticket_type_id] = it.quantity
      const guestNames: Record<string, string[]> = {}
      for (const t of tickets) {
        if (t.is_primary) continue
        guestNames[t.id] = reg.guests.filter((g) => g.relation === t.label).map((g) => g.name)
      }
      setForm((f) => ({
        ...f,
        qty,
        guestNames,
        tshirt_size: reg.tshirt_size ?? '',
        food_pref: reg.food_pref ?? '',
        needs_accommodation: reg.needs_accommodation,
        arrival_note: reg.arrival_note ?? '',
        notes: reg.notes ?? '',
      }))
    } else {
      const primary = tickets.filter((t) => t.is_primary)
      if (primary.length === 1 && !Object.keys(form.qty).length) setForm((f) => ({ ...f, qty: { [primary[0]!.id]: 1 } }))
    }
    setPrefilled(true)
  }, [prefilled, lm, tickets, mine, form.qty, setForm])

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [step])

  const primaryTickets = useMemo(() => tickets?.filter((t) => t.is_primary) ?? [], [tickets])
  const extraTickets = useMemo(() => tickets?.filter((t) => !t.is_primary) ?? [], [tickets])
  const total = (tickets ?? []).reduce((sum, t) => sum + t.price_paise * (form.qty[t.id] ?? 0), 0)
  const people = (tickets ?? []).reduce((sum, t) => sum + (form.qty[t.id] ?? 0), 0)

  if (le || lt || lm || !profile) return <PageSkeleton />
  if (!event) return <Navigate to="/meet" replace />
  const reg = mine?.registration
  const locked = !!reg && (reg.status === 'under_review' || reg.status === 'confirmed')
  if (!registrationOpen(event) && !locked) return <Navigate to="/meet" replace />

  const outsideBatch =
    event.eligible_from_year && event.eligible_to_year && profile.grad_year &&
    (profile.grad_year < event.eligible_from_year || profile.grad_year > event.eligible_to_year)

  const setQty = (t: TicketType, n: number) =>
    setForm((f) => {
      const names = [...(f.guestNames[t.id] ?? [])].slice(0, n)
      while (names.length < n) names.push('')
      return { ...f, qty: { ...f.qty, [t.id]: n }, guestNames: { ...f.guestNames, [t.id]: names } }
    })
  const setPrimary = (id: string) =>
    setForm((f) => {
      const qty = { ...f.qty }
      for (const t of primaryTickets) qty[t.id] = t.id === id ? 1 : 0
      return { ...f, qty }
    })
  const selectedPrimary = primaryTickets.find((t) => (form.qty[t.id] ?? 0) > 0)

  function validate(s: number): boolean {
    const e: Record<string, string> = {}
    if (s === 0 && !selectedPrimary) e.primary = 'Please choose your ticket.'
    if (s === 1) {
      if (!form.food_pref) e.food_pref = 'Please choose a food preference.'
      if (!form.tshirt_size) e.tshirt_size = 'Please choose your T-shirt size.'
    }
    if (s === 2 && !form.accept_terms) e.accept_terms = 'Please accept to continue.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function nextStep() {
    if (validate(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function submit() {
    if (!validate(2) || !event || !profile) return
    const guests: Guest[] = extraTickets.flatMap((t) =>
      (form.guestNames[t.id] ?? []).slice(0, form.qty[t.id] ?? 0).map((name) => ({ name: name.trim(), relation: t.label })),
    )
    try {
      await upsert.mutateAsync({
        details: {
          full_name: profile.full_name,
          email: session?.user.email ?? '',
          phone: priv?.phone ?? '',
          branch: profile.branch ?? '',
          grad_year: profile.grad_year ? String(profile.grad_year) : '',
          city: profile.city ?? '',
          tshirt_size: form.tshirt_size,
          food_pref: form.food_pref,
          needs_accommodation: form.needs_accommodation,
          arrival_note: form.arrival_note,
          notes: form.notes,
          guests,
          accept_terms: form.accept_terms,
          photo_consent: form.photo_consent,
        },
        items: (tickets ?? []).map((t) => ({ ticket_type_id: t.id, quantity: form.qty[t.id] ?? 0 })),
      })
      clearDraft()
      navigate('/meet/my', { replace: true })
    } catch {
      /* shown below */
    }
  }

  return (
    <div ref={topRef} className="scroll-mt-0">
      <PageHeader title={locked ? 'Update your registration' : 'Register'} subtitle={event.title} back="/meet" />
      <Page className="space-y-6">
        {/* step indicator */}
        <ol className="flex items-center gap-2" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 flex-col gap-1.5">
              <span className={clsx('h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-surface-2')} />
              <span className={clsx('text-xs font-semibold', i === step ? 'text-primary' : 'text-muted')} aria-current={i === step ? 'step' : undefined}>
                {i + 1}. {label}
              </span>
            </li>
          ))}
        </ol>

        {/* who is registering */}
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm text-muted">Registering as</p>
            <p className="truncate font-semibold">{profile.full_name}</p>
            <p className="truncate text-sm text-muted">
              {[profile.branch, profile.grad_year && `Batch ${profile.grad_year}`, profile.city].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm text-muted">{priv?.phone}</p>
          </div>
          <Link to="/welcome?edit=1&next=/meet/register" className="grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label="Edit your details">
            <Pencil className="size-4" />
          </Link>
        </Card>
        {outsideBatch && (
          <Notice tone="warning" title={`This meet is for batches ${event.eligible_from_year}–${event.eligible_to_year}`}>
            Your profile says batch {profile.grad_year}. You can still register; the organisers will contact you if needed.
          </Notice>
        )}
        {locked && (
          <Notice tone="info" title="Your payment is already submitted">
            You can update your preferences. To change who is coming, please contact the organisers.
          </Notice>
        )}

        {step === 0 && (
          <section className="space-y-5">
            {primaryTickets.length > 1 ? (
              <ChoiceGroup
                label="Your ticket"
                options={primaryTickets.map((t) => ({ value: t.id, label: `${t.label} · ${formatPaise(t.price_paise)}`, hint: t.description ?? undefined }))}
                value={selectedPrimary?.id ?? null}
                onChange={(id) => !locked && setPrimary(id)}
                error={errors.primary}
              />
            ) : (
              selectedPrimary && (
                <div>
                  <SectionTitle>Your ticket</SectionTitle>
                  <Card className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold">{selectedPrimary.label}</p>
                      {selectedPrimary.description && <p className="text-sm text-muted">{selectedPrimary.description}</p>}
                    </div>
                    <p className="text-lg font-bold">{formatPaise(selectedPrimary.price_paise)}</p>
                  </Card>
                </div>
              )
            )}
            {errors.primary && primaryTickets.length <= 1 && <Notice tone="danger" title={errors.primary} />}

            {extraTickets.length > 0 && (
              <div>
                <SectionTitle>Family coming with you</SectionTitle>
                <Card className="divide-y divide-border">
                  {extraTickets.map((t) => {
                    const n = form.qty[t.id] ?? 0
                    return (
                      <div key={t.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{t.label}</p>
                            <p className="text-sm text-muted">
                              {formatPaise(t.price_paise)} {t.price_paise > 0 && 'each'}
                              {t.description && ` · ${t.description}`}
                            </p>
                          </div>
                          {locked ? (
                            <span className="text-lg font-semibold">{n}</span>
                          ) : (
                            <Stepper value={n} max={t.max_per_registration} onChange={(v) => setQty(t, v)} label={t.label} />
                          )}
                        </div>
                        {n > 0 && (
                          <div className="mt-3 space-y-2">
                            {Array.from({ length: n }, (_, i) => (
                              <Input
                                key={i}
                                aria-label={`${t.label} ${i + 1} name`}
                                placeholder={`Name of ${t.label.toLowerCase().split(' (')[0]} ${n > 1 ? i + 1 : ''} (for the name badge)`}
                                value={form.guestNames[t.id]?.[i] ?? ''}
                                maxLength={80}
                                onChange={(e) =>
                                  setForm((f) => {
                                    const names = [...(f.guestNames[t.id] ?? [])]
                                    names[i] = e.target.value
                                    return { ...f, guestNames: { ...f.guestNames, [t.id]: names } }
                                  })
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </Card>
              </div>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5">
            <ChoiceGroup label="Food preference" options={FOOD_PREFS} value={(form.food_pref || null) as never} onChange={(v) => setForm((f) => ({ ...f, food_pref: v }))} columns={3} error={errors.food_pref} />
            <Field label="Your T-shirt size" error={errors.tshirt_size} hint="For the alumni meet kit.">
              {(p) => (
                <Select {...p} value={form.tshirt_size} onChange={(e) => setForm((f) => ({ ...f, tshirt_size: e.target.value }))}>
                  <option value="">Choose size</option>
                  {TSHIRT_SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              )}
            </Field>
            <ChoiceGroup
              label="Do you need help with accommodation in Jabalpur?"
              options={[
                { value: 'no', label: 'No, I’ve arranged my stay' },
                { value: 'yes', label: 'Yes, please share options' },
              ]}
              value={form.needs_accommodation ? 'yes' : 'no'}
              onChange={(v) => setForm((f) => ({ ...f, needs_accommodation: v === 'yes' }))}
              columns={2}
            />
            <Field label="Arrival plan" optional hint="e.g. Arriving 25 Dec by train, leaving 27 Dec evening.">
              {(p) => <Input {...p} maxLength={300} value={form.arrival_note} onChange={(e) => setForm((f) => ({ ...f, arrival_note: e.target.value }))} />}
            </Field>
            <Field label="Anything we should know?" optional hint="Accessibility needs, dietary allergies, or a message for the organisers.">
              {(p) => <Textarea {...p} maxLength={1000} rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />}
            </Field>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5">
            <div>
              <SectionTitle>Summary</SectionTitle>
              <Card className="px-4">
                <dl className="divide-y divide-border">
                  {(tickets ?? [])
                    .filter((t) => (form.qty[t.id] ?? 0) > 0)
                    .map((t) => (
                      <KeyValue key={t.id} label={`${t.label} × ${form.qty[t.id]}`}>
                        {formatPaise(t.price_paise * (form.qty[t.id] ?? 0))}
                      </KeyValue>
                    ))}
                  <KeyValue label="Food">{FOOD_PREFS.find((f) => f.value === form.food_pref)?.label}</KeyValue>
                  <KeyValue label="T-shirt">{form.tshirt_size}</KeyValue>
                  <KeyValue label="Accommodation help">{form.needs_accommodation ? 'Yes' : 'No'}</KeyValue>
                  <div className="flex items-center justify-between py-3.5">
                    <dt className="font-semibold">
                      Total · {people} {people === 1 ? 'person' : 'people'}
                    </dt>
                    <dd className="text-xl font-bold tabular-nums">{formatPaise(total)}</dd>
                  </div>
                </dl>
              </Card>
            </div>
            <div className="space-y-2">
              <Checkbox checked={form.photo_consent} onChange={(v) => setForm((f) => ({ ...f, photo_consent: v }))}>
                Photos and videos of me taken at the meet may be shared with JEC alumni in the app.
              </Checkbox>
              <Checkbox checked={form.accept_terms} onChange={(v) => setForm((f) => ({ ...f, accept_terms: v }))}>
                My details are correct, and I agree to the{' '}
                <a href="/terms" target="_blank" className="font-semibold text-primary underline">
                  event terms
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" className="font-semibold text-primary underline">
                  privacy notice
                </a>
                .
              </Checkbox>
              {errors.accept_terms && (
                <p className="text-sm text-danger" role="alert">
                  {errors.accept_terms}
                </p>
              )}
            </div>
            {upsert.error && <Notice tone="danger" title={friendlyError(upsert.error)} />}
          </section>
        )}

        {/* actions */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mb-2 flex items-center justify-between text-[15px]">
            <span className="text-muted">
              {people} {people === 1 ? 'person' : 'people'}
            </span>
            <span className="font-bold tabular-nums">{formatPaise(total)}</span>
          </div>
          <div className="flex gap-3">
            {step > 0 && (
              <Button variant="secondary" size="lg" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button size="lg" className="flex-1" onClick={nextStep}>
                Continue
              </Button>
            ) : (
              <Button size="lg" className="flex-1" loading={upsert.isPending} onClick={submit} icon={<Check className="size-5" />}>
                {locked ? 'Save changes' : total > 0 ? 'Confirm and pay' : 'Confirm registration'}
              </Button>
            )}
          </div>
        </div>
      </Page>
    </div>
  )
}
