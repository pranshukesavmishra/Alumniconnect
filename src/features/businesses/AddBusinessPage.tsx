import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState, PageSkeleton } from '../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { normalizeWebUrl } from '../../lib/linkedin/common'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { BUSINESS_CATEGORIES, useBusiness, useSaveBusiness, type BusinessFields } from './queries'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE = /^\+?[0-9 ]{8,16}$/

const EMPTY: BusinessFields = { name: '', category: '', city: '', description: '', offer: '', website_url: '', phone: '', whatsapp: false, email: '' }

/** Add a business, or (with ?edit=<id>) edit one of your own with the same form, prefilled. */
export function AddBusinessPage() {
  const [params] = useSearchParams()
  const editId = params.get('edit') ?? undefined
  const { data: me, isLoading } = useMyProfile()
  const uid = useUserId()
  const existing = useBusiness(editId)
  if (isLoading || (editId && existing.isLoading)) return <PageSkeleton />
  if (!me) return <Navigate to="/signin?next=/businesses/new" replace />
  if (me.verification !== 'verified' && !me.is_admin) {
    return (
      <div>
        <PageHeader title="List your business" back="/businesses" />
        <EmptyState title="Listing is for verified members">You’ll be verified once your Alumni Meet payment is confirmed, or when two verified JECians vouch for you.</EmptyState>
      </div>
    )
  }
  if (editId && (!existing.data || existing.data.owner_id !== uid)) {
    return (
      <div>
        <PageHeader title="Edit business" back="/businesses" />
        <EmptyState title="Listing not found">You can only edit your own listings.</EmptyState>
      </div>
    )
  }
  const b = existing.data
  const initial: BusinessFields = b
    ? { name: b.name, category: b.category, city: b.city, description: b.description, offer: b.offer ?? '', website_url: b.website_url ?? '', phone: b.phone ?? '', whatsapp: b.whatsapp, email: b.email ?? '' }
    : EMPTY
  return <BusinessForm editId={editId} initial={initial} />
}

function BusinessForm({ editId, initial }: { editId?: string; initial: BusinessFields }) {
  const navigate = useNavigate()
  const save = useSaveBusiness(editId)
  const [f, setF] = useState<BusinessFields>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof BusinessFields) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const title = editId ? 'Edit business' : 'List your business'

  function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (f.name.trim().length < 2) errs.name = 'Please enter the business name.'
    if (!f.category) errs.category = 'Please choose a category.'
    if (f.city.trim().length < 2) errs.city = 'Please enter the city.'
    if (f.description.trim().length < 20) errs.description = 'Tell us a little more (at least 20 characters).'
    let url = ''
    if (f.website_url.trim()) {
      url = normalizeWebUrl(f.website_url) ?? ''
      if (!url) errs.website_url = 'Please enter a valid web address.'
    }
    const phone = f.phone.trim()
    if (phone && !PHONE.test(phone)) errs.phone = 'Enter a phone number with 8 to 16 digits, like +91 98765 43210.'
    if (f.whatsapp && !phone) errs.phone = 'Add the phone number that is on WhatsApp.'
    if (f.email.trim() && !EMAIL.test(f.email.trim())) errs.email = 'Please enter a valid email address.'
    if (!url && !phone && !f.email.trim() && !errs.website_url && !errs.phone && !errs.email) errs.website_url = 'Add a website, phone or email so people can reach you.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    save.mutate(
      { ...f, website_url: url, phone },
      {
        onSuccess: (d) => {
          toast.success(editId ? 'Your listing is updated.' : 'Your business is listed. Batchmates can now find it.')
          navigate(`/businesses/${d.id}`, { replace: true })
        },
        onError: (err) => toast.error(friendlyError(err)),
      },
    )
  }

  return (
    <div>
      <PageHeader title={title} subtitle="Visible to verified JEC alumni" back={editId ? `/businesses/${editId}` : '/businesses'} />
      <Page>
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label="Business name" error={errors.name}>{(p) => <Input {...p} value={f.name} onChange={set('name')} maxLength={100} autoComplete="organization" />}</Field>
          <Field label="Category" error={errors.category}>
            {(p) => (
              <Select {...p} value={f.category} onChange={set('category')}>
                <option value="">Choose a category</option>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="City" error={errors.city}>{(p) => <Input {...p} value={f.city} onChange={set('city')} maxLength={80} placeholder="e.g. Jabalpur" />}</Field>
          <Field label="What you do" error={errors.description} hint="Products or services, who you serve, and anything a batchmate should know.">
            {(p) => <Textarea {...p} value={f.description} onChange={set('description')} maxLength={1500} rows={6} />}
          </Field>
          <Field label="Offer for JECians" optional hint="For example “10% off for JECians”.">{(p) => <Input {...p} value={f.offer} onChange={set('offer')} maxLength={200} />}</Field>
          <Field label="Website" optional error={errors.website_url} hint="Add a website, a phone number, an email, or any mix.">
            {(p) => <Input {...p} type="url" inputMode="url" value={f.website_url} onChange={set('website_url')} placeholder="https://" />}
          </Field>
          <Field label="Phone" optional error={errors.phone}>{(p) => <Input {...p} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={16} autoComplete="tel" />}</Field>
          <Checkbox checked={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })}>
            This number is on WhatsApp
          </Checkbox>
          <Field label="Email" optional error={errors.email}>{(p) => <Input {...p} type="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={200} />}</Field>
          <p className="text-sm text-muted">You can list up to 3 businesses. Members can report a listing and moderators will remove anything misleading.</p>
          <Button type="submit" size="lg" block loading={save.isPending}>
            {editId ? 'Save changes' : 'List business'}
          </Button>
        </form>
      </Page>
    </div>
  )
}
