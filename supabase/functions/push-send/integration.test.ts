// End-to-end through the real local stack: notification row -> database trigger -> pg_net -> push-send
// function -> a fake push service that decrypts the message exactly like a phone would.
//
// Needs: scripts/dev-stack.sh, VAPID keys + PUSH_SECRET + PUSH_ALLOW_HTTP_ENDPOINTS=1 in supabase/functions/.env,
// and private.settings rows (push_function_url, push_secret). Run:
//   deno test --allow-all supabase/functions/push-send/integration.test.ts
import { b64urlDecode, b64urlEncode, deriveKeys } from '../_shared/webpush.ts'

const DB = Deno.env.get('DB_URL') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PORT = 18555
// the address of this machine as seen from the Supabase containers
const HOST = new TextDecoder()
  .decode((await new Deno.Command('docker', { args: ['network', 'inspect', 'supabase_network_Alumniconnect', '-f', '{{range .IPAM.Config}}{{.Gateway}}{{end}}'] }).output()).stdout)
  .trim()

async function sql(q: string): Promise<string> {
  const out = await new Deno.Command('psql', { args: [DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q] }).output()
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  return new TextDecoder().decode(out.stdout).trim()
}

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

interface Received {
  path: string
  headers: Headers
  body: Uint8Array
}

Deno.test('a new notification arrives on the member’s device, encrypted, with the right text and link', async () => {
  const received: Received[] = []
  const server = Deno.serve({ port: PORT, hostname: '0.0.0.0', onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname
    received.push({ path, headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) })
    return new Response(null, { status: path.startsWith('/gone/') ? 410 : 201 })
  })
  const run = crypto.randomUUID().slice(0, 8)
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  try {
    // two members; A has two devices: a working one and one the push service says no longer exists
    await sql(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role) values
      ('${a}', 'pa-${run}@example.com', '{"full_name":"Asha Rao"}', now(), 'authenticated', 'authenticated'),
      ('${b}', 'pb-${run}@example.com', '{"full_name":"Bela Verma"}', now(), 'authenticated', 'authenticated')`)
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPublic = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
    const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)))
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
      ('${a}', 'http://${HOST}:${PORT}/ok/${run}', '${uaPublic}', '${auth}'),
      ('${a}', 'http://${HOST}:${PORT}/gone/${run}', '${uaPublic}', '${auth}')`)

    // B mentions A in a chat: this is exactly what the chat trigger does
    const chat = crypto.randomUUID()
    await sql(`select public._notify('${a}', 'mention', '${b}', '${chat}', 'Count me in @asha, see you at JEC!')`)

    for (let i = 0; i < 60 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 250))
    eq(received.length, 2, 'both devices were tried')
    const ok = received.find((r) => r.path.startsWith('/ok/'))!

    // what a phone does: decrypt with its private key + auth secret
    const body = ok.body
    const salt = body.slice(0, 16)
    const asPublic = body.slice(21, 21 + body[20]!)
    const peer = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, ua.privateKey, 256))
    const { cek, nonce } = await deriveKeys(secret, b64urlDecode(auth), b64urlDecode(uaPublic), asPublic, salt)
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + body[20]!)))
    const msg = JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))
    eq(msg, { title: 'Bela Verma mentioned you', body: 'Count me in @asha, see you at JEC!', url: `/chat/${chat}`, tag: `chat:${chat}` }, 'decrypted message')

    // headers a real push service requires
    eq([ok.headers.get('content-encoding'), ok.headers.get('urgency'), ok.headers.get('ttl')], ['aes128gcm', 'high', '86400'], 'push headers')
    const vapid = ok.headers.get('authorization') ?? ''
    eq(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(vapid), true, 'VAPID authorization')
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(vapid.split('.')[1]!)))
    eq(claims.aud, `http://${HOST}:${PORT}`, 'audience is the push service origin')

    // the dead device is cleaned up; the working one stays
    for (let i = 0; i < 20 && (await sql(`select count(*) from push_subscriptions where user_id = '${a}'`)) !== '1'; i++) await new Promise((r) => setTimeout(r, 250))
    eq(await sql(`select endpoint like '%/ok/%' from push_subscriptions where user_id = '${a}'`), 't', 'gone device removed, working device kept')

    // B has no devices: nothing is sent for B
    const before = received.length
    await sql(`select public._notify('${b}', 'like', '${a}', '${crypto.randomUUID()}', null)`)
    await new Promise((r) => setTimeout(r, 1500))
    eq(received.length, before, 'no push for a member without devices')
  } finally {
    await sql(`delete from auth.users where id in ('${a}', '${b}')`).catch(() => {})
    await server.shutdown()
  }
})

Deno.test('the push function refuses callers without the shared secret', async () => {
  const res = await fetch('http://127.0.0.1:54321/functions/v1/push-send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-push-secret': 'wrong' }, body: '{"notification_id":"00000000-0000-0000-0000-000000000000"}' })
  await res.body?.cancel()
  eq(res.status, 403, 'forbidden without the secret')
})
