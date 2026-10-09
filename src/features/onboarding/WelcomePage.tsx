import { toast } from 'sonner'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Avatar, Notice, PageSkeleton } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { useT } from '../../i18n'
import { memberTypeOptions } from '../../i18n/labels'
import { safeNext } from '../../lib/safeNext'
import type { MemberType } from '../../lib/types'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { isOurAvatar, useImportProviderPhoto, useMyPrivate, useUpdateProfile } from '../profile/queries'

const PHONE = /^\+?[0-9 ]{10,16}$/


export function WelcomePage() {
  const tx = useT()
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

  // wait for both profile and private details so the prefill never overwrites typing
  if (isLoading || !profile || !priv || !loaded) return <PageSkeleton />
  if (profile.onboarded && !params.get('edit')) return <Navigate to={next} replace />

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const isStudent = form.member_type === 'student'
  const isFaculty = form.member_type === 'faculty'

  function validate() {
    const e: Record<string, string> = {}
    if (form.full_name.trim().length < 2) e.full_name = tx('welcome.errName')
    if (!form.member_type) e.member_type = tx('welcome.errType')
    if (!isFaculty && !form.branch) e.branch = tx('welcome.errBranch')
    if (!isFaculty && !form.grad_year) e.grad_year = isStudent ? tx('welcome.errGradStudent') : tx('welcome.errGrad')
    if (!form.city.trim()) e.city = tx('welcome.errCity')
    if (!PHONE.test(form.phone.trim())) e.phone = tx('welcome.errPhone')
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
        phone: form.phone.trim().replace(/\s+/g, ' '),
      })
    } catch {
      return // error shown below the form
    }
    navigate(next, { replace: true })
  }

  const gradYears = yearRange(1960, CURRENT_YEAR + 5)
  return (
    <div className="mx-auto max-w-md px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="mb-6 flex items-center gap-4">
        <Avatar src={profile.avatar_url} name={form.full_name || session?.user.email || '?'} size={56} />
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{tx('welcome.title')}</h1>
        </div>
      </div>
      <p className="mb-6 text-muted">{tx('welcome.intro')}</p>

      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label={tx('welcome.fullName')} error={errors.full_name}>
          {(p) => <Input {...p} autoComplete="name" value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} />}
        </Field>

        <ChoiceGroup label={tx('welcome.iAm')} options={memberTypeOptions(tx)} value={form.member_type || null} onChange={(v) => set('member_type')(v)} error={errors.member_type} />

        {!isFaculty && (
          <>
            <Field label={tx('welcome.branch')} error={errors.branch}>
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
                  <Select {...p} value={form.grad_year} onChange={(e) => set('grad_year')(e.target.value)}>
                    <option value="">{tx('welcome.year')}</option>
                    {gradYears.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={tx('welcome.joinYear')} optional>
                {(p) => (
                  <Select {...p} value={form.join_year} onChange={(e) => set('join_year')(e.target.value)}>
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
          {(p) => (
            <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
          )}
        </Field>

        {update.error && <Notice tone="danger" title={friendlyError(update.error)} />}
        <Button type="submit" size="lg" block loading={update.isPending}>
          {tx('common.continue')}
        </Button>
      </form>
    </div>
  )
}
