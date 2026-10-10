import { describe, expect, it } from 'vitest'
import { parseDriveRef } from './driveRef'
import { MAX_GLIMPSE_BYTES, MAX_VIDEO_BYTES, MB, extOf, formatDuration, formatSize, glimpseAutoplays, isVideoFile, mediaUrl, videoFingerprint, videoMime, videoProblem } from './video'

const f = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('video file rules', () => {
  it('accepts mp4, mov and webm by type', () => {
    expect(videoMime(f('a.mp4', 'video/mp4'))).toBe('video/mp4')
    expect(videoMime(f('a.mov', 'video/quicktime'))).toBe('video/quicktime')
    expect(videoMime(f('a.webm', 'video/webm'))).toBe('video/webm')
  })

  it('falls back to the file name when the phone leaves the type empty or odd (iOS .mov quirks)', () => {
    expect(videoMime(f('IMG_0001.MOV', ''))).toBe('video/quicktime')
    expect(videoMime(f('IMG_0001.mov', 'application/octet-stream'))).toBe('video/quicktime')
    expect(videoMime(f('clip.m4v', 'video/x-m4v'))).toBe('video/mp4')
    expect(videoMime(f('clip.MP4', ''))).toBe('video/mp4')
  })

  it('refuses other formats and non-videos', () => {
    expect(videoMime(f('a.avi', 'video/x-msvideo'))).toBeNull()
    expect(videoMime(f('a.mkv', ''))).toBeNull()
    expect(videoMime(f('photo.jpg', 'image/jpeg'))).toBeNull()
    expect(videoMime(f('a.mp4', 'image/png'))).toBeNull()
  })

  it('tells videos from photos, even unsupported video formats (so they get a video message)', () => {
    expect(isVideoFile(f('a.avi', 'video/x-msvideo'))).toBe(true)
    expect(isVideoFile(f('IMG.MOV', ''))).toBe(true)
    expect(isVideoFile(f('a.heic', 'image/heic'))).toBe(false)
  })

  it('checks size against the limit: 500 MB for videos, 60 MB for glimpses', () => {
    expect(videoProblem(f('a.mp4', 'video/mp4', 500 * MB))).toBeNull()
    expect(videoProblem(f('a.mp4', 'video/mp4', 500 * MB + 1))).toBe('tooBig')
    expect(videoProblem(f('a.mp4', 'video/mp4', 0))).toBe('empty')
    expect(videoProblem(f('a.avi', 'video/x-msvideo', 5))).toBe('format')
    expect(videoProblem(f('a.mp4', 'video/mp4', MAX_GLIMPSE_BYTES + 1), MAX_GLIMPSE_BYTES)).toBe('tooBig')
    expect(MAX_VIDEO_BYTES).toBe(500 * MB)
  })

  it('names the extension from the type', () => {
    expect(extOf('video/quicktime')).toBe('mov')
    expect(extOf('video/webm')).toBe('webm')
    expect(extOf('video/mp4')).toBe('mp4')
  })
})

describe('formatting', () => {
  it('shows durations as m:ss and h:mm:ss', () => {
    expect(formatDuration(7000)).toBe('0:07')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(-5)).toBe('')
  })
  it('shows sizes', () => {
    expect(formatSize(500)).toBe('1 KB')
    expect(formatSize(2.5 * MB)).toBe('2.5 MB')
    expect(formatSize(120 * MB)).toBe('120 MB')
  })
})

describe('fingerprint', () => {
  it('is the same for the same bytes and differs for another size or content', async () => {
    const a = new Blob([new Uint8Array(5 * MB).fill(1)])
    const b = new Blob([new Uint8Array(5 * MB).fill(1)])
    const c = new Blob([new Uint8Array(5 * MB + 1).fill(1)])
    const d = new Blob([new Uint8Array(5 * MB).fill(2)])
    const fa = await videoFingerprint(a)
    expect(fa).toMatch(/^[0-9a-f]{64}$/)
    expect(await videoFingerprint(b)).toBe(fa)
    expect(await videoFingerprint(c)).not.toBe(fa)
    expect(await videoFingerprint(d)).not.toBe(fa)
  })
  it('works for small files too', async () => {
    expect(await videoFingerprint(new Blob(['abc']))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('playback address', () => {
  it('builds the drive-media address; the token is only sent for members, never for glimpses', () => {
    const base = 'https://x.supabase.co'
    expect(mediaUrl('event', 'abc', 'TOK', { base })).toBe('https://x.supabase.co/functions/v1/drive-media?k=event&id=abc&t=TOK')
    expect(mediaUrl('gallery', 'abc', null, { base: `${base}/` })).toBe('https://x.supabase.co/functions/v1/drive-media?k=gallery&id=abc')
    expect(mediaUrl('glimpse', 'abc', 'TOK', { base })).toBe('https://x.supabase.co/functions/v1/drive-media?k=glimpse&id=abc')
    expect(mediaUrl('event', 'abc', 'T', { base, download: true })).toContain('dl=1')
  })
})

describe('glimpse autoplay policy', () => {
  it('plays on a normal connection', () => {
    expect(glimpseAutoplays({ reducedMotion: false })).toBe(true)
    expect(glimpseAutoplays({ reducedMotion: false, saveData: false, effectiveType: '4g' })).toBe(true)
  })
  it('shows only the poster for reduced motion, Data Saver and slow connections', () => {
    expect(glimpseAutoplays({ reducedMotion: true })).toBe(false)
    expect(glimpseAutoplays({ reducedMotion: false, saveData: true })).toBe(false)
    for (const t of ['slow-2g', '2g', '3g']) expect(glimpseAutoplays({ reducedMotion: false, effectiveType: t })).toBe(false)
  })
})

describe('pasted Drive links', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123'
  it('reads the id from the usual link shapes and from a bare id', () => {
    expect(parseDriveRef(ID)).toEqual({ id: ID })
    expect(parseDriveRef(`  ${ID}  `)).toEqual({ id: ID })
    expect(parseDriveRef(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toEqual({ id: ID })
    expect(parseDriveRef(`https://drive.google.com/file/u/1/d/${ID}/edit`)).toEqual({ id: ID })
    expect(parseDriveRef(`https://drive.google.com/open?id=${ID}`)).toEqual({ id: ID })
    expect(parseDriveRef(`https://drive.google.com/uc?export=download&id=${ID}`)).toEqual({ id: ID })
    expect(parseDriveRef(`https://drive.usercontent.google.com/download?id=${ID}&export=download`)).toEqual({ id: ID })
  })
  it('explains what is wrong', () => {
    expect(parseDriveRef('')).toEqual({ error: 'empty' })
    expect(parseDriveRef(null)).toEqual({ error: 'empty' })
    expect(parseDriveRef(`https://drive.google.com/drive/folders/${ID}`)).toEqual({ error: 'folder' })
    expect(parseDriveRef('https://example.com/file/d/' + ID)).toEqual({ error: 'invalid' })
    expect(parseDriveRef('http://drive.google.com/file/d/' + ID)).toEqual({ error: 'invalid' })
    expect(parseDriveRef('hello world')).toEqual({ error: 'invalid' })
    expect(parseDriveRef('https://drive.google.com/file/d/short/view')).toEqual({ error: 'invalid' })
  })
})
