import { describe, expect, it } from 'vitest'
import {
  advanceProgress, BG_KEYS, BG_STYLE, bgStyle, captionProblem, DAILY_LIMIT, draftProblem, groupRings, HOLD_MS, isCloseSwipe, isExpired, isPhotoFile, isSafeLink, isSwiping, linkProblem,
  MAX_CAPTION, MAX_STORY_VIDEO_BYTES, MAX_TEXT, MORE_LIMIT, normalizeLink, postedToday, pressKind, segmentFractions, startIndex, stepFrom, storyDurationMs, storyVideoProblem,
  tapZone, textCardSize, timeLeft, videoFraction, viewerQueue, type FeedRing,
} from './rules'

describe('links', () => {
  it('accepts plain https addresses', () => {
    for (const u of ['https://jecjabalpur.ac.in', 'https://jecjabalpur.ac.in/news?id=1&x=y#top', 'https://a.b.co:8443/path/to', 'https://example.org/a-b_c~d']) expect(isSafeLink(u), u).toBe(true)
  })
  it('refuses anything else', () => {
    const bad = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'http://example.org', 'data:text/html,x', 'https://user:pw@example.org', 'https://exa mple.org', 'https://example.org/<script>', 'https://example.org/a"b',
      "https://example.org/a'b", 'ftp://example.org', '//example.org', 'https://', 'https://-bad.org', '', '   ', 'https://example.org/' + 'a'.repeat(500), 'https:/example.org', 'https://example.org/a\\b']
    for (const u of bad) expect(isSafeLink(u), u).toBe(false)
    expect(isSafeLink(null)).toBe(false)
  })
  it('adds https:// to a bare address but never rewrites another scheme', () => {
    expect(normalizeLink('  jecjabalpur.ac.in/news ')).toBe('https://jecjabalpur.ac.in/news')
    expect(normalizeLink('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeLink('http://x.org')).toBe('http://x.org')
    expect(isSafeLink(normalizeLink('javascript:alert(1)'))).toBe(false)
    expect(normalizeLink('')).toBe('')
  })
  it('reports what is wrong', () => {
    expect(linkProblem('')).toBeNull()
    expect(linkProblem('jecjabalpur.ac.in')).toBeNull()
    expect(linkProblem('javascript:1')).toBe('invalid')
    expect(linkProblem('https://x.org', 'y'.repeat(41))).toBe('labelTooLong')
  })
})

describe('text and styles', () => {
  it('has a style for every colour and falls back for an unknown one', () => {
    for (const k of BG_KEYS) expect(BG_STYLE[k]).toContain('gradient')
    expect(bgStyle('nope')).toBe(BG_STYLE.indigo)
    expect(bgStyle(null)).toBe(BG_STYLE.indigo)
    expect(bgStyle('teal')).toBe(BG_STYLE.teal)
  })
  it('caps captions at 200 and picks a size by length', () => {
    expect(captionProblem('x'.repeat(MAX_CAPTION))).toBeNull()
    expect(captionProblem('x'.repeat(MAX_CAPTION + 1))).toBe('tooLong')
    expect(textCardSize('Hi')).toBeGreaterThan(textCardSize('x'.repeat(200)))
  })
})

describe('time left and expiry', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  it('counts hours and minutes down to zero', () => {
    expect(timeLeft('2026-10-21T12:00:00Z', now)).toEqual({ hours: 24, minutes: 0 })
    expect(timeLeft('2026-10-20T17:30:00Z', now)).toEqual({ hours: 5, minutes: 30 })
    expect(timeLeft('2026-10-20T12:00:30Z', now)).toEqual({ hours: 0, minutes: 1 })
  })
  it('is null once expired', () => {
    expect(timeLeft('2026-10-20T12:00:00Z', now)).toBeNull()
    expect(timeLeft('2026-10-19T12:00:00Z', now)).toBeNull()
    expect(isExpired('2026-10-20T11:59:59Z', now)).toBe(true)
    expect(isExpired('2026-10-20T12:00:01Z', now)).toBe(false)
    expect(timeLeft('not a date', now)).toBeNull()
  })
  it('counts stories posted in the last 24 hours against the limit', () => {
    const ts = [now - 1000, now - 23 * 3600e3, now - 25 * 3600e3].map((t) => new Date(t).toISOString())
    expect(postedToday(ts, now)).toBe(2)
    expect(DAILY_LIMIT).toBe(20)
  })
})

describe('how long a story plays and the progress bar', () => {
  it('photos and text play 6 s, a video plays its length within 1..60.5 s', () => {
    expect(storyDurationMs({ kind: 'photo', duration_ms: null })).toBe(6000)
    expect(storyDurationMs({ kind: 'text', duration_ms: null })).toBe(6000)
    expect(storyDurationMs({ kind: 'video', duration_ms: 12_345 })).toBe(12_345)
    expect(storyDurationMs({ kind: 'video', duration_ms: 200 })).toBe(1000)
    expect(storyDurationMs({ kind: 'video', duration_ms: 999_999 })).toBe(60_500)
    expect(storyDurationMs({ kind: 'video', duration_ms: null })).toBe(5000)
  })
  it('advances while playing and stops while paused or held', () => {
    let p = advanceProgress(0, 16, 6000, false)
    expect(p).toEqual({ elapsed: 16, fraction: 16 / 6000, done: false })
    p = advanceProgress(p.elapsed, 16, 6000, true)
    expect(p.elapsed).toBe(16)
  })
  it('finishes exactly at the end and never goes past it', () => {
    let e = 0
    let frames = 0
    for (; frames < 1000; frames++) {
      const p = advanceProgress(e, 16, 6000, false)
      e = p.elapsed
      if (p.done) break
    }
    expect(e).toBe(6000)
    expect(frames * 16).toBeGreaterThanOrEqual(5900)
    expect(frames * 16).toBeLessThan(6100)
    expect(advanceProgress(5990, 100, 6000, false)).toEqual({ elapsed: 6000, fraction: 1, done: true })
  })
  it('treats a long gap (a hidden tab) as one short frame', () => {
    expect(advanceProgress(0, 60_000, 6000, false).elapsed).toBe(100)
    expect(advanceProgress(0, -5, 6000, false).elapsed).toBe(0)
  })
  it('reads a video from its own clock', () => {
    expect(videoFraction(5, 10)).toBe(0.5)
    expect(videoFraction(11, 10)).toBe(1)
    expect(videoFraction(1, 0)).toBe(0)
    expect(videoFraction(1, NaN)).toBe(0)
  })
  it('draws finished, current and waiting segments', () => {
    expect(segmentFractions(4, 2, 0.25)).toEqual([1, 1, 0.25, 0])
    expect(segmentFractions(1, 0, 2)).toEqual([1])
    expect(segmentFractions(0, 0, 0)).toEqual([])
  })
})

describe('moving around', () => {
  it('goes to the next story, then the next person, then closes', () => {
    expect(stepFrom(0, 3, 1)).toEqual({ kind: 'story', index: 1 })
    expect(stepFrom(2, 3, 1, 0, 2)).toEqual({ kind: 'source', dir: 1 })
    expect(stepFrom(2, 3, 1, 1, 2)).toEqual({ kind: 'close' })
    expect(stepFrom(2, 3, 1)).toEqual({ kind: 'close' })
  })
  it('goes back, to the previous person, or restarts the first story', () => {
    expect(stepFrom(2, 3, -1)).toEqual({ kind: 'story', index: 1 })
    expect(stepFrom(0, 3, -1, 1, 2)).toEqual({ kind: 'source', dir: -1 })
    expect(stepFrom(0, 3, -1, 0, 2)).toEqual({ kind: 'story', index: 0 })
  })
  it('starts at the first unseen story', () => {
    expect(startIndex([{ seen: true }, { seen: true }, { seen: false }, { seen: false }])).toBe(2)
    expect(startIndex([{ seen: true }, { seen: true }])).toBe(0)
    expect(startIndex([])).toBe(0)
  })
  it('splits the screen: left third back, the rest forward', () => {
    expect(tapZone(10, 360)).toBe('prev')
    expect(tapZone(107, 360)).toBe('prev')
    expect(tapZone(120, 360)).toBe('next')
    expect(tapZone(350, 360)).toBe('next')
    expect(tapZone(5, 0)).toBe('next')
  })
  it('tells a tap from a hold and a swipe down from a tap', () => {
    expect(pressKind(HOLD_MS - 1)).toBe('tap')
    expect(pressKind(HOLD_MS)).toBe('hold')
    expect(isSwiping(2, 3)).toBe(false)
    expect(isSwiping(0, 30)).toBe(true)
    expect(isCloseSwipe(5, 120)).toBe(true)
    expect(isCloseSwipe(5, 40)).toBe(false)
    expect(isCloseSwipe(150, 100)).toBe(false)
    expect(isCloseSwipe(0, -200)).toBe(false)
  })
})

describe('the ring row', () => {
  const ring = (section: FeedRing['section'], id: string | null, unseen: number, at: string): FeedRing => ({ section, owner_id: id, owner_name: id, owner_avatar: null, story_count: 2, unseen_count: unseen, latest_at: at })
  it('puts official first, yours next, unseen before seen, and caps More at 30', () => {
    const feed: FeedRing[] = [
      ring('connections', 'old-seen', 0, '2026-10-20T10:00:00Z'),
      ring('connections', 'new-seen', 0, '2026-10-20T11:00:00Z'),
      ring('connections', 'old-unseen', 2, '2026-10-20T09:00:00Z'),
      ring('official', null, 1, '2026-10-20T08:00:00Z'),
      ring('mine', 'me', 0, '2026-10-20T07:00:00Z'),
      ...Array.from({ length: 40 }, (_, i) => ring('more', `m${i}`, 1, `2026-10-19T${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}:00Z`)),
    ]
    const r = groupRings(feed)
    expect(r.official?.owner_id).toBeNull()
    expect(r.mine?.owner_id).toBe('me')
    expect(r.connections.map((x) => x.owner_id)).toEqual(['old-unseen', 'new-seen', 'old-seen'])
    expect(r.more).toHaveLength(MORE_LIMIT)
    const q = viewerQueue(r)
    expect(q[0]!.section).toBe('official')
    expect(q.some((x) => x.section === 'mine')).toBe(false)
    expect(viewerQueue(r, r.connections[1]!)[0]!.owner_id).toBe('new-seen')
    expect(viewerQueue(r, r.mine!)[0]!.owner_id).toBe('me')
  })
  it('copes with an empty feed', () => {
    expect(groupRings([])).toEqual({ official: null, mine: null, connections: [], more: [] })
  })
})

describe('files', () => {
  const f = (name: string, type: string, size: number) => ({ name, type, size })
  it('accepts a short MP4 and says what is wrong otherwise', () => {
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), 30_000)).toBeNull()
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), 60_000)).toBeNull()
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), 60_400)).toBeNull()
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), 61_000)).toBe('tooLong')
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', MAX_STORY_VIDEO_BYTES + 1), 10_000)).toBe('tooBig')
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', MAX_STORY_VIDEO_BYTES), 10_000)).toBeNull()
    expect(storyVideoProblem(f('a.avi', 'video/x-msvideo', 5e6), 10_000)).toBe('format')
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 0), 10_000)).toBe('empty')
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), null)).toBe('unreadable')
    expect(storyVideoProblem(f('a.mp4', 'video/mp4', 5e6), 100)).toBe('tooShort')
    expect(storyVideoProblem(f('clip.mov', '', 5e6), 10_000)).toBeNull()
  })
  it('recognises photos by type or name', () => {
    expect(isPhotoFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(true)
    expect(isPhotoFile({ name: 'IMG_1.HEIC', type: '' })).toBe(true)
    expect(isPhotoFile({ name: 'a.gif', type: 'image/gif' })).toBe(false)
    expect(isPhotoFile({ name: 'a.svg', type: 'image/svg+xml' })).toBe(false)
  })
})

describe('the composer checks', () => {
  const base = { kind: 'text' as const, text: 'Hello', audience: 'connections' as const, official: false }
  it('needs text for a text card and a file for the others', () => {
    expect(draftProblem(base)).toBeNull()
    expect(draftProblem({ ...base, text: '  ' })).toBe('text')
    expect(draftProblem({ ...base, text: 'x'.repeat(MAX_TEXT + 1) })).toBe('text')
    expect(draftProblem({ ...base, kind: 'photo', hasFile: false })).toBe('file')
    expect(draftProblem({ ...base, kind: 'video', hasFile: true })).toBeNull()
  })
  it('offers members two audiences and admins three, and asks for the event or group', () => {
    expect(draftProblem({ ...base, audience: 'all' })).toBeNull()
    expect(draftProblem({ ...base, audience: 'event', eventId: 'e' })).toBe('audience')
    expect(draftProblem({ ...base, official: true, audience: 'connections' })).toBe('audience')
    expect(draftProblem({ ...base, official: true, audience: 'event' })).toBe('event')
    expect(draftProblem({ ...base, official: true, audience: 'event', eventId: 'e' })).toBeNull()
    expect(draftProblem({ ...base, official: true, audience: 'group' })).toBe('group')
    expect(draftProblem({ ...base, official: true, audience: 'group', groupId: 'g' })).toBeNull()
  })
  it('allows a link only on official stories and only a safe one', () => {
    expect(draftProblem({ ...base, link: 'https://x.org' })).toBe('link')
    expect(draftProblem({ ...base, official: true, audience: 'all', link: 'https://x.org' })).toBeNull()
    expect(draftProblem({ ...base, official: true, audience: 'all', link: 'javascript:alert(1)' })).toBe('link')
    expect(draftProblem({ ...base, caption: 'x'.repeat(201) })).toBe('caption')
  })
})
