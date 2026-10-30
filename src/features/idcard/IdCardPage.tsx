import { Camera, Download, Eye, Hourglass, QrCode as QrIcon, RefreshCw, RotateCcw, ScanLine, Share2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, Notice, SkeletonCard } from '../../components/ui/Display'
import { Dialog } from '../../components/ui/Dialog'
import { Switch } from '../../components/ui/Form'
import { BorderBeam, GlowOrbs } from '../../components/ui/Fx'
import { IconTile } from '../../components/ui/IconTile'
import { useLang, useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { haptic } from '../../lib/haptics'
import { downloadBlob, shareOrDownload } from '../share/canvasArt'
import { renderShareCard } from '../share/renderShareCard'
import { useIdCardTokenActions, useMyIdCard, useSetShowcasePrefs, useShowcasePrefs, type MyIdCard } from './api'
import { CARD_ROLE_LABELS, cardRoles, cardVerifyUrl } from './card'
import { IdCard, useCardLine, type CardView } from './IdCard'
import { drawIdCard, type CardDrawData } from './renderIdCard'

const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

/** The dark stage the card sits on: aurora, glow orbs, a faint grid and one travelling beam. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <BorderBeam className="rounded-[32px]" speed={8}>
      <div className="aurora relative overflow-hidden rounded-[32px] px-4 pb-5 pt-7 sm:px-10 sm:pb-8 sm:pt-10">
        <GlowOrbs />
        <div aria-hidden className="fx-grid fx-grid-light pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-[440px]">{children}</div>
      </div>
    </BorderBeam>
  )
}

export function IdCardPage() {
  const tx = useT()
  const { data: card, isLoading, error } = useMyIdCard()
  return (
    <div>
      <PageHeader title={tx('wow.card.title')} subtitle={tx('wow.card.subtitle')} back="/me" />
      <Page className="space-y-5">
        {isLoading ? (
          <SkeletonCard className="h-72" />
        ) : error || !card ? (
          <Notice tone="danger" title={tx('wow.card.loadError')}>
            {friendlyError(error)}
          </Notice>
        ) : card.status !== 'active' ? (
          <NotYet card={card} />
        ) : (
          <ActiveCard card={card} />
        )}
      </Page>
    </div>
  )
}

function NotYet({ card }: { card: MyIdCard }) {
  const tx = useT()
  const view: CardView = { ...card, membership_no: 'JEC-0000-000000', member_since: null, roles: [] }
  return (
    <>
      <Stage>
        <div className="pointer-events-none select-none opacity-70 blur-[1.5px] saturate-[0.6]">
          <IdCard card={view} verifyUrl={null} flipped={false} specimen />
        </div>
        <div className="fx-liquid-dark relative -mt-10 rounded-[24px] p-5 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-white/10 text-accent">
            <Hourglass className="size-6" aria-hidden />
          </span>
          <h2 className="text-h2 text-white">{card.status === 'rejected' ? tx('wow.card.rejectedTitle') : tx('wow.card.pendingTitle')}</h2>
          <p className="mt-2 text-body text-hero-text">{card.status === 'rejected' ? tx('wow.card.rejectedBody') : tx('wow.card.pendingBody')}</p>
        </div>
      </Stage>
      <div className="grid gap-3 sm:grid-cols-2">
        <ButtonLink to="/me/edit" variant="primary" size="lg" block>
          {tx('wow.card.completeProfile')}
        </ButtonLink>
        <ButtonLink to="/help" variant="secondary" size="lg" block>
          {tx('wow.card.askHelp')}
        </ButtonLink>
      </div>
    </>
  )
}

function ActiveCard({ card }: { card: MyIdCard }) {
  const tx = useT()
  const { lang } = useLang()
  const line = useCardLine()(card)
  const { regenerate, revoke } = useIdCardTokenActions()
  const prefs = useShowcasePrefs()
  const setPrefs = useSetShowcasePrefs()
  const [flipped, setFlipped] = useState(false)
  const [confirm, setConfirm] = useState<null | 'regen' | 'revoke'>(null)
  const [busy, setBusy] = useState<null | 'download' | 'share'>(null)
  const verifyUrl = card.token ? cardVerifyUrl(window.location.origin, card.token) : null
  const since = card.member_since ? formatDate(card.member_since, { month: 'long', year: 'numeric' }) : '—'
  const roles = cardRoles(card.roles).map((r) => CARD_ROLE_LABELS[r][lang === 'hi' ? 'hi' : 'en'])
  const showPhoto = prefs.data?.card_show_photo ?? card.card_show_photo

  const drawData = (): CardDrawData => ({
    name: card.full_name,
    photo: card.avatar_url,
    line,
    membershipNo: card.membership_no ?? '',
    memberSince: card.member_since ? formatDate(card.member_since, { month: 'short', year: 'numeric' }) : '',
    roles,
    verifyUrl,
    labels: {
      college: tx('wow.card.college'),
      collegeSub: tx('wow.card.collegeSub'),
      alumniId: tx('wow.card.alumniId'),
      membershipNo: tx('wow.card.membershipNo'),
      memberSince: tx('wow.card.memberSince'),
      noQr: tx('wow.card.noQr'),
    },
  })
  const fileBase = `JEC-ID-${card.membership_no ?? 'card'}`

  async function download() {
    setBusy('download')
    try {
      const canvas = await drawIdCard(drawData())
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
      downloadBlob(blob, `${fileBase}.png`)
      haptic()
      toast.success(tx('wow.card.downloaded'))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }
  async function share() {
    setBusy('share')
    try {
      const canvas = await drawIdCard(drawData())
      const blob = await renderShareCard({
        eyebrow: tx('wow.share.idEyebrow'),
        title: card.full_name,
        subtitle: line,
        art: { type: 'image', canvas },
        footer: window.location.host,
        college: tx('wow.card.college'),
        collegeSub: tx('wow.card.collegeSub'),
      })
      const r = await shareOrDownload(blob, `${fileBase}-story.png`, tx('wow.share.idText'))
      if (r === 'downloaded') toast.success(tx('wow.share.saved'))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }
  function doConfirm() {
    const which = confirm
    setConfirm(null)
    const m = which === 'regen' ? regenerate : revoke
    m.mutate(undefined, {
      onSuccess: () => {
        haptic()
        toast.success(which === 'regen' ? tx('wow.card.regenDone') : tx('wow.card.revokeDone'))
      },
      onError: (e) => toast.error(friendlyError(e)),
    })
  }

  return (
    <>
      <Stage>
        <IdCard card={card} verifyUrl={verifyUrl} flipped={flipped} />
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-caption text-white/70">{flipped ? tx('wow.card.backHint') : tx('wow.card.tiltHint')}</p>
          <Button variant="glass" size="sm" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>
            {tx('wow.card.flip')}
          </Button>
        </div>
      </Stage>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="primary" size="lg" className="fx-shine" icon={<Download className="size-5" aria-hidden />} loading={busy === 'download'} onClick={() => void download()}>
          {tx('wow.card.download')}
        </Button>
        <Button variant="secondary" size="lg" icon={<Share2 className="size-5" aria-hidden />} loading={busy === 'share'} onClick={() => void share()}>
          {tx('wow.card.share')}
        </Button>
      </div>

      <Card className="fx-hairline divide-y divide-border/70 overflow-hidden p-0">
        <dl>
          {[
            [tx('wow.card.membershipNo'), <span key="m" className="font-mono tracking-wide">{card.membership_no}</span>],
            [tx('wow.card.batchBranch'), line || '—'],
            [tx('wow.card.memberSince'), since],
            [
              tx('wow.card.qrStatus'),
              verifyUrl ? (
                <span key="q" className="inline-flex items-center gap-1.5 font-semibold text-success">
                  <ShieldCheck className="size-4" aria-hidden />
                  {tx('wow.card.qrActive')}
                </span>
              ) : (
                <span key="q" className="inline-flex items-center gap-1.5 font-semibold text-warning">
                  <ShieldOff className="size-4" aria-hidden />
                  {tx('wow.card.qrOff')}
                </span>
              ),
            ],
          ].map(([k, v], i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-border/70 px-5 py-3.5 [&:not(:first-child)]:border-t">
              <dt className="text-caption font-semibold text-muted">{k}</dt>
              <dd className="min-w-0 text-right text-[15px] font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section className="space-y-3">
        <h2 className="text-h2">{tx('wow.card.qrSection')}</h2>
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={QrIcon} tone="emerald" size="md" />
            <p className="text-body text-muted">{tx('wow.card.qrExplain')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={regenerate.isPending} onClick={() => setConfirm('regen')}>
              {verifyUrl ? tx('wow.card.regen') : tx('wow.card.makeNew')}
            </Button>
            {verifyUrl && (
              <Button variant="danger-ghost" icon={<ShieldOff className="size-4" aria-hidden />} loading={revoke.isPending} onClick={() => setConfirm('revoke')}>
                {tx('wow.card.revoke')}
              </Button>
            )}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={showPhoto ? Eye : Camera} tone="gold" size="md" />
            <Switch
              className="flex-1"
              checked={showPhoto}
              disabled={setPrefs.isPending || prefs.isLoading}
              onChange={(v) => setPrefs.mutate({ card_show_photo: v }, { onError: (e) => toast.error(friendlyError(e)) })}
              label={tx('wow.card.photoToggle')}
              hint={tx('wow.card.photoHint')}
            />
          </div>
        </Card>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <ButtonLink to="/verify" variant="outline" icon={<ScanLine className="size-4" aria-hidden />} block>
          {tx('wow.card.scanOther')}
        </ButtonLink>
        {!isStandalone() && (
          <ButtonLink to="/install" variant="ghost" icon={<Smartphone className="size-4" aria-hidden />} block>
            {tx('wow.card.addHome')}
          </ButtonLink>
        )}
      </div>
      {!isStandalone() && <p className="text-center text-caption text-muted">{tx('wow.card.addHomeHint')}</p>}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        icon={<IconTile icon={confirm === 'revoke' ? ShieldOff : RefreshCw} tone={confirm === 'revoke' ? 'maroon' : 'emerald'} size="lg" />}
        title={confirm === 'revoke' ? tx('wow.card.revokeTitle') : tx('wow.card.regenTitle')}
        description={confirm === 'revoke' ? tx('wow.card.revokeBody') : tx('wow.card.regenBody')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {tx('wow.common.cancel')}
            </Button>
            <Button variant={confirm === 'revoke' ? 'danger' : 'primary'} onClick={doConfirm}>
              {confirm === 'revoke' ? tx('wow.card.revokeConfirm') : tx('wow.card.regenConfirm')}
            </Button>
          </>
        }
      />
    </>
  )
}
