import clsx from 'clsx'
import { Bookmark, BriefcaseBusiness, Handshake, MapPin, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { useMyProfile } from '../auth/AuthProvider'
import { JOB_TYPES, modeLabel, typeLabel, useJobs, WORK_MODES, type JobFilters, type JobListItem, type JobType, type WorkMode } from './queries'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={clsx('min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold', active ? 'bg-primary text-on-primary' : 'border border-border bg-surface')}>
      {children}
    </button>
  )
}

export function JobCard({ j }: { j: JobListItem }) {
  return (
    <Link to={`/jobs/${j.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-surface-2">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
            <BriefcaseBusiness className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-snug">{j.title}</p>
            <p className="text-[15px] text-muted">
              {j.company}
              {j.location && (
                <>
                  {' · '}
                  <MapPin className="-mt-0.5 inline size-3.5" aria-hidden /> {j.location}
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="primary">{typeLabel(j.job_type)}</Badge>
              <Badge>{modeLabel(j.work_mode)}</Badge>
              {j.experience && <Badge>{j.experience}</Badge>}
              {j.can_refer && (
                <Badge tone="accent">
                  <Handshake className="size-3" aria-hidden /> Can refer
                </Badge>
              )}
            </div>
          </div>
          {j.saved && <Bookmark className="size-5 shrink-0 fill-primary text-primary" aria-label="Saved" />}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm text-muted">
          <Avatar src={j.poster_avatar} name={j.poster_name} size={24} />
          <span className="min-w-0 truncate">
            {j.poster_name}
            {j.poster_batch ? ` · Batch ${j.poster_batch}` : ''}
          </span>
          <span className="ml-auto shrink-0">{relativeTime(j.created_at)}</span>
        </div>
      </Card>
    </Link>
  )
}

export function JobsPage() {
  const { data: me } = useMyProfile()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [type, setType] = useState<JobType | null>(null)
  const [mode, setMode] = useState<WorkMode | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const filters: JobFilters = { query: dq, type, mode, saved }
  const list = useJobs(filters)
  const rows = list.data?.pages.flat() ?? []
  const filtered = !!(dq.trim() || type || mode || saved)
  const verified = me?.verification === 'verified' || !!me?.is_admin

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Openings and referrals from JECians"
        back="/"
        action={
          verified && (
            <ButtonLink to="/jobs/new" size="sm" icon={<Plus className="size-4" />}>
              Post a job
            </ButtonLink>
          )
        }
      />
      <Page className="space-y-4">
        <label className="relative block">
          <span className="sr-only">Search jobs</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Role, company or city" className="min-h-12 w-full rounded-full border border-border bg-surface pl-12 pr-4 text-[16px] focus:border-primary focus:outline-none" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filters">
          <Chip active={saved} onClick={() => setSaved((s) => !s)}>
            <Bookmark className="-mt-0.5 mr-1 inline size-4" aria-hidden />
            Saved
          </Chip>
          {JOB_TYPES.map((t) => (
            <Chip key={t.value} active={type === t.value} onClick={() => setType(type === t.value ? null : t.value)}>
              {t.label}
            </Chip>
          ))}
          {WORK_MODES.map((m) => (
            <Chip key={m.value} active={mode === m.value} onClick={() => setMode(mode === m.value ? null : m.value)}>
              {m.label}
            </Chip>
          ))}
        </div>
        <div className="flex justify-end">
          <Link to="/jobs/mine" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
            My postings
          </Link>
        </div>
        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {list.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-3xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<BriefcaseBusiness />} title={filtered ? 'No jobs match' : 'No openings yet'} action={verified ? <ButtonLink to="/jobs/new">Post the first job</ButtonLink> : undefined}>
            {filtered ? 'Try a different search or remove a filter.' : 'Know of an opening at your company? Post it here so batchmates can apply, or offer to refer them.'}
          </EmptyState>
        ) : (
          <ul className="space-y-3" aria-label="Jobs">
            {rows.map((j) => (
              <li key={j.id}>
                <JobCard j={j} />
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Show more
          </Button>
        )}
      </Page>
    </div>
  )
}
