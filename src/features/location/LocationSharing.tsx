import { MapPin, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice, Skeleton } from '../../components/ui/Display'
import { Checkbox } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { relativeTime } from '../../lib/format'
import { useMyProfile } from '../auth/AuthProvider'
import { locationErrorMessage } from './geo'
import { cityLabel, useLocationActions, useMyLocation } from './queries'

/** The plain-words promise shown wherever sharing can be turned on. */
export function SharingExplainer() {
  const t = useT()
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
      <li>{t('loc.explainCity')}</li>
      <li>{t('loc.explainArea')}</li>
      <li>{t('loc.explainOff')}</li>
    </ul>
  )
}

/** Profile → "Share my city": turn on/off, update now, and the profile-city option. */
export function LocationSettings() {
  const t = useT()
  const { data: loc, isLoading, error: loadError } = useMyLocation()
  const { enable, refresh, setUpdateProfile, turnOff } = useLocationActions()
  const [updateProfile, setUpdate] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (e) {
      setError(locationErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <Skeleton className="h-40" />
  if (loadError) return <Notice tone="danger" title={locationErrorMessage(loadError)} />
  if (!loc) return null

  return (
    <Card className="p-4" aria-labelledby="loc-title">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p id="loc-title" className="font-semibold">{t('loc.title')}</p>
          {loc.sharing ? (
            <p className="text-sm" data-testid="loc-status">
              {loc.city
                ? t('loc.statusOn', { city: cityLabel({ name: loc.city, region: loc.region, country: loc.country ?? '' }), when: loc.updated_at ? relativeTime(loc.updated_at) : '' })
                : t('loc.statusOnNoCity')}
            </p>
          ) : (
            <p className="text-sm text-muted" data-testid="loc-status">{t('loc.statusOff')}</p>
          )}
        </div>
      </div>
      <SharingExplainer />
      <div className="mt-3">
        <Checkbox
          checked={loc.sharing ? loc.update_profile : updateProfile}
          onChange={(v) => (loc.sharing ? void run('profile', () => setUpdateProfile(v), t('loc.saved')) : setUpdate(v))}
        >
          {t('loc.alsoProfile')}
        </Checkbox>
      </div>
      {error && (
        <Notice tone="danger" className="mt-3" title={error} />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {loc.sharing ? (
          <>
            <Button size="sm" variant="secondary" loading={busy === 'refresh'} onClick={() => run('refresh', refresh, t('loc.updated'))}>
              {t('loc.updateNow')}
            </Button>
            <Button
              size="sm"
              variant="danger-ghost"
              loading={busy === 'off'}
              onClick={() => {
                if (!window.confirm(t('loc.confirmOff'))) return
                void run('off', turnOff, t('loc.turnedOff'))
              }}
            >
              {t('loc.turnOff')}
            </Button>
            <Link to="/nearby" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary">
              {t('nearby.title')}
            </Link>
          </>
        ) : (
          <Button size="sm" icon={<MapPin className="size-4" />} loading={busy === 'on'} onClick={() => run('on', () => enable(updateProfile), t('loc.turnedOn'))}>
            {t('loc.turnOn')}
          </Button>
        )}
      </div>
    </Card>
  )
}

/** A gentle one-time card on Home. "No thanks" hides it for good (saved on the server, so on every device). */
export function LocationPromptCard({ always = false }: { always?: boolean }) {
  const t = useT()
  const { data: profile } = useMyProfile()
  const { data: loc } = useMyLocation()
  const { enable, dismissPrompt } = useLocationActions()
  const [updateProfile, setUpdate] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const verified = profile?.verification === 'verified' || profile?.is_admin
  if (!verified || !loc || (loc.sharing && !error) || (loc.prompt_dismissed && !always && !error)) return null

  return (
    <Card className="relative p-4" role="region" aria-label={t('loc.promptTitle')}>
      <button
        type="button"
        aria-label={t('loc.noThanks')}
        className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2"
        onClick={() => {
          setError(null)
          void dismissPrompt().catch((e) => toast.error(locationErrorMessage(e)))
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{t('loc.promptTitle')}</p>
          <p className="text-sm text-muted">{t('loc.promptBody')}</p>
        </div>
      </div>
      <SharingExplainer />
      <div className="mt-2">
        <Checkbox checked={updateProfile} onChange={setUpdate}>
          {t('loc.alsoProfile')}
        </Checkbox>
      </div>
      {error && <Notice tone="danger" className="mt-2" title={error} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<MapPin className="size-4" />}
          loading={busy === 'on'}
          onClick={async () => {
            setBusy('on')
            setError(null)
            try {
              await enable(updateProfile)
              toast.success(t('loc.turnedOn'))
            } catch (e) {
              setError(locationErrorMessage(e))
            } finally {
              setBusy(null)
            }
          }}
        >
          {t('loc.turnOn')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => {
          setError(null)
          void dismissPrompt().catch((e) => toast.error(locationErrorMessage(e)))
        }}>
          {t('loc.noThanks')}
        </Button>
      </div>
    </Card>
  )
}
