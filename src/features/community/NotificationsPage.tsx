import clsx from 'clsx'
import { Bell } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Card, EmptyState, PageSkeleton } from '../../components/ui/Display'
import { relativeTime } from '../../lib/format'
import { useUserId } from '../auth/AuthProvider'
import { PushToggle } from './PushToggle'
import { markNotificationsRead, useNotifications, type Notification } from './queries'

function describe(n: Notification): { text: string; to: string } {
  const who = n.actor?.full_name ?? 'Someone'
  switch (n.kind) {
    case 'like':
      return { text: `${who} liked your post`, to: '/' }
    case 'comment':
      return { text: `${who} commented: “${n.body ?? ''}”`, to: '/' }
    case 'connection_request':
      return { text: `${who} wants to connect`, to: '/me/connections' }
    case 'connection_accepted':
      return { text: `${who} accepted your connection request`, to: `/people/${n.actor?.id}` }
    case 'message':
      return { text: `${who} sent you a message: “${n.body ?? ''}”`, to: `/chat/${n.target_id}` }
    case 'mention':
      return { text: `${who} mentioned you: “${n.body ?? ''}”`, to: `/chat/${n.target_id}` }
    case 'announcement':
      return { text: `Alumni Meet announcement: ${n.body ?? ''}`, to: '/meet' }
    case 'mentor_request':
      return { text: `${who} asked you to be their mentor: “${n.body ?? ''}”`, to: '/mentors/mine' }
    case 'mentor_accepted':
      return { text: `${who} accepted your mentor request`, to: '/mentors/mine' }
    case 'mentor_declined':
      return { text: `${who} can’t take on a new mentee right now`, to: '/mentors/mine' }
    case 'help_request':
      return { text: `${who} asked for help: “${n.body ?? ''}”`, to: '/help' }
    case 'invite_joined':
      return { text: `${who} joined JEC Alumni Connect through your invite 🎉`, to: `/people/${n.actor?.id}` }
    default:
      return { text: n.body ?? 'New activity', to: '/' }
  }
}

export function NotificationsPage() {
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
      <PageHeader title="Notifications" back="/" />
      <Page>
        <PushToggle />
        {!data?.length ? (
          <EmptyState icon={<Bell />} title="No notifications yet">Likes, comments, messages and connection requests will show up here.</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {data.map((n) => {
              const d = describe(n)
              return (
                <Link key={n.id} to={d.to} className={clsx('flex items-start gap-3 p-4 hover:bg-surface-2', !n.read_at && 'bg-primary-soft/50')}>
                  <Avatar src={n.actor?.avatar_url} name={n.actor?.full_name ?? '?'} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[15px]">{d.text}</p>
                    <p className="text-xs text-muted">{relativeTime(n.created_at)}</p>
                  </div>
                  {!n.read_at && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </Link>
              )
            })}
          </Card>
        )}
      </Page>
    </div>
  )
}
