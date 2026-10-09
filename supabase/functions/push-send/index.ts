// Delivers one in-app notification to all of the member's phones/browsers as a push notification.
// Called only by the database (trigger on public.notifications, see 20261009000009_push.sql) with a shared secret.
import { json } from '../_shared/http.ts'
import { asService, eq } from '../_shared/db.ts'
import { sendPush, type Vapid } from '../_shared/webpush.ts'

const SECRET = Deno.env.get('PUSH_SECRET') ?? ''
const VAPID: Vapid = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.org',
}
// local testing only: lets a fake push service run on plain http
const ALLOW_HTTP = Deno.env.get('PUSH_ALLOW_HTTP_ENDPOINTS') === '1'

interface Row {
  id: string
  user_id: string
  kind: string
  body: string | null
  target_id: string | null
  actor_id: string | null
  actor: { full_name: string } | null
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const clip = (s: string | null | undefined, n = 180) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Same wording and links as the in-app notifications list. */
export function describe(n: Row): { title: string; body: string; url: string; tag: string; urgency: 'normal' | 'high' } {
  const who = n.actor?.full_name ?? 'Someone'
  switch (n.kind) {
    case 'message':
      return { title: who, body: clip(n.body) || 'Sent you an attachment', url: `/chat/${n.target_id}`, tag: `chat:${n.target_id}`, urgency: 'high' }
    case 'mention':
      return { title: `${who} mentioned you`, body: clip(n.body), url: `/chat/${n.target_id}`, tag: `chat:${n.target_id}`, urgency: 'high' }
    case 'like':
      return { title: 'JEC Alumni Connect', body: `${who} liked your post`, url: '/', tag: `post:${n.target_id}`, urgency: 'normal' }
    case 'comment':
      return { title: `${who} commented`, body: clip(n.body), url: '/', tag: `post:${n.target_id}`, urgency: 'normal' }
    case 'connection_request':
      return { title: 'JEC Alumni Connect', body: `${who} wants to connect`, url: '/me/connections', tag: `conn:${n.actor_id}`, urgency: 'normal' }
    case 'connection_accepted':
      return { title: 'JEC Alumni Connect', body: `${who} accepted your connection request`, url: `/people/${n.actor_id}`, tag: `conn:${n.actor_id}`, urgency: 'normal' }
    case 'invite_joined':
      return { title: 'JEC Alumni Connect', body: `${who} joined through your invite 🎉`, url: `/people/${n.actor_id}`, tag: `invite:${n.actor_id}`, urgency: 'normal' }
    case 'announcement':
      return { title: 'Alumni Meet 2026', body: clip(n.body), url: '/meet', tag: `ann:${n.target_id}`, urgency: 'high' }
    case 'mentor_request':
      return { title: `${who} wants you as a mentor`, body: clip(n.body), url: '/mentors/mine', tag: `mentor:${n.target_id}`, urgency: 'normal' }
    case 'mentor_accepted':
      return { title: 'JEC Alumni Connect', body: `${who} accepted your mentor request`, url: '/mentors/mine', tag: `mentor:${n.target_id}`, urgency: 'normal' }
    case 'mentor_declined':
      return { title: 'JEC Alumni Connect', body: `${who} can’t take on a new mentee right now`, url: '/mentors/mine', tag: `mentor:${n.target_id}`, urgency: 'normal' }
    case 'help_request':
      return { title: `${who} needs help`, body: clip(n.body), url: '/help', tag: `help:${n.target_id}`, urgency: 'normal' }
    default:
      return { title: 'JEC Alumni Connect', body: clip(n.body) || 'You have a new notification', url: '/notifications', tag: `n:${n.id}`, urgency: 'normal' }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405)
  if (!SECRET || !VAPID.publicKey || !VAPID.privateKey) return json(req, { error: 'not_configured' }, 503)
  if (!same(req.headers.get('x-push-secret') ?? '', SECRET)) return json(req, { error: 'forbidden' }, 403)

  const { notification_id } = (await req.json().catch(() => ({}))) as { notification_id?: string }
  if (!notification_id || !/^[0-9a-f-]{36}$/i.test(notification_id)) return json(req, { error: 'invalid' }, 400)

  const db = asService()
  const [n] = await db.select<Row>('notifications', `select=id,user_id,kind,body,target_id,actor_id,actor:profiles!notifications_actor_id_fkey(full_name)&id=${eq(notification_id)}`)
  if (!n) return json(req, { error: 'not_found' }, 404)
  const subs = await db.select<{ id: string; endpoint: string; p256dh: string; auth: string }>('push_subscriptions', `select=id,endpoint,p256dh,auth&user_id=${eq(n.user_id)}`)

  const m = describe(n)
  let sent = 0
  const gone: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      if (!s.endpoint.startsWith('https://') && !ALLOW_HTTP) return gone.push(s.id)
      try {
        const r = await sendPush(s, { title: m.title, body: m.body, url: m.url, tag: m.tag }, VAPID, { urgency: m.urgency, topic: m.tag })
        if (r.ok) sent++
        else if (r.gone) gone.push(s.id)
      } catch {
        /* one broken device never stops the others */
      }
    }),
  )
  if (gone.length) await db.remove('push_subscriptions', `id=in.(${gone.join(',')})`)
  return json(req, { sent, removed: gone.length })
})
