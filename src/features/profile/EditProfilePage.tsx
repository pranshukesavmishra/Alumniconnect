import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { LinkedInIcon } from '../../components/ui/Icons'
import { PhoneInput, usePhoneError } from '../../components/ui/PhoneInput'
import { BRANCHES, CURRENT_YEAR, HELP_TAGS, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { maxBirthDay, normalizeLinkedInUrl, normalizeWebUrl } from '../../lib/linkedin/common'
import { normalizePhone } from '../../lib/phone'
import { supabase } from '../../lib/supabase'
import type { Experience } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { PhotoImportError, useImportProviderPhoto, useMember, useMyPrivate, useRemoveAvatar, useUpdateProfile, useUploadAvatar, type PhotoProvider } from './queries'

export function EditProfilePage() {
  const { data: profile, isLoading } = useMyProfile()
  const { data: priv } = useMyPrivate()
  const update = useUpdateProfile()
  const phoneError = usePhoneError()
  const avatar = useUploadAvatar()
  const photo = useImportProviderPhoto()
  const removeAvatar = useRemoveAvatar()
  const [params, setParams] = useSearchParams()

  async function importPhoto(provider: PhotoProvider, quiet = false) {
    try {
      const r = await photo.mutateAsync(provider)
      toast.success(r.source === 'linkedin' ? 'Your LinkedIn photo is now your profile photo. You can change it anytime.' : 'Photo updated')
    } catch (e) {
      if (e instanceof PhotoImportError && e.code === 'no_identity' && provider === 'linkedin_oidc') {
        // not signed in with LinkedIn: offer to connect it (LinkedIn then shares the photo with us)
        if (window.confirm('Connect your LinkedIn account to use its photo? You will sign in to LinkedIn once, and your profile stays the same.')) {
          const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/me/edit?photo=linkedin')}`
          const { error } = await supabase.auth.linkIdentity({ provider: 'linkedin_oidc', options: { redirectTo } })
          if (error) toast.error(friendlyError(error))
        }
        return
      }
      if (!quiet) toast.error(e instanceof PhotoImportError && e.code === 'no_photo' ? 'LinkedIn didn’t share a photo with us. Please upload one instead.' : friendlyError(e))
    }
  }

  // coming back from "Connect LinkedIn": finish the import automatically
  const wantsLinkedIn = params.get('photo') === 'linkedin'
  useEffect(() => {
    if (!wantsLinkedIn) return
    setParams((p) => { p.delete('photo'); return p }, { replace: true })
    void importPhoto('linkedin_oidc')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per return from LinkedIn
  }, [wantsLinkedIn])
  const navigate = useNavigate()
  const [f, setF] = useState<Record<string, string>>({})
  const [helpTags, setHelpTags] = useState<string[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (profile && priv && !ready) {
      setF({
        full_name: profile.full_name,
        headline: profile.headline ?? '',
        current_title: profile.current_title ?? '',
        current_company: profile.current_company ?? '',
        city: profile.city ?? '',
        country: profile.country ?? 'India',
        branch: profile.branch ?? '',
        grad_year: profile.grad_year ? String(profile.grad_year) : '',
        join_year: profile.join_year ? String(profile.join_year) : '',
        about: profile.about ?? '',
        linkedin_url: profile.linkedin_url ?? '',
        website_url: profile.website_url ?? '',
        phone: priv.phone ?? '',
        birth_day: profile.birth_day ? String(profile.birth_day) : '',
        birth_month: profile.birth_month ? String(profile.birth_month) : '',
        message_policy: profile.message_policy ?? 'jec',
      })
      setHelpTags(profile.help_tags)
      setSkills(profile.skills)
      setReady(true)
    }
  }, [profile, priv, ready])

  if (isLoading || !profile || !ready) return <PageSkeleton />
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const years = yearRange(1960, CURRENT_YEAR + 5)

  function addSkill() {
    const parts = skillInput.split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    setSkills((s) => [...new Set([...s, ...parts.map((p) => p.slice(0, 60))])].slice(0, 50))
    setSkillInput('')
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if ((f.full_name ?? '').trim().length < 2) errs.full_name = 'Please enter your full name.'
    const pe = phoneError(f.phone)
    if (pe) errs.phone = pe
    let linkedin: string | null = null
    if (f.linkedin_url?.trim()) {
      linkedin = normalizeLinkedInUrl(f.linkedin_url)
      if (!linkedin) errs.linkedin_url = 'Paste your profile link, e.g. linkedin.com/in/your-name'
    }
    let website: string | null = null
    if (f.website_url?.trim()) {
      website = normalizeWebUrl(f.website_url)
      if (!website) errs.website_url = 'Please enter a valid web address.'
    }
    if ((f.birth_day && !f.birth_month) || (!f.birth_day && f.birth_month)) errs.birth_day = 'Please choose both the day and the month.'
    else if (f.birth_day && f.birth_month && Number(f.birth_day) > maxBirthDay(Number(f.birth_month))) errs.birth_day = 'That date doesn’t exist. Please check the day and month.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const n = (v?: string) => (v?.trim() ? v.trim() : null)
    try {
      await update.mutateAsync({
        profile: {
          full_name: f.full_name!.trim().replace(/\s+/g, ' '),
          headline: n(f.headline),
          current_title: n(f.current_title),
          current_company: n(f.current_company),
          city: n(f.city),
          country: n(f.country),
          branch: n(f.branch),
          grad_year: f.grad_year ? Number(f.grad_year) : null,
          join_year: f.join_year ? Number(f.join_year) : null,
          about: n(f.about),
          linkedin_url: linkedin,
          website_url: website,
          help_tags: helpTags,
          skills,
          birth_day: f.birth_day ? Number(f.birth_day) : null,
          birth_month: f.birth_month ? Number(f.birth_month) : null,
          message_policy: (f.message_policy || 'jec') as 'jec',
        },
        phone: n(normalizePhone(f.phone)),
      })
      toast.success('Profile saved')
      navigate('/me')
    } catch {
      /* shown below */
    }
  }

  return (
    <div>
      <PageHeader title="Edit profile" back="/me" />
      <Page>
        <form onSubmit={save} noValidate className="space-y-7">
          <section className="space-y-3" aria-label="Profile photo">
            <div className="flex items-center gap-4">
              <Avatar src={profile.avatar_url} name={profile.full_name} size={80} />
              <div className="min-w-0 text-sm text-muted">
                <p className="font-semibold text-text">Profile photo</p>
                <p>A clear, professional photo helps batchmates recognise you.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" icon={<LinkedInIcon className="size-4" />} loading={photo.isPending} onClick={() => void importPhoto('linkedin_oidc')}>
                Use my LinkedIn photo
              </Button>
              <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-6 text-[15px] font-semibold shadow-sm hover:bg-surface-2">
                <Camera className="size-4" aria-hidden />
                {avatar.isPending ? 'Uploading…' : 'Upload a photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={avatar.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) avatar.mutate(file, { onSuccess: () => toast.success('Photo updated'), onError: (err) => toast.error(friendlyError(err)) })
                  }}
                />
              </label>
              {profile.avatar_url && (
                <Button type="button" variant="danger-ghost" loading={removeAvatar.isPending} onClick={() => removeAvatar.mutate(undefined, { onSuccess: () => toast.success('Photo removed'), onError: (err) => toast.error(friendlyError(err)) })}>
                  Remove
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Basics</SectionTitle>
            <Field label="Full name" error={errors.full_name}>
              {(p) => <Input {...p} value={f.full_name} onChange={set('full_name')} autoComplete="name" />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Current role" optional>
                {(p) => <Input {...p} placeholder="e.g. Senior Engineer" value={f.current_title} onChange={set('current_title')} maxLength={120} />}
              </Field>
              <Field label="Company / organisation" optional>
                {(p) => <Input {...p} placeholder="e.g. Tata Steel" value={f.current_company} onChange={set('current_company')} maxLength={120} />}
              </Field>
            </div>
            <Field label="Headline" optional hint="One line about you, shown under your name.">
              {(p) => <Input {...p} value={f.headline} onChange={set('headline')} maxLength={160} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City" optional>
                {(p) => <Input {...p} value={f.city} onChange={set('city')} maxLength={80} />}
              </Field>
              <Field label="Country" optional>
                {(p) => <Input {...p} value={f.country} onChange={set('country')} maxLength={80} />}
              </Field>
            </div>
            <Field label="Mobile number" optional error={errors.phone} hint="Private. Only you and event organisers can see it.">
              {(p) => <PhoneInput {...p} value={f.phone ?? ''} onChange={(v) => setF((s) => ({ ...s, phone: v }))} />}
            </Field>
          </section>

          <section className="space-y-4">
            <SectionTitle>At JEC</SectionTitle>
            <Field label="Branch" optional>
              {(p) => (
                <Select {...p} value={f.branch} onChange={set('branch')}>
                  <option value="">Choose</option>
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Passing-out year" optional>
                {(p) => (
                  <Select {...p} value={f.grad_year} onChange={set('grad_year')}>
                    <option value="">Year</option>
                    {years.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Joining year" optional>
                {(p) => (
                  <Select {...p} value={f.join_year} onChange={set('join_year')}>
                    <option value="">Year</option>
                    {years.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>About you</SectionTitle>
            <Field label="About" optional>
              {(p) => <Textarea {...p} rows={5} value={f.about} onChange={set('about')} maxLength={3000} />}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">I can help juniors with</legend>
              <div className="flex flex-wrap gap-2">
                {HELP_TAGS.map((t) => {
                  const on = helpTags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHelpTags((s) => (on ? s.filter((x) => x !== t) : [...s, t]))}
                      className={clsx('min-h-10 rounded-full border px-4 text-sm font-semibold', on ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div>
              <p className="mb-1.5 text-sm font-semibold">Skills</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Add skills"
                  placeholder="Type a skill, then Add (comma for several)"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addSkill()
                    }
                  }}
                />
                <Button variant="secondary" onClick={addSkill}>
                  Add
                </Button>
              </div>
              {skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                      {s}
                      <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-border" onClick={() => setSkills((x) => x.filter((y) => y !== s))} aria-label={`Remove ${s}`}>
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Privacy and birthday</SectionTitle>
            <Field label="Who can message me">
              {(p) => (
                <Select {...p} value={f.message_policy} onChange={set('message_policy')}>
                  <option value="jec">Any verified JECian (messages from strangers arrive as requests)</option>
                  <option value="batch_and_connections">My batchmates and connections</option>
                  <option value="connections">Only my connections</option>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birthday: day" optional hint="Only the day and month. Shown to your batch and connections." error={errors.birth_day}>
                {(p) => (
                  <Select {...p} value={f.birth_day} onChange={set('birth_day')}>
                    <option value="">—</option>
                    {Array.from({ length: f.birth_month ? maxBirthDay(Number(f.birth_month)) : 31 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Month" optional>
                {(p) => (
                  <Select {...p} value={f.birth_month} onChange={set('birth_month')}>
                    <option value="">—</option>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Links</SectionTitle>
            <Field label="LinkedIn profile" optional error={errors.linkedin_url}>
              {(p) => <Input {...p} inputMode="url" placeholder="linkedin.com/in/your-name" value={f.linkedin_url} onChange={set('linkedin_url')} />}
            </Field>
            <Field label="Website" optional error={errors.website_url}>
              {(p) => <Input {...p} inputMode="url" value={f.website_url} onChange={set('website_url')} />}
            </Field>
          </section>

          {update.error && <Notice tone="danger" title={friendlyError(update.error)} />}
          <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
            <Button type="submit" size="lg" block loading={update.isPending}>
              Save profile
            </Button>
          </div>
        </form>

        <ExperienceEditor />
      </Page>
    </div>
  )
}

/** Add / remove work experience manually (LinkedIn import fills this automatically). */
function ExperienceEditor() {
  const uid = useUserId()
  const { data } = useMember(uid ?? undefined)
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const blank = { title: '', company: '', location: '', description: '', start: '', end: '', current: true }
  const [x, setX] = useState(blank)
  const [editingId, setEditingId] = useState<string | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['member', uid] })
  }

  function startEdit(ex: Experience) {
    setEditingId(ex.id)
    setX({
      title: ex.title,
      company: ex.company,
      location: ex.location ?? '',
      description: ex.description ?? '',
      start: ex.start_date?.slice(0, 7) ?? '',
      end: ex.end_date?.slice(0, 7) ?? '',
      current: ex.is_current,
    })
    setAdding(true)
  }

  function close() {
    setAdding(false)
    setEditingId(null)
    setX(blank)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!x.title.trim() || !x.company.trim()) return toast.error('Please enter both the role and the company.')
    if (!x.current && x.start && x.end && x.end < x.start) return toast.error('The end date can’t be before the start date.')
    setBusy(true)
    const row = {
      title: x.title.trim().slice(0, 160),
      company: x.company.trim().slice(0, 160),
      location: x.location.trim() || null,
      description: x.description.trim().slice(0, 3000) || null,
      start_date: x.start ? `${x.start}-01` : null,
      end_date: !x.current && x.end ? `${x.end}-01` : null,
      is_current: x.current,
    }
    const { error } = editingId
      ? await supabase.from('experiences').update(row).eq('id', editingId)
      : await supabase.from('experiences').insert({ profile_id: uid, ...row })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success(editingId ? 'Experience updated' : 'Experience added')
    close()
    refresh()
  }

  async function remove(ex: Experience) {
    if (!window.confirm(`Remove “${ex.title} at ${ex.company}”?`)) return
    const { error } = await supabase.from('experiences').delete().eq('id', ex.id)
    if (error) return toast.error(friendlyError(error))
    refresh()
  }

  return (
    <section className="mt-10 space-y-3">
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add
            </Button>
          )
        }
      >
        Experience
      </SectionTitle>
      {data?.experiences.length ? (
        <Card className="divide-y divide-border">
          {data.experiences.map((ex) => (
            <div key={ex.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{ex.title}</p>
                <p className="truncate text-sm text-muted">
                  {ex.company}
                  {ex.is_current && ' · Current'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-primary-soft hover:text-primary" onClick={() => startEdit(ex)} aria-label={`Edit ${ex.title}`}>
                  <Pencil className="size-4" />
                </button>
                <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => remove(ex)} aria-label={`Remove ${ex.title}`}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        !adding && <p className="text-[15px] text-muted">No experience added yet. Import from LinkedIn or add it here.</p>
      )}
      {adding && (
        <Card className="p-4">
          <form onSubmit={save} className="space-y-4">
            <Field label="Role">{(p) => <Input {...p} value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} maxLength={160} />}</Field>
            <Field label="Company">{(p) => <Input {...p} value={x.company} onChange={(e) => setX({ ...x, company: e.target.value })} maxLength={160} />}</Field>
            <Field label="Location" optional>{(p) => <Input {...p} value={x.location} onChange={(e) => setX({ ...x, location: e.target.value })} maxLength={120} />}</Field>
            <Field label="Description" optional>{(p) => <Textarea {...p} value={x.description} onChange={(e) => setX({ ...x, description: e.target.value })} maxLength={3000} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">{(p) => <Input {...p} type="month" value={x.start} onChange={(e) => setX({ ...x, start: e.target.value })} />}</Field>
              {!x.current && <Field label="To">{(p) => <Input {...p} type="month" value={x.end} onChange={(e) => setX({ ...x, end: e.target.value })} />}</Field>}
            </div>
            <Checkbox checked={x.current} onChange={(v) => setX({ ...x, current: v })}>
              I currently work here
            </Checkbox>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                {editingId ? 'Save changes' : 'Add experience'}
              </Button>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  )
}
