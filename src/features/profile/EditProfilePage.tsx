import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, HELP_TAGS, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { normalizeLinkedInUrl } from '../../lib/linkedin/common'
import { supabase } from '../../lib/supabase'
import type { Experience } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMember, useMyPrivate, useUpdateProfile, useUploadAvatar } from './queries'

const PHONE = /^\+?[0-9 ]{10,16}$/

export function EditProfilePage() {
  const { data: profile, isLoading } = useMyProfile()
  const { data: priv } = useMyPrivate()
  const update = useUpdateProfile()
  const avatar = useUploadAvatar()
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
    if (f.phone && !PHONE.test(f.phone.trim())) errs.phone = 'Please enter a valid mobile number.'
    let linkedin: string | null = null
    if (f.linkedin_url?.trim()) {
      linkedin = normalizeLinkedInUrl(f.linkedin_url)
      if (!linkedin) errs.linkedin_url = 'Paste your profile link, e.g. linkedin.com/in/your-name'
    }
    let website: string | null = null
    if (f.website_url?.trim()) {
      try {
        const u = new URL(/^https?:\/\//.test(f.website_url) ? f.website_url.trim() : `https://${f.website_url.trim()}`)
        website = u.toString()
      } catch {
        errs.website_url = 'Please enter a valid web address.'
      }
    }
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
        },
        phone: n(f.phone),
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
          <section className="flex items-center gap-4">
            <Avatar src={profile.avatar_url} name={profile.full_name} size={80} />
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 font-semibold text-primary hover:bg-primary-soft">
              <Camera className="size-4" aria-hidden />
              {avatar.isPending ? 'Uploading…' : 'Change photo'}
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
              {(p) => <Input {...p} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />}
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
            <SectionTitle>Links</SectionTitle>
            <Field label="LinkedIn profile" optional error={errors.linkedin_url}>
              {(p) => <Input {...p} inputMode="url" placeholder="linkedin.com/in/your-name" value={f.linkedin_url} onChange={set('linkedin_url')} />}
            </Field>
            <Field label="Website" optional error={errors.website_url}>
              {(p) => <Input {...p} inputMode="url" value={f.website_url} onChange={set('website_url')} />}
            </Field>
          </section>

          {update.error && <Notice tone="danger" title={friendlyError(update.error)} />}
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
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
  const [x, setX] = useState({ title: '', company: '', location: '', start: '', end: '', current: true })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['member', uid] })
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!x.title.trim() || !x.company.trim()) return toast.error('Please enter both the role and the company.')
    setBusy(true)
    const { error } = await supabase.from('experiences').insert({
      profile_id: uid,
      title: x.title.trim().slice(0, 160),
      company: x.company.trim().slice(0, 160),
      location: x.location.trim() || null,
      start_date: x.start ? `${x.start}-01` : null,
      end_date: !x.current && x.end ? `${x.end}-01` : null,
      is_current: x.current,
    })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    setX({ title: '', company: '', location: '', start: '', end: '', current: true })
    setAdding(false)
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
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => remove(ex)} aria-label={`Remove ${ex.title}`}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      ) : (
        !adding && <p className="text-[15px] text-muted">No experience added yet. Import from LinkedIn or add it here.</p>
      )}
      {adding && (
        <Card className="p-4">
          <form onSubmit={add} className="space-y-4">
            <Field label="Role">{(p) => <Input {...p} value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} maxLength={160} />}</Field>
            <Field label="Company">{(p) => <Input {...p} value={x.company} onChange={(e) => setX({ ...x, company: e.target.value })} maxLength={160} />}</Field>
            <Field label="Location" optional>{(p) => <Input {...p} value={x.location} onChange={(e) => setX({ ...x, location: e.target.value })} maxLength={120} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">{(p) => <Input {...p} type="month" value={x.start} onChange={(e) => setX({ ...x, start: e.target.value })} />}</Field>
              {!x.current && <Field label="To">{(p) => <Input {...p} type="month" value={x.end} onChange={(e) => setX({ ...x, end: e.target.value })} />}</Field>}
            </div>
            <Checkbox checked={x.current} onChange={(v) => setX({ ...x, current: v })}>
              I currently work here
            </Checkbox>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                Add experience
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  )
}
