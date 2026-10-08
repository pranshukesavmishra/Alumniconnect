import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Avatar, Notice, PageSkeleton } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, MEMBER_TYPES, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import type { MemberType } from '../../lib/types'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { useMyPrivate, useUpdateProfile } from '../profile/queries'

const PHONE = /^\+?[0-9 ]{10,16}$/

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function WelcomePage() {
  const { session } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const { data: priv } = useMyPrivate()
  const update = useUpdateProfile()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [form, setForm] = useState({ full_name: '', member_type: '' as MemberType | '', branch: '', grad_year: '', join_year: '', city: '', phone: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (profile && priv && !loaded) {
      setForm({
        full_name: profile.full_name ?? '',
        member_type: profile.member_type ?? '',
        branch: profile.branch ?? '',
        grad_year: profile.grad_year ? String(profile.grad_year) : '',
        join_year: profile.join_year ? String(profile.join_year) : '',
        city: profile.city ?? '',
        phone: priv.phone ?? '',
      })
      setLoaded(true)
    }
  }, [profile, priv, loaded])

  if (isLoading || !profile) return <PageSkeleton />
  if (profile.onboarded && !params.get('edit')) return <Navigate to={next} replace />

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const isStudent = form.member_type === 'student'
  const isFaculty = form.member_type === 'faculty'

  function validate() {
    const e: Record<string, string> = {}
    if (form.full_name.trim().length < 2) e.full_name = 'Please enter your full name.'
    if (!form.member_type) e.member_type = 'Please choose one.'
    if (!isFaculty && !form.branch) e.branch = 'Please choose your branch.'
    if (!isFaculty && !form.grad_year) e.grad_year = isStudent ? 'Please choose your expected passing-out year.' : 'Please choose your passing-out year.'
    if (!form.city.trim()) e.city = 'Please enter the city you live in.'
    if (!PHONE.test(form.phone.trim())) e.phone = 'Please enter a valid mobile number, e.g. +91 98765 43210.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
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
      phone: form.phone.trim().replace(/\s+/g, ' '),
    })
    navigate(next, { replace: true })
  }

  const gradYears = yearRange(1960, CURRENT_YEAR + 5)
  return (
    <div className="mx-auto max-w-md px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="mb-6 flex items-center gap-4">
        <Avatar src={profile.avatar_url} name={form.full_name || session?.user.email || '?'} size={56} />
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">Welcome to JEC Alumni Connect</h1>
        </div>
      </div>
      <p className="mb-6 text-muted">Tell us a little about yourself. It takes under a minute, and you can change it any time.</p>

      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Full name" error={errors.full_name}>
          {(p) => <Input {...p} autoComplete="name" value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} />}
        </Field>

        <ChoiceGroup label="I am" options={MEMBER_TYPES} value={form.member_type || null} onChange={(v) => set('member_type')(v)} error={errors.member_type} />

        {!isFaculty && (
          <>
            <Field label="Branch" error={errors.branch}>
              {(p) => (
                <Select {...p} value={form.branch} onChange={(e) => set('branch')(e.target.value)}>
                  <option value="">Choose your branch</option>
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isStudent ? 'Passing-out year (expected)' : 'Passing-out year'} error={errors.grad_year}>
                {(p) => (
                  <Select {...p} value={form.grad_year} onChange={(e) => set('grad_year')(e.target.value)}>
                    <option value="">Year</option>
                    {gradYears.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Joining year" optional>
                {(p) => (
                  <Select {...p} value={form.join_year} onChange={(e) => set('join_year')(e.target.value)}>
                    <option value="">Year</option>
                    {gradYears.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </>
        )}

        <Field label="City you live in" error={errors.city}>
          {(p) => <Input {...p} autoComplete="address-level2" placeholder="e.g. Pune" value={form.city} onChange={(e) => set('city')(e.target.value)} />}
        </Field>

        <Field label="Mobile number" error={errors.phone} hint="Private. Only you and the event organisers can see it.">
          {(p) => (
            <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
          )}
        </Field>

        {update.error && <Notice tone="danger" title={friendlyError(update.error)} />}
        <Button type="submit" size="lg" block loading={update.isPending}>
          Continue
        </Button>
      </form>
    </div>
  )
}
