import { useQuery } from '@tanstack/react-query'
import { Copy, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Card, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { QrCode } from '../../components/ui/QrCode'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { BadgesRow } from './ProfileActions'

export function InvitePage() {
  const { data: me, isLoading } = useMyProfile()
  const progress = useQuery({
    queryKey: ['batch-progress', me?.grad_year, me?.branch],
    enabled: !!me?.grad_year,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('batch_progress', { p_year: me!.grad_year, p_branch: me!.branch })
      if (error) throw error
      return data as { joined: number; total: number | null }
    },
  })
  const board = useQuery({
    queryKey: ['invite-board'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('invite_leaderboard', { p_year: null })
      if (error) throw error
      return data as { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; joined: number }[]
    },
  })
  const mine = useQuery({
    queryKey: ['my-invites', me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('invited_by', me!.id)
      return count ?? 0
    },
  })

  if (isLoading || !me) return <PageSkeleton />
  const link = `${window.location.origin}/?invite=${(me as unknown as { invite_code: string }).invite_code}`
  const message = `Hi! I'm on JEC Alumni Connect, the home of Jabalpur Engineering College alumni. Find our batchmates, see what everyone's doing and register for the Alumni Meet 2026: ${link}`
  const p = progress.data
  const pct = p?.total ? Math.min(100, Math.round((p.joined / p.total) * 100)) : null

  return (
    <div>
      <PageHeader title="Invite friends" back="/me" />
      <Page className="space-y-6">
        <Card className="overflow-hidden">
          <div className="bg-hero p-5 text-white">
            <p className="text-xl font-bold">Bring your batch in</p>
            <p className="mt-1 text-hero-text">Friends who join with your link are verified faster, because you vouch for them.</p>
            {p && (
              <div className="mt-4">
                <p className="text-sm font-semibold">
                  {me.branch} {me.grad_year}: {p.joined} on board{pct !== null && ` · ${pct}%`}
                </p>
                {pct !== null && (
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-4 p-5">
            <QrCode value={link} size={190} label="Invite QR code" />
            <div className="grid w-full gap-2 sm:grid-cols-3">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#128c4a] px-4 font-semibold text-white">
                <WhatsAppIcon className="size-5" /> WhatsApp
              </a>
              <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Link copied'))} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-border px-4 font-semibold text-primary">
                <Copy className="size-4" aria-hidden /> Copy link
              </button>
              {'share' in navigator && (
                <button type="button" onClick={() => navigator.share({ text: message }).catch(() => undefined)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-border px-4 font-semibold text-primary">
                  <Share2 className="size-4" aria-hidden /> Share
                </button>
              )}
            </div>
            <p className="text-sm text-muted">{mine.data ?? 0} friends joined with your link. We never message anyone on your behalf.</p>
          </div>
        </Card>
        <section>
          <SectionTitle>Your badges</SectionTitle>
          <BadgesRow memberId={me.id} />
          <p className="mt-2 text-sm text-muted">Connector: 5 friends joined · Batch Champion: 25 friends joined.</p>
        </section>
        {!!board.data?.length && (
          <section>
            <SectionTitle>Top inviters</SectionTitle>
            <Card className="divide-y divide-border">
              {board.data.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 p-3.5">
                  <span className="w-6 text-center font-bold text-muted">{i + 1}</span>
                  <Avatar src={r.avatar_url} name={r.full_name} size={36} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.full_name}</span>
                  <span className="text-sm font-semibold">{r.joined}</span>
                </div>
              ))}
            </Card>
          </section>
        )}
      </Page>
    </div>
  )
}
