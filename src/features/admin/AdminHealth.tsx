import { Activity, Database, HardDrive, Bell, DatabaseBackup } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Badge, Card, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, relativeTime } from '../../lib/format'
import { useMyProfile } from '../auth/AuthProvider'
import { useHealth } from './queries'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const DAY = 86_400_000

function Row({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-1 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</span>
        <h3 className="min-w-0 flex-1 font-semibold">{title}</h3>
        {status}
      </div>
      <div className="pl-[3.25rem] text-sm text-muted">{children}</div>
    </Card>
  )
}

/** Is everything running? Last backup, push delivery, storage and unfinished imports, in plain words. Admins only. */
export function AdminHealth() {
  const { data: me, isLoading: meLoading } = useMyProfile()
  const h = useHealth(!!me?.is_admin)
  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const d = h.data
  const last = d?.backup.last
  const backupAge = d?.backup.last_ok_at ? Date.now() - new Date(d.backup.last_ok_at).getTime() : null
  const backupTone = !last ? 'warning' : !last.ok ? 'danger' : backupAge !== null && backupAge > 2 * DAY ? 'warning' : 'success'
  const push = d?.push
  const pushBad = push?.failures_24h ?? 0
  return (
    <div>
      <PageHeader title="Health" subtitle="Is everything running?" back="/admin" />
      <Page className="space-y-3">
        {h.isError ? (
          <Notice tone="danger" title={friendlyError(h.error)} />
        ) : h.isLoading || !d ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-3" data-testid="health">
            <Row icon={<DatabaseBackup className="size-5" aria-hidden />} title="Nightly backup" status={<Badge tone={backupTone}>{!last ? 'Never ran' : !last.ok ? 'Failed' : backupTone === 'warning' ? 'Late' : 'OK'}</Badge>}>
              {last ? (
                <>
                  <p>Last run {relativeTime(last.at)} ({formatDateTime(last.at)}).</p>
                  {last.detail && <p className="[overflow-wrap:anywhere]">{last.detail}</p>}
                  {d.backup.last_ok_at && !last.ok && <p>Last good backup: {formatDateTime(d.backup.last_ok_at)}.</p>}
                </>
              ) : (
                <p>No backup has been recorded yet. It runs every night from GitHub; check that the nightly workflow is enabled and the backup secret is set.</p>
              )}
            </Row>
            <Row icon={<Bell className="size-5" aria-hidden />} title="Push notifications" status={<Badge tone={!push?.configured ? 'neutral' : pushBad > 0 ? 'warning' : 'success'}>{!push?.configured ? 'Not set up' : pushBad > 0 ? `${pushBad} failed` : 'OK'}</Badge>}>
              <p>{push?.subscriptions ?? 0} phones and browsers subscribed.{push?.last_used_at ? ` Last delivery ${relativeTime(push.last_used_at)}.` : ''}</p>
              <p>{push?.failures_24h == null ? 'Delivery failures are not available on this server.' : `${push.failures_24h} failed of ${push.requests_24h ?? 0} sends in the last 24 hours.`}</p>
            </Row>
            <Row icon={<HardDrive className="size-5" aria-hidden />} title="Storage" status={<Badge>{formatBytes(d.storage.reduce((a, s) => a + s.bytes, 0))}</Badge>}>
              {d.storage.length === 0 ? <p>No files stored yet.</p> : (
                <ul>{d.storage.map((s) => <li key={s.bucket}>{s.bucket}: {formatBytes(s.bytes)} in {s.objects} {s.objects === 1 ? 'file' : 'files'}</li>)}</ul>
              )}
            </Row>
            <Row icon={<Database className="size-5" aria-hidden />} title="Database" status={<Badge>{formatBytes(d.database_bytes)}</Badge>}>
              <p>{d.members} member profiles. {d.audit_last_day} admin actions in the last day.</p>
            </Row>
            <Row icon={<Activity className="size-5" aria-hidden />} title="Member imports" status={<Badge tone={d.import_failed_rows > 0 ? 'warning' : d.import_unfinished_rows > 0 ? 'accent' : 'success'}>{d.import_failed_rows > 0 ? `${d.import_failed_rows} failed rows` : d.import_unfinished_rows > 0 ? 'Running' : 'Nothing waiting'}</Badge>}>
              <p>{d.import_unfinished_rows} rows still to add, {d.import_failed_rows} rows that failed and can be retried from the import screen.</p>
            </Row>
            <SectionTitle>Updated {relativeTime(d.generated_at)}</SectionTitle>
          </div>
        )}
      </Page>
    </div>
  )
}
