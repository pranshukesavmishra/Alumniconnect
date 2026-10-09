import { BellRing, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push'

/** "Notifications on this phone": explains what the device needs and turns push on or off. */
export function PushToggle({ onlyWhenOff = false }: { onlyWhenOff?: boolean }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void pushState().then((s) => live && setState(s))
    return () => {
      live = false
    }
  }, [])
  if (!state || state === 'unconfigured') return null
  // on busy screens (the chat list) only invite people who haven't turned it on yet
  if (onlyWhenOff && state !== 'off') return null

  async function toggle() {
    setBusy(true)
    try {
      const next = state === 'on' ? await disablePush() : await enablePush()
      setState(next)
      if (next === 'on') toast.success('Notifications are on for this phone.')
      else if (next === 'denied') toast.error('Notifications are blocked for this site. You can allow them in your browser settings.')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4 flex items-start gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
        {state === 'ios-install' ? <Smartphone className="size-5" aria-hidden /> : <BellRing className="size-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Notifications on this phone</p>
        {state === 'on' && <p className="text-sm text-muted">On. You’ll be told about messages, mentions and connection requests.</p>}
        {state === 'off' && <p className="text-sm text-muted">Get messages and mentions even when the app is closed.</p>}
        {state === 'denied' && <p className="text-sm text-muted">Blocked for this site. Open your browser’s site settings, allow notifications, then come back.</p>}
        {state === 'unsupported' && <p className="text-sm text-muted">This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.</p>}
        {state === 'ios-install' && (
          <p className="text-sm text-muted">
            On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.{' '}
            <Link to="/install" className="font-semibold text-primary">How?</Link>
          </p>
        )}
        {(state === 'on' || state === 'off') && (
          <Button size="sm" variant={state === 'on' ? 'secondary' : 'primary'} className="mt-3" loading={busy} onClick={toggle}>
            {state === 'on' ? 'Turn off' : 'Turn on notifications'}
          </Button>
        )}
      </div>
    </Card>
  )
}
