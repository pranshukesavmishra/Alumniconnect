// A dismissible Home card that points new members to the one-minute guide. Dismissal is remembered on this phone.
import { PlayCircle, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Card } from '../../components/ui/Display'
import { IconTile } from '../../components/ui/IconTile'
import { useT } from '../../i18n'

const KEY = 'jec-guide-card-dismissed'

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function GuideCard() {
  const tx = useT()
  const [hidden, setHidden] = useState(read)
  if (hidden) return null
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, '1')
    } catch {
      /* private mode: it just comes back next time */
    }
    setHidden(true)
  }
  return (
    <Card className="flex items-center gap-3 p-3 pr-1" data-testid="home-guide-card">
      <IconTile icon={PlayCircle} tone="gold" size="lg" />
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug">{tx('guide.homeTitle')}</p>
        <p className="text-sm text-muted">{tx('guide.homeBody')}</p>
        <Link to="/guide" className="inline-flex min-h-11 items-center font-semibold text-primary underline">{tx('guide.homeWatch')}</Link>
      </div>
      <button type="button" onClick={dismiss} aria-label={tx('guide.homeDismiss')} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2">
        <X className="size-5" aria-hidden />
      </button>
    </Card>
  )
}
