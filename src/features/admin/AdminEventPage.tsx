import clsx from 'clsx'
import { RefreshCw, ScanLine } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Badge, Card, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { FOOD_PREFS, TSHIRT_SIZES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import { useMyProfile } from '../auth/AuthProvider'
import { AdminPayments } from './AdminPayments'
import { AdminPeople } from './AdminPeople'
import { AdminSettings } from './AdminSettings'
import { AdminTeam } from './AdminTeam'
import { useAdminData, useAdminEvent, useEventRole, type AdminData } from './queries'

type Tab = 'overview' | 'payments' | 'people' | 'settings' | 'team'

export function AdminEventPage() {
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: me } = useMyProfile()
  const isNew = slug === 'new'
  const { data, isLoading, error } = useAdminEvent(isNew ? '__none__' : slug)
  const role = useEventRole(data?.event.id)
  const admin = useAdminData(data?.event.id, role)

  if (isNew) {
    if (!me?.is_admin) return <Navigate to="/admin" replace />
    return (
      <div>
        <PageHeader title="New event" back="/admin" />
        <Page>
          <AdminSettings />
        </Page>
      </div>
    )
  }
  if (isLoading || !me) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!data || !role) return <Navigate to="/admin" replace />

  const manager = role === 'manager'
  const tabs: { id: Tab; label: string; count?: number }[] = manager
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'payments', label: 'Payments', count: admin.data?.payments.filter((p) => p.status === 'submitted').length },
        { id: 'people', label: 'Registrations' },
        ...(me.is_admin ? ([{ id: 'settings', label: 'Settings' }, { id: 'team', label: 'Team' }] as const) : []),
      ]
    : [{ id: 'people', label: 'Registrations' }]
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]!.id) as Tab

  return (
    <div>
      <PageHeader
        title={data.event.title}
        subtitle={data.event.is_published ? 'Published' : 'Draft: not visible to members'}
        back="/admin"
        action={
          <ButtonLink to={`/admin/events/${slug}/check-in`} size="sm" icon={<ScanLine className="size-4" />}>
            Check-in
          </ButtonLink>
        }
      />
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 border-b border-border bg-bg/95 backdrop-blur">
        <div role="tablist" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={clsx('flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted')}
            >
              {t.label}
              {!!t.count && <Badge tone="accent">{t.count}</Badge>}
            </button>
          ))}
        </div>
      </div>
      <Page wide className="space-y-4">
        {admin.error && <Notice tone="danger" title={friendlyError(admin.error)} />}
        {tab !== 'settings' && tab !== 'team' && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" icon={<RefreshCw className={clsx('size-4', admin.isFetching && 'animate-spin')} />} onClick={() => admin.refetch()}>
              Refresh
            </Button>
          </div>
        )}
        {tab === 'overview' && (admin.data ? <Overview data={admin.data} /> : <PageSkeleton />)}
        {tab === 'payments' && (admin.data ? <AdminPayments event={data.event} data={admin.data} /> : <PageSkeleton />)}
        {tab === 'people' && (admin.data ? <AdminPeople event={data.event} data={admin.data} manager={manager} /> : <PageSkeleton />)}
        {tab === 'settings' && <AdminSettings key={`${data.event.updated_at}:${data.tickets.map((t) => t.id).join()}`} existing={data} />}
        {tab === 'team' && <AdminTeam eventId={data.event.id} />}
      </Page>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'success' | 'accent' | 'primary' }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tabular-nums', tone === 'success' && 'text-success', tone === 'accent' && 'text-warning', tone === 'primary' && 'text-primary')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  )
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}

function Overview({ data }: { data: AdminData }) {
  const s = useMemo(() => {
    const live = data.registrations.filter((r) => r.status !== 'cancelled')
    const confirmed = live.filter((r) => r.status === 'confirmed')
    const paidOrConfirmed = live.filter((r) => r.status !== 'pending_payment')
    const verified = data.payments.filter((p) => p.status === 'verified')
    const collected = verified.filter((p) => p.method !== 'waiver').reduce((a, p) => a + p.amount_paise, 0)
    const waived = verified.filter((p) => p.method === 'waiver').reduce((a, p) => a + p.amount_paise, 0)
    const awaiting = data.payments.filter((p) => p.status === 'submitted')
    const byStatus = (st: string) => live.filter((r) => r.status === st).length
    const people = (list: typeof live) => list.reduce((a, r) => a + r.headcount, 0)
    const byYear = new Map<string, number>()
    for (const r of live) byYear.set(String(r.grad_year ?? 'Unknown'), (byYear.get(String(r.grad_year ?? 'Unknown')) ?? 0) + 1)
    const food = FOOD_PREFS.map((f) => ({ label: f.label, value: people(paidOrConfirmed.filter((r) => r.food_pref === f.value)) }))
    const tshirts = TSHIRT_SIZES.map((t) => ({ label: t, value: paidOrConfirmed.filter((r) => r.tshirt_size === t).length }))
    return {
      total: live.length,
      confirmed: confirmed.length,
      confirmedPeople: people(confirmed),
      pending: byStatus('pending_payment'),
      review: byStatus('under_review'),
      collected,
      waived,
      awaitingAmount: awaiting.reduce((a, p) => a + p.amount_paise, 0),
      awaitingCount: awaiting.length,
      accommodation: paidOrConfirmed.filter((r) => r.needs_accommodation).length,
      checkedIn: confirmed.filter((r) => r.checked_in_at).reduce((a, r) => a + r.headcount, 0),
      byYear: [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value })),
      food,
      tshirts,
    }
  }, [data])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Registrations" value={s.total} hint={`${s.pending} unpaid · ${s.review} being verified`} />
        <Stat label="Confirmed" value={s.confirmed} hint={`${s.confirmedPeople} people`} tone="success" />
        <Stat label="Collected (verified)" value={formatPaise(s.collected)} hint={s.waived ? `${formatPaise(s.waived)} waived` : undefined} tone="success" />
        <Stat label="Awaiting verification" value={formatPaise(s.awaitingAmount)} hint={`${s.awaitingCount} payments`} tone="accent" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Accommodation requests" value={s.accommodation} />
        <Stat label="Checked in" value={s.checkedIn} hint={`of ${s.confirmedPeople} people`} tone="primary" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <SectionTitle>By batch</SectionTitle>
          <Bars rows={s.byYear} />
        </Card>
        <Card className="p-4">
          <SectionTitle>Food (people, paid)</SectionTitle>
          <Bars rows={s.food} />
        </Card>
        <Card className="p-4">
          <SectionTitle>T-shirts (paid)</SectionTitle>
          <Bars rows={s.tshirts} />
        </Card>
      </div>
      <p className="text-xs text-muted">Food and T-shirt counts include registrations that are confirmed or being verified. Updates every minute.</p>
    </div>
  )
}
