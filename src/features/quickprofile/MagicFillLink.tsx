// The single "Magic fill" entry button used on Home (profile strength) and in Edit profile.
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { useT } from '../../i18n'
import { useEnrichAvailable } from './enrichQueries'
import { MAGIC_FILL_ON } from './queries'

export function MagicFillLink({ next = '/', className }: { next?: string; className?: string }) {
  const tx = useT()
  const linkedin = useEnrichAvailable().data
  if (!MAGIC_FILL_ON && !linkedin) return null
  return (
    <Link
      to={`/me/magic?next=${encodeURIComponent(next)}`}
      data-testid="magic-fill-link"
      className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent hover:bg-white/10', className)}
    >
      <Sparkles className="size-4" aria-hidden /> {tx('qp.magicBtn')}
    </Link>
  )
}
