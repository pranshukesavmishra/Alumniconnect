import { Award, Lock, Share2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Confetti } from '../../components/ui/Confetti'
import { Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { Dialog } from '../../components/ui/Dialog'
import { GlowOrbs, SpotlightCard, TextReveal } from '../../components/ui/Fx'
import { ProgressBar, ProgressRing } from '../../components/ui/Progress'
import { Sheet } from '../../components/ui/Sheet'
import { useLang, useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { haptic } from '../../lib/haptics'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMember } from '../profile/queries'
import { shareOrDownload, svgElementToImage } from '../share/canvasArt'
import { renderShareCard } from '../share/renderShareCard'
import { useShownBadges } from './api'
import { BadgeMedallion } from './BadgeMedallion'
import { badgeHow, badgeTitle, progressText, sortForDisplay, type ShownBadge } from './catalog'
import { MEDAL, medalToneOf } from './medal'

const seenKey = (uid: string) => `jec-badges-seen:${uid}`
function readSeen(uid: string): string[] | null {
  try {
    const v = localStorage.getItem(seenKey(uid))
    return v ? (JSON.parse(v) as string[]) : null
  } catch {
    return null
  }
}
function writeSeen(uid: string, keys: string[]) {
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify(keys))
  } catch {
    /* private mode: celebrate again next time, harmless */
  }
}

export function BadgesPage() {
  const tx = useT()
  const { lang } = useLang()
  const { id } = useParams()
  const me = useUserId()
  const self = !id || id === me
  const userId = self ? me : id
  const { data: myProfile } = useMyProfile()
  const member = useMember(self ? undefined : id)
  const name = self ? myProfile?.full_name : member.data?.profile.full_name
  const { badges: all, isLoading, error } = useShownBadges(userId)
  const [open, setOpen] = useState<ShownBadge | null>(null)
  const [celebrate, setCelebrate] = useState<ShownBadge[]>([])
  const [burst, setBurst] = useState(0)

  // founding member that can no longer be earned is not shown at all
  const badges = useMemo(() => sortForDisplay(all.filter((b) => b.earned || b.attainable)), [all])
  const earned = badges.filter((b) => b.earned)
  const locked = badges.filter((b) => !b.earned)
  const next = locked.find((b) => (b.ratio ?? 0) > 0) ?? locked[0]

  // newly earned badges since the last visit: one celebration, remembered on this device
  useEffect(() => {
    if (!self || !me || isLoading || all.length === 0) return
    const seen = readSeen(me)
    const now = earned.map((b) => b.key)
    const fresh = earned.filter((b) => !(seen ?? []).includes(b.key))
    writeSeen(me, [...new Set([...(seen ?? []), ...now])])
    if (fresh.length) {
      setCelebrate(fresh)
      setBurst((n) => n + 1)
      haptic([20, 40, 20])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self, me, isLoading, all.length])

  const title = self ? tx('wow.badges.mine') : tx('wow.badges.theirs', { name: name ?? '' })
  return (
    <div>
      <PageHeader title={tx('wow.badges.title')} back={self ? '/me' : `/people/${id}`} />
      <Page className="space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-[32px]" />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-36 rounded-3xl" />
              ))}
            </div>
          </div>
        ) : error ? (
          <Notice tone="warning" title={tx('wow.badges.cantLoad')}>
            {friendlyError(error)}
          </Notice>
        ) : all.length === 0 ? (
          <EmptyState icon={<Award />} title={tx('wow.badges.noneTitle')}>
            {tx('wow.badges.noneBody')}
          </EmptyState>
        ) : (
          <>
            {/* ---------------- hero */}
            <section className="aurora relative overflow-hidden rounded-[32px] px-5 pb-6 pt-7 text-white shadow-pop sm:px-8">
              <GlowOrbs />
              <div aria-hidden className="fx-dots fx-dots-light pointer-events-none absolute inset-0" />
              <div className="relative flex items-center gap-5">
                <div className="min-w-0 flex-1">
                  <p className="text-eyebrow text-accent">{tx('wow.badges.eyebrow')}</p>
                  <TextReveal text={title} as="h2" className="text-display mt-2 text-white" />
                  <p className="mt-2 text-body-lg text-hero-text">{tx('wow.badges.earnedOf', { earned: earned.length, total: badges.length })}</p>
                </div>
                <ProgressRing value={earned.length} max={badges.length || 1} size={104} stroke={9} tone="gold" label={tx('wow.badges.ringLabel')}>
                  <span className="text-center">
                    <span className="text-stat block text-[30px] text-white" data-testid="earned-count">
                      {earned.length}
                    </span>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">{tx('wow.badges.earnedShort')}</span>
                  </span>
                </ProgressRing>
              </div>
              {earned.length > 0 && (
                <div className="relative mt-6 flex items-end justify-center gap-3 sm:gap-8">
                  {earned.slice(0, 3).map((b, i) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setOpen(b)}
                      className={`fx-press flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl p-1 ${i === 0 ? 'order-2' : i === 1 ? 'order-1' : 'order-3'}`}
                    >
                      <BadgeMedallion badge={b} size={i === 0 ? 96 : 76} />
                      <span className="text-[13px] font-semibold leading-tight text-white/90">{badgeTitle(b, lang)}</span>
                    </button>
                  ))}
                </div>
              )}
              {self && next && (
                <div className="fx-liquid-dark relative mt-6 flex items-center gap-3 rounded-[20px] p-3">
                  <BadgeMedallion badge={next} size={48} shine={false} />
                  <div className="min-w-0 flex-1">
                    <p className="text-caption text-white/70">{tx('wow.badges.nextUp')}</p>
                    <p className="text-title text-white">{badgeTitle(next, lang)}</p>
                    {next.ratio !== null && <ProgressBar value={next.ratio * 100} tone="gold" size="sm" label={badgeTitle(next, lang)} className="mt-1.5 bg-white/15" />}
                  </div>
                  {progressText(next) && <span className="text-stat shrink-0 text-[18px] text-accent">{progressText(next)}</span>}
                </div>
              )}
            </section>

            {/* ---------------- earned */}
            {earned.length > 0 && (
              <section aria-labelledby="earned-h">
                <h2 id="earned-h" className="text-h2 mb-3">
                  {tx('wow.badges.earned')}
                </h2>
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                  {earned.map((b) => (
                    <li key={b.key}>
                      <SpotlightCard tone="gold" className="fx-hairline h-full rounded-[24px] border border-border/70 bg-surface shadow-card">
                        <button type="button" onClick={() => setOpen(b)} className="fx-press flex h-full w-full flex-col items-center gap-2 px-2 pb-3 pt-4 text-center" data-testid={`badge-${b.key}`}>
                          <BadgeMedallion badge={b} size={68} />
                          <span className="text-[14px] font-semibold leading-tight">{badgeTitle(b, lang)}</span>
                          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-gold-ink">{MEDAL[medalToneOf(b)].label[lang === 'hi' ? 'hi' : 'en']}</span>
                        </button>
                      </SpotlightCard>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ---------------- still to earn */}
            {locked.length > 0 && (
              <section aria-labelledby="locked-h">
                <h2 id="locked-h" className="text-h2 mb-3">
                  {tx('wow.badges.toEarn')}
                </h2>
                <Card className="divide-y divide-border/70 overflow-hidden p-0">
                  {locked.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setOpen(b)}
                      className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                      data-testid={`locked-${b.key}`}
                    >
                      <BadgeMedallion badge={b} size={54} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-title">{badgeTitle(b, lang)}</span>
                        <span className="block text-caption text-muted">{badgeHow(b, lang)}</span>
                        {b.ratio !== null && (
                          <span className="mt-2 flex items-center gap-3">
                            <ProgressBar value={b.ratio * 100} size="sm" label={badgeTitle(b, lang)} className="flex-1" />
                            <span className="shrink-0 text-caption font-semibold tabular-nums text-muted">{progressText(b)}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </Card>
              </section>
            )}
          </>
        )}
      </Page>

      <BadgeSheet badge={open} onClose={() => setOpen(null)} canShare={self} name={name ?? ''} />

      <Confetti trigger={burst} />
      <Dialog
        open={celebrate.length > 0}
        onClose={() => setCelebrate([])}
        icon={celebrate[0] ? <BadgeMedallion badge={celebrate[0]} size={120} /> : undefined}
        title={celebrate.length === 1 && celebrate[0] ? tx('wow.badges.newOne', { title: badgeTitle(celebrate[0], lang) }) : tx('wow.badges.newMany', { count: celebrate.length })}
        description={celebrate.length > 1 ? celebrate.map((b) => badgeTitle(b, lang)).join(' · ') : celebrate[0] ? badgeHow(celebrate[0], lang) : undefined}
        actions={
          <Button variant="gold" onClick={() => setCelebrate([])} icon={<Sparkles className="size-4" aria-hidden />}>
            {tx('wow.badges.wonderful')}
          </Button>
        }
      />
    </div>
  )
}

function BadgeSheet({ badge, onClose, canShare, name }: { badge: ShownBadge | null; onClose: () => void; canShare: boolean; name: string }) {
  const tx = useT()
  const { lang } = useLang()
  const holder = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const b = badge
  async function share() {
    if (!b) return
    setBusy(true)
    try {
      const icon = await svgElementToImage(holder.current?.querySelector('[data-medal-icon] svg'), MEDAL[medalToneOf(b)].ink)
      const blob = await renderShareCard({
        eyebrow: tx('wow.share.badgeEyebrow'),
        title: tx('wow.share.badgeTitle', { title: badgeTitle(b, lang) }),
        subtitle: name ? `${name} · ${badgeHow(b, lang)}` : badgeHow(b, lang),
        art: { type: 'badge', tone: medalToneOf(b), icon },
        footer: window.location.host,
        college: tx('wow.card.college'),
        collegeSub: tx('wow.card.collegeSub'),
      })
      const r = await shareOrDownload(blob, `JEC-badge-${b.key}.png`, tx('wow.share.badgeText', { title: badgeTitle(b, lang) }))
      if (r === 'downloaded') toast.success(tx('wow.share.saved'))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={!!b} onClose={onClose} label={b ? badgeTitle(b, lang) : ''}>
      {b && (
        <div>
          <div ref={holder} className="aurora relative mx-3 mt-3 grid place-items-center overflow-hidden rounded-[24px] py-8">
            <GlowOrbs />
            <BadgeMedallion badge={b} size={150} className="relative" />
          </div>
          <div className="space-y-4 px-5 pb-4 pt-5 text-center">
            <div>
              <p className="text-eyebrow text-gold-ink">{MEDAL[medalToneOf(b)].label[lang === 'hi' ? 'hi' : 'en']}</p>
              <h2 className="text-h1 mt-1">{badgeTitle(b, lang)}</h2>
              <p className="mt-1.5 text-body text-muted">{badgeHow(b, lang)}</p>
            </div>
            {b.earned ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-success-soft px-4 py-1.5 text-[15px] font-semibold text-success">
                <Award className="size-4" aria-hidden />
                {b.earnedAt ? tx('wow.badges.earnedOn', { date: formatDate(b.earnedAt) }) : tx('wow.badges.earnedYes')}
              </p>
            ) : (
              <div className="space-y-2 text-left">
                <p className="flex items-center justify-center gap-2 text-[15px] font-semibold text-muted">
                  <Lock className="size-4" aria-hidden />
                  {tx('wow.badges.notYet')}
                </p>
                {b.ratio !== null && (
                  <div className="flex items-center gap-3">
                    <ProgressBar value={b.ratio * 100} label={badgeTitle(b, lang)} className="flex-1" />
                    <span className="text-[15px] font-semibold tabular-nums">{progressText(b)}</span>
                  </div>
                )}
              </div>
            )}
            {b.earned && canShare && (
              <Button variant="gold" size="lg" block className="fx-shine" loading={busy} icon={<Share2 className="size-5" aria-hidden />} onClick={() => void share()}>
                {tx('wow.badges.share')}
              </Button>
            )}
            {!b.earned && canShare && b.key === 'profile_star' && (
              <ButtonLink to="/me/edit" variant="secondary" block>
                {tx('wow.badges.completeProfile')}
              </ButtonLink>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
