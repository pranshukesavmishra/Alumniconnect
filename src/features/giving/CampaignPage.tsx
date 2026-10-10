import { CalendarClock, Check, Copy, Gift, HeartHandshake, Lock, Target, Trophy } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, Field, Input } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate, relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { cancelPledge, coverUrl, setPledge, sponsorInterest, useAct, useCampaign, useDonors, useLeaderboard, usePublicPackages, type CampaignDetail } from './api'
import { GiveSheet } from './GiveSheet'
import { daysLeft, donorLabel, itemRemaining, percentOf, whatsappShareUrl } from './helpers'
import { Cover, Money, ProgressBar, StatusBadge, TYPE_KEY, copyText } from './parts'
import { SponsorStrip } from './SponsorWall'

function PledgeSheet({ c, onClose }: { c: CampaignDetail; onClose: () => void }) {
  const tx = useT()
  const save = useAct(setPledge)
  const drop = useAct(cancelPledge)
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const [on, setOn] = useState(c.my_pledge?.remind_on ?? '')
  const [monthly, setMonthly] = useState(c.my_pledge?.monthly ?? false)
  const [err, setErr] = useState<string | null>(null)
  async function submit() {
    if (!on) return setErr(tx('give.pledgeDate'))
    try {
      await save.mutateAsync([c.id, on, monthly, null])
      toast.success(tx('give.pledgeSaved'))
      onClose()
    } catch (e) {
      setErr(friendlyError(e))
    }
  }
  return (
    <Sheet open onClose={onClose} label={tx('give.pledgeTitle')}>
      <div className="space-y-4 p-5" data-testid="pledge-sheet">
        <h2 className="text-lg font-bold">{tx('give.pledgeTitle')}</h2>
        <p className="text-sm text-muted">{tx('give.pledgeBody')}</p>
        <Field label={tx('give.remindOn')} error={err}>
          {(p) => <Input {...p} type="date" min={today} value={on} onChange={(e) => { setOn(e.target.value); setErr(null) }} />}
        </Field>
        <Checkbox checked={monthly} onChange={setMonthly}>{tx('give.monthly')}</Checkbox>
        <Button block loading={save.isPending} onClick={submit}>{tx('give.pledgeSave')}</Button>
        {c.my_pledge && (
          <Button block variant="ghost" loading={drop.isPending} onClick={async () => { await drop.mutateAsync([c.id]); toast.success(tx('give.pledgeCancelled')); onClose() }}>{tx('give.pledgeCancel')}</Button>
        )}
      </div>
    </Sheet>
  )
}

function SponsorInterestSheet({ c, onClose }: { c: CampaignDetail; onClose: () => void }) {
  const tx = useT()
  const pk = usePublicPackages({ campaign: c.id }, true)
  const send = useAct(sponsorInterest)
  const [org, setOrg] = useState('')
  const [note, setNote] = useState('')
  const [pkg, setPkg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function submit() {
    try {
      await send.mutateAsync([{ campaign: c.id, pkg, org, note }])
      toast.success(tx('give.sponsorThanks'))
      onClose()
    } catch (e) {
      setErr(friendlyError(e))
    }
  }
  return (
    <Sheet open onClose={onClose} label={tx('give.sponsorTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('give.sponsorTitle')}</h2>
        <p className="text-sm text-muted">{tx('give.sponsorBody')}</p>
        {pk.data?.map((p) => (
          <button key={p.id} type="button" onClick={() => setPkg(pkg === p.id ? null : p.id)} aria-pressed={pkg === p.id}
            className={`w-full rounded-2xl border p-3 text-left ${pkg === p.id ? 'border-primary bg-primary-soft' : 'border-border'}`}>
            <span className="flex items-baseline justify-between gap-2"><b>{p.name}</b><span className="tabular-nums">{p.is_in_kind ? tx('give.inKind') : formatPaise(p.price_paise, { zeroAsFree: false })}</span></span>
            {p.available !== null && <span className="text-xs text-muted">{tx('give.slotsLeft', { count: p.available })}</span>}
            {p.benefits.length > 0 && <span className="mt-1 block text-sm text-muted">{p.benefits.join(' · ')}</span>}
          </button>
        ))}
        <Field label={tx('give.sponsorOrg')} error={err}>{(p) => <Input {...p} maxLength={120} value={org} onChange={(e) => setOrg(e.target.value)} />}</Field>
        <Field label={tx('give.sponsorNote')} optional>{(p) => <Input {...p} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Button block loading={send.isPending} onClick={submit}>{tx('give.sponsorSend')}</Button>
      </div>
    </Sheet>
  )
}

export function CampaignPage() {
  const tx = useT()
  const { slug } = useParams()
  const { data: c, isLoading, error } = useCampaign(slug)
  const [limit, setLimit] = useState(10)
  const donors = useDonors(c?.id, limit)
  const board = useLeaderboard(c?.id ?? null)
  const [give, setGive] = useState<{ item: string | null } | null>(null)
  const [pledge, setPledgeOpen] = useState(false)
  const [sponsor, setSponsor] = useState(false)
  if (isLoading) return <PageSkeleton />
  if (error || !c) return <div><PageHeader title={tx('give.title')} back="/give" /><Page><Notice tone="danger" title={error ? friendlyError(error) : tx('give.notFound')} /></Page></div>

  const d = daysLeft(c.ends_at)
  const url = `${window.location.origin}/give/${c.slug}`
  const shareText = tx('give.shareText', { title: c.title, raised: formatPaise(c.raised_paise, { zeroAsFree: false }), goal: formatPaise(c.goal_paise, { zeroAsFree: false }), url })
  const open = c.accepting
  return (
    <div>
      <PageHeader title={c.title} back="/give" />
      <Page className="space-y-5">
        <div className="overflow-hidden rounded-3xl border border-border/80 shadow-card">
          <Cover c={c} className="h-44 sm:h-64" />
          <div className="space-y-3 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{tx(TYPE_KEY[c.type] ?? 'give.type.project')}</Badge>
              <StatusBadge c={c} />
              {c.department && <Badge>{c.department}</Badge>}
              {c.batch_from && <Badge>{tx('give.batches', { from: c.batch_from, to: c.batch_to ?? c.batch_from })}</Badge>}
            </div>
            {c.summary && <p className="text-[15px] text-muted">{c.summary}</p>}
            <ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={tx('give.progress')} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p><span className="text-2xl font-bold tabular-nums" data-testid="raised"><Money paise={c.raised_paise} /></span> <span className="text-sm text-muted">{tx('give.ofGoal', { goal: formatPaise(c.goal_paise, { zeroAsFree: false }) })}</span></p>
              <span className="text-sm font-semibold" data-testid="percent">{percentOf(c.raised_paise, c.goal_paise)}%</span>
            </div>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span data-testid="donor-count">{tx('give.donors', { count: c.donor_count })}</span>
              {d !== null && <span className="inline-flex items-center gap-1" data-testid="countdown"><CalendarClock className="size-4" aria-hidden /> {d === 0 ? tx('give.ended') : tx('give.daysLeft', { count: d })}</span>}
              {c.ends_at && <span>{tx('give.endsOn', { date: formatDate(c.ends_at) })}</span>}
            </p>
            {c.my_total_paise > 0 && <p className="text-sm font-semibold text-success" data-testid="my-total">{tx('give.youGave', { amount: formatPaise(c.my_total_paise, { zeroAsFree: false }) })}</p>}
            {open ? (
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" icon={<HeartHandshake className="size-4" />} onClick={() => setGive({ item: null })} data-testid="give-btn">{tx('give.giveNow')}</Button>
                <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setPledgeOpen(true)} data-testid="pledge-btn">{c.my_pledge ? tx('give.pledged') : tx('give.pledge')}</Button>
              </div>
            ) : (
              <Notice tone="info" title={c.status === 'completed' ? tx('give.completedNote') : c.status === 'paused' ? tx('give.pausedNote') : tx('give.closedNote')} />
            )}
            <div className="flex flex-wrap gap-2">
              <a href={whatsappShareUrl(shareText)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft" data-testid="share-whatsapp">
                <WhatsAppIcon className="size-4" /> {tx('give.shareWhatsapp')}
              </a>
              <button type="button" onClick={() => copyText(url, tx('give.link'))} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft">
                <Copy className="size-4" aria-hidden /> {tx('give.copyLink')}
              </button>
            </div>
            {c.status === 'draft' && <Notice tone="warning" title={tx('give.draftPreview')} />}
          </div>
        </div>

        {c.milestones.length > 0 && (
          <section aria-label={tx('give.milestones')}>
            <SectionTitle>{tx('give.milestones')}</SectionTitle>
            <Card className="divide-y divide-border">
              {c.milestones.map((m) => (
                <div key={m.percent} className="flex items-start gap-3 p-3.5" data-testid="milestone" data-reached={m.reached}>
                  <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${m.reached ? 'bg-success text-white' : 'bg-surface-2 text-muted'}`}>
                    {m.reached ? <Check className="size-4" aria-hidden /> : `${m.percent}%`}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{m.percent}% · {m.title} <span className="font-normal text-muted">({formatPaise(m.amount_paise, { zeroAsFree: false })})</span></p>
                    {m.unlocks && <p className="text-sm text-muted">{tx('give.unlocks')}: {m.unlocks}</p>}
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}

        {c.items.length > 0 && (
          <section aria-label={tx('give.items')}>
            <SectionTitle>{tx(c.type === 'adopt' ? 'give.adoptItems' : 'give.items')}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.items.map((i) => {
                const left = itemRemaining(i)
                return (
                  <Card key={i.id} className="space-y-2 p-4" data-testid="item-card">
                    <div className="flex items-start justify-between gap-2"><p className="font-bold">{i.name}</p><b className="tabular-nums">{formatPaise(i.price_paise, { zeroAsFree: false })}</b></div>
                    {i.description && <p className="text-sm text-muted">{i.description}</p>}
                    <ProgressBar raised={i.funded_paise} goal={i.price_paise} label={i.name} />
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted" data-testid="item-funded">{i.funded_paise >= i.price_paise ? tx('give.itemFunded') : tx('give.itemRaised', { amount: formatPaise(i.funded_paise, { zeroAsFree: false }) })}</span>
                      {open && left > 0 && <Button size="sm" variant="secondary" icon={<Gift className="size-4" />} onClick={() => setGive({ item: i.id })} data-testid="adopt-btn">{tx('give.fundItem')}</Button>}
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {c.story && (
          <section aria-label={tx('give.story')}>
            <SectionTitle>{tx('give.story')}</SectionTitle>
            <Card className="whitespace-pre-wrap p-4 text-[16px] leading-relaxed">{c.story}</Card>
          </section>
        )}

        <SponsorStrip campaign={c.id} />
        {open && <button type="button" onClick={() => setSponsor(true)} className="min-h-11 text-sm font-semibold text-primary">{tx('give.becomeSponsor')}</button>}

        <section aria-label={tx('give.updates')}>
          <SectionTitle>{tx('give.updates')}</SectionTitle>
          {c.updates.length === 0 ? <p className="text-sm text-muted">{tx('give.noUpdates')}</p> : (
            <div className="space-y-3">
              {c.updates.map((u) => (
                <Card key={u.id} className="overflow-hidden" data-testid="update">
                  {u.image_path && <img src={coverUrl(u.image_path) ?? ''} alt="" loading="lazy" className="h-40 w-full object-cover" />}
                  <div className="p-4">
                    <p className="text-xs text-muted">{relativeTime(u.created_at)}</p>
                    {u.title && <p className="font-bold">{u.title}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-[15px]">{u.body}</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section aria-label={tx('give.batchBoard')} data-testid="leaderboard">
          <SectionTitle>{tx('give.batchBoard')}</SectionTitle>
          {!board.data?.batches.length ? <p className="text-sm text-muted">{tx('give.noBoard')}</p> : (
            <Card className="divide-y divide-border">
              {board.data.batches.map((b, i) => (
                <div key={b.batch} className="flex items-center gap-3 p-3.5" data-testid="board-row">
                  <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-bold text-warning">{i === 0 ? <Trophy className="size-4" aria-hidden /> : i + 1}</span>
                  <p className="min-w-0 flex-1">{tx('give.batchRaised', { year: b.batch })} <b className="tabular-nums"><Money paise={b.raised_paise} /></b></p>
                  <span className="text-xs text-muted">{tx('give.donors', { count: b.donors })}</span>
                </div>
              ))}
              {board.data.anonymous_paise > 0 && <p className="p-3.5 text-sm text-muted">{tx('give.plusAnon', { amount: formatPaise(board.data.anonymous_paise, { zeroAsFree: false }) })}</p>}
            </Card>
          )}
        </section>

        <section aria-label={tx('give.wall')} data-testid="donor-wall">
          <SectionTitle>{tx('give.wall')}</SectionTitle>
          {donors.isLoading ? <PageSkeleton /> : !donors.data?.length ? (
            <EmptyState icon={<Target />} title={tx('give.beFirst')} />
          ) : (
            <Card className="divide-y divide-border">
              {donors.data.map((dn) => (
                <div key={dn.id} className="p-3.5" data-testid="donor">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold">{donorLabel(dn, tx('give.aJecian'))}{dn.batch ? <span className="font-normal text-muted"> · {tx('common.batch', { year: dn.batch })}</span> : null}</p>
                    <b className="tabular-nums"><Money paise={dn.amount_paise} /></b>
                  </div>
                  {dn.dedication && <p className="text-sm text-muted">{dn.dedication}</p>}
                  {dn.message && <p className="mt-0.5 text-[15px]">“{dn.message}”</p>}
                </div>
              ))}
              {donors.data.length >= limit && <button type="button" className="min-h-12 w-full text-sm font-semibold text-primary" onClick={() => setLimit(limit + 30)}>{tx('give.showMore')}</button>}
            </Card>
          )}
        </section>

        <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" aria-hidden /> {tx('give.privacy')}</p>
      </Page>
      {give && <GiveSheet c={c} itemId={give.item} onClose={() => setGive(null)} />}
      {pledge && <PledgeSheet c={c} onClose={() => setPledgeOpen(false)} />}
      {sponsor && <SponsorInterestSheet c={c} onClose={() => setSponsor(false)} />}
    </div>
  )
}
