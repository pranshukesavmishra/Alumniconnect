import { Bookmark, BookmarkCheck, ExternalLink, Flag, Handshake, Mail, MapPin, MessageCircle, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'
import { Linkified } from '../community/PostCard'
import { modeLabel, typeLabel, useDeleteMyJob, useJob, useJobSaved, useToggleSave, useUpdateMyJob } from './queries'

const REPORT_REASONS = ['Scam or fake job', 'Asks for money', 'Misleading or spam', 'Something else']

export function JobDetailPage() {
  const { id = '' } = useParams()
  const uid = useUserId()
  const navigate = useNavigate()
  const { data: job, isLoading, error } = useJob(id)
  const saved = useJobSaved(id)
  const toggle = useToggleSave(id)
  const update = useUpdateMyJob()
  const del = useDeleteMyJob()
  const [reporting, setReporting] = useState(false)
  const [messaging, setMessaging] = useState(false)

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!job)
    return (
      <div>
        <PageHeader title="Job" back="/jobs" />
        <EmptyState title="This posting isn’t available">It may have expired, been filled or removed.</EmptyState>
      </div>
    )

  const mine = job.posted_by === uid
  const expired = new Date(job.expires_at) < new Date()
  const open = !job.is_closed && !job.is_hidden && !expired
  const link = `${window.location.origin}/jobs/${job.id}`
  const shareText = `${job.title} at ${job.company}${job.location ? `, ${job.location}` : ''}. Posted by a JECian on JEC Alumni Connect: ${link}`
  const applyHref = job.apply_url ?? `mailto:${job.apply_email}?subject=${encodeURIComponent(`Application: ${job.title}`)}&body=${encodeURIComponent(`Hi ${job.poster?.full_name.split(' ')[0] ?? ''},\n\nI saw your posting on JEC Alumni Connect and would like to apply.\n\n`)}`

  async function report(reason: string) {
    const { error: err } = await supabase.rpc('report_job', { p_job: job!.id, p_reason: reason })
    if (err) return toast.error(friendlyError(err))
    toast.success('Thanks. Our moderators will review this posting.')
    setReporting(false)
  }

  return (
    <div>
      <PageHeader
        title={job.title}
        subtitle={job.company}
        back="/jobs"
        action={
          !mine && (
            <button type="button" onClick={() => toggle.mutate(!saved.data)} aria-pressed={!!saved.data} aria-label={saved.data ? 'Remove from saved' : 'Save this job'} className="grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft">
              {saved.data ? <BookmarkCheck className="size-6 fill-primary/20" /> : <Bookmark className="size-6" />}
            </button>
          )
        }
      />
      <Page className="space-y-5">
        {!open && (
          <Notice tone="warning" title={job.is_hidden ? 'This posting is hidden pending review' : job.is_closed ? 'This position is closed' : 'This posting has expired'}>
            {mine ? 'Only you can see it.' : undefined}
          </Notice>
        )}
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="primary">{typeLabel(job.job_type)}</Badge>
            <Badge>{modeLabel(job.work_mode)}</Badge>
            {job.experience && <Badge>{job.experience}</Badge>}
            {job.can_refer && (
              <Badge tone="accent">
                <Handshake className="size-3" aria-hidden /> Poster can refer you
              </Badge>
            )}
          </div>
          {job.location && (
            <p className="flex items-center gap-2 text-[15px] text-muted">
              <MapPin className="size-4" aria-hidden /> {job.location}
            </p>
          )}
          <div className="whitespace-pre-line break-words text-[16px] leading-relaxed [overflow-wrap:anywhere]">
            <Linkified text={job.description} />
          </div>
          <p className="text-sm text-muted">
            Posted {formatDate(job.created_at)} · {open ? `open until ${formatDate(job.expires_at)}` : 'not accepting applications'}
          </p>
        </Card>

        {open && (
          <div className="space-y-2">
            {job.apply_url ? (
              <a href={applyHref} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-on-primary shadow-[0_8px_20px_-10px_var(--primary)]">
                <ExternalLink className="size-5" aria-hidden /> Apply on the company site
              </a>
            ) : (
              <a href={applyHref} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-on-primary shadow-[0_8px_20px_-10px_var(--primary)]">
                <Mail className="size-5" aria-hidden /> Apply by email
              </a>
            )}
            {job.apply_url && job.apply_email && (
              <a href={`mailto:${job.apply_email}?subject=${encodeURIComponent(`Application: ${job.title}`)}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-surface font-semibold">
                <Mail className="size-4" aria-hidden /> Or email {job.apply_email}
              </a>
            )}
          </div>
        )}

        {job.poster && (
          <Card className="p-4">
            <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em] text-muted">Posted by</p>
            <Link to={`/people/${job.poster.id}`} className="flex items-center gap-3">
              <Avatar src={job.poster.avatar_url} name={job.poster.full_name} size={48} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{job.poster.full_name}</span>
                <span className="block truncate text-sm text-muted">
                  {[job.poster.grad_year && `Batch ${job.poster.grad_year}`, job.poster.current_title && job.poster.current_company ? `${job.poster.current_title}, ${job.poster.current_company}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </Link>
            {!mine && (
              <Button
                variant="secondary"
                block
                className="mt-3"
                icon={<MessageCircle className="size-4" />}
                loading={messaging}
                onClick={async () => {
                  setMessaging(true)
                  try {
                    navigate(`/chat/${await startDm(job.poster!.id)}`)
                  } catch (e) {
                    toast.error(friendlyError(e))
                  } finally {
                    setMessaging(false)
                  }
                }}
              >
                Message {job.poster.full_name.split(' ')[0]}
              </Button>
            )}
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#128c4a] px-5 text-[15px] font-semibold text-white">
            <WhatsAppIcon className="size-4" /> Share
          </a>
          {'share' in navigator && (
            <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => navigator.share({ title: job.title, text: shareText, url: link }).catch(() => undefined)}>
              More
            </Button>
          )}
          {!mine && (
            <Button variant="ghost" icon={<Flag className="size-4" />} onClick={() => setReporting(true)}>
              Report
            </Button>
          )}
        </div>

        {mine && (
          <Card className="space-y-2 p-4">
            <p className="font-semibold">Your posting</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id: job.id, closed: !job.is_closed }, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success(job.is_closed ? 'Reopened' : 'Marked as filled') })}>
                {job.is_closed ? 'Reopen' : 'Mark as filled'}
              </Button>
              <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id: job.id, extendDays: 30 }, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Extended by 30 days') })}>
                Extend 30 days
              </Button>
              <Button
                variant="danger-ghost"
                icon={<Trash2 className="size-4" />}
                onClick={() => window.confirm('Delete this posting for good?') && del.mutate(job.id, { onSuccess: () => navigate('/jobs/mine', { replace: true }), onError: (e) => toast.error(friendlyError(e)) })}
              >
                Delete
              </Button>
            </div>
          </Card>
        )}
      </Page>
      <Sheet open={reporting} onClose={() => setReporting(false)} label="Report this job">
        <h2 className="px-5 pb-1 pt-1 text-lg font-bold">Report this job</h2>
        <p className="px-5 pb-2 text-sm text-muted">Only moderators see your report. Never pay anyone to apply for a job.</p>
        {REPORT_REASONS.map((r) => (
          <SheetAction key={r} onClick={() => void report(r)}>
            {r}
          </SheetAction>
        ))}
      </Sheet>
    </div>
  )
}
