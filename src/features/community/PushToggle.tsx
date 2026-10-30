import { BellRing, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push'

/** "Notifications on this phone": explains what the device needs and turns push on or off. */
export function PushToggle({ onlyWhenOff = false }: { onlyWhenOff?: boolean }) {
  const tx = useT()
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
      if (next === 'on') toast.success(tx('push.toastOn'))
      else if (next === 'denied') toast.error(tx('push.toastBlocked'))
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
        <p className="font-semibold">{tx('push.title')}</p>
        {state === 'on' && <p className="text-sm text-muted">{tx('push.on')}</p>}
        {state === 'off' && <p className="text-sm text-muted">{tx('push.off')}</p>}
        {state === 'denied' && <p className="text-sm text-muted">{tx('push.denied')}</p>}
        {state === 'unsupported' && <p className="text-sm text-muted">{tx('push.unsupported')}</p>}
        {state === 'ios-install' && (
          <p className="text-sm text-muted">
            {tx('push.ios')}{' '}
            <Link to="/install" className="font-semibold text-primary">{tx('push.how')}</Link>
          </p>
        )}
        {(state === 'on' || state === 'off') && (
          <Button size="sm" variant={state === 'on' ? 'secondary' : 'primary'} className="mt-3" loading={busy} onClick={toggle}>
            {state === 'on' ? tx('push.turnOff') : tx('push.turnOn')}
          </Button>
        )}
      </div>
    </Card>
  )
}
