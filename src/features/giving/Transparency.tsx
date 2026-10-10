import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { coverUrl, useTransparency } from './api'
import { Money, ProgressBar } from './parts'

/** "Where the money went": totals, spending per appeal, sponsorship income (in-kind kept apart) and every expense with its receipt. */
export function TransparencyPage() {
  const tx = useT()
  const { data, isLoading, error } = useTransparency()
  if (isLoading) return <PageSkeleton />
  if (!data) return <div><PageHeader title={tx('give.wentTitle')} back="/give" /><Page><Notice tone="danger" title={friendlyError(error)} /></Page></div>
  const s = data.sponsorship
  return (
    <div>
      <PageHeader title={tx('give.wentTitle')} subtitle={tx('give.wentSubtitle')} back="/give" />
      <Page className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4"><p className="text-sm text-muted">{tx('give.totalRaised')}</p><p className="text-xl font-bold tabular-nums" data-testid="total-raised"><Money paise={data.total_raised_paise} /></p></Card>
          <Card className="p-4"><p className="text-sm text-muted">{tx('give.totalSpent')}</p><p className="text-xl font-bold tabular-nums" data-testid="total-spent"><Money paise={data.total_spent_paise} /></p></Card>
        </div>
        <section aria-label={tx('give.perAppeal')} className="space-y-2">
          <SectionTitle>{tx('give.perAppeal')}</SectionTitle>
          {data.campaigns.map((c) => (
            <Card key={c.slug} className="space-y-2 p-4">
              <Link to={`/give/${c.slug}`} className="font-bold text-primary">{c.title}</Link>
              <ProgressBar raised={c.spent_paise} goal={Math.max(c.raised_paise, 1)} label={c.title} />
              <p className="text-sm text-muted">{tx('give.raisedSpent', { raised: formatPaise(c.raised_paise, { zeroAsFree: false }), spent: formatPaise(c.spent_paise, { zeroAsFree: false }) })}</p>
            </Card>
          ))}
        </section>
        <Card className="space-y-1 p-4">
          <p className="font-bold">{tx('give.reunionFund')}</p>
          <p className="tabular-nums"><Money paise={data.reunion.raised_paise} /> <span className="text-sm text-muted">· {tx('give.contributors', { count: data.reunion.contributors })}</span></p>
        </Card>
        {(s.cash_paise > 0 || s.in_kind_paise > 0) && (
          <Card className="space-y-1 p-4" data-testid="sponsor-income">
            <p className="font-bold">{tx('give.sponsorIncome')}</p>
            <p>{tx('give.sponsorCash')}: <b className="tabular-nums"><Money paise={s.cash_paise} /></b></p>
            <p>{tx('give.sponsorInKind')}: <b className="tabular-nums"><Money paise={s.in_kind_paise} /></b> <span className="text-sm text-muted">({tx('give.notInTotals')})</span></p>
            {s.events.map((e) => <p key={e.title} className="text-sm text-muted">{e.title}: <Money paise={e.cash_paise} /> · {tx('give.spentShort')} <Money paise={e.spent_paise} /></p>)}
          </Card>
        )}
        <section aria-label={tx('give.expenses')} className="space-y-2">
          <SectionTitle>{tx('give.expenses')}</SectionTitle>
          {!data.expenses.length ? <EmptyState title={tx('give.noExpenses')} /> : (
            <Card className="divide-y divide-border" data-testid="expense-list">
              {data.expenses.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 p-3.5" data-testid="expense">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.description}</p>
                    <p className="text-sm text-muted">{formatDate(e.spent_on)}{e.campaign_title ? ` · ${e.campaign_title}` : ''}</p>
                    {e.receipt_path && <a href={coverUrl(e.receipt_path) ?? '#'} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><ExternalLink className="size-4" aria-hidden /> {tx('give.viewReceipt')}</a>}
                  </div>
                  <b className="tabular-nums"><Money paise={e.amount_paise} /></b>
                </div>
              ))}
            </Card>
          )}
        </section>
      </Page>
    </div>
  )
}
