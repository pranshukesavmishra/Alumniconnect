// Run: deno test --allow-env --allow-net=none supabase/functions/import-avatar/index.test.ts
// Exercises the real handler with a stubbed network (no real LinkedIn/Supabase calls).
Deno.env.set('SUPABASE_URL', 'http://supabase.test')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')

let handler!: (req: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: typeof handler) => {
  handler = h
}
await import('./index.ts')

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(50).fill(1)])
const HTML = new TextEncoder().encode('<html>not an image</html>')

interface World {
  identities?: unknown[]
  user?: boolean
  images?: Record<string, { body: Uint8Array; url?: string; status?: number; length?: number }>
  uploads: { path: string; type: string; size: number }[]
  fetched: string[]
}
function world(w: Partial<World>): World {
  const state: World = { user: true, identities: [], images: {}, uploads: [], fetched: [], ...w }
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    state.fetched.push(url)
    if (url === 'http://supabase.test/auth/v1/user') {
      return state.user ? Response.json({ id: 'user-1', identities: state.identities }) : new Response('no', { status: 401 })
    }
    if (url.startsWith('http://supabase.test/storage/v1/object/avatars/')) {
      state.uploads.push({ path: url.split('/avatars/')[1]!, type: String((init?.headers as Record<string, string>)['Content-Type']), size: (init?.body as Uint8Array).byteLength })
      return Response.json({ Key: 'ok' })
    }
    const img = state.images?.[url]
    if (!img) return new Response('missing', { status: 404 })
    const res = new Response(img.body, { status: img.status ?? 200, headers: img.length ? { 'content-length': String(img.length) } : {} })
    Object.defineProperty(res, 'url', { value: img.url ?? url })
    return res
  }) as typeof fetch
  return state
}
const call = (body: unknown = {}, auth: string | null = 'Bearer t') =>
  handler(new Request('http://fn/import-avatar', { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const li = (picture?: string) => ({ provider: 'linkedin_oidc', identity_data: { picture } })
const LI_URL = 'https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_100_100/0/1?e=1&v=beta&t=xyz'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

Deno.test('copies the LinkedIn photo into the member’s own folder', async () => {
  const w = world({ identities: [{ provider: 'email', identity_data: {} }, li(LI_URL)], images: { [LI_URL]: { body: JPEG } } })
  const res = await call({ provider: 'linkedin_oidc' })
  eq(res.status, 200, 'status')
  const out = await res.json()
  eq(out.source, 'linkedin', 'source')
  eq(/^user-1\/profile-\d+\.jpg$/.test(out.path), true, 'path in own folder')
  eq(w.uploads.length, 1, 'one upload')
  eq([w.uploads[0]!.type, w.uploads[0]!.size], ['image/jpeg', JPEG.byteLength], 'type/size')
})

Deno.test('accepts PNG; type comes from the bytes, not the header', async () => {
  world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: PNG } } })
  const out = await (await call()).json()
  eq(out.path.endsWith('.png'), true, 'png')
})

Deno.test('Google photo works with provider "any"; LinkedIn is preferred', async () => {
  const G = 'https://lh3.googleusercontent.com/a/xyz=s96-c'
  world({ identities: [{ provider: 'google', identity_data: { avatar_url: G } }, li(LI_URL)], images: { [G]: { body: PNG }, [LI_URL]: { body: JPEG } } })
  eq((await (await call({ provider: 'any' })).json()).source, 'linkedin', 'prefers linkedin')
  world({ identities: [{ provider: 'google', identity_data: { avatar_url: G } }], images: { [G]: { body: PNG } } })
  eq((await (await call({ provider: 'any' })).json()).source, 'google', 'google fallback')
})

Deno.test('no LinkedIn identity -> 409 no_identity (client offers to connect)', async () => {
  world({ identities: [{ provider: 'email', identity_data: {} }] })
  const res = await call({ provider: 'linkedin_oidc' })
  eq([res.status, (await res.json()).error], [409, 'no_identity'], 'no identity')
})

Deno.test('identity without a picture -> 404 no_photo', async () => {
  world({ identities: [li(undefined)] })
  const res = await call()
  eq([res.status, (await res.json()).error], [404, 'no_photo'], 'no photo')
})

Deno.test('SSRF: only HTTPS LinkedIn/Google image hosts are ever fetched', async () => {
  for (const bad of ['http://media.licdn.com/x.jpg', 'https://evil.example.com/x.jpg', 'https://licdn.com.evil.com/x.jpg', 'https://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'https://notlicdn.com/x.jpg']) {
    const w = world({ identities: [li(bad)], images: { [bad]: { body: JPEG } } })
    const res = await call()
    eq(res.status, 404, `blocked ${bad}`)
    eq(w.fetched.filter((u) => u === bad).length, 0, `never fetched ${bad}`)
  }
})

Deno.test('a redirect to another host is refused', async () => {
  const w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: JPEG, url: 'https://evil.example.com/steal.jpg' } } })
  const res = await call()
  eq(res.status, 502, 'refused')
  eq(w.uploads.length, 0, 'nothing stored')
})

Deno.test('not an image / too large / empty are rejected and nothing is stored', async () => {
  let w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: HTML } } })
  eq((await call()).status, 415, 'html')
  eq(w.uploads.length, 0, 'html not stored')
  w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: JPEG, length: 5 * 1024 * 1024 } } })
  eq((await call()).status, 413, 'declared too large')
  w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: new Uint8Array([0xff, 0xd8, 0xff, ...new Array(2 * 1024 * 1024 + 10).fill(1)]) } } })
  eq((await call()).status, 413, 'actual too large')
  eq(w.uploads.length, 0, 'large not stored')
  w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: new Uint8Array() } } })
  eq((await call()).status, 413, 'empty')
})

Deno.test('requires a signed-in member', async () => {
  world({ user: false })
  eq((await call({}, null)).status, 401, 'no header')
  eq((await call({}, 'Bearer bad')).status, 401, 'bad token')
})

Deno.test('the request cannot choose the image address', async () => {
  const evil = 'https://media.licdn.com/attacker-chosen.jpg'
  const w = world({ identities: [li(LI_URL)], images: { [LI_URL]: { body: JPEG }, [evil]: { body: JPEG } } })
  await call({ provider: 'linkedin_oidc', url: evil, picture: evil })
  eq(w.fetched.includes(evil), false, 'ignored')
})
