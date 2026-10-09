// deno test --allow-env supabase/functions/_shared/webpush.test.ts
import { b64urlDecode, b64urlEncode, deriveKeys, encryptPayload, sendPush, vapidAuthorization, type Vapid } from './webpush.ts'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

async function ecdhFromJwk(dB64: string, ownPublicB64: string, peerPublic: Uint8Array): Promise<Uint8Array> {
  const pub = b64urlDecode(ownPublicB64)
  const priv = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: dB64, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  const peer = await crypto.subtle.importKey('raw', peerPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256))
}

/** What a browser does with an incoming push: read the header, derive the keys, decrypt, strip the delimiter. */
async function browserDecrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  eq(rs, 4096, 'record size')
  const secret = await ecdhFromJwk(uaPrivate, uaPublic, asPublic)
  const { cek, nonce } = await deriveKeys(secret, b64urlDecode(auth), b64urlDecode(uaPublic), asPublic, salt)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)))
  eq(plain[plain.length - 1], 2, 'last-record delimiter')
  return new TextDecoder().decode(plain.slice(0, -1))
}

// RFC 8291 Appendix A
const RFC = {
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  plaintext: 'When I grow up, I want to be a watermelon',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

Deno.test('key derivation matches RFC 8291 Appendix A', async () => {
  const secret = await ecdhFromJwk(RFC.asPrivate, RFC.asPublic, b64urlDecode(RFC.uaPublic))
  const { cek, nonce } = await deriveKeys(secret, b64urlDecode(RFC.auth), b64urlDecode(RFC.uaPublic), b64urlDecode(RFC.asPublic), b64urlDecode(RFC.salt))
  eq(b64urlEncode(cek), RFC.cek, 'CEK')
  eq(b64urlEncode(nonce), RFC.nonce, 'nonce')
})

Deno.test('the RFC example message decrypts the way a browser would', async () => {
  eq(await browserDecrypt(b64urlDecode(RFC.body), RFC.uaPrivate, RFC.uaPublic, RFC.auth), RFC.plaintext, 'RFC plaintext')
})

Deno.test('our encryption round-trips for a fresh browser subscription', async () => {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const uaPublic = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
  const uaPrivate = (await crypto.subtle.exportKey('jwk', ua.privateKey)).d!
  const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)))
  const msg = JSON.stringify({ title: 'Asha Rao', body: 'नमस्ते! See you at the meet 🎉', url: '/chat/1' })
  const body = await encryptPayload({ endpoint: 'https://push.example/x', p256dh: uaPublic, auth }, new TextEncoder().encode(msg))
  eq(await browserDecrypt(body, uaPrivate, uaPublic, auth), msg, 'round trip (unicode)')
  // two sends of the same text are not identical (fresh salt and key each time)
  const again = await encryptPayload({ endpoint: 'https://push.example/x', p256dh: uaPublic, auth }, new TextEncoder().encode(msg))
  eq(b64urlEncode(again) === b64urlEncode(body), false, 'fresh salt/key per message')
})

Deno.test('bad keys and oversize messages are refused', async () => {
  let threw = 0
  try {
    await encryptPayload({ endpoint: 'https://x', p256dh: 'AAAA', auth: 'AAAA' }, new Uint8Array(1))
  } catch {
    threw++
  }
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const p256dh = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
  try {
    await encryptPayload({ endpoint: 'https://x', p256dh, auth: b64urlEncode(new Uint8Array(16)) }, new Uint8Array(4000))
  } catch {
    threw++
  }
  eq(threw, 2, 'both refused')
})

async function newVapid(): Promise<Vapid> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return {
    publicKey: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))),
    privateKey: (await crypto.subtle.exportKey('jwk', k.privateKey)).d!,
    subject: 'mailto:alumni@example.org',
  }
}

Deno.test('VAPID header is a valid ES256 JWT for the push service origin', async () => {
  const vapid = await newVapid()
  const now = 1_800_000_000
  const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', vapid, now)
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)
  if (!m) throw new Error('header format: ' + h)
  eq(m[4], vapid.publicKey, 'k is the public key')
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)))
  eq(claims, { aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'mailto:alumni@example.org' }, 'claims')
  const pub = await crypto.subtle.importKey('raw', b64urlDecode(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`))
  eq(ok, true, 'signature verifies with the public key')
})

Deno.test('sendPush: headers, success, and gone subscriptions', async () => {
  const vapid = await newVapid()
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const sub = { endpoint: 'https://push.example/s/1', p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) }
  const seen: Headers[] = []
  let status = 201
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers))
    return new Response(null, { status })
  }) as typeof fetch
  eq(await sendPush(sub, { title: 't' }, vapid, { topic: 'chat:abc-123!', urgency: 'high' }), { ok: true }, 'sent')
  const h = seen[0]!
  eq([h.get('content-encoding'), h.get('content-type'), h.get('urgency'), h.get('topic')], ['aes128gcm', 'application/octet-stream', 'high', 'chatabc-123'], 'headers')
  eq(h.get('authorization')!.startsWith('vapid t='), true, 'vapid auth')
  status = 410
  eq(await sendPush(sub, { title: 't' }, vapid), { ok: false, gone: true, status: 410 }, 'expired subscription')
  status = 429
  eq(await sendPush(sub, { title: 't' }, vapid), { ok: false, gone: false, status: 429 }, 'rate limited: keep it')
})
