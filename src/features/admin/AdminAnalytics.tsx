import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Card, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'

interface Analytics {
  generated_at: string
  members: { total: number; onboarded: number; verified: number; pending: number; new_7d: number; new_30d: number; with_photo: number; with_linkedin: number; offering_help: number }
  signups_by_day: { day: string; count: number }[]
  by_batch: { year: number; members: number; verified: number }[]
  by_branch: { branch: string; members: number }[]
  engagement_7d: { posts: number; comments: number; messages: number; active_members: number; new_connections: number; jobs_posted: number; help_asked: number }
  content: { open_jobs: number; open_help_requests: number; open_reports: number; push_devices: number }
  invites: { joined_via_invite: number; top_inviters: { name: string; joined: number }[] }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  )
}

function Bar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 py-1.5 text-sm">
      <span className="truncate font-medium" title={label}>{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full bg-primary" style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%` }} />
      </span>
      <span className="tabular-nums text-muted">{value}{sub}</span>
    </div>
  )
}

/** Sign-ups per day as a small bar chart (plain SVG: no chart library). */
function Spark({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const w = 300
  const h = 70
  const bw = w / data.length
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} className="w-full" role="img" aria-label={`Sign-ups per day for the last 30 days, highest ${max}`}>
      {data.map((d, i) => {
        const bh = (d.count / max) * h
        return <rect key={d.day} x={i * bw + 1} y={h - bh} width={bw - 2} height={Math.max(bh, d.count ? 2 : 1)} rx={2} className={d.count ? 'fill-primary' : 'fill-border'}><title>{`${formatDate(d.day)}: ${d.count}`}</title></rect>
      })}
      <text x="0" y={h + 12} className="fill-muted text-[9px]">{formatDate(data[0]?.day)}</text>
      <text x={w} y={h + 12} textAnchor="end" className="fill-muted text-[9px]">{formatDate(data[data.length - 1]?.day)}</text>
    </svg>
  )
}

export function AdminAnalytics() {
  const { data: me, isLoading: meLoading } = useMyProfile()
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-analytics'],
    enabled: !!me?.is_admin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_analytics')
      if (error) throw error
      return data as Analytics
    },
  })
  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const m = data?.members
  const maxBatch = Math.max(1, ...(data?.by_batch.map((b) => b.members) ?? [1]))
  const maxBranch = Math.max(1, ...(data?.by_branch.map((b) => b.members) ?? [1]))
  const e = data?.engagement_7d
  return (
    <div>
      <PageHeader title="Analytics" subtitle={data ? `Updated ${formatDate(data.generated_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'How the community is doing'} back="/admin" />
      <Page className="space-y-6">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading || !data || !m || !e ? (
          <PageSkeleton />
        ) : (
          <>
            <section aria-label="Members" className="grid grid-cols-2 gap-3">
              <Stat label="Members" value={m.total} hint={`${m.new_7d} new this week · ${m.new_30d} this month`} />
              <Stat label="Verified" value={m.verified} hint={`${pct(m.verified, m.total)}% of members`} />
              <Stat label="Profile completed" value={m.onboarded} hint={`${pct(m.onboarded, m.total)}% finished sign-up`} />
              <Stat label="Waiting for verification" value={m.pending} />
            </section>

            <section>
              <SectionTitle>Sign-ups, last 30 days</SectionTitle>
              <Card className="p-4"><Spark data={data.signups_by_day} /></Card>
            </section>

            <section>
              <SectionTitle>Sign-up to verified</SectionTitle>
              <Card className="p-4">
                <Bar label="Signed up" value={m.total} max={m.total} />
                <Bar label="Completed" value={m.onboarded} max={m.total} sub={` · ${pct(m.onboarded, m.total)}%`} />
                <Bar label="Verified" value={m.verified} max={m.total} sub={` · ${pct(m.verified, m.total)}%`} />
              </Card>
            </section>

            <section>
              <SectionTitle>This week</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Active members" value={e.active_members} hint={`${pct(e.active_members, m.verified)}% of verified`} />
                <Stat label="Messages sent" value={e.messages} />
                <Stat label="Posts / comments" value={`${e.posts} / ${e.comments}`} />
                <Stat label="New connections" value={e.new_connections} />
                <Stat label="Jobs posted" value={e.jobs_posted} />
                <Stat label="Help requests" value={e.help_asked} />
              </div>
            </section>

            <section>
              <SectionTitle>Profiles</SectionTitle>
              <Card className="p-4">
                <Bar label="Has a photo" value={m.with_photo} max={m.total} sub={` · ${pct(m.with_photo, m.total)}%`} />
                <Bar label="LinkedIn linked" value={m.with_linkedin} max={m.total} sub={` · ${pct(m.with_linkedin, m.total)}%`} />
                <Bar label="Offers help" value={m.offering_help} max={m.total} sub={` · ${pct(m.offering_help, m.total)}%`} />
              </Card>
            </section>

            <section>
              <SectionTitle>Members by batch</SectionTitle>
              <Card className="p-4">
                {data.by_batch.length === 0 && <p className="text-sm text-muted">No data yet.</p>}
                {data.by_batch.map((b) => (
                  <Bar key={b.year} label={`Batch ${b.year}`} value={b.members} max={maxBatch} sub={` · ${b.verified} verified`} />
                ))}
              </Card>
            </section>

            <section>
              <SectionTitle>Members by branch</SectionTitle>
              <Card className="p-4">
                {data.by_branch.map((b) => (
                  <Bar key={b.branch} label={b.branch} value={b.members} max={maxBranch} />
                ))}
              </Card>
            </section>

            <section>
              <SectionTitle>Right now</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Open jobs" value={data.content.open_jobs} />
                <Stat label="Open help requests" value={data.content.open_help_requests} />
                <Stat label="Reports to review" value={data.content.open_reports} />
                <Stat label="Phones with notifications" value={data.content.push_devices} />
                <Stat label="Joined by invite" value={data.invites.joined_via_invite} />
              </div>
              {data.invites.top_inviters.length > 0 && (
                <Card className="mt-3 p-4">
                  <p className="mb-1 text-sm font-semibold">Top inviters</p>
                  {data.invites.top_inviters.map((t) => (
                    <Bar key={t.name} label={t.name} value={t.joined} max={data.invites.top_inviters[0]!.joined} />
                  ))}
                </Card>
              )}
            </section>
          </>
        )}
      </Page>
    </div>
  )
}
