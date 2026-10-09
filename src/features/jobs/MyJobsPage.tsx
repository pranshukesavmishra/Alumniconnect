import { BriefcaseBusiness } from 'lucide-react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useMyJobs } from './queries'

export function MyJobsPage() {
  const { data, isLoading, error } = useMyJobs()
  if (isLoading) return <PageSkeleton />
  const now = Date.now()
  return (
    <div>
      <PageHeader title="My postings" back="/jobs" action={<ButtonLink to="/jobs/new" size="sm">Post a job</ButtonLink>} />
      <Page className="space-y-3">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {!data?.length ? (
          <EmptyState icon={<BriefcaseBusiness />} title="You haven’t posted a job yet" action={<ButtonLink to="/jobs/new">Post a job</ButtonLink>}>
            Openings and referrals you post appear here, where you can mark them filled or extend them.
          </EmptyState>
        ) : (
          data.map((j) => {
            const expired = new Date(j.expires_at).getTime() < now
            return (
              <Link key={j.id} to={`/jobs/${j.id}`} className="block">
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{j.title}</p>
                    <p className="truncate text-sm text-muted">
                      {j.company} · posted {formatDate(j.created_at)}
                    </p>
                  </div>
                  {j.is_hidden ? <Badge tone="warning">Under review</Badge> : j.is_closed ? <Badge>Filled</Badge> : expired ? <Badge>Expired</Badge> : <Badge tone="success">Open</Badge>}
                </Card>
              </Link>
            )
          })
        )}
      </Page>
    </div>
  )
}
