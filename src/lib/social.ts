/**
 * Instagram / Facebook links typed by members. Whatever they paste (handle, @handle, short link, full URL with tracking
 * junk) comes out as one canonical https address on the real site, or null. The database enforces the same shapes
 * (profile_social_links CHECK constraints), and SocialLinks re-checks before rendering, so a bad value can never become a link.
 */
export type SocialKind = 'instagram' | 'facebook'
export type SocialVisibility = 'verified' | 'connections' | 'hidden'
export const SOCIAL_VISIBILITIES: SocialVisibility[] = ['verified', 'connections', 'hidden']

const IG_USER = /^[A-Za-z0-9._]{1,30}$/
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'])
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'tv', 'about', 'developer', 'legal', 'privacy', 'web', 'challenge', 'oauth', 'emails', 'directory', 'press', 'api', 'static', 'graphql'])

const FB_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'mobile.facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'touch.facebook.com',
  'fb.com', 'www.fb.com', 'fb.me', 'www.fb.me',
])
const FB_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/
const FB_TAIL = /^[A-Za-z0-9._%-]{1,100}$/
const FB_BARE = /^[A-Za-z0-9.]{5,50}$/
const FB_MULTI = new Set(['people', 'pages', 'p'])
const FB_RESERVED = new Set([
  'share', 'sharer', 'dialog', 'login', 'l', 'plugins', 'tr', 'help', 'policies', 'privacy', 'ads', 'watch', 'groups', 'events', 'marketplace',
  'gaming', 'stories', 'story', 'reel', 'reels', 'hashtag', 'search', 'photo', 'permalink', 'posts', 'video', 'videos', 'flx', 'recover', 'checkpoint',
  'settings', 'home', 'index', 'about', 'notes', 'public', 'r', 'ajax', 'rsrc', 'security',
])

/** Parses a typed address into a URL, adding https:// when missing. Rejects other schemes, credentials, whitespace and odd ports. */
function parse(input: string): URL | null {
  const t = input.trim()
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
  if (!t || t.length > 500 || /[\s\u0000-\u001f\u007f<>"'`]/.test(t)) return null
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(t)
  let u: URL
  try {
    u = new URL(hasScheme ? t : `https://${t.replace(/^\/+/, '')}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null
  return u
}

/** Does the text start with a web address (as opposed to being just a handle)? */
const looksLikeAddress = (s: string, hosts: string[]) =>
  /[/?#\\]/.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s) || hosts.some((h) => s.toLowerCase().startsWith(h))

export function normalizeInstagramUrl(input: string): string | null {
  let s = input.trim()
  if (s.startsWith('@')) s = s.slice(1)
  if (!s) return null
  if (!looksLikeAddress(s, ['instagram.', 'www.instagram', 'm.instagram', 'instagr.am', 'www.instagr'])) {
    return IG_USER.test(s) ? `https://www.instagram.com/${s}/` : null
  }
  const u = parse(s)
  if (!u || !IG_HOSTS.has(u.hostname)) return null
  let seg = u.pathname.split('/').filter(Boolean)
  if (seg[0] === '_u') seg = seg.slice(1) // instagram.com/_u/name (app deep link)
  const name = seg[0]
  if (!name || !IG_USER.test(name) || IG_RESERVED.has(name.toLowerCase())) return null
  return `https://www.instagram.com/${name}/`
}

export function normalizeFacebookUrl(input: string): string | null {
  let s = input.trim()
  if (s.startsWith('@')) s = s.slice(1)
  if (!s) return null
  if (!looksLikeAddress(s, ['facebook.', 'www.facebook', 'm.facebook', 'web.facebook', 'mbasic.facebook', 'fb.', 'www.fb.'])) {
    return FB_BARE.test(s) && !/\.php$/i.test(s) && !FB_RESERVED.has(s.toLowerCase()) ? `https://www.facebook.com/${s}` : null
  }
  const u = parse(s)
  if (!u || !FB_HOSTS.has(u.hostname)) return null
  const seg = u.pathname.split('/').filter(Boolean)
  const first = seg[0]
  if (!first) return null
  if (first.toLowerCase() === 'profile.php') {
    const id = u.searchParams.get('id') ?? ''
    return /^[0-9]{5,25}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null
  }
  if (!FB_SEGMENT.test(first) || /\.php$/i.test(first) || FB_RESERVED.has(first.toLowerCase())) return null
  if (FB_MULTI.has(first.toLowerCase())) {
    const rest = seg.slice(1, 3)
    if (!rest.length || !rest.every((x) => FB_TAIL.test(x) && !/\.php$/i.test(x))) return null
    return `https://www.facebook.com/${first}/${rest.join('/')}`
  }
  return `https://www.facebook.com/${first}`
}

export function normalizeSocialUrl(kind: SocialKind, input: string): string | null {
  return kind === 'instagram' ? normalizeInstagramUrl(input) : normalizeFacebookUrl(input)
}

/** True only for the exact canonical shapes above; used before a stored value is turned into a link. */
export function isCanonicalSocialUrl(kind: SocialKind, url: string | null | undefined): url is string {
  return !!url && normalizeSocialUrl(kind, url) === url
}

/** Short text for a stored link: "@anil.k" for Instagram, the page name for Facebook. */
export function socialHandle(kind: SocialKind, url: string): string {
  const seg = new URL(url).pathname.split('/').filter(Boolean)
  if (kind === 'instagram') return `@${seg[0] ?? ''}`
  if (seg[0] === 'profile.php' || !seg.length) return 'Facebook'
  const label = FB_MULTI.has(seg[0]!.toLowerCase()) ? (seg[1] ?? seg[0]!) : seg[0]!
  try {
    return decodeURIComponent(label).replace(/-/g, ' ')
  } catch {
    return label
  }
}

export interface SocialDraft {
  instagram: string
  facebook: string
  instagram_visibility: SocialVisibility
  facebook_visibility: SocialVisibility
}

/** Checks what is typed in the edit form: the canonical urls to save (null = left empty), and which networks are invalid. */
export function validateSocial(d: SocialDraft): { instagram_url: string | null; facebook_url: string | null; errors: Partial<Record<SocialKind, true>> } {
  const errors: Partial<Record<SocialKind, true>> = {}
  const one = (kind: SocialKind, v: string) => {
    if (!v.trim()) return null
    const n = normalizeSocialUrl(kind, v)
    if (!n) errors[kind] = true
    return n
  }
  return { instagram_url: one('instagram', d.instagram), facebook_url: one('facebook', d.facebook), errors }
}

/** What the edit form shows for a stored link: the handle without the web address. */
export function socialInputValue(kind: SocialKind, url: string | null | undefined): string {
  if (!url) return ''
  return kind === 'instagram' ? socialHandle('instagram', url) : url.replace(/^https:\/\/www\./, '')
}
