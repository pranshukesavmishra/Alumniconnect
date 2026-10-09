// Web Push without third-party libraries: message encryption (RFC 8291, "aes128gcm" from RFC 8188) and
// VAPID sender identification (RFC 8292), using only WebCrypto. Works with Chrome/Android (FCM), Firefox,
// Edge and Safari/iOS (installed web apps) push services alike. No Firebase account is needed.

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string // browser's public key, base64url (65-byte uncompressed P-256 point)
  auth: string // browser's auth secret, base64url (16 bytes)
}

export interface Vapid {
  publicKey: string // base64url, 65-byte uncompressed P-256 point (the same key the app subscribes with)
  privateKey: string // base64url, 32-byte private scalar "d"
  subject: string // "mailto:..." or an https URL, so push services can contact the sender
}

/** Bytes backed by a plain ArrayBuffer (what WebCrypto accepts). */
type Bytes = Uint8Array<ArrayBuffer>

const enc = new TextEncoder()

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function b64urlEncode(b: Bytes): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** HKDF-SHA256 (extract + expand) to `length` bytes. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** The content-encryption key and nonce shared by sender and browser (RFC 8291 section 3.4). */
export async function deriveKeys(ecdhSecret: Bytes, authSecret: Bytes, uaPublic: Bytes, asPublic: Bytes, salt: Bytes) {
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  return { cek, nonce }
}

/** Encrypt one message for one browser subscription. Returns the full request body. */
export async function encryptPayload(sub: PushSubscriptionKeys, payload: Bytes): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.p256dh)
  const authSecret = b64urlDecode(sub.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length < 16) throw new Error('Invalid subscription keys')
  if (payload.length > 3993) throw new Error('Push message too long') // 4096-byte record minus header, padding delimiter and tag

  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // a single record: payload, then the 0x02 "last record" delimiter
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))

  const header = new Uint8Array(21 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096) // record size
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

/** VAPID "Authorization" header value for a push service (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64urlDecode(vapid.publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Invalid VAPID public key')
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: vapid.subject })))
  // WebCrypto ECDSA signatures are already the raw r||s form that ES256 JWTs use
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${vapid.publicKey}`
}

export type SendResult = { ok: true } | { ok: false; gone: boolean; status: number }

/** Send one notification. `gone` means the subscription no longer exists and should be deleted. */
export async function sendPush(sub: PushSubscriptionKeys, message: unknown, vapid: Vapid, opts: { ttl?: number; urgency?: 'normal' | 'high'; topic?: string } = {}): Promise<SendResult> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)))
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 24 * 3600),
    Urgency: opts.urgency ?? 'normal',
  }
  // a topic replaces an undelivered earlier message with the same topic (e.g. many messages in one chat)
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
  await res.body?.cancel()
  if (res.ok) return { ok: true }
  return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status }
}
