import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { FacebookIcon, InstagramIcon } from '../../components/ui/Icons'
import { Field, Input, Select } from '../../components/ui/Form'
import { SectionTitle } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { normalizeSocialUrl, SOCIAL_VISIBILITIES, type SocialKind, type SocialVisibility } from '../../lib/social'

export interface SocialDraft {
  instagram: string
  facebook: string
  instagram_visibility: SocialVisibility
  facebook_visibility: SocialVisibility
}

/** Returns the canonical urls to save (null = empty), or the kinds that are invalid. */
export function validateSocial(d: SocialDraft): { instagram_url: string | null; facebook_url: string | null; errors: Partial<Record<SocialKind, true>> } {
  const errors: Partial<Record<SocialKind, true>> = {}
  const one = (kind: SocialKind, v: string) => {
    if (!v.trim()) return null
    const n = normalizeSocialUrl(kind, v)
    if (!n) errors[kind] = true
    return n
  }
  return { instagram_url: one('instagram', d.instagram), facebook_url: one('facebook', d.facebook), errors }
}

function Row({ kind, value, visibility, onValue, onVisibility, showError }: {
  kind: SocialKind
  value: string
  visibility: SocialVisibility
  onValue: (v: string) => void
  onVisibility: (v: SocialVisibility) => void
  showError: boolean
}) {
  const t = useT()
  const [touched, setTouched] = useState(false)
  const normalized = value.trim() ? normalizeSocialUrl(kind, value) : null
  const invalid = !!value.trim() && !normalized
  const network = t(kind === 'instagram' ? 'social.instagram' : 'social.facebook')
  const Icon = kind === 'instagram' ? InstagramIcon : FacebookIcon
  const visLabel = { verified: t('social.visVerified'), connections: t('social.visConnections'), hidden: t('social.visHidden') }
  return (
    <div className="space-y-2" data-testid={`social-edit-${kind}`}>
      <Field
        label={network}
        optional
        error={invalid && (touched || showError) ? t(kind === 'instagram' ? 'social.errInstagram' : 'social.errFacebook') : null}
        hint={normalized ? t('social.opensAs', { url: normalized.replace(/^https:\/\//, '') }) : undefined}
      >
        {(p) => (
          <div className="flex items-start gap-2">
            <span className="mt-3.5 text-muted"><Icon className="size-5" /></span>
            <Input
              {...p}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t(kind === 'instagram' ? 'social.igPh' : 'social.fbPh')}
              value={value}
              onChange={(e) => onValue(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid={`social-input-${kind}`}
            />
            {normalized ? (
              <a
                href={normalized}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('social.testAria', { network })}
                className="inline-flex min-h-12 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 font-semibold text-primary hover:bg-primary-soft"
                data-testid={`social-test-${kind}`}
              >
                <ExternalLink className="size-4" aria-hidden /> {t('social.test')}
              </a>
            ) : null}
          </div>
        )}
      </Field>
      <Field label={`${network}: ${t('social.visibility')}`}>
        {(p) => (
          <Select {...p} value={visibility} onChange={(e) => onVisibility(e.target.value as SocialVisibility)} data-testid={`social-vis-${kind}`}>
            {SOCIAL_VISIBILITIES.map((v) => <option key={v} value={v}>{visLabel[v]}</option>)}
          </Select>
        )}
      </Field>
    </div>
  )
}

export function SocialLinksEditor({ draft, onChange, showErrors }: { draft: SocialDraft; onChange: (d: SocialDraft) => void; showErrors: boolean }) {
  const t = useT()
  return (
    <section className="space-y-4" aria-label={t('social.title')}>
      <SectionTitle>{t('social.title')}</SectionTitle>
      <p className="text-sm text-muted">{t('social.hint')}</p>
      <Row kind="instagram" value={draft.instagram} visibility={draft.instagram_visibility} showError={showErrors}
        onValue={(v) => onChange({ ...draft, instagram: v })} onVisibility={(v) => onChange({ ...draft, instagram_visibility: v })} />
      <Row kind="facebook" value={draft.facebook} visibility={draft.facebook_visibility} showError={showErrors}
        onValue={(v) => onChange({ ...draft, facebook: v })} onVisibility={(v) => onChange({ ...draft, facebook_visibility: v })} />
    </section>
  )
}
