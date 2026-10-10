// Building blocks of the registration form: yes/no and multi-choice questions, the "Your details" profile card with its
// inline mini-form, the Reunion Fund picker and the organisers' own questions.
import { BadgeCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, KeyValue, Notice } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { LinkedInIcon } from '../../components/ui/Icons'
import { PhoneInput, usePhoneError } from '../../components/ui/PhoneInput'
import { useT } from '../../i18n'
import { BRANCHES, CURRENT_YEAR, FUND_PRESETS, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import { formatPhone, normalizePhone } from '../../lib/phone'
import type { CustomAnswer, EventQuestion, Experience, Profile } from '../../lib/types'
import { useUpdateProfile, type ProfileUpdate } from '../profile/queries'
import { useAddExperiences } from './queries'
import { currentRole, pastJobs, type AnswerProblem, type ProfileField } from './reunion'

export type YN = '' | 'yes' | 'no'
export const ynToBool = (v: YN): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null)
export const boolToYn = (v: boolean | null | undefined): YN => (v === true ? 'yes' : v === false ? 'no' : '')

/** A required Yes / No question as two big choice cards. */
export function YesNo({ label, value, onChange, error, disabled }: { label: string; value: YN; onChange: (v: YN) => void; error?: string | null; disabled?: boolean }) {
  const tx = useT()
  return (
    <ChoiceGroup
      label={label}
      columns={2}
      options={[
        { value: 'yes', label: tx('common.yes') },
        { value: 'no', label: tx('common.no') },
      ]}
      value={value || null}
      onChange={(v) => !disabled && onChange(v as YN)}
      error={error}
    />
  )
}

/** Tick any number of options (checkboxes, each a 44px target). */
export function MultiChoice({ label, options, value, onChange, error, hint }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; error?: string | null; hint?: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="grid gap-x-4 sm:grid-cols-2">
        {options.map((o) => (
          <Checkbox key={o.value} checked={value.includes(o.value)} onChange={(on) => onChange(on ? [...value, o.value] : value.filter((x) => x !== o.value))}>
            {o.label}
          </Checkbox>
        ))}
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert" data-field-error>
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** "Your details (from your profile)": what the registration will record, and a short inline form for anything missing. */
export function ProfileCard({
  profile,
  email,
  phone,
  experiences,
  missing,
  reunion,
  error,
}: {
  profile: Profile
  email: string
  phone: string | null
  experiences: Experience[]
  missing: ProfileField[]
  reunion: boolean
  error?: string | null
}) {
  const tx = useT()
  const role = currentRole(profile, experiences)
  const past = pastJobs(experiences)
  const [addingJobs, setAddingJobs] = useState(false)
  return (
    <section aria-labelledby="your-details" className="space-y-3">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="your-details" className="font-semibold">
              {tx('rr.detailsTitle')}
            </h2>
            <p className="text-sm text-muted">{tx('rr.detailsSub')}</p>
          </div>
          <Link to="/welcome?edit=1&next=/meet/register" className="grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label={tx('reg.editDetails')}>
            <Pencil className="size-4" />
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">{tx('reg.registeringAs')}</p>
          <p className="font-semibold">{profile.full_name || '—'}</p>
          {profile.verification === 'verified' && (
            <Badge tone="success">
              <BadgeCheck className="mr-1 inline size-3.5" aria-hidden />
              {tx('rr.verified')}
            </Badge>
          )}
        </div>
        <dl className="mt-1 divide-y divide-border">
          <KeyValue label={tx('rr.email')}>{email || '—'}</KeyValue>
          <KeyValue label={tx('rr.mobile')}>{formatPhone(phone) || '—'}</KeyValue>
          <KeyValue label={tx('rr.batchBranch')}>{[profile.grad_year, profile.branch].filter(Boolean).join(' · ') || '—'}</KeyValue>
          <KeyValue label={tx('rr.cityCountry')}>{[profile.city, profile.country].filter(Boolean).join(', ') || '—'}</KeyValue>
          {reunion && <KeyValue label={tx('rr.currentRole')}>{[role.designation, role.company].filter(Boolean).join(tx('rr.at')) || '—'}</KeyValue>}
          {reunion && (
            <KeyValue label={tx('rr.pastRoles')}>
              {past.length ? (
                <span className="block text-right">{past.join('; ')}</span>
              ) : (
                <span className="text-muted">{tx('rr.noneAdded')}</span>
              )}
            </KeyValue>
          )}
        </dl>
        {reunion && past.length === 0 && !addingJobs && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAddingJobs(true)}>
              {tx('rr.addPastJobs')}
            </Button>
            <Link to="/me/import?next=/meet/register" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-primary">
              <LinkedInIcon className="size-4" /> {tx('rr.importLinkedIn')}
            </Link>
          </div>
        )}
        {addingJobs && <PastJobsForm onDone={() => setAddingJobs(false)} />}
      </Card>
      {missing.length > 0 && <MissingDetailsForm profile={profile} phone={phone} experiences={experiences} missing={missing} />}
      {error && <Notice tone="danger" title={error} />}
    </section>
  )
}

/** The fields the profile is missing, saved straight to the profile (no detour to another page). */
function MissingDetailsForm({ profile, phone, experiences, missing }: { profile: Profile; phone: string | null; experiences: Experience[]; missing: ProfileField[] }) {
  const tx = useT()
  const update = useUpdateProfile()
  const phoneError = usePhoneError()
  const role = currentRole(profile, experiences)
  const [f, setF] = useState({
    full_name: profile.full_name ?? '',
    phone: phone ?? '',
    grad_year: profile.grad_year ? String(profile.grad_year) : '',
    branch: profile.branch ?? '',
    city: profile.city ?? '',
    country: profile.country ?? 'India',
    designation: role.designation,
    company: role.company,
  })
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const has = (k: ProfileField) => missing.includes(k)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function save() {
    const e: Partial<Record<ProfileField, string>> = {}
    if (has('full_name') && !f.full_name.trim()) e.full_name = tx('rr.errRequired')
    if (has('phone')) {
      const pe = phoneError(f.phone, true)
      if (pe) e.phone = pe
    }
    if (has('grad_year') && !f.grad_year) e.grad_year = tx('rr.errRequired')
    if (has('branch') && !f.branch) e.branch = tx('rr.errRequired')
    if (has('city') && !f.city.trim()) e.city = tx('rr.errRequired')
    if (has('country') && !f.country.trim()) e.country = tx('rr.errRequired')
    if (has('designation') && !f.designation.trim()) e.designation = tx('rr.errRequired')
    if (has('company') && !f.company.trim()) e.company = tx('rr.errRequired')
    setErrors(e)
    if (Object.keys(e).length) return
    const p: ProfileUpdate = {}
    if (has('full_name')) p.full_name = f.full_name.trim()
    if (has('grad_year')) p.grad_year = Number(f.grad_year)
    if (has('branch')) p.branch = f.branch
    if (has('city')) p.city = f.city.trim()
    if (has('country')) p.country = f.country.trim()
    if (has('designation')) p.current_title = f.designation.trim()
    if (has('company')) p.current_company = f.company.trim()
    try {
      await update.mutateAsync({ profile: p, ...(has('phone') ? { phone: normalizePhone(f.phone) } : {}) })
      toast.success(tx('rr.profileSaved'))
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  return (
    <Card className="space-y-4 border-accent/60 p-4">
      <div>
        <p className="font-semibold">{tx('rr.missingTitle')}</p>
        <p className="text-sm text-muted">{tx('rr.missingBody')}</p>
      </div>
      {has('full_name') && <Field label={tx('rr.fullName')} error={errors.full_name}>{(p) => <Input {...p} autoComplete="name" maxLength={120} value={f.full_name} onChange={set('full_name')} />}</Field>}
      {has('phone') && (
        <Field label={tx('rr.mobile')} error={errors.phone} hint={tx('rr.mobileHint')}>
          {(p) => <PhoneInput {...p} value={f.phone} onChange={(v) => setF((s) => ({ ...s, phone: v }))} />}
        </Field>
      )}
      {(has('grad_year') || has('branch')) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {has('grad_year') && (
            <Field label={tx('rr.gradYear')} error={errors.grad_year}>
              {(p) => (
                <Select {...p} value={f.grad_year} onChange={set('grad_year')}>
                  <option value="">{tx('rr.choose')}</option>
                  {yearRange(1960, CURRENT_YEAR + 4).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {has('branch') && (
            <Field label={tx('rr.branch')} error={errors.branch}>
              {(p) => (
                <Select {...p} value={f.branch} onChange={set('branch')}>
                  <option value="">{tx('rr.choose')}</option>
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}
      {(has('city') || has('country')) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {has('city') && <Field label={tx('rr.city')} error={errors.city}>{(p) => <Input {...p} autoComplete="address-level2" maxLength={80} value={f.city} onChange={set('city')} />}</Field>}
          {has('country') && <Field label={tx('rr.country')} error={errors.country}>{(p) => <Input {...p} autoComplete="country-name" maxLength={80} value={f.country} onChange={set('country')} />}</Field>}
        </div>
      )}
      {(has('designation') || has('company')) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {has('designation') && <Field label={tx('rr.designation')} error={errors.designation} hint={tx('rr.designationHint')}>{(p) => <Input {...p} maxLength={120} value={f.designation} onChange={set('designation')} />}</Field>}
          {has('company') && <Field label={tx('rr.company')} error={errors.company}>{(p) => <Input {...p} maxLength={120} value={f.company} onChange={set('company')} />}</Field>}
        </div>
      )}
      <Button onClick={save} loading={update.isPending}>
        {tx('rr.saveToProfile')}
      </Button>
    </Card>
  )
}

/** "Title at company" rows for earlier jobs, added to the profile's experience. */
function PastJobsForm({ onDone }: { onDone: () => void }) {
  const tx = useT()
  const add = useAddExperiences()
  const [rows, setRows] = useState([{ title: '', company: '' }])
  const [error, setError] = useState<string | null>(null)
  async function save() {
    const clean = rows.map((r) => ({ title: r.title.trim(), company: r.company.trim() })).filter((r) => r.title || r.company)
    if (clean.some((r) => !r.title || !r.company)) return setError(tx('rr.errJob'))
    setError(null)
    try {
      await add.mutateAsync(clean)
      if (clean.length) toast.success(tx('rr.profileSaved'))
      onDone()
    } catch (err) {
      setError(friendlyError(err))
    }
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-surface-2 p-3">
      <p className="text-sm font-semibold">{tx('rr.pastJobsTitle')}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={tx('rr.jobTitleN', { n: i + 1 })} placeholder={tx('rr.jobTitlePh')} maxLength={160} value={r.title} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Input aria-label={tx('rr.jobCompanyN', { n: i + 1 })} placeholder={tx('rr.jobCompanyPh')} maxLength={160} value={r.company} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)))} />
          </div>
          <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface" aria-label={tx('rr.removeJob', { n: i + 1 })} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [{ title: '', company: '' }]))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {rows.length < 6 && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, { title: '', company: '' }])}>
            {tx('rr.addAnotherJob')}
          </Button>
        )}
        <Button size="sm" onClick={save} loading={add.isPending}>
          {tx('rr.saveJobs')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {tx('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

/** Reunion Fund: presets or another amount (₹100 – ₹10,00,000). Locked after payment. */
export function FundPicker({
  choice,
  custom,
  onChoice,
  onCustom,
  error,
  locked,
}: {
  choice: string
  custom: string
  onChoice: (v: string) => void
  onCustom: (v: string) => void
  error?: string | null
  locked: boolean
}) {
  const tx = useT()
  const id = useId()
  return (
    <div className="space-y-3">
      <ChoiceGroup
        label={tx('rr.fundAmount')}
        columns={2}
        options={[...FUND_PRESETS.map((p) => ({ value: String(p), label: formatPaise(p) })), { value: 'custom', label: tx('rr.fundOther') }]}
        value={choice || null}
        onChange={(v) => !locked && onChoice(v)}
        error={choice === 'custom' ? null : error}
      />
      {choice === 'custom' && (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-semibold">
            {tx('rr.fundCustom')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
              ₹
            </span>
            <Input id={id} inputMode="numeric" className="pl-8" disabled={locked} value={custom} maxLength={9} onChange={(e) => onCustom(e.target.value.replace(/[^\d]/g, ''))} aria-invalid={error ? true : undefined} />
          </div>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-sm text-muted">{tx('rr.fundRange')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** One of the organisers' own questions. */
export function QuestionField({ q, value, onChange, error }: { q: EventQuestion; value: CustomAnswer | undefined; onChange: (v: CustomAnswer | undefined) => void; error?: AnswerProblem }) {
  const tx = useT()
  const msg = error ? tx(`rr.q_${error}` as 'rr.q_required') : null
  const label = q.required ? q.label : `${q.label} (${tx('common.optional')})`
  const help = q.help ? <p className="-mt-1 text-sm text-muted">{q.help}</p> : null
  if (q.kind === 'yes_no') {
    return (
      <div className="space-y-2">
        <YesNo label={label} value={boolToYn(typeof value === 'boolean' ? value : null)} onChange={(v) => onChange(ynToBool(v) ?? undefined)} error={msg} />
        {help}
      </div>
    )
  }
  if (q.kind === 'single') {
    return (
      <div className="space-y-2">
        <ChoiceGroup label={label} options={q.options.map((o) => ({ value: o, label: o }))} value={typeof value === 'string' ? value : null} onChange={(v) => onChange(v)} error={msg} />
        {help}
      </div>
    )
  }
  if (q.kind === 'multi') {
    return <MultiChoice label={label} hint={q.help ?? undefined} options={q.options.map((o) => ({ value: o, label: o }))} value={Array.isArray(value) ? value : []} onChange={(v) => onChange(v)} error={msg} />
  }
  return (
    <Field label={q.label} optional={!q.required} hint={q.help} error={msg}>
      {(p) =>
        q.kind === 'short_text' ? (
          <Input {...p} maxLength={200} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Textarea {...p} rows={3} maxLength={2000} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  )
}
