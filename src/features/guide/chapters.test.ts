import { describe, expect, it } from 'vitest'
import { CHAPTERS, chapterAt, guideAssets, guideLangFor, seekTime } from './chapters'

describe('guide chapters', () => {
  for (const lang of ['en', 'hi'] as const) {
    it(`${lang}: eight steps, in order, back to back, inside one minute or so`, () => {
      const c = CHAPTERS[lang]
      expect(c.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(c[0]!.start).toBe(0)
      for (let i = 1; i < c.length; i++) {
        expect(c[i]!.start).toBeGreaterThan(c[i - 1]!.start)
        expect(c[i]!.start).toBeCloseTo(c[i - 1]!.end, 1)
      }
      expect(c[7]!.end).toBeLessThanOrEqual(62)
    })
  }

  it('finds the step playing at a time', () => {
    const c = [
      { step: 1, start: 0, end: 5 },
      { step: 2, start: 5, end: 12 },
      { step: 3, start: 12, end: 20 },
    ]
    expect(chapterAt(c, 0)?.step).toBe(1)
    expect(chapterAt(c, 4.9)?.step).toBe(1)
    expect(chapterAt(c, 5)?.step).toBe(2)
    expect(chapterAt(c, 19)?.step).toBe(3)
    expect(chapterAt([], 3)).toBeNull()
  })

  it('seeks to just after the start of a step, and to 0 for an unknown step', () => {
    const c = [{ step: 2, start: 5, end: 12 }]
    expect(seekTime(c, 2)).toBeCloseTo(5.05)
    expect(seekTime(c, 9)).toBe(0)
  })

  it('picks the video file by language and falls back to English', () => {
    expect(guideLangFor('hi')).toBe('hi')
    expect(guideLangFor('en')).toBe('en')
    expect(guideLangFor('fr')).toBe('en')
    expect(guideAssets('hi')).toEqual({ video: '/guide/guide-hi.mp4', captions: '/guide/guide-hi.vtt', poster: '/guide/poster-hi.webp' })
  })
})
