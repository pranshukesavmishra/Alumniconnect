import clsx from 'clsx'
import { CalendarDays, Check, Clock, MapPin, Pencil, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, KeyValue, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Stepper, Textarea } from '../../components/ui/Form'
import { useT, type MsgKey } from '../../i18n'
import { foodLabel, foodOptions, modeLabel, performLabel, sponsorLabel, teamLabel, tshirtLabel } from '../../i18n/labels'
import { useDraft } from '../../hooks/useDraft'
import { ARRIVAL_MODES, FUND_PRESETS, MEET_SLUG, ORG_TEAMS, PERFORM_TYPES, SPONSOR_LEVELS, TSHIRT_SIZES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDateRange } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import type { CustomAnswer, EventRow, FoodPref, Guest, TicketType } from '../../lib/types'
import { useAuth, useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMyPrivate } from '../profile/queries'
import { registrationOpen, useEvent, useEventQuestions, useMyExperiences, useMyRegistration, useTicketTypes, useUpsertRegistration } from './queries'
import { FundPicker, MultiChoice, ProfileCard, QuestionField, YesNo, boolToYn, ynToBool, type YN } from './RegisterParts'
import { answerText, checkCustomAnswers, cleanCustomAnswers, dayLabel, eventDayCount, fundOk, missingProfileFields, ticketFits, type AnswerProblem } from './reunion'

interface GuestDraft {
  name: string
  food: string
}

interface FormState {
  qty: Record<string, number>
  guestNames: Record<string, string[]>
  guestFood: Record<string, string[]>
  tshirt_size: string
  food_pref: string
  needs_accommodation: YN
  needs_local_travel: YN
  arrival_note: string
  arrival_from: string
  arrival_date: string
  arrival_mode: string
  notes: string
  org_team: YN
  org_teams: string[]
  perform: YN
  perform_types: string[]
  perform_group: '' | 'solo' | 'group'
  perform_members: string
  perform_description: string
  perform_minutes: string
  fund: YN
  fund_choice: string
  fund_custom: string
  sponsor: YN
  sponsor_level: string
  sponsor_org: string
  sponsor_note: string
  nickname: string
  hostel: string
  faculty_wish: string
  songs: string[]
  memory: string
  memory_wall_consent: boolean
  emergency_name: string
  emergency_phone: string
  medical_notes: string
  feedback: string
  custom: Record<string, CustomAnswer | undefined>
  photo_consent: boolean
  accept_terms: boolean
}

type StepId = 'details' | 'days' | 'involved' | 'memorable' | 'review'

const blank = (): FormState => ({
  qty: {},
  guestNames: {},
  guestFood: {},
  tshirt_size: '',
  food_pref: '',
  needs_accommodation: '',
  needs_local_travel: '',
  arrival_note: '',
  arrival_from: '',
  arrival_date: '',
  arrival_mode: '',
  notes: '',
  org_team: '',
  org_teams: [],
  perform: '',
  perform_types: [],
  perform_group: '',
  perform_members: '',
  perform_description: '',
  perform_minutes: '',
  fund: '',
  fund_choice: '',
  fund_custom: '',
  sponsor: '',
  sponsor_level: '',
  sponsor_org: '',
  sponsor_note: '',
  nickname: '',
  hostel: '',
  faculty_wish: '',
  songs: ['', '', ''],
  memory: '',
  memory_wall_consent: false,
  emergency_name: '',
  emergency_phone: '',
  medical_notes: '',
  feedback: '',
  custom: {},
  photo_consent: false, // consent is an active choice, never pre-ticked
  accept_terms: false,
})

function fundPaiseOf(f: Pick<FormState, 'fund' | 'fund_choice' | 'fund_custom'>): number {
  if (f.fund !== 'yes') return 0
  if (f.fund_choice === 'custom') return /^\d{1,7}$/.test(f.fund_custom) ? Number(f.fund_custom) * 100 : NaN
  return f.fund_choice ? Number(f.fund_choice) : NaN
}

export function RegisterPage() {
  const tx = useT()
  const uid = useUserId()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { data: event, isLoading: le } = useEvent(MEET_SLUG)
  const { data: tickets, isLoading: lt } = useTicketTypes(event?.id)
  const { data: questions, isLoading: lq } = useEventQuestions(event?.id)
  const { data: mine, isLoading: lm } = useMyRegistration(event?.id)
  const { data: profile } = useMyProfile()
  const { data: priv } = useMyPrivate()
  const { data: experiences } = useMyExperiences()
  const upsert = useUpsertRegistration(event?.id ?? '')
  const [stepIdx, setStepIdx] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [qErrors, setQErrors] = useState<Record<string, AnswerProblem>>({})
  const topRef = useRef<HTMLDivElement>(null)

  const [form, setForm, clearDraft] = useDraft<FormState>(uid && event ? `reg-draft:v2:${event.id}:${uid}` : null, blank)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Prefill from an existing registration once.
  const [prefilled, setPrefilled] = useState(false)
  useEffect(() => {
    if (prefilled || lm || !tickets) return
    const reg = mine?.registration
    if (reg && reg.status !== 'cancelled') {
      const qty: Record<string, number> = {}
      for (const it of mine.items) qty[it.ticket_type_id] = it.quantity
      // Match saved guests to tickets by id (older entries by label); anything unmatched fills remaining slots,
      // so a renamed ticket never drops a guest's name.
      const guestNames: Record<string, string[]> = {}
      const guestFood: Record<string, string[]> = {}
      const pool: Guest[] = [...reg.guests]
      const extras = tickets.filter((t) => !t.is_primary)
      const taken: Record<string, GuestDraft[]> = {}
      for (const t of extras) {
        const n = qty[t.id] ?? 0
        const list: GuestDraft[] = []
        for (let i = 0; i < pool.length && list.length < n; ) {
          const g = pool[i]!
          if (g.ticket_type_id ? g.ticket_type_id === t.id : g.relation === t.label) {
            list.push({ name: g.name, food: g.food ?? '' })
            pool.splice(i, 1)
          } else i++
        }
        taken[t.id] = list
      }
      for (const t of extras) {
        const list = taken[t.id]!
        while (list.length < (qty[t.id] ?? 0) && pool.length) {
          const g = pool.shift()!
          list.push({ name: g.name, food: g.food ?? '' })
        }
        guestNames[t.id] = list.map((g) => g.name)
        guestFood[t.id] = list.map((g) => g.food)
      }
      const fund = reg.fund_paise > 0
      const preset = (FUND_PRESETS as readonly number[]).includes(reg.fund_paise)
      setForm((f) => ({
        ...f,
        qty,
        guestNames,
        guestFood,
        tshirt_size: reg.tshirt_size ?? '',
        food_pref: reg.food_pref ?? '',
        needs_accommodation: boolToYn(reg.needs_accommodation),
        needs_local_travel: reg.needs_local_travel ? 'yes' : reg.fund_interest === null && reg.org_team_interest === null ? '' : 'no',
        arrival_note: reg.arrival_note ?? '',
        arrival_from: reg.arrival_from ?? '',
        arrival_date: reg.arrival_date ?? '',
        arrival_mode: reg.arrival_mode ?? '',
        notes: reg.notes ?? '',
        org_team: boolToYn(reg.org_team_interest),
        org_teams: reg.org_teams ?? [],
        perform: boolToYn(reg.perform_interest),
        perform_types: reg.perform_types ?? [],
        perform_group: reg.perform_group === null ? '' : reg.perform_group ? 'group' : 'solo',
        perform_members: reg.perform_members ?? '',
        perform_description: reg.perform_description ?? '',
        perform_minutes: reg.perform_minutes ? String(reg.perform_minutes) : '',
        fund: fund ? 'yes' : boolToYn(reg.fund_interest),
        fund_choice: fund ? (preset ? String(reg.fund_paise) : 'custom') : '',
        fund_custom: fund && !preset ? String(reg.fund_paise / 100) : '',
        sponsor: boolToYn(reg.sponsor_interest),
        sponsor_level: reg.sponsor_level ?? '',
        sponsor_org: reg.sponsor_org ?? '',
        sponsor_note: reg.sponsor_note ?? '',
        nickname: reg.nickname ?? '',
        hostel: reg.hostel ?? '',
        faculty_wish: reg.faculty_wish ?? '',
        songs: [0, 1, 2].map((i) => reg.song_requests?.[i] ?? ''),
        memory: reg.memory ?? '',
        memory_wall_consent: reg.memory_wall_consent,
        emergency_name: reg.emergency_name ?? '',
        emergency_phone: reg.emergency_phone ?? '',
        medical_notes: reg.medical_notes ?? '',
        feedback: reg.feedback ?? '',
        custom: { ...reg.custom_answers },
        photo_consent: reg.photo_consent, // keep the member's earlier choice when editing
        accept_terms: !!reg.terms_accepted_at, // already agreed when they registered
      }))
    } else {
      // Drop draft entries for tickets that no longer exist, and pick the main ticket if there is only one.
      const primary = tickets.filter((t) => t.is_primary)
      const known = new Set(tickets.map((t) => t.id))
      const cleaned = Object.fromEntries(Object.entries(form.qty).filter(([id]) => known.has(id)))
      if (primary.length === 1 && !primary.some((p) => (cleaned[p.id] ?? 0) > 0)) cleaned[primary[0]!.id] = 1
      setForm((f) => ({ ...f, qty: cleaned }))
    }
    setPrefilled(true)
  }, [prefilled, lm, tickets, mine, form.qty, setForm])

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [stepIdx])

  const primaryTickets = useMemo(() => tickets?.filter((t) => t.is_primary) ?? [], [tickets])
  const extraTickets = useMemo(() => tickets?.filter((t) => !t.is_primary) ?? [], [tickets])
  const activeQuestions = useMemo(() => (questions ?? []).filter((q) => q.is_active), [questions])
  const ticketsTotal = (tickets ?? []).reduce((sum, t) => sum + t.price_paise * (form.qty[t.id] ?? 0), 0)
  const people = (tickets ?? []).reduce((sum, t) => sum + (form.qty[t.id] ?? 0), 0)
  const fundPaise = fundPaiseOf(form)
  const total = ticketsTotal + (fundOk(fundPaise) ? fundPaise : 0)

  if (le || lt || lm || lq || !profile) return <PageSkeleton />
  if (!event) return <Navigate to="/meet" replace />
  const reg = mine?.registration
  const locked = !!reg && (reg.status === 'under_review' || reg.status === 'confirmed')
  if (!registrationOpen(event) && !locked) return <Navigate to="/meet" replace />

  const reunion = event.ask_reunion_questions
  const steps: StepId[] = reunion ? ['details', 'days', 'involved', 'memorable', 'review'] : ['details', 'days', 'memorable', 'review']
  const step = steps[Math.min(stepIdx, steps.length - 1)]!
  const stepLabel = (s: StepId): string =>
    ({ details: tx('rr.stepDetails'), days: tx(reunion ? 'rr.stepDays' : 'reg.step1'), involved: tx('rr.stepInvolved'), memorable: tx(reunion ? 'rr.stepMemorable' : 'rr.stepMore'), review: tx('rr.stepReview') })[s]
  const goTo = (s: StepId) => setStepIdx(steps.indexOf(s))

  const phone = priv?.phone ?? null
  const email = session?.user.email ?? ''
  const exps = experiences ?? []
  const missing = missingProfileFields(profile, phone, exps, reunion)
  const nDays = eventDayCount(event, tickets ?? [])

  const outsideBatch =
    event.eligible_from_year && event.eligible_to_year && profile.grad_year &&
    (profile.grad_year < event.eligible_from_year || profile.grad_year > event.eligible_to_year)

  const selectedPrimary = primaryTickets.find((t) => (form.qty[t.id] ?? 0) > 0)
  // family tickets appear once the days are chosen, and only the ones that fit those days
  const fitting = selectedPrimary ? extraTickets.filter((t) => ticketFits(selectedPrimary, t)) : []
  const notFitting = selectedPrimary ? extraTickets.filter((t) => !ticketFits(selectedPrimary, t)) : extraTickets
  const coversDay = (d: number) => !!selectedPrimary && (!selectedPrimary.days || selectedPrimary.days.includes(d))
  const familyDays = [...new Set(extraTickets.flatMap((t) => t.days ?? []))].sort()
  const helpWanted = form.needs_accommodation === 'yes' || form.needs_local_travel === 'yes'
  const outdoorChosen = nDays > 1 && coversDay(nDays)

  const setQty = (t: TicketType, n: number) =>
    setForm((f) => {
      const names = [...(f.guestNames[t.id] ?? [])].slice(0, n)
      const food = [...(f.guestFood[t.id] ?? [])].slice(0, n)
      while (names.length < n) names.push('')
      while (food.length < n) food.push('')
      return { ...f, qty: { ...f.qty, [t.id]: n }, guestNames: { ...f.guestNames, [t.id]: names }, guestFood: { ...f.guestFood, [t.id]: food } }
    })
  const setPrimary = (id: string) =>
    setForm((f) => {
      const qty = { ...f.qty }
      for (const t of primaryTickets) qty[t.id] = t.id === id ? 1 : 0
      // family tickets that don't fit the new days are dropped (the server would refuse them)
      const chosen = primaryTickets.find((t) => t.id === id)
      for (const t of extraTickets) if (!ticketFits(chosen, t)) qty[t.id] = 0
      return { ...f, qty }
    })
  const setGuest = (t: TicketType, i: number, key: 'guestNames' | 'guestFood', v: string) =>
    setForm((f) => {
      const list = [...(f[key][t.id] ?? [])]
      list[i] = v
      return { ...f, [key]: { ...f[key], [t.id]: list } }
    })

  function validate(s: StepId): boolean {
    const e: Record<string, string> = {}
    let qe: Record<string, AnswerProblem> = {}
    if (s === 'details' && missing.length) e.profile = tx('rr.errProfile')
    if (s === 'days') {
      if (!selectedPrimary) e.primary = tx(reunion ? 'rr.errDays' : 'reg.errTicket')
      if (!form.food_pref) e.food_pref = tx('reg.errFood')
      if (!form.tshirt_size) e.tshirt_size = tx('reg.errTshirt')
      if (reunion && !form.needs_accommodation) e.accom = tx('rr.errYesNo')
      if (reunion && !form.needs_local_travel) e.travel = tx('rr.errYesNo')
    }
    if (s === 'involved') {
      if (!form.org_team) e.org_team = tx('rr.errYesNo')
      else if (form.org_team === 'yes' && !form.org_teams.length) e.org_teams = tx('rr.errTeams')
      if (!form.perform) e.perform = tx('rr.errYesNo')
      else if (form.perform === 'yes') {
        if (!form.perform_types.length) e.perform_types = tx('rr.errPerformTypes')
        if (!form.perform_group) e.perform_group = tx('rr.errSoloGroup')
        const m = Number(form.perform_minutes)
        if (!/^\d{1,2}$/.test(form.perform_minutes) || m < 1 || m > 30) e.perform_minutes = tx('rr.errMinutes')
      }
      if (!form.fund) e.fund = tx('rr.errYesNo')
      else if (form.fund === 'yes' && !fundOk(fundPaise)) e.fund_amount = tx('rr.errFund')
      if (!form.sponsor) e.sponsor = tx('rr.errYesNo')
      else if (form.sponsor === 'yes') {
        if (!form.sponsor_level) e.sponsor_level = tx('rr.errSponsorLevel')
        if (!form.sponsor_org.trim()) e.sponsor_org = tx('rr.errSponsorOrg')
      }
    }
    if (s === 'memorable') {
      qe = checkCustomAnswers(questions ?? [], form.custom)
      const ph = form.emergency_phone.trim()
      if (ph && !/^\+?[0-9 ]{8,16}$/.test(ph)) e.emergency_phone = tx('rr.errPhone')
      if (!!ph !== !!form.emergency_name.trim()) e.emergency = tx('rr.errEmergencyBoth')
    }
    if (s === 'review' && !form.accept_terms) e.accept_terms = tx('reg.errTerms')
    setErrors(e)
    setQErrors(qe)
    const ok = Object.keys(e).length === 0 && Object.keys(qe).length === 0
    // bring the first problem into view (the sticky footer can hide it) and move focus there
    if (!ok)
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[data-field-error], [role="alert"]')
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.closest('fieldset, section, div')?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true })
      })
    return ok
  }

  function nextStep() {
    if (validate(step)) setStepIdx((i) => Math.min(i + 1, steps.length - 1))
  }

  async function submit() {
    // every step is checked again, so a stale draft can't skip one
    for (const s of steps) {
      if (!validate(s)) {
        goTo(s)
        return
      }
    }
    if (!event || !profile) return
    const guests: Guest[] = fitting.flatMap((t) =>
      (form.guestNames[t.id] ?? []).slice(0, form.qty[t.id] ?? 0).map((name, i) => ({
        name: name.trim(),
        relation: t.label,
        ticket_type_id: t.id,
        food: (form.guestFood[t.id]?.[i] || null) as FoodPref | null,
      })),
    )
    const yn = (v: YN) => (reunion ? ynToBool(v) : (ynToBool(v) ?? false))
    try {
      const saved = await upsert.mutateAsync({
        details: {
          full_name: profile.full_name,
          email,
          phone: phone ?? '',
          branch: profile.branch ?? '',
          grad_year: profile.grad_year ? String(profile.grad_year) : '',
          city: profile.city ?? '',
          tshirt_size: form.tshirt_size,
          food_pref: form.food_pref,
          needs_accommodation: yn(form.needs_accommodation),
          needs_local_travel: yn(form.needs_local_travel),
          arrival_note: form.arrival_note,
          arrival_from: helpWanted ? form.arrival_from : '',
          arrival_date: helpWanted ? form.arrival_date : '',
          arrival_mode: helpWanted ? form.arrival_mode : '',
          notes: form.notes,
          guests,
          accept_terms: form.accept_terms,
          photo_consent: form.photo_consent,
          ...(reunion
            ? {
                org_team_interest: ynToBool(form.org_team),
                org_teams: form.org_team === 'yes' ? form.org_teams : [],
                perform_interest: ynToBool(form.perform),
                perform_types: form.perform === 'yes' ? form.perform_types : [],
                perform_group: form.perform === 'yes' ? form.perform_group === 'group' : null,
                perform_members: form.perform === 'yes' && form.perform_group === 'group' ? form.perform_members : '',
                perform_description: form.perform === 'yes' ? form.perform_description : '',
                perform_minutes: form.perform === 'yes' ? Number(form.perform_minutes) : null,
                fund_interest: ynToBool(form.fund),
                fund_paise: form.fund === 'yes' ? fundPaise : 0,
                sponsor_interest: ynToBool(form.sponsor),
                sponsor_level: form.sponsor === 'yes' ? form.sponsor_level : '',
                sponsor_org: form.sponsor === 'yes' ? form.sponsor_org : '',
                sponsor_note: form.sponsor === 'yes' ? form.sponsor_note : '',
                nickname: form.nickname,
                hostel: form.hostel,
                faculty_wish: form.faculty_wish,
                song_requests: form.songs.map((x) => x.trim()).filter(Boolean),
                memory: form.memory,
                memory_wall_consent: form.memory_wall_consent && !!form.memory.trim(),
                emergency_name: form.emergency_name,
                emergency_phone: form.emergency_phone,
                medical_notes: form.medical_notes,
              }
            : {}),
          feedback: form.feedback,
          custom_answers: cleanCustomAnswers(questions ?? [], form.custom),
        },
        items: (tickets ?? []).map((t) => ({ ticket_type_id: t.id, quantity: form.qty[t.id] ?? 0 })),
      })
      clearDraft()
      if (!locked && saved.amount_paise !== total) {
        toast.info(tx('reg.feesUpdated', { total: formatPaise(saved.amount_paise) }))
      }
      if (locked) toast.success(tx('rr.saved'))
      navigate('/meet/my', { replace: true, state: { justRegistered: !locked } })
    } catch {
      /* shown below */
    }
  }

  const err = (k: string) => errors[k] ?? null
  const reviewSection = (s: StepId, children: ReactNode) => (
    <section aria-label={stepLabel(s)}>
      <SectionTitle
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-primary" onClick={() => goTo(s)} aria-label={tx('rr.editSection', { section: stepLabel(s) })}>
            <Pencil className="size-3.5" aria-hidden /> {tx('rr.edit')}
          </button>
        }
      >
        {stepLabel(s)}
      </SectionTitle>
      <Card className="px-4">
        <dl className="divide-y divide-border">{children}</dl>
      </Card>
    </section>
  )
  const yesNoText = (v: YN) => (v === 'yes' ? tx('common.yes') : v === 'no' ? tx('common.no') : '—')

  return (
    <div ref={topRef} className="scroll-mt-0">
      <PageHeader title={locked ? tx('reg.updateTitle') : tx('reg.title')} subtitle={event.title} back="/meet" />
      <Page className="space-y-6">
        {/* step indicator */}
        <div>
          <ol className="flex items-center gap-1.5" aria-label={tx('reg.progress')}>
            {steps.map((s, i) => (
              <li key={s} className="flex-1" aria-current={i === stepIdx ? 'step' : undefined}>
                <span className={clsx('block h-1.5 rounded-full', i <= stepIdx ? 'bg-primary' : 'bg-surface-2')} />
                <span className="sr-only">
                  {i + 1}. {stepLabel(s)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 flex items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-primary" aria-live="polite">
              {tx('rr.stepOf', { n: stepIdx + 1, total: steps.length, label: stepLabel(step) })}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-muted">
              <Clock className="size-3.5" aria-hidden /> {tx('rr.twoMinutes')}
            </span>
          </p>
        </div>

        {step === 'details' && (
          <section className="space-y-5">
            <WelcomeHeader event={event} />
            <ProfileCard profile={profile} email={email} phone={phone} experiences={exps} missing={missing} reunion={reunion} error={err('profile')} />
            {outsideBatch && (
              <Notice tone="warning" title={tx('reg.outsideTitle', { from: event.eligible_from_year!, to: event.eligible_to_year! })}>
                {tx('reg.outsideBody', { year: profile.grad_year! })}
              </Notice>
            )}
            {locked && (
              <Notice tone="info" title={tx('reg.lockedTitle')}>
                {tx('rr.lockedBody')}
              </Notice>
            )}
          </section>
        )}

        {step === 'days' && (
          <section className="space-y-6">
            {locked && <Notice tone="info" title={tx('reg.lockedTitle')}>{tx('rr.lockedBody')}</Notice>}
            {primaryTickets.length > 1 ? (
              <ChoiceGroup
                label={reunion ? tx('rr.whichDays') : tx('reg.yourTicket')}
                options={primaryTickets.map((t) => ({ value: t.id, label: `${t.label} · ${formatPaise(t.price_paise)}`, hint: t.description ?? undefined }))}
                value={selectedPrimary?.id ?? null}
                onChange={(id) => !locked && setPrimary(id)}
                error={err('primary')}
              />
            ) : (
              selectedPrimary && (
                <div>
                  <SectionTitle>{tx('reg.yourTicket')}</SectionTitle>
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
                <SectionTitle>{tx('reg.family')}</SectionTitle>
                {notFitting.length > 0 && familyDays.length > 0 && (
                  <Notice tone="info" className="mb-3" title={tx('rr.familyOnly', { days: familyDays.map((d) => dayLabel(event, d)).join(' & ') })}>
                    {selectedPrimary ? tx('rr.familyHow') : tx('rr.familyChooseFirst')}
                  </Notice>
                )}
                {fitting.length > 0 && (
                  <Card className="divide-y divide-border">
                    {fitting.map((t) => {
                      const n = form.qty[t.id] ?? 0
                      return (
                        <div key={t.id} className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{t.label}</p>
                              <p className="text-sm text-muted">
                                {formatPaise(t.price_paise)} {t.price_paise > 0 && tx('reg.each')}
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
                            <div className="mt-3 space-y-3">
                              {Array.from({ length: n }, (_, i) => (
                                <div key={i} className={clsx('grid gap-2', reunion && 'grid-cols-[minmax(0,1fr)_8.5rem]')}>
                                  <Input
                                    aria-label={tx('reg.guestNameLabel', { label: t.label, n: i + 1 })}
                                    placeholder={tx('reg.guestNamePh', { label: t.label.toLowerCase().split(/ [(·]/)[0]!, n: n > 1 ? i + 1 : '' })}
                                    value={form.guestNames[t.id]?.[i] ?? ''}
                                    maxLength={80}
                                    onChange={(e) => setGuest(t, i, 'guestNames', e.target.value)}
                                  />
                                  {reunion && (
                                    <Select aria-label={tx('rr.guestFoodLabel', { label: t.label, n: i + 1 })} value={form.guestFood[t.id]?.[i] ?? ''} onChange={(e) => setGuest(t, i, 'guestFood', e.target.value)}>
                                      <option value="">{tx('rr.guestFoodPh')}</option>
                                      {foodOptions(tx).map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </Select>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </Card>
                )}
              </div>
            )}

            <ChoiceGroup label={reunion ? tx('rr.yourFood') : tx('reg.food')} options={foodOptions(tx)} value={(form.food_pref || null) as never} onChange={(v) => set('food_pref', v)} error={err('food_pref')} />
            <Field label={reunion ? tx('rr.tshirt') : tx('reg.tshirt')} error={err('tshirt_size')} hint={reunion ? tx('rr.tshirtHint') : tx('reg.tshirtHint')}>
              {(p) => (
                <Select {...p} value={form.tshirt_size} onChange={(e) => set('tshirt_size', e.target.value)}>
                  <option value="">{tx('reg.chooseSize')}</option>
                  {TSHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {tshirtLabel(tx, s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {reunion ? (
              <div className="space-y-4">
                <SectionTitle>{tx('rr.helpTitle')}</SectionTitle>
                <Notice tone="info" title={tx('rr.vendorNote')} />
                <YesNo label={tx('rr.accomQ')} value={form.needs_accommodation} onChange={(v) => set('needs_accommodation', v)} error={err('accom')} />
                <YesNo label={tx('rr.travelQ')} value={form.needs_local_travel} onChange={(v) => set('needs_local_travel', v)} error={err('travel')} />
                {helpWanted && (
                  <Card className="space-y-4 p-4">
                    <p className="text-sm font-semibold">{tx('rr.arrivalTitle')}</p>
                    <Field label={tx('rr.arrivingFrom')} optional>{(p) => <Input {...p} maxLength={80} value={form.arrival_from} onChange={(e) => set('arrival_from', e.target.value)} />}</Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={tx('rr.arrivalDate')} optional>{(p) => <Input {...p} type="date" min={shiftDate(event.starts_at, -10)} max={shiftDate(event.ends_at ?? event.starts_at, 1)} value={form.arrival_date} onChange={(e) => set('arrival_date', e.target.value)} />}</Field>
                      <Field label={tx('rr.arrivalMode')} optional>
                        {(p) => (
                          <Select {...p} value={form.arrival_mode} onChange={(e) => set('arrival_mode', e.target.value)}>
                            <option value="">{tx('rr.choose')}</option>
                            {ARRIVAL_MODES.map((m) => (
                              <option key={m} value={m}>
                                {modeLabel(tx, m)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                  </Card>
                )}
                <Field label={tx('reg.arrival')} optional hint={tx('reg.arrivalHint')}>
                  {(p) => <Input {...p} maxLength={300} value={form.arrival_note} onChange={(e) => set('arrival_note', e.target.value)} />}
                </Field>
              </div>
            ) : (
              <>
                <ChoiceGroup
                  label={tx('reg.accomQ')}
                  options={[
                    { value: 'no', label: tx('reg.accomNo') },
                    { value: 'yes', label: tx('reg.accomYes') },
                  ]}
                  value={form.needs_accommodation === 'yes' ? 'yes' : 'no'}
                  onChange={(v) => set('needs_accommodation', v as YN)}
                  columns={2}
                />
                <Field label={tx('reg.arrival')} optional hint={tx('reg.arrivalHint')}>
                  {(p) => <Input {...p} maxLength={300} value={form.arrival_note} onChange={(e) => set('arrival_note', e.target.value)} />}
                </Field>
              </>
            )}
          </section>
        )}

        {step === 'involved' && (
          <section className="space-y-8">
            <div className="space-y-4">
              <YesNo label={tx('rr.teamQ')} value={form.org_team} onChange={(v) => set('org_team', v)} error={err('org_team')} />
              {form.org_team === 'yes' && (
                <MultiChoice label={tx('rr.teamWhich')} options={ORG_TEAMS.map((v) => ({ value: v, label: teamLabel(tx, v) }))} value={form.org_teams} onChange={(v) => set('org_teams', v)} error={err('org_teams')} />
              )}
            </div>

            <div className="space-y-4">
              <YesNo label={tx('rr.performQ')} value={form.perform} onChange={(v) => set('perform', v)} error={err('perform')} />
              {form.perform === 'yes' && (
                <Card className="space-y-4 p-4">
                  <MultiChoice label={tx('rr.performWhat')} options={PERFORM_TYPES.map((v) => ({ value: v, label: performLabel(tx, v) }))} value={form.perform_types} onChange={(v) => set('perform_types', v)} error={err('perform_types')} />
                  <ChoiceGroup
                    label={tx('rr.soloGroup')}
                    columns={2}
                    options={[
                      { value: 'solo', label: tx('rr.solo') },
                      { value: 'group', label: tx('rr.group') },
                    ]}
                    value={form.perform_group || null}
                    onChange={(v) => set('perform_group', v as 'solo' | 'group')}
                    error={err('perform_group')}
                  />
                  {form.perform_group === 'group' && (
                    <Field label={tx('rr.groupMembers')} optional hint={tx('rr.groupMembersHint')}>
                      {(p) => <Input {...p} maxLength={300} value={form.perform_members} onChange={(e) => set('perform_members', e.target.value)} />}
                    </Field>
                  )}
                  <Field label={tx('rr.performAbout')} optional hint={tx('rr.performAboutHint')}>
                    {(p) => <Input {...p} maxLength={300} value={form.perform_description} onChange={(e) => set('perform_description', e.target.value)} />}
                  </Field>
                  <Field label={tx('rr.performMinutes')} error={err('perform_minutes')} hint={tx('rr.performMinutesHint')}>
                    {(p) => <Input {...p} inputMode="numeric" className="max-w-32" maxLength={2} value={form.perform_minutes} onChange={(e) => set('perform_minutes', e.target.value.replace(/[^\d]/g, ''))} />}
                  </Field>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <YesNo label={tx('rr.fundQ')} value={form.fund} onChange={(v) => !locked && set('fund', v)} error={err('fund')} disabled={locked} />
              <p className="-mt-2 text-sm text-muted">{tx('rr.fundHint')}</p>
              {locked && <Notice tone="info" title={tx('rr.fundLocked')} />}
              {form.fund === 'yes' && (
                <FundPicker choice={form.fund_choice} custom={form.fund_custom} onChoice={(v) => set('fund_choice', v)} onCustom={(v) => set('fund_custom', v)} error={err('fund_amount')} locked={locked} />
              )}
            </div>

            <div className="space-y-4">
              <YesNo label={tx('rr.sponsorQ')} value={form.sponsor} onChange={(v) => set('sponsor', v)} error={err('sponsor')} />
              {form.sponsor === 'yes' && (
                <Card className="space-y-4 p-4">
                  <ChoiceGroup label={tx('rr.sponsorLevel')} columns={2} options={SPONSOR_LEVELS.map((v) => ({ value: v, label: sponsorLabel(tx, v) }))} value={form.sponsor_level || null} onChange={(v) => set('sponsor_level', v)} error={err('sponsor_level')} />
                  <Field label={tx('rr.sponsorOrg')} error={err('sponsor_org')} hint={tx('rr.sponsorOrgHint')}>
                    {(p) => <Input {...p} maxLength={120} value={form.sponsor_org} onChange={(e) => set('sponsor_org', e.target.value)} />}
                  </Field>
                  <Field label={tx('rr.sponsorNote')} optional>
                    {(p) => <Textarea {...p} rows={2} maxLength={500} value={form.sponsor_note} onChange={(e) => set('sponsor_note', e.target.value)} />}
                  </Field>
                  <p className="text-sm text-muted">{tx('rr.sponsorContact')}</p>
                </Card>
              )}
            </div>
          </section>
        )}

        {step === 'memorable' && (
          <section className="space-y-6">
            {reunion && (
              <>
                <p className="text-[15px] text-muted">{tx('rr.memorableIntro')}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={tx('rr.nickname')} optional hint={tx('rr.nicknameHint')}>{(p) => <Input {...p} maxLength={40} value={form.nickname} onChange={(e) => set('nickname', e.target.value)} />}</Field>
                  <Field label={tx('rr.hostel')} optional>{(p) => <Input {...p} maxLength={80} value={form.hostel} onChange={(e) => set('hostel', e.target.value)} />}</Field>
                </div>
                <Field label={tx('rr.faculty')} optional hint={tx('rr.facultyHint')}>{(p) => <Textarea {...p} rows={2} maxLength={500} value={form.faculty_wish} onChange={(e) => set('faculty_wish', e.target.value)} />}</Field>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold">
                    {tx('rr.songs')} <span className="font-normal text-muted">({tx('common.optional')})</span>
                  </legend>
                  {form.songs.map((v, i) => (
                    <Input key={i} aria-label={tx('rr.songN', { n: i + 1 })} placeholder={tx('rr.songN', { n: i + 1 })} maxLength={100} value={v} onChange={(e) => set('songs', form.songs.map((x, j) => (j === i ? e.target.value : x)))} />
                  ))}
                </fieldset>
                <div className="space-y-2">
                  <Field label={tx('rr.memory')} optional hint={tx('rr.memoryHint')}>{(p) => <Textarea {...p} rows={3} maxLength={1000} value={form.memory} onChange={(e) => set('memory', e.target.value)} />}</Field>
                  {form.memory.trim() && (
                    <Checkbox checked={form.memory_wall_consent} onChange={(v) => set('memory_wall_consent', v)}>
                      {tx('rr.memoryWall')}
                    </Checkbox>
                  )}
                </div>
                <div className="space-y-4">
                  <SectionTitle>{tx('rr.emergencyTitle')}</SectionTitle>
                  {outdoorChosen && <Notice tone="info" title={tx('rr.emergencyPrompt', { day: dayLabel(event, nDays) })} />}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={tx('rr.emergencyName')} optional>{(p) => <Input {...p} maxLength={80} value={form.emergency_name} onChange={(e) => set('emergency_name', e.target.value)} />}</Field>
                    <Field label={tx('rr.emergencyPhone')} optional error={err('emergency_phone')}>
                      {(p) => <Input {...p} type="tel" inputMode="tel" maxLength={16} value={form.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} />}
                    </Field>
                  </div>
                  {errors.emergency && (
                    <p className="text-sm text-danger" role="alert" data-field-error>
                      {errors.emergency}
                    </p>
                  )}
                  <Field label={tx('rr.medical')} optional hint={tx('rr.privateHint')}>{(p) => <Textarea {...p} rows={2} maxLength={300} value={form.medical_notes} onChange={(e) => set('medical_notes', e.target.value)} />}</Field>
                </div>
              </>
            )}
            {activeQuestions.length > 0 && (
              <div className="space-y-5">
                <SectionTitle>{tx('rr.organisersAsk')}</SectionTitle>
                {activeQuestions.map((q) => (
                  <QuestionField key={q.id} q={q} value={form.custom[q.id]} onChange={(v) => set('custom', { ...form.custom, [q.id]: v })} error={qErrors[q.id]} />
                ))}
              </div>
            )}
            <Field label={tx('rr.feedback')} optional hint={tx('rr.feedbackHint')}>
              {(p) => <Textarea {...p} rows={3} maxLength={2000} value={form.feedback} onChange={(e) => set('feedback', e.target.value)} />}
            </Field>
            <Field label={tx('reg.notes')} optional hint={tx('reg.notesHint')}>
              {(p) => <Textarea {...p} maxLength={1000} rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}
            </Field>
          </section>
        )}

        {step === 'review' && (
          <section className="space-y-6">
            {reviewSection(
              'details',
              <>
                <KeyValue label={tx('rr.fullName')}>{profile.full_name}</KeyValue>
                <KeyValue label={tx('rr.mobile')}>{phone ?? '—'}</KeyValue>
                <KeyValue label={tx('rr.batchBranch')}>{[profile.grad_year, profile.branch].filter(Boolean).join(' · ') || '—'}</KeyValue>
                <KeyValue label={tx('rr.cityCountry')}>{[profile.city, profile.country].filter(Boolean).join(', ') || '—'}</KeyValue>
              </>,
            )}
            {reviewSection(
              'days',
              <>
                {(tickets ?? [])
                  .filter((t) => (form.qty[t.id] ?? 0) > 0)
                  .map((t) => (
                    <KeyValue key={t.id} label={`${t.label} × ${form.qty[t.id]}`}>
                      {formatPaise(t.price_paise * (form.qty[t.id] ?? 0))}
                    </KeyValue>
                  ))}
                {fitting.some((t) => (form.qty[t.id] ?? 0) > 0) && (
                  <KeyValue label={tx('my.withYou')}>
                    {fitting
                      .flatMap((t) => (form.guestNames[t.id] ?? []).slice(0, form.qty[t.id] ?? 0).map((nm, i) => [nm.trim() || t.label, form.guestFood[t.id]?.[i] ? `(${foodLabel(tx, form.guestFood[t.id]![i])})` : ''].filter(Boolean).join(' ')))
                      .join(', ')}
                  </KeyValue>
                )}
                <KeyValue label={tx('reg.foodShort')}>{foodLabel(tx, form.food_pref)}</KeyValue>
                <KeyValue label={tx('reg.tshirtShort')}>{tshirtLabel(tx, form.tshirt_size)}</KeyValue>
                <KeyValue label={tx('reg.accomShort')}>{yesNoText(reunion ? form.needs_accommodation : form.needs_accommodation === 'yes' ? 'yes' : 'no')}</KeyValue>
                {reunion && <KeyValue label={tx('rr.travelShort')}>{yesNoText(form.needs_local_travel)}</KeyValue>}
                {helpWanted && (form.arrival_from || form.arrival_date || form.arrival_mode) && (
                  <KeyValue label={tx('rr.arrivalTitle')}>{[form.arrival_from, form.arrival_date, modeLabel(tx, form.arrival_mode)].filter(Boolean).join(' · ')}</KeyValue>
                )}
              </>,
            )}
            {reunion &&
              reviewSection(
                'involved',
                <>
                  <KeyValue label={tx('rr.teamShort')}>{form.org_team === 'yes' ? form.org_teams.map((v) => teamLabel(tx, v)).join(', ') : yesNoText(form.org_team)}</KeyValue>
                  <KeyValue label={tx('rr.performShort')}>
                    {form.perform === 'yes'
                      ? `${form.perform_types.map((v) => performLabel(tx, v)).join(', ')} · ${form.perform_group === 'group' ? tx('rr.group') : tx('rr.solo')} · ${tx('rr.minutes', { n: form.perform_minutes })}`
                      : yesNoText(form.perform)}
                  </KeyValue>
                  <KeyValue label={tx('rr.fundShort')}>{form.fund === 'yes' && fundOk(fundPaise) ? formatPaise(fundPaise) : yesNoText(form.fund)}</KeyValue>
                  <KeyValue label={tx('rr.sponsorShort')}>{form.sponsor === 'yes' ? `${sponsorLabel(tx, form.sponsor_level)} · ${form.sponsor_org}` : yesNoText(form.sponsor)}</KeyValue>
                </>,
              )}
            {reviewSection(
              'memorable',
              <>
                {reunion && form.nickname.trim() && <KeyValue label={tx('rr.nicknameShort')}>{form.nickname}</KeyValue>}
                {reunion && form.hostel.trim() && <KeyValue label={tx('rr.hostel')}>{form.hostel}</KeyValue>}
                {reunion && form.songs.some((x) => x.trim()) && <KeyValue label={tx('rr.songsShort')}>{form.songs.filter((x) => x.trim()).join(', ')}</KeyValue>}
                {reunion && form.emergency_name.trim() && <KeyValue label={tx('rr.emergencyTitle')}>{`${form.emergency_name} · ${form.emergency_phone}`}</KeyValue>}
                {activeQuestions
                  .filter((q) => answerText(form.custom[q.id]))
                  .map((q) => (
                    <KeyValue key={q.id} label={q.label}>
                      {answerText(form.custom[q.id], tx('common.yes'), tx('common.no'))}
                    </KeyValue>
                  ))}
                <KeyValue label={tx('rr.feedbackShort')}>{form.feedback.trim() ? tx('rr.added') : '—'}</KeyValue>
              </>,
            )}

            <div>
              <SectionTitle>{tx('reg.summary')}</SectionTitle>
              <Card className="px-4">
                <dl className="divide-y divide-border">
                  <KeyValue label={tx('rr.ticketsSubtotal', { people: tx('common.people', { count: people }) })}>{formatPaise(ticketsTotal, { zeroAsFree: false })}</KeyValue>
                  {reunion && <KeyValue label={tx('rr.fundLine')}>{formatPaise(fundOk(fundPaise) ? fundPaise : 0, { zeroAsFree: false })}</KeyValue>}
                  <div className="flex items-center justify-between py-3.5">
                    <dt className="font-semibold">{tx('reg.total', { people: tx('common.people', { count: people }) })}</dt>
                    <dd className="text-xl font-bold tabular-nums">{formatPaise(total)}</dd>
                  </div>
                </dl>
              </Card>
            </div>
            <div className="space-y-2">
              <Checkbox checked={form.photo_consent} onChange={(v) => set('photo_consent', v)}>
                {tx('reg.photoConsent')}
              </Checkbox>
              <Checkbox checked={form.accept_terms} onChange={(v) => set('accept_terms', v)}>
                {tx('reg.agree1')}{' '}
                <a href="/terms" target="_blank" className="font-semibold text-primary underline">
                  {tx('reg.eventTerms')}
                </a>{' '}
                {tx('reg.and')}{' '}
                <a href="/privacy" target="_blank" className="font-semibold text-primary underline">
                  {tx('reg.privacyNotice')}
                </a>
                {tx('reg.agree2')}
              </Checkbox>
              {errors.accept_terms && (
                <p className="text-sm font-semibold text-danger" role="alert" data-field-error>
                  {errors.accept_terms}
                </p>
              )}
            </div>
            {upsert.error && <Notice tone="danger" title={friendlyError(upsert.error)} />}
          </section>
        )}

        {/* actions */}
        <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:bottom-0">
          <div className="mb-2 flex items-center justify-between text-[15px]">
            <span className="text-muted">
              {tx('common.people', { count: people })}
              {reunion && fundOk(fundPaise) && ` · ${tx('rr.inclFund', { amount: formatPaise(fundPaise) })}`}
            </span>
            <span className="font-bold tabular-nums">{formatPaise(total)}</span>
          </div>
          <div className="flex gap-3">
            {stepIdx > 0 && (
              <Button variant="secondary" size="lg" onClick={() => setStepIdx((i) => i - 1)}>
                {tx('common.back')}
              </Button>
            )}
            {step !== 'review' ? (
              <Button size="lg" className="flex-1" onClick={nextStep}>
                {tx('common.continue')}
              </Button>
            ) : (
              <Button size="lg" className="flex-1" loading={upsert.isPending} onClick={submit} icon={locked ? <Save className="size-5" /> : <Check className="size-5" />}>
                {locked ? tx('reg.save') : total > 0 ? tx('reg.confirmPay') : tx('reg.confirm')}
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted">{tx('rr.draftSaved')}</p>
        </div>
      </Page>
    </div>
  )
}

/** "2026-12-16" = the event's first day shifted by n days (bounds for the arrival date picker). */
function shiftDate(iso: string | null, n: number): string | undefined {
  if (!iso) return undefined
  return new Date(new Date(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

function WelcomeHeader({ event }: { event: EventRow }) {
  const tx = useT()
  return (
    <Card className="overflow-hidden">
      <div className="bg-hero px-5 py-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{tx('rr.welcome')}</p>
        <h2 className="mt-0.5 text-xl font-bold leading-tight">{event.title}</h2>
        {event.tagline && <p className="mt-1 text-[15px] text-hero-text">{event.tagline}</p>}
        <ul className="mt-3 space-y-1.5 text-sm text-hero-text">
          <li className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> {formatDateRange(event.starts_at, event.ends_at)}
          </li>
          {event.venue && (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> <span className="min-w-0">{event.venue}</span>
            </li>
          )}
        </ul>
      </div>
      <p className="px-5 py-3 text-sm text-muted">{tx('rr.welcomeBody')}</p>
    </Card>
  )
}

export type { MsgKey }
