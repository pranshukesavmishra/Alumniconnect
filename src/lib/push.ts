import { supabase } from './supabase'

// Push notifications on this device (Web Push). The server sends them; see supabase/functions/push-send.

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState =
  | 'unconfigured' // the app was deployed without push keys
  | 'ios-install' // iPhone/iPad: Apple only allows notifications for apps added to the Home Screen
  | 'unsupported'
  | 'denied' // the member blocked notifications for this site
  | 'off'
  | 'on'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** The service worker, or null if it isn't running (e.g. the development server). */
async function registration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
}

export async function pushState(): Promise<PushState> {
  if (!VAPID) return 'unconfigured'
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration(1500)
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

/** Ask permission (if needed), subscribe this device and register it for the signed-in member. */
export async function enablePush(): Promise<PushState> {
  if (!VAPID) return 'unconfigured'
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off'
  const reg = await registration()
  if (!reg) throw new Error('Notifications need the installed app. Please reload the page and try again.')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }))
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('This browser did not provide a notification address.')
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  })
  if (error) {
    await sub.unsubscribe().catch(() => undefined)
    throw error
  }
  return 'on'
}

/** Stop notifications on this device (also called on sign-out, so a shared phone stops getting them). */
export async function disablePush(): Promise<PushState> {
  const reg = await registration(1500)
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }).then(
      () => undefined,
      () => undefined,
    )
    await sub.unsubscribe().catch(() => undefined)
  }
  return 'off'
}
