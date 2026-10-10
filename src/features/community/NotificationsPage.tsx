import clsx from 'clsx'
import { Bell } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Card, EmptyState, PageSkeleton } from '../../components/ui/Display'
import { relativeTime } from '../../lib/format'
import { useT, type MsgKey, type Params } from '../../i18n'
import { useUserId } from '../auth/AuthProvider'
import { PushToggle } from './PushToggle'
import { markNotificationsRead, useNotifications, type Notification } from './queries'

function describe(n: Notification, tx: (key: MsgKey, params?: Params) => string): { text: string; to: string } {
  const who = n.actor?.full_name ?? tx('notif.someone')
  const body = n.body ?? ''
  switch (n.kind) {
    case 'like':
      return { text: tx('notif.like', { who }), to: '/' }
    case 'comment':
      return { text: tx('notif.comment', { who, body }), to: '/' }
    case 'connection_request':
      return { text: tx('notif.connect', { who }), to: '/me/connections' }
    case 'connection_accepted':
      return { text: tx('notif.accepted', { who }), to: `/people/${n.actor?.id}` }
    case 'message':
      return { text: tx('notif.message', { who, body }), to: `/chat/${n.target_id}` }
    case 'mention':
      return { text: tx('notif.mention', { who, body }), to: `/chat/${n.target_id}` }
    case 'announcement':
      return { text: `Alumni Meet announcement: ${n.body ?? ''}`, to: '/meet' }
    case 'mentor_request':
      return { text: `${who} asked you to be their mentor: “${n.body ?? ''}”`, to: '/mentors/mine' }
    case 'mentor_accepted':
      return { text: `${who} accepted your mentor request`, to: '/mentors/mine' }
    case 'mentor_declined':
      return { text: `${who} can’t take on a new mentee right now`, to: '/mentors/mine' }
    case 'help_request':
      return { text: tx('notif.help', { who, body }), to: '/help' }
    case 'nearby_batchmate':
      return { text: tx('notif.nearbyBatchmate', { who, city: body }), to: '/nearby' }
    case 'nearby_trip':
      return { text: tx('notif.nearbyTrip', { who, city: body }), to: '/nearby' }
    case 'admin_access':
      return { text: n.body ?? 'Your admin access changed', to: '/admin' }
    case 'invite_joined':
      return { text: tx('notif.invite', { who }), to: `/people/${n.actor?.id}` }
    default:
      return { text: n.body ?? tx('notif.default'), to: '/' }
  }
}

export function NotificationsPage() {
  const tx = useT()
  const { data, isLoading } = useNotifications()
  const qc = useQueryClient()
  const uid = useUserId()
  useEffect(() => {
    if (data?.some((n) => !n.read_at)) {
      const t = setTimeout(() => void markNotificationsRead().then(() => qc.invalidateQueries({ queryKey: ['notifications', uid] })), 1500)
      return () => clearTimeout(t)
    }
  }, [data, qc, uid])
  if (isLoading) return <PageSkeleton />
  return (
    <div>
      <PageHeader title={tx('notif.title')} back="/" />
      <Page>
        <PushToggle />
        {!data?.length ? (
          <EmptyState icon={<Bell />} title={tx('notif.empty')}>{tx('notif.emptyBody')}</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {data.map((n) => {
              const d = describe(n, tx)
              return (
                <Link key={n.id} to={d.to} className={clsx('flex items-start gap-3 p-4 hover:bg-surface-2', !n.read_at && 'bg-primary-soft/50')}>
                  <Avatar src={n.actor?.avatar_url} name={n.actor?.full_name ?? '?'} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[15px]">{d.text}</p>
                    <p className="text-xs text-muted">{relativeTime(n.created_at)}</p>
                  </div>
                  {!n.read_at && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" aria-label={tx('notif.unread')} />}
                </Link>
              )
            })}
          </Card>
        )}
      </Page>
    </div>
  )
}
