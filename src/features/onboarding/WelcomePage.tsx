// The 30-second welcome, in two steps, then Home.
//   Step 1 "Your JEC": the details every member needs (name, who they are, branch, batch, city, mobile), prefilled from
//          whatever is known: the sign-in, the organisers' reunion list ("is this you?"), an admin-created profile.
//   Step 2 "What do you do?": optional. Fill from LinkedIn (when a provider is set up), or ONE Magic fill box (type,
//          paste LinkedIn text, or speak). "Skip for now" is always there. A finished profile ring, then Home.
import { toast } from 'sonner'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Avatar, Chip, Notice, PageSkeleton } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select } from '../../components/ui/Form'
import { PhoneInput, usePhoneError } from '../../components/ui/PhoneInput'
import { ProgressRing } from '../../components/ui/Progress'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import { useT, type MsgKey } from '../../i18n'
import { memberTypeOptions } from '../../i18n/labels'
import { safeNext } from '../../lib/safeNext'
import type { MemberType, Profile, ProfilePrivate } from '../../lib/types'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { profileCompleteness } from '../home/HomePage'
import { isOurAvatar, useImportProviderPhoto, useMyPrivate, useUpdateProfile } from '../profile/queries'
import { LinkedInFill } from '../quickprofile/LinkedInFill'
import { MagicFill } from '../quickprofile/MagicFill'
import { PrefillClaimCard } from '../quickprofile/PrefillClaimCard'
import { usePrefillMatch } from '../quickprofile/queries'

/** The branches most members pick, as big chips; the full list stays in the picker below them. */
const QUICK_BRANCHES: [MsgKey, (typeof BRANCHES)[number]][] = [
  ['qp.br.cse', 'B.E. in Computer Science & Engineering'],
  ['qp.br.mech', 'B.E. in Mechanical Engineering'],
  ['qp.br.etc', 'B.E. in Electronics & Telecommunications'],
  ['qp.br.ee', 'B.E. in Electrical Engineering'],
  ['qp.br.civil', 'B.E. in Civil Engineering'],
  ['qp.br.it', 'B.E. in Information Technology'],
  ['qp.br.ip', 'B.E. Industrial & Production Engineering'],
]

type Form = { full_name: string; member_type: MemberType | ''; branch: string; grad_year: string; join_year: string; city: string; phone: string }

const fromProfile = (p: Profile, priv: ProfilePrivate): Form => ({
  full_name: p.full_name ?? '',
  member_type: p.member_type ?? '',
  branch: p.branch ?? '',
  grad_year: p.grad_year ? String(p.grad_year) : '',
  join_year: p.join_year ? String(p.join_year) : '',
  city: p.city ?? '',
  phone: priv.phone ?? '',
})

function StepRing({ step }: { step: 1 | 2 }) {
  const tx = useT()
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-muted" aria-label={tx('qp.stepsAria')}>
      <ProgressRing value={step} max={2} size={36} stroke={4} label={tx('qp.step', { n: step })}>
        <span className="text-xs font-bold text-text">{step}</span>
      </ProgressRing>
      <span>{tx('qp.step', { n: step })}</span>
    </div>
  )
}

export function WelcomePage() {
  const tx = useT()
  const phoneError = usePhoneError()
  const { session } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const importPhoto = useImportProviderPhoto()
  // signed in with LinkedIn/Google: keep a permanent copy of the shared photo (the provider's link expires)
  const migrated = useRef(false)
  useEffect(() => {
    if (!profile || migrated.current || !profile.avatar_url || isOurAvatar(profile.avatar_url)) return
    migrated.current = true
    importPhoto.mutate('any', { onSuccess: (r) => toast.success(r.source === 'linkedin' ? tx('welcome.photoLinkedin') : tx('welcome.photoGoogle')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [profile])
  const { data: priv } = useMyPrivate()
  const update = useUpdateProfile()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const editing = !!params.get('edit')

  const [form, setForm] = useState<Form>({ full_name: '', member_type: '', branch: '', grad_year: '', join_year: '', city: '', phone: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [step, setStep] = useState<1 | 2 | 'done'>(1)
  const [refill, setRefill] = useState(false)
  // whether the member had finished onboarding when they arrived (saving step 1 sets it, step 2 must still show)
  const arrivedOnboarded = useRef<boolean | null>(null)

  useEffect(() => {
    if (profile && priv && !loaded) {
      setForm(fromProfile(profile, priv))
      arrivedOnboarded.current = profile.onboarded
      setLoaded(true)
    }
  }, [profile, priv, loaded])

  // after "Yes, fill my profile": take the claimed details into the empty fields of the form
  useEffect(() => {
    if (!refill || !profile || !priv) return
    const got = fromProfile(profile, priv)
    setForm((f) => {
      const out = { ...f }
      for (const k of Object.keys(out) as (keyof Form)[]) if (!out[k] && got[k]) (out as Record<string, string>)[k] = got[k]
      return out
    })
    setRefill(false)
  }, [refill, profile, priv])

  const phoneE164 = isValidPhone(form.phone) ? normalizePhone(form.phone) : null
  const emailMatch = usePrefillMatch({ enabled: loaded && step === 1 })
  const phoneMatch = usePrefillMatch({ phone: phoneE164, name: form.full_name, enabled: loaded && step === 2 && !!phoneE164 })

  // the profile ring, then Home
  useEffect(() => {
    if (step !== 'done') return
    const t = window.setTimeout(() => navigate(next, { replace: true }), 1600)
    return () => window.clearTimeout(t)
  }, [step, navigate, next])

  if (isLoading || !profile || !priv || !loaded) return <PageSkeleton />
  if (arrivedOnboarded.current && !editing && step === 1) return <Navigate to={next} replace />

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const isStudent = form.member_type === 'student'
  const isFaculty = form.member_type === 'faculty'

  function validate() {
    const e: Record<string, string> = {}
    if (form.full_name.trim().length < 2) e.full_name = tx('welcome.errName')
    if (!form.member_type) e.member_type = tx('welcome.errType')
    if (!isFaculty && !form.branch) e.branch = tx('welcome.errBranch')
    if (!isFaculty && !form.grad_year) e.grad_year = isStudent ? tx('welcome.errGradStudent') : tx('welcome.errGrad')
    if (!form.city.trim()) e.city = tx('welcome.errCity')
    const pe = phoneError(form.phone, true)
    if (pe) e.phone = pe
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    try {
      await update.mutateAsync({
        profile: {
          full_name: form.full_name.trim().replace(/\s+/g, ' '),
          member_type: form.member_type as MemberType,
          branch: form.branch || null,
          grad_year: form.grad_year ? Number(form.grad_year) : null,
          join_year: form.join_year ? Number(form.join_year) : null,
          city: form.city.trim(),
          onboarded: true,
        },
        phone: normalizePhone(form.phone),
      })
    } catch {
      return // error shown below the form
    }
    if (editing) return navigate(next, { replace: true })
    setStep(2)
    window.scrollTo({ top: 0 })
  }

  const wrap = 'mx-auto max-w-md px-4 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)] sm:px-5'

  if (step === 'done') {
    const pct = profileCompleteness(profile).percent
    return (
      <div className={`${wrap} flex min-h-dvh flex-col items-center justify-center gap-5 text-center`} data-testid="welcome-done">
        <ProgressRing value={pct} size={128} stroke={10} label={tx('qp.doneBody', { percent: pct })}>
          <span className="text-3xl font-bold tabular-nums">{pct}%</span>
        </ProgressRing>
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{tx('qp.doneTitle')}</h1>
          <p className="mt-1 text-muted" aria-live="polite">{tx('qp.doneBody', { percent: pct })}</p>
        </div>
        <Button size="lg" onClick={() => navigate(next, { replace: true })}>{tx('qp.goHome')}</Button>
      </div>
    )
  }

  if (step === 2) {
    const match = phoneMatch.data
    return (
      <div className={`${wrap} space-y-5`}>
        <StepRing step={2} />
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{tx('qp.step2Title')}</h1>
          <p className="mt-1 text-muted">{tx('qp.step2Intro')}</p>
        </div>
        {match && <PrefillClaimCard match={match} phone={phoneE164} name={form.full_name} onClaimed={() => setStep('done')} />}
        <LinkedInFill onSaved={() => setStep('done')} />
        <MagicFill onSaved={() => setStep('done')} />
        <Button size="lg" variant="ghost" block onClick={() => setStep('done')}>
          {tx('qp.skip')}
        </Button>
      </div>
    )
  }

  const gradYears = yearRange(1960, CURRENT_YEAR + 5)
  const claim = emailMatch.data
  return (
    <div className={wrap}>
      {!editing && <StepRing step={1} />}
      <div className="mb-4 mt-4 flex items-center gap-4">
        <Avatar src={profile.avatar_url} name={form.full_name || session?.user.email || '?'} size={56} />
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{tx('welcome.title')}</h1>
          {!editing && <p className="text-sm font-semibold text-primary">{tx('qp.step1Title')}</p>}
        </div>
      </div>
      <p className="mb-6 text-muted">{editing ? tx('welcome.intro') : tx('qp.step1Intro')}</p>

      {claim && !editing && (
        <div className="mb-6">
          <PrefillClaimCard match={claim} onClaimed={() => setRefill(true)} />
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label={tx('welcome.fullName')} error={errors.full_name}>
          {(p) => <Input {...p} autoComplete="name" value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} />}
        </Field>

        <ChoiceGroup label={tx('welcome.iAm')} options={memberTypeOptions(tx)} value={form.member_type || null} onChange={(v) => set('member_type')(v)} error={errors.member_type} />

        {!isFaculty && (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold" id="qp-branch-quick">{tx('qp.branchQuick')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="qp-branch-quick">
                {QUICK_BRANCHES.map(([label, value]) => (
                  <Chip key={value} selected={form.branch === value} onClick={() => set('branch')(value)}>
                    {tx(label)}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label={tx('welcome.branch')} error={errors.branch} hint={tx('qp.branchMore')}>
              {(p) => (
                <Select {...p} value={form.branch} onChange={(e) => set('branch')(e.target.value)}>
                  <option value="">{tx('welcome.chooseBranch')}</option>
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isStudent ? tx('welcome.gradStudent') : tx('welcome.grad')} error={errors.grad_year}>
                {(p) => (
                  <Select {...p} className="min-h-13 text-lg font-semibold" value={form.grad_year} onChange={(e) => set('grad_year')(e.target.value)}>
                    <option value="">{tx('welcome.year')}</option>
                    {gradYears.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={tx('welcome.joinYear')} optional>
                {(p) => (
                  <Select {...p} className="min-h-13" value={form.join_year} onChange={(e) => set('join_year')(e.target.value)}>
                    <option value="">{tx('welcome.year')}</option>
                    {gradYears.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </>
        )}

        <Field label={tx('welcome.city')} error={errors.city}>
          {(p) => <Input {...p} autoComplete="address-level2" placeholder={tx('welcome.cityPh')} value={form.city} onChange={(e) => set('city')(e.target.value)} />}
        </Field>

        <Field label={tx('welcome.phone')} error={errors.phone} hint={tx('welcome.phoneHint')}>
          {(p) => <PhoneInput {...p} value={form.phone} onChange={set('phone')} />}
        </Field>

        {update.error && <Notice tone="danger" title={friendlyError(update.error)} />}
        <Button type="submit" size="lg" block loading={update.isPending}>
          {tx('common.continue')}
        </Button>
      </form>
    </div>
  )
}
