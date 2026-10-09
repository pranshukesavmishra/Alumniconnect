import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState, PageSkeleton } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { normalizeWebUrl } from '../../lib/linkedin/common'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { JOB_TYPES, WORK_MODES, type JobType, type WorkMode } from './queries'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function PostJobPage() {
  const { data: me, isLoading } = useMyProfile()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [f, setF] = useState({
    title: '',
    company: '',
    location: '',
    job_type: 'full_time' as JobType,
    work_mode: 'onsite' as WorkMode,
    experience: '',
    description: '',
    apply_url: '',
    apply_email: '',
    can_refer: false,
    days: '45',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  if (isLoading) return <PageSkeleton />
  if (me?.verification !== 'verified' && !me?.is_admin) {
    return (
      <div>
        <PageHeader title="Post a job" back="/jobs" />
        <EmptyState title="Posting is for verified members">You’ll be verified once your Alumni Meet payment is confirmed, or when two verified JECians vouch for you.</EmptyState>
      </div>
    )
  }
  if (!me) return <Navigate to="/signin?next=/jobs/new" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (f.title.trim().length < 3) errs.title = 'Please enter the job title.'
    if (f.company.trim().length < 2) errs.company = 'Please enter the company.'
    if (f.description.trim().length < 20) errs.description = 'Add a few lines about the role (at least 20 characters).'
    let url: string | null = null
    if (f.apply_url.trim()) {
      url = normalizeWebUrl(f.apply_url)
      if (!url) errs.apply_url = 'Please enter a valid web address.'
    }
    if (f.apply_email.trim() && !EMAIL.test(f.apply_email.trim())) errs.apply_email = 'Please enter a valid email address.'
    if (!url && !f.apply_email.trim() && !errs.apply_url && !errs.apply_email) errs.apply_url = 'Add a link or an email address so people can apply.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('post_job', { p_fields: { ...f, apply_url: url ?? '', days: Number(f.days) } })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Your job is live. Batchmates can now see it.')
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: ['my-jobs'] })
    navigate(`/jobs/${(data as { id: string }).id}`, { replace: true })
  }

  return (
    <div>
      <PageHeader title="Post a job" subtitle="Visible to verified JEC alumni" back="/jobs" />
      <Page>
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label="Job title" error={errors.title}>{(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={120} placeholder="e.g. Senior Backend Engineer" />}</Field>
          <Field label="Company" error={errors.company}>{(p) => <Input {...p} value={f.company} onChange={set('company')} maxLength={120} autoComplete="organization" />}</Field>
          <Field label="Location" optional>{(p) => <Input {...p} value={f.location} onChange={set('location')} maxLength={120} placeholder="e.g. Pune, India" />}</Field>
          <ChoiceGroup label="Type" columns={2} options={JOB_TYPES} value={f.job_type} onChange={(v) => setF({ ...f, job_type: v })} />
          <ChoiceGroup label="Work mode" columns={3} options={WORK_MODES} value={f.work_mode} onChange={(v) => setF({ ...f, work_mode: v })} />
          <Field label="Experience" optional>{(p) => <Input {...p} value={f.experience} onChange={set('experience')} maxLength={60} placeholder="e.g. 3–6 years, or Freshers" />}</Field>
          <Field label="About the role" error={errors.description} hint="What the team does, what you need, and anything a batchmate should know.">
            {(p) => <Textarea {...p} value={f.description} onChange={set('description')} maxLength={4000} rows={7} />}
          </Field>
          <Field label="Apply link" optional error={errors.apply_url} hint="The company's careers page. Add this, an email, or both.">
            {(p) => <Input {...p} type="url" inputMode="url" value={f.apply_url} onChange={set('apply_url')} placeholder="https://" />}
          </Field>
          <Field label="Apply by email" optional error={errors.apply_email}>{(p) => <Input {...p} type="email" inputMode="email" value={f.apply_email} onChange={set('apply_email')} maxLength={200} />}</Field>
          <Checkbox checked={f.can_refer} onChange={(v) => setF({ ...f, can_refer: v })}>
            I work here and can refer JECians
          </Checkbox>
          <Field label="Keep it up for">
            {(p) => (
              <Select {...p} value={f.days} onChange={set('days')}>
                {[30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-sm text-muted">Only post real openings. Never ask candidates for money. Members can report a posting and moderators will remove scams.</p>
          <Button type="submit" size="lg" block loading={busy}>
            Post job
          </Button>
        </form>
      </Page>
    </div>
  )
}
