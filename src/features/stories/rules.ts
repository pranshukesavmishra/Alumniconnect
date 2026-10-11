// Everything about stories that needs no screen: the limits (the same numbers the database enforces), link and text rules, time left,
// how long each story plays, the progress bar maths, tap zones and swipe detection, and how the ring row is ordered. Pure, so unit-tested.
import { MB, videoMime } from '../photos/video'

export const STORY_MS = 24 * 3600 * 1000
export const MAX_CAPTION = 200
export const MAX_TEXT = 280
export const MAX_LINK_LABEL = 40
export const MAX_TITLE = 40
export const MAX_VIDEO_MS = 60_000
/** The database allows half a second more (a video that rounds up to 60.4 s is still "60 seconds"). */
export const MAX_VIDEO_MS_SERVER = 60_500
export const MAX_STORY_VIDEO_BYTES = 40 * MB
export const DAILY_LIMIT = 20
export const PHOTO_MS = 6000
export const TEXT_MS = 6000
export const MIN_VIDEO_MS = 500
/** A press that lasts longer than this is a "hold" (pause), a shorter one is a tap. */
export const HOLD_MS = 200
export const SWIPE_CLOSE_PX = 80
/** The left part of the screen goes back, the rest goes on. */
export const PREV_ZONE = 0.3
export const MORE_LIMIT = 30

export const BG_KEYS = ['indigo', 'teal', 'amber', 'rose', 'forest', 'slate', 'plum', 'sunset'] as const
export type BgKey = (typeof BG_KEYS)[number]

/** CSS backgrounds for the text cards (all dark enough for white text, 4.5:1 or better). */
export const BG_STYLE: Record<BgKey, string> = {
  indigo: 'linear-gradient(160deg, #3730a3, #1e1b4b)',
  teal: 'linear-gradient(160deg, #0f766e, #134e4a)',
  amber: 'linear-gradient(160deg, #b45309, #78350f)',
  rose: 'linear-gradient(160deg, #be123c, #881337)',
  forest: 'linear-gradient(160deg, #166534, #14532d)',
  slate: 'linear-gradient(160deg, #334155, #0f172a)',
  plum: 'linear-gradient(160deg, #86198f, #4a044e)',
  sunset: 'linear-gradient(160deg, #c2410c, #9d174d)',
}

export function bgStyle(key: string | null | undefined): string {
  return BG_STYLE[key && key in BG_STYLE ? (key as BgKey) : 'indigo']
}

export type StoryKind = 'photo' | 'video' | 'text'
export type Audience = 'all' | 'connections' | 'event' | 'group'

// ------------------------------------------------------------------ links
const LINK_RE = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(\/[^\s<>"'\\]*)?$/

/** Only plain https web addresses are accepted (no javascript:, data:, http:, user:password@). The database checks the same rule. */
export function isSafeLink(url: string | null | undefined): boolean {
  const u = (url ?? '').trim()
  return u.length > 0 && u.length <= 500 && LINK_RE.test(u)
}

/** What a person typed -> the address to save. "jecjabalpur.ac.in/news" becomes "https://..."; anything with another scheme is left alone (and then refused). */
export function normalizeLink(input: string): string {
  const t = input.trim()
  if (!t) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return t
  return `https://${t}`
}

export type LinkProblem = 'invalid' | 'labelTooLong'
export function linkProblem(url: string, label = ''): LinkProblem | null {
  if (!url.trim()) return null
  if (!isSafeLink(normalizeLink(url))) return 'invalid'
  if (label.trim().length > MAX_LINK_LABEL) return 'labelTooLong'
  return null
}

// ------------------------------------------------------------------ text
export function clampText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

export type CaptionProblem = 'tooLong'
export function captionProblem(caption: string): CaptionProblem | null {
  return caption.trim().length > MAX_CAPTION ? 'tooLong' : null
}

/** Text size for a text card: short sentences are huge, long ones smaller (px for a 360 px wide phone, scaled by the viewer). */
export function textCardSize(text: string): number {
  const n = text.trim().length
  if (n <= 40) return 34
  if (n <= 90) return 28
  if (n <= 160) return 23
  return 19
}

// ------------------------------------------------------------------ time
export interface TimeLeft {
  hours: number
  minutes: number
}
/** Time until a story disappears, or null once it has. */
export function timeLeft(expiresAt: string | number | Date, now: number = Date.now()): TimeLeft | null {
  const ms = new Date(expiresAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.ceil(ms / 60_000)
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}
export const isExpired = (expiresAt: string | number | Date, now: number = Date.now()) => timeLeft(expiresAt, now) === null

// ------------------------------------------------------------------ how long a story plays
export interface PlayInfo {
  kind: StoryKind
  duration_ms: number | null
}
/** Photos and text cards show for 6 seconds; a video plays for its own length (never more than 60 s, never less than 1 s). */
export function storyDurationMs(s: PlayInfo): number {
  if (s.kind === 'video') return Math.min(MAX_VIDEO_MS_SERVER, Math.max(1000, s.duration_ms ?? 5000))
  return s.kind === 'text' ? TEXT_MS : PHOTO_MS
}

export interface Progress {
  elapsed: number
  /** 0..1 */
  fraction: number
  done: boolean
}
/** Moves the progress bar on by `dt` ms unless paused. A long gap (a hidden tab) counts as at most 100 ms so a story is never skipped unseen. */
export function advanceProgress(elapsed: number, dt: number, duration: number, paused: boolean): Progress {
  const step = paused ? 0 : Math.max(0, Math.min(dt, 100))
  const e = Math.min(duration, elapsed + step)
  return { elapsed: e, fraction: duration > 0 ? e / duration : 1, done: e >= duration }
}

/** Progress of a video from its own clock. */
export function videoFraction(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.max(0, Math.min(1, currentTime / duration))
}

/** The widths of the segmented bar: finished ones full, the current one partly, the rest empty. */
export function segmentFractions(count: number, index: number, fraction: number): number[] {
  return Array.from({ length: count }, (_, i) => (i < index ? 1 : i === index ? Math.max(0, Math.min(1, fraction)) : 0))
}

// ------------------------------------------------------------------ moving between stories
export type Step = { kind: 'story'; index: number } | { kind: 'source'; dir: 1 | -1 } | { kind: 'close' }
/** Where "next" / "previous" lead: another story, another person's stories, or out. `sources` is how many rings are queued, `sourceIndex` the current one. */
export function stepFrom(index: number, count: number, dir: 1 | -1, sourceIndex = 0, sources = 1): Step {
  const to = index + dir
  if (to >= 0 && to < count) return { kind: 'story', index: to }
  if (dir === 1) return sourceIndex + 1 < sources ? { kind: 'source', dir: 1 } : { kind: 'close' }
  return sourceIndex > 0 ? { kind: 'source', dir: -1 } : { kind: 'story', index: 0 }
}

/** First story the viewer has not seen (like Instagram), else the first. */
export function startIndex(stories: readonly { seen: boolean }[]): number {
  const i = stories.findIndex((s) => !s.seen)
  return i === -1 ? 0 : i
}

export type Zone = 'prev' | 'next'
export function tapZone(x: number, width: number): Zone {
  return width > 0 && x / width < PREV_ZONE ? 'prev' : 'next'
}

/** A downward swipe that is mostly vertical closes the viewer. */
export function isCloseSwipe(dx: number, dy: number): boolean {
  return dy >= SWIPE_CLOSE_PX && Math.abs(dx) < dy * 0.8
}
/** A finger that has moved enough to be a swipe rather than a tap or a hold. */
export function isSwiping(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 12
}

export type PressResult = 'tap' | 'hold'
export const pressKind = (heldMs: number): PressResult => (heldMs >= HOLD_MS ? 'hold' : 'tap')

// ------------------------------------------------------------------ the ring row
export type Section = 'official' | 'mine' | 'connections' | 'more'
export interface FeedRing {
  section: Section
  owner_id: string | null
  owner_name: string | null
  owner_avatar: string | null
  story_count: number
  unseen_count: number
  latest_at: string
}
export interface Rings {
  official: FeedRing | null
  mine: FeedRing | null
  connections: FeedRing[]
  more: FeedRing[]
}

/** Official first, then yours, then connections (unseen before seen, newest first), then "More stories" (newest 30). */
export function groupRings(feed: readonly FeedRing[]): Rings {
  const order = (a: FeedRing, b: FeedRing) => Number(a.unseen_count === 0) - Number(b.unseen_count === 0) || b.latest_at.localeCompare(a.latest_at)
  return {
    official: feed.find((r) => r.section === 'official') ?? null,
    mine: feed.find((r) => r.section === 'mine') ?? null,
    connections: feed.filter((r) => r.section === 'connections').sort(order),
    more: feed.filter((r) => r.section === 'more').sort((a, b) => b.latest_at.localeCompare(a.latest_at)).slice(0, MORE_LIMIT),
  }
}

/** The order the viewer plays them in when you open the row: official, yours is skipped, connections, then more. */
export function viewerQueue(r: Rings, startWith?: FeedRing): FeedRing[] {
  const all = [r.official, ...r.connections, ...r.more].filter((x): x is FeedRing => !!x)
  if (!startWith) return all
  const i = all.findIndex((x) => x.section === startWith.section && x.owner_id === startWith.owner_id)
  return i === -1 ? [startWith, ...all] : all.slice(i)
}

// ------------------------------------------------------------------ files
export type StoryVideoProblem = 'format' | 'empty' | 'tooBig' | 'tooLong' | 'unreadable' | 'tooShort'
/** What is wrong with a video chosen for a story, or null. `durationMs` comes from reading the file on the phone. */
export function storyVideoProblem(file: Pick<File, 'name' | 'type' | 'size'>, durationMs: number | null): StoryVideoProblem | null {
  if (!videoMime(file)) return 'format'
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_STORY_VIDEO_BYTES) return 'tooBig'
  if (durationMs === null) return 'unreadable'
  if (durationMs < MIN_VIDEO_MS) return 'tooShort'
  if (durationMs > MAX_VIDEO_MS_SERVER) return 'tooLong'
  return null
}

export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export function isPhotoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return PHOTO_MIMES.includes((file.type || '').toLowerCase()) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

// ------------------------------------------------------------------ the composer
export interface DraftCheck {
  kind: StoryKind
  text?: string
  caption?: string
  hasFile?: boolean
  audience: Audience
  official: boolean
  eventId?: string | null
  groupId?: string | null
  link?: string
  linkLabel?: string
}
export type DraftProblem = 'text' | 'file' | 'caption' | 'event' | 'group' | 'link' | 'audience'
/** The first thing missing or wrong before "Post" can be pressed, or null. */
export function draftProblem(d: DraftCheck): DraftProblem | null {
  if (d.kind === 'text') {
    if (!d.text?.trim() || d.text.trim().length > MAX_TEXT) return 'text'
  } else if (!d.hasFile) return 'file'
  if (captionProblem(d.caption ?? '')) return 'caption'
  const allowed: Audience[] = d.official ? ['all', 'event', 'group'] : ['all', 'connections']
  if (!allowed.includes(d.audience)) return 'audience'
  if (d.audience === 'event' && !d.eventId) return 'event'
  if (d.audience === 'group' && !d.groupId) return 'group'
  if (d.link?.trim() && (!d.official || linkProblem(d.link, d.linkLabel))) return 'link'
  return null
}

/** Stories posted in the last 24 h versus the daily limit, from the member's archive. */
export function postedToday(createdAts: readonly string[], now: number = Date.now()): number {
  return createdAts.filter((c) => now - new Date(c).getTime() < STORY_MS).length
}
