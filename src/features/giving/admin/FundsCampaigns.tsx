import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { ButtonLink } from '../../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { friendlyError } from '../../../lib/errors'
import { formatPaise } from '../../../lib/money'
import { useAdminAccess } from '../../admin/access'
import { useAdminCampaigns } from '../api'
import { percentOf } from '../helpers'
import { ProgressBar } from '../parts'

const TYPE: Record<string, string> = { project: 'Project', scholarship: 'Scholarship', adopt: 'Adopt a lab / classroom', alumni_fund: 'Alumni fund', drive: 'Drive' }
const TONE = { draft: 'neutral', live: 'success', paused: 'warning', completed: 'primary' } as const

export function FundsCampaigns() {
  const { can } = useAdminAccess()
  const { data, isLoading, error } = useAdminCampaigns()
  return (
    <section className="space-y-3" aria-label="Appeals">
      {can('funds_manage') && <ButtonLink to="/admin/funds/campaign/new" icon={<Plus className="size-4" />} data-testid="new-campaign">New appeal</ButtonLink>}
      {error && <Notice tone="danger" title={friendlyError(error)} />}
      {isLoading ? <Skeleton className="h-28" /> : !data?.length ? (
        <EmptyState title="No appeals yet">Launch the first one: a project such as the Convocation Hall, a scholarship fund, or an adopt-a-lab appeal.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((c) => (
            <Card key={c.id} className="space-y-2 p-4" data-testid="admin-campaign" data-title={c.title}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[c.status]}>{c.status}</Badge>
                <Badge>{TYPE[c.type] ?? c.type}</Badge>
                {c.is_featured && <Badge tone="accent">Featured</Badge>}
                {!!c.submitted_count && <Badge tone="danger">{c.submitted_count} to verify</Badge>}
              </div>
              {can('funds_manage') ? <Link to={`/admin/funds/campaign/${c.id}`} className="block text-lg font-bold text-primary">{c.title}</Link> : <p className="text-lg font-bold">{c.title}</p>}
              <ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={c.title} />
              <p className="text-sm text-muted">{formatPaise(c.raised_paise, { zeroAsFree: false })} of {formatPaise(c.goal_paise, { zeroAsFree: false })} · {percentOf(c.raised_paise, c.goal_paise)}% · {c.donor_count} donors</p>
              {c.status !== 'draft' && <Link to={`/give/${c.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">View as member</Link>}
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
