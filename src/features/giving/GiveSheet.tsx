import { Check, Copy, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { QrCode } from '../../components/ui/QrCode'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatPaise } from '../../lib/money'
import { buildUpiLink, isValidUpiId, normalizeUtr } from '../../lib/upi'
import { useMyProfile } from '../auth/AuthProvider'
import { submitGift, useAct, type CampaignDetail } from './api'
import { giftProblem, itemRemaining, parseGift, upiNote } from './helpers'
import { copyText } from './parts'

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const isIos = /iPhone|iPad|iPod/i.test(ua)
const isPhone = isIos || /Android/i.test(ua)
const IOS_APPS = [
  { name: 'Google Pay', scheme: 'gpay://upi/pay' },
  { name: 'PhonePe', scheme: 'phonepe://pay' },
  { name: 'Paytm', scheme: 'paytmmp://pay' },
]

/** The give flow: amount, who sees it, pay by UPI (link, QR, copy), enter the 12-digit UTR. No card data, no gateway. */
export function GiveSheet({ c, itemId, onClose }: { c: CampaignDetail; itemId: string | null; onClose: () => void }) {
  const tx = useT()
  const { data: profile } = useMyProfile()
  const send = useAct(submitGift)
  const item = c.items.find((i) => i.id === itemId) ?? null
  const remaining = item ? itemRemaining(item) : null
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [amount, setAmount] = useState(item && remaining ? String(Math.min(remaining, item.price_paise) / 100) : '')
  const [anonymous, setAnonymous] = useState(false)
  const [message, setMessage] = useState('')
  const [dedication, setDedication] = useState('')
  const [utr, setUtr] = useState('')
  const [payer, setPayer] = useState(profile?.full_name ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const paise = parseGift(amount)
  const upiReady = !!c.upi_id && isValidUpiId(c.upi_id)
  const link = upiReady && paise ? buildUpiLink({ upiId: c.upi_id!, payeeName: c.payee_name, amountPaise: paise, note: upiNote(c.slug) }) : null

  function next() {
    const p = giftProblem(amount)
    if (p) return setErr(tx(p === 'empty' ? 'give.err.empty' : p === 'low' ? 'give.err.low' : p === 'high' ? 'give.err.high' : 'give.err.invalid'))
    if (remaining !== null && paise! > remaining) return setErr(tx('give.err.itemMax', { amount: formatPaise(remaining, { zeroAsFree: false }) }))
    setErr(null)
    setStep(2)
  }

  async function pay() {
    const clean = normalizeUtr(utr)
    if (!clean) return setErr(tx('my.utrError'))
    setErr(null)
    setBusy(true)
    try {
      await send.mutateAsync([{ campaign: c.id, item: itemId, amount: paise!, utr: clean, payer, anonymous, message, dedication }])
      setStep(3)
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} label={tx('give.giveTitle')}>
      <div className="space-y-4 p-5" data-testid="give-sheet">
        <h2 className="text-lg font-bold">{step === 3 ? tx('give.thanksTitle') : tx('give.giveTitle')}</h2>
        {step === 1 && (
          <>
            {item && <Notice tone="info" title={tx('give.fundingItem', { name: item.name })}>{tx('give.itemLeft', { amount: formatPaise(remaining ?? 0, { zeroAsFree: false }) })}</Notice>}
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={tx('give.suggested')}>
              {c.suggested_paise.filter((s) => remaining === null || s <= remaining).map((s) => (
                <button key={s} type="button" onClick={() => setAmount(String(s / 100))} aria-pressed={paise === s}
                  className={`min-h-12 rounded-xl border px-3 font-bold tabular-nums ${paise === s ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface'}`}>
                  {formatPaise(s, { zeroAsFree: false })}
                </button>
              ))}
            </div>
            <Field label={tx('give.otherAmount')} hint={tx('give.amountHint')} error={err}>
              {(p) => <Input {...p} inputMode="decimal" autoComplete="off" placeholder="₹" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(null) }} />}
            </Field>
            <Checkbox checked={anonymous} onChange={setAnonymous}><span className="font-semibold">{tx('give.anonymous')}</span><span className="block text-sm text-muted">{tx('give.anonymousHint')}</span></Checkbox>
            <Field label={tx('give.dedication')} optional hint={tx('give.dedicationHint')}>
              {(p) => <Input {...p} maxLength={150} value={dedication} onChange={(e) => setDedication(e.target.value)} />}
            </Field>
            <Field label={tx('give.message')} optional>
              {(p) => <Textarea {...p} maxLength={300} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />}
            </Field>
            {c.foreign_notice && <Notice tone="warning" title={tx('give.foreignTitle')}>{c.foreign_notice}</Notice>}
            <Button block onClick={next}>{tx('give.continue')}</Button>
          </>
        )}
        {step === 2 && paise && (
          <>
            {!upiReady ? (
              <Notice tone="warning" title={tx('my.soonTitle')}>{tx('my.soonBody')}</Notice>
            ) : (
              <>
                <div className="rounded-2xl bg-primary-soft p-4">
                  <p className="text-sm font-semibold text-primary">{tx('give.step1')}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">{formatPaise(paise, { zeroAsFree: false })}</p>
                  <p className="text-sm text-muted">{tx('my.payTo', { name: c.payee_name })}</p>
                </div>
                {isIos && link && (
                  <div className="grid grid-cols-3 gap-2">
                    {IOS_APPS.map((a) => <a key={a.name} href={link.replace('upi://pay', a.scheme)} className="flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-2 text-center text-sm font-semibold text-primary">{a.name}</a>)}
                  </div>
                )}
                {isPhone && !isIos && link && (
                  <a href={link} data-testid="upi-link" className="flex min-h-13 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary">
                    <Smartphone className="size-5" aria-hidden /> {tx('my.payApp', { amount: formatPaise(paise, { zeroAsFree: false }) })}
                  </a>
                )}
                <dl className="divide-y divide-border rounded-xl border border-border px-3">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-sm text-muted">{tx('my.upiId')}</dt>
                    <dd className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-mono text-[15px] font-semibold" data-testid="upi-id">{c.upi_id}</span>
                      <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copyText(c.upi_id!, tx('my.upiId'))} aria-label={tx('my.copyUpi')}><Copy className="size-4" /></button>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-sm text-muted">{tx('my.amount')}</dt>
                    <dd className="flex items-center gap-1">
                      <span className="font-semibold tabular-nums">{formatPaise(paise, { zeroAsFree: false })}</span>
                      <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copyText(String(paise / 100), tx('my.amount'))} aria-label={tx('my.copyAmount')}><Copy className="size-4" /></button>
                    </dd>
                  </div>
                </dl>
                {link && (
                  <div className="flex flex-col items-center gap-2">
                    <QrCode value={link} size={200} label={tx('my.upiQr', { amount: formatPaise(paise, { zeroAsFree: false }) })} />
                    <p className="text-center text-sm text-muted">{tx('my.scan')}</p>
                  </div>
                )}
                <p className="text-sm font-semibold text-primary">{tx('give.step2')}</p>
                <Field label={tx('my.utr')} hint={tx('my.utrHint')} error={err}>
                  {(p) => <Input {...p} inputMode="numeric" autoComplete="off" placeholder={tx('my.utrPh')} className="font-mono tracking-wider" value={utr} onChange={(e) => { setUtr(e.target.value); setErr(null) }} />}
                </Field>
                <Field label={tx('my.payer')} optional>
                  {(p) => <Input {...p} autoComplete="name" value={payer} onChange={(e) => setPayer(e.target.value)} />}
                </Field>
                <Button block loading={busy} onClick={pay}>{tx('give.iPaid')}</Button>
              </>
            )}
            <Button block variant="ghost" onClick={() => { setStep(1); setErr(null) }}>{tx('common.back')}</Button>
          </>
        )}
        {step === 3 && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><Check className="size-7" aria-hidden /></div>
            <p className="text-[15px] text-muted" data-testid="give-done">{tx('give.thanksBody')}</p>
            <Link to="/give/mine" className="inline-flex min-h-11 items-center font-semibold text-primary" onClick={() => toast.dismiss()}>{tx('give.myGiving')}</Link>
            <Button block variant="secondary" onClick={onClose}>{tx('common.close')}</Button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
