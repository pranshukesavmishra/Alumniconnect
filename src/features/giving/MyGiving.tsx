import { CalendarClock, FileText, HeartHandshake } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox } from '../../components/ui/Form'
import { useT, type MsgKey } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { setNotifyNew, useAct, useMyGiving } from './api'
import { Money } from './parts'

const STATUS: Record<string, { key: MsgKey; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  submitted: { key: 'give.st.submitted', tone: 'warning' },
  verified: { key: 'give.st.verified', tone: 'success' },
  rejected: { key: 'give.st.rejected', tone: 'danger' },
  refunded: { key: 'give.st.refunded', tone: 'neutral' },
}

export function MyGivingPage() {
  const tx = useT()
  const { data, isLoading, error } = useMyGiving()
  const prefs = useAct(setNotifyNew)
  if (isLoading) return <PageSkeleton />
  const total = (data?.donations ?? []).filter((d) => d.status === 'verified').reduce((s, d) => s + d.amount_paise, 0)
  return (
    <div>
      <PageHeader title={tx('give.myGiving')} back="/give" />
      <Page className="space-y-5">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        <Card className="p-4">
          <p className="text-sm text-muted">{tx('give.myTotal')}</p>
          <p className="text-3xl font-bold tabular-nums" data-testid="my-giving-total"><Money paise={total} /></p>
        </Card>
        {!data?.donations.length ? (
          <EmptyState icon={<HeartHandshake />} title={tx('give.noGifts')} action={<ButtonLink to="/give">{tx('give.browse')}</ButtonLink>}>{tx('give.noGiftsBody')}</EmptyState>
        ) : (
          <section aria-label={tx('give.history')} className="space-y-2">
            <SectionTitle>{tx('give.history')}</SectionTitle>
            {data.donations.map((d) => (
              <Card key={d.id} className="space-y-1.5 p-4" data-testid="my-gift" data-status={d.status}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {d.campaign_slug ? <Link to={`/give/${d.campaign_slug}`} className="font-bold text-primary">{d.campaign_title}</Link> : <p className="font-bold">{d.campaign_title ?? tx('give.sponsorship')}</p>}
                    {d.item_name && <p className="text-sm text-muted">{d.item_name}</p>}
                  </div>
                  <b className="tabular-nums"><Money paise={d.amount_paise} /></b>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={STATUS[d.status]!.tone}>{tx(STATUS[d.status]!.key)}</Badge>
                  {d.is_anonymous && <Badge>{tx('give.anonymousBadge')}</Badge>}
                  <span className="text-muted">{formatDate(d.verified_at ?? d.created_at)}</span>
                </div>
                {d.status === 'rejected' && d.review_note && <p className="text-sm text-danger">{d.review_note}</p>}
                {d.receipt_no && (
                  <Link to={`/give/receipt/${d.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary" data-testid="receipt-link"><FileText className="size-4" aria-hidden /> {tx('give.receipt')} {d.receipt_no}</Link>
                )}
              </Card>
            ))}
          </section>
        )}
        {!!data?.pledges.length && (
          <section aria-label={tx('give.pledges')} className="space-y-2">
            <SectionTitle>{tx('give.pledges')}</SectionTitle>
            {data.pledges.map((p) => (
              <Card key={p.campaign_slug} className="flex items-center gap-3 p-4">
                <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link to={`/give/${p.campaign_slug}`} className="font-semibold text-primary">{p.campaign_title}</Link>
                  <p className="text-sm text-muted">{tx('give.remindOnDate', { date: formatDate(p.remind_on) })}{p.monthly ? ` · ${tx('give.everyMonth')}` : ''}</p>
                </div>
              </Card>
            ))}
          </section>
        )}
        <Card className="p-4">
          <Checkbox checked={data?.notify_new ?? true} onChange={async (v) => { try { await prefs.mutateAsync([v]); toast.success(tx('give.prefSaved')) } catch (e) { toast.error(friendlyError(e)) } }}>
            <span className="font-semibold">{tx('give.notifyNew')}</span>
          </Checkbox>
        </Card>
      </Page>
    </div>
  )
}
