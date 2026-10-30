import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { IconTile } from '../../components/ui/IconTile'
import { EmptyInboxArt } from '../../components/ui/Illustrations'
import { Sheet } from '../../components/ui/Sheet'
import { SkeletonRow } from '../../components/ui/Skeleton'
import { useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { haptic } from '../../lib/haptics'
import { useUserId } from '../auth/AuthProvider'
import { markNotificationsRead, useNotifications, type Notification } from '../community/queries'
import { describeNotification, groupByDay } from './notifKinds'

/** The bell's sheet: the latest notifications, Today and Earlier, with type icons, unread dots and Mark all read. */
export function NotificationsCentre({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tx = useT()
  return (
    <Sheet open={open} onClose={onClose} label={tx('notif.title')} className="md:max-w-lg">
      {open && <Body onClose={onClose} />}
    </Sheet>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const uid = useUserId()
  const { data, isLoading } = useNotifications()
  const [marking, setMarking] = useState(false)
  const list = data ?? []
  const unread = list.filter((n) => !n.read_at).length
  const { today, earlier } = groupByDay(list.slice(0, 40))

  async function markAll() {
    setMarking(true)
    haptic()
    await markNotificationsRead()
    await qc.invalidateQueries({ queryKey: ['notifications', uid] })
    setMarking(false)
  }

  const section = (label: MsgKey, items: Notification[]) =>
    items.length > 0 && (
      <section aria-label={tx(label)} className="mb-3">
        <h3 className="px-5 pb-1.5 pt-1 font-sans text-eyebrow text-gold-ink">{tx(label)}</h3>
        <ul className="mx-3 overflow-hidden rounded-[22px] border border-border/70 bg-surface shadow-card">
          {items.map((n, i) => {
            const d = describeNotification(n, tx)
            return (
              <li key={n.id} className={i > 0 ? 'border-t border-border/60' : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(d.to)
                  }}
                  className={cn('fx-press flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2', !n.read_at && 'bg-primary-soft/40')}
                  data-unread={!n.read_at || undefined}
                >
                  {n.actor ? (
                    <Avatar
                      src={n.actor.avatar_url}
                      name={n.actor.full_name}
                      size={44}
                      badge={<IconTile icon={d.icon} tone={d.tone} variant="solid" size="sm" className="size-[22px] rounded-full ring-2 ring-surface [&_svg]:size-3" />}
                    />
                  ) : (
                    <IconTile icon={d.icon} tone={d.tone} variant="solid" size="md" className="rounded-full" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('line-clamp-3 text-[15px] leading-snug', !n.read_at ? 'font-semibold text-text' : 'text-text/90')}>{d.text}</span>
                    <span className="mt-0.5 block text-caption text-muted">{relativeTime(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)]" aria-label={tx('notif.unread')} />}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )

  return (
    <div data-testid="notif-centre">
      <div className="flex items-end gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-gold-ink">{unread ? tx('shell.notif.unreadN', { n: unread }) : tx('shell.notif.caught')}</p>
          <h2 className="mt-1 text-h1">{tx('notif.title')}</h2>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={markAll}
            disabled={marking}
            className="fx-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-surface px-3.5 text-[14px] font-semibold text-primary shadow-e1 hover:bg-primary-soft disabled:opacity-60"
          >
            <CheckCheck className="size-4" aria-hidden />
            {tx('shell.notif.markAll')}
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="mx-3 space-y-1 rounded-[22px] border border-border/70 bg-surface p-3" aria-busy="true" aria-label={tx('common.loading')}>
          {[0, 1, 2, 3].map((k) => (
            <SkeletonRow key={k} />
          ))}
        </div>
      ) : !list.length ? (
        <div className="flex flex-col items-center px-6 pb-8 pt-2 text-center">
          <div className="w-[190px] [&_svg]:h-auto [&_svg]:w-full" aria-hidden>
            <EmptyInboxArt />
          </div>
          <p className="mt-3 font-display text-[21px] font-semibold">{tx('notif.empty')}</p>
          <p className="mt-1 max-w-xs text-body text-muted">{tx('notif.emptyBody')}</p>
        </div>
      ) : (
        <>
          {section('shell.notif.today', today)}
          {section('shell.notif.earlier', earlier)}
        </>
      )}
      <div className="px-3 pb-2 pt-1">
        <Link to="/notifications" onClick={onClose} className="fx-press flex min-h-12 items-center justify-center gap-1 rounded-[16px] text-[15px] font-semibold text-primary hover:bg-primary-soft">
          {tx('shell.notif.all')}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
