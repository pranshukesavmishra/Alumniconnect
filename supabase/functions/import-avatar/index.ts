// Copies the member's own LinkedIn (or Google) profile photo into our storage.
//
// Why a function: LinkedIn's picture links expire and can't be fetched from the browser (CORS), so the
// server downloads the photo once and keeps a permanent copy in the "avatars" bucket.
// Safety: the image address comes ONLY from the signed-in member's own provider identity (never from
// the request), is HTTPS on a LinkedIn/Google image host, and must really be a small JPEG/PNG/WebP.
import { corsHeaders, json } from '../_shared/http.ts'
import { currentUser } from '../_shared/db.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_BYTES = 2 * 1024 * 1024 // matches the avatars bucket limit
const HOSTS = [/(^|\.)licdn\.com$/i, /(^|\.)googleusercontent\.com$/i]

type Provider = 'linkedin_oidc' | 'google' | 'any'
interface Identity {
  provider: string
  identity_data?: { picture?: string; avatar_url?: string }
}

const hostAllowed = (u: URL) => u.protocol === 'https:' && HOSTS.some((re) => re.test(u.hostname))

/** Identify the image type from its first bytes (never trust the server's header alone). */
function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405)

  const authorization = req.headers.get('Authorization')
  const user = await currentUser(authorization)
  if (!user) return json(req, { error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as { provider?: Provider }
  const wanted: Provider = body.provider === 'google' || body.provider === 'any' ? body.provider : 'linkedin_oidc'

  // the member's own sign-in identities (as stored by Supabase Auth)
  const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authorization! } })
  if (!me.ok) return json(req, { error: 'unauthorized' }, 401)
  const identities = ((await me.json()) as { identities?: Identity[] }).identities ?? []
  const pool = wanted === 'any' ? [...identities].sort((a) => (a.provider === 'linkedin_oidc' ? -1 : 1)) : identities.filter((i) => i.provider === wanted)
  if (!pool.length) return json(req, { error: 'no_identity', message: 'This account isn’t connected to that sign-in method.' }, 409)

  const source = pool.map((i) => i.identity_data?.picture ?? i.identity_data?.avatar_url).find(Boolean)
  if (!source) return json(req, { error: 'no_photo', message: 'No profile photo was shared with us.' }, 404)

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return json(req, { error: 'no_photo' }, 404)
  }
  if (!hostAllowed(url)) return json(req, { error: 'no_photo' }, 404)

  let bytes: Uint8Array<ArrayBuffer>
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { Accept: 'image/*' } })
    // a redirect must not lead somewhere else
    if (!res.ok || !hostAllowed(new URL(res.url))) return json(req, { error: 'fetch_failed', message: 'The photo could not be downloaded. Please try again, or upload one.' }, 502)
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) return json(req, { error: 'too_large' }, 413)
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return json(req, { error: 'fetch_failed', message: 'The photo could not be downloaded. Please try again, or upload one.' }, 502)
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return json(req, { error: 'too_large' }, 413)
  const type = sniff(bytes)
  if (!type) return json(req, { error: 'not_image' }, 415)

  // permanent copy in the member's own folder
  const path = `${user.id}/profile-${Date.now()}.${type.ext}`
  const up = await fetch(`${URL_}/storage/v1/object/avatars/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': type.mime, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' },
    body: bytes,
  })
  if (!up.ok) return json(req, { error: 'store_failed', message: 'Could not save the photo. Please try again.' }, 500)

  // the browser sets profiles.avatar_url from this path (row-level security applies to the member)
  return json(req, { path, source: pool[0]?.provider === 'linkedin_oidc' ? 'linkedin' : 'google' })
})
