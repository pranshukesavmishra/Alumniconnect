import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../../components/layout/AppShell'
import { Badge } from '../../../components/ui/Display'
import { useAdminAccess } from '../../admin/access'
import { useAdminCampaigns } from '../api'
import { FundsCampaigns } from './FundsCampaigns'
import { FundsExpenses } from './FundsExpenses'
import { FundsQueue } from './FundsQueue'
import { FundsReports } from './FundsReports'
import { FundsSettings } from './FundsSettings'
import { SponsorsPanel } from './SponsorsPanel'

const TABS = [
  { id: 'campaigns', label: 'Appeals', perms: ['funds_manage', 'funds_verify', 'funds_reports'] },
  { id: 'verify', label: 'Verify', perms: ['funds_verify'] },
  { id: 'sponsors', label: 'Sponsors', perms: ['sponsors_manage'] },
  { id: 'expenses', label: 'Expenses', perms: ['funds_manage', 'funds_reports'] },
  { id: 'reports', label: 'Reports', perms: ['funds_reports'] },
  { id: 'settings', label: 'Settings', perms: ['funds_manage'] },
] as const

/** Organise → Funds: appeals, the verification queue, sponsors, the expense log, reports and the fund settings. */
export function AdminFunds() {
  const { canAny, can } = useAdminAccess()
  const [sp, setSp] = useSearchParams()
  const tabs = TABS.filter((t) => canAny(t.perms))
  const tab = tabs.find((t) => t.id === sp.get('tab'))?.id ?? tabs[0]?.id
  const campaigns = useAdminCampaigns(can('funds_verify') || can('funds_manage') || can('funds_reports'))
  const waiting = (campaigns.data ?? []).reduce((s, c) => s + (c.submitted_count ?? 0), 0)
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab])
  return (
    <div>
      <PageHeader title="Funds" subtitle="Appeals, donations and sponsors" back="/admin" />
      <Page wide className="space-y-4">
        <div role="tablist" aria-label="Funds sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`funds-tab-${t.id}`} onClick={() => setSp({ tab: t.id }, { replace: true })}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${tab === t.id ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-text'}`}>
              {t.label}
              {t.id === 'verify' && waiting > 0 && <Badge tone="danger">{waiting}</Badge>}
            </button>
          ))}
        </div>
        {tab === 'campaigns' && <FundsCampaigns />}
        {tab === 'verify' && <FundsQueue />}
        {tab === 'sponsors' && <SponsorsPanel />}
        {tab === 'expenses' && <FundsExpenses />}
        {tab === 'reports' && <FundsReports />}
        {tab === 'settings' && <FundsSettings />}
      </Page>
    </div>
  )
}
