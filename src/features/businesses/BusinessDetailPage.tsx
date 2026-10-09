import { ExternalLink, Flag, Mail, MapPin, MessageCircle, Pencil, Phone, Tag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'
import { Linkified } from '../community/PostCard'
import { telHref, useBusiness, useDeleteBusiness, whatsappDigits } from './queries'

const REPORT_REASONS = ['Fake or misleading', 'Spam or advertising', 'Offensive or illegal', 'Something else']

const actionClass = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 font-semibold'

export function BusinessDetailPage() {
  const { id = '' } = useParams()
  const uid = useUserId()
  const navigate = useNavigate()
  const { data: b, isLoading, error } = useBusiness(id)
  const del = useDeleteBusiness()
  const [reporting, setReporting] = useState(false)
  const [messaging, setMessaging] = useState(false)

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!b)
    return (
      <div>
        <PageHeader title="Business" back="/businesses" />
        <EmptyState title="This listing isn’t available">It may have been removed.</EmptyState>
      </div>
    )

  const mine = b.owner_id === uid

  async function report(reason: string) {
    const { error: err } = await supabase.rpc('report_business', { p_id: b!.id, p_reason: reason })
    if (err) return toast.error(friendlyError(err))
    toast.success('Thanks. Our moderators will review this listing.')
    setReporting(false)
  }

  return (
    <div>
      <PageHeader title={b.name} subtitle={b.category} back="/businesses" />
      <Page className="space-y-5">
        {b.is_hidden && (
          <Notice tone="warning" title="This listing is hidden pending review">
            {mine ? 'Only you and the moderators can see it.' : undefined}
          </Notice>
        )}
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="primary">{b.category}</Badge>
            {b.offer && (
              <Badge tone="accent">
                <Tag className="size-3" aria-hidden /> {b.offer}
              </Badge>
            )}
          </div>
          <p className="flex items-center gap-2 text-[15px] text-muted">
            <MapPin className="size-4" aria-hidden /> {b.city}
          </p>
          <div className="whitespace-pre-line break-words text-[16px] leading-relaxed [overflow-wrap:anywhere]">
            <Linkified text={b.description} />
          </div>
          <p className="text-sm text-muted">Listed {formatDate(b.created_at)}</p>
        </Card>

        <div className="space-y-2" aria-label="Contact">
          {b.website_url && (
            <a href={b.website_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-on-primary shadow-[0_8px_20px_-10px_var(--primary)]">
              <ExternalLink className="size-5" aria-hidden /> Visit website
            </a>
          )}
          {b.phone && (
            <a href={telHref(b.phone)} className={actionClass}>
              <Phone className="size-4" aria-hidden /> Call {b.phone}
            </a>
          )}
          {b.phone && b.whatsapp && (
            <a href={`https://wa.me/${whatsappDigits(b.phone)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#128c4a] px-5 font-semibold text-white">
              <WhatsAppIcon className="size-4" /> WhatsApp
            </a>
          )}
          {b.email && (
            <a href={`mailto:${b.email}?subject=${encodeURIComponent(`Saw ${b.name} on JEC Alumni Connect`)}`} className={actionClass}>
              <Mail className="size-4" aria-hidden /> Email {b.email}
            </a>
          )}
        </div>

        {b.owner && (
          <Card className="p-4">
            <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em] text-muted">Run by</p>
            <Link to={`/people/${b.owner.id}`} className="flex items-center gap-3">
              <Avatar src={b.owner.avatar_url} name={b.owner.full_name} size={48} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{b.owner.full_name}</span>
                <span className="block truncate text-sm text-muted">{[b.owner.grad_year && `Batch ${b.owner.grad_year}`, b.owner.branch].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
            {!mine && (
              <Button
                variant="secondary"
                block
                className="mt-3"
                icon={<MessageCircle className="size-4" />}
                loading={messaging}
                onClick={async () => {
                  setMessaging(true)
                  try {
                    navigate(`/chat/${await startDm(b.owner!.id)}`)
                  } catch (e) {
                    toast.error(friendlyError(e))
                  } finally {
                    setMessaging(false)
                  }
                }}
              >
                Message {b.owner.full_name.split(' ')[0]}
              </Button>
            )}
          </Card>
        )}

        {!mine && (
          <div className="flex">
            <Button variant="ghost" icon={<Flag className="size-4" />} onClick={() => setReporting(true)}>
              Report
            </Button>
          </div>
        )}

        {mine && (
          <Card className="space-y-2 p-4">
            <p className="font-semibold">Your listing</p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to={`/businesses/new?edit=${b.id}`} variant="secondary" icon={<Pencil className="size-4" />}>
                Edit
              </ButtonLink>
              <Button
                variant="danger-ghost"
                icon={<Trash2 className="size-4" />}
                loading={del.isPending}
                onClick={() => window.confirm('Delete this listing for good?') && del.mutate(b.id, { onSuccess: () => { toast.success('Listing deleted'); navigate('/businesses', { replace: true }) }, onError: (e) => toast.error(friendlyError(e)) })}
              >
                Delete
              </Button>
            </div>
          </Card>
        )}
      </Page>
      <Sheet open={reporting} onClose={() => setReporting(false)} label="Report this listing">
        <h2 className="px-5 pb-1 pt-1 text-lg font-bold">Report this listing</h2>
        <p className="px-5 pb-2 text-sm text-muted">Only moderators see your report.</p>
        {REPORT_REASONS.map((r) => (
          <SheetAction key={r} onClick={() => void report(r)}>
            {r}
          </SheetAction>
        ))}
      </Sheet>
    </div>
  )
}
