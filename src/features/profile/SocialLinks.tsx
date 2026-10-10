import { cn } from '../../lib/cn'
import { FacebookIcon, InstagramIcon } from '../../components/ui/Icons'
import { useT } from '../../i18n'
import { isCanonicalSocialUrl } from '../../lib/social'
import { useSocialLinks } from './socialQueries'

interface Props {
  /** Whose links to show. Nothing is rendered when the member has none or hides them from you. */
  userId: string | null | undefined
  /** Used in the button labels read out by screen readers. */
  name?: string
  /** compact: icon-only round buttons for list rows. full: icon + network name. */
  variant?: 'compact' | 'full'
  className?: string
}

const base = 'inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-surface text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** Tappable Instagram / Facebook buttons. Values come from get_social_links (checked in the database) and are re-checked here before becoming a link. */
export function SocialLinks({ userId, name, variant = 'full', className }: Props) {
  const t = useT()
  const { data } = useSocialLinks(userId)
  const who = name?.trim() || t('social.thisMember')
  const ig = isCanonicalSocialUrl('instagram', data?.instagram_url) ? data!.instagram_url : null
  const fb = isCanonicalSocialUrl('facebook', data?.facebook_url) ? data!.facebook_url : null
  if (!ig && !fb) return null
  const size = variant === 'compact' ? 'size-11' : 'min-h-11 px-5 font-semibold'
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="group" aria-label={t('social.group', { name: who })} data-testid="social-links">
      {ig && (
        <a href={ig} target="_blank" rel="noopener noreferrer" aria-label={t('social.openIg', { name: who })} className={cn(base, size)} data-testid="social-instagram">
          <InstagramIcon className="size-5" />
          {variant === 'full' && t('social.instagram')}
        </a>
      )}
      {fb && (
        <a href={fb} target="_blank" rel="noopener noreferrer" aria-label={t('social.openFb', { name: who })} className={cn(base, size)} data-testid="social-facebook">
          <FacebookIcon className="size-5" />
          {variant === 'full' && t('social.facebook')}
        </a>
      )}
    </div>
  )
}
