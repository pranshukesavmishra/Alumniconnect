// "Fill my profile from LinkedIn": one consent tick, one tap. Looks the member up by their verified sign-in e-mail;
// when that finds nothing, asks for one thing only: their LinkedIn profile link. Hidden when no provider is set up.
import { Copy, Link2, MoreHorizontal, Share2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { Checkbox, Field, Input } from '../../components/ui/Form'
import { LinkedInIcon } from '../../components/ui/Icons'
import { useT } from '../../i18n'
import { normaliseLinkedInUrl } from '../../../supabase/functions/linkedin-enrich/rules.ts'
import { enrichFromLinkedIn, useEnrichAvailable, type EnrichJec } from './enrichQueries'
import { useFoundProfile } from './MagicFill'
import { PreviewCard } from './PreviewCard'
import { AiFillError } from './queries'

/** Two small drawings: LinkedIn app -> More -> Share profile, then Copy link. */
function HowToPictures() {
  const tx = useT()
  const phone = 'relative h-36 w-full max-w-40 overflow-hidden rounded-2xl border-2 border-border-strong bg-surface p-2 text-[11px] leading-tight'
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{tx('qp.li.howTitle')}</figcaption>
      <ol className="grid grid-cols-2 gap-3">
        <li className="space-y-1.5">
          <div className={phone} aria-hidden>
            <div className="h-6 rounded-md bg-[#0a66c2]/15" />
            <div className="-mt-3 ml-2 size-8 rounded-full border-2 border-surface bg-surface-2" />
            <div className="mt-1 h-2 w-16 rounded bg-surface-2" />
            <div className="mt-2 flex gap-1">
              <span className="rounded-full bg-[#0a66c2] px-2 py-0.5 text-white">Open to</span>
              <span className="inline-flex items-center rounded-full border-2 border-primary px-1.5 py-0.5 text-primary ring-4 ring-primary/20">
                <MoreHorizontal className="size-3" />
              </span>
            </div>
            <div className="absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-lg bg-primary-soft px-2 py-1.5 font-semibold text-primary">
              <Share2 className="size-3" /> Share profile
            </div>
          </div>
          <p className="text-sm">1. {tx('qp.li.how1')}</p>
        </li>
        <li className="space-y-1.5">
          <div className={phone} aria-hidden>
            <div className="h-2 w-20 rounded bg-surface-2" />
            <div className="mt-2 space-y-1.5">
              <div className="h-5 rounded bg-surface-2" />
              <div className="flex items-center gap-1 rounded-lg bg-primary-soft px-2 py-1.5 font-semibold text-primary ring-4 ring-primary/20">
                <Copy className="size-3" /> Copy link
              </div>
              <div className="h-5 rounded bg-surface-2" />
            </div>
            <div className="absolute inset-x-2 bottom-2 flex items-center gap-1 truncate rounded-lg border border-border px-2 py-1.5 text-muted">
              <Link2 className="size-3 shrink-0" /> linkedin.com/in/…
            </div>
          </div>
          <p className="text-sm">2. {tx('qp.li.how2')}</p>
        </li>
      </ol>
    </figure>
  )
}

export function LinkedInFill({ onSaved }: { onSaved?: () => void }) {
  const tx = useT()
  const available = useEnrichAvailable()
  const found = useFoundProfile(onSaved)
  const [consent, setConsent] = useState(false)
  const [stage, setStage] = useState<'start' | 'url'>('start')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null)
  const [off, setOff] = useState(false)
  const [jec, setJec] = useState<EnrichJec | null>(null)

  if (!available.data || off) return null

  async function run(mode: 'email' | 'url') {
    setNotice(null)
    if (!consent) return setNotice({ tone: 'danger', text: tx('qp.li.consentFirst') })
    let link: string | undefined
    if (mode === 'url') {
      const n = normaliseLinkedInUrl(url)
      if (!n) return setNotice({ tone: 'danger', text: tx('qp.li.urlBad') })
      link = n
      setUrl(n)
    }
    setBusy(true)
    try {
      const out = await enrichFromLinkedIn({ mode, url: link })
      setJec(out.jec)
      found.show({ ...out.profile, linkedin_url: out.profile.linkedin_url ?? link ?? null })
    } catch (e) {
      const code = e instanceof AiFillError ? e.code : 'failed'
      if (code === ('no_match' as string)) {
        if (mode === 'email') {
          setStage('url')
          setNotice({ tone: 'info', text: tx('qp.li.noMatch') })
        } else setNotice({ tone: 'info', text: tx('qp.li.notFound') })
      } else if (code === ('bad_url' as string)) {
        setNotice({ tone: 'danger', text: tx('qp.li.urlBad') })
      } else if (code === 'limit' || code.startsWith('enrich_')) {
        setOff(true)
      } else {
        setNotice({ tone: 'danger', text: e instanceof AiFillError && e.message ? e.message : tx('qp.aiError') })
      }
    } finally {
      setBusy(false)
    }
  }

  const jecNote = jec && (
    <Notice tone="success" title={jec.hint === 'auto_approved' ? tx('qp.li.jecAuto', { school: jec.school }) : tx('qp.li.jec', { school: jec.school })} />
  )

  if (found.preview) {
    return (
      <div className="space-y-3">
        {jecNote}
        <PreviewCard
          preview={found.preview}
          onChange={found.setPreview}
          onSave={() => void found.commit().catch(() => undefined)}
          onStartOver={found.reset}
          saving={found.save.isPending}
          error={found.save.error}
        />
      </div>
    )
  }

  return (
    <Card className="space-y-3 p-4" data-testid="linkedin-fill">
      <div className="flex items-start gap-3">
        <LinkedInIcon className="size-10 shrink-0" />
        <div className="min-w-0">
          <h3 className="font-bold">{tx('qp.li.title')}</h3>
          <p className="text-sm text-muted">{tx('qp.li.body')}</p>
        </div>
      </div>
      {jecNote}
      {found.nothing && <Notice tone="info" title={tx('qp.nothingFound')} />}
      <Checkbox checked={consent} onChange={setConsent}>
        <span className="text-sm">{tx('qp.li.consent')}</span>
      </Checkbox>
      {stage === 'url' && (
        <>
          <Field label={tx('qp.li.urlLabel')}>
            {(p) => <Input {...p} inputMode="url" autoComplete="url" placeholder={tx('qp.li.urlPh')} value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
          <HowToPictures />
        </>
      )}
      {notice && <Notice tone={notice.tone} title={notice.text} />}
      <Button size="lg" block loading={busy} onClick={() => void run(stage === 'url' ? 'url' : 'email')}>
        {stage === 'url' ? tx('qp.li.find') : tx('qp.li.go')}
      </Button>
      {stage === 'url' && (
        <Link to="/me/import?source=zip" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">
          {tx('qp.li.zip')}
        </Link>
      )}
    </Card>
  )
}
