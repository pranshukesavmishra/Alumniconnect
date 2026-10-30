// The guide video's chapters (start and end second of each of the 8 steps), generated with the video by scripts/guide/build.mjs.
import timing from './chapters.json'

export interface Chapter {
  step: number
  start: number
  end: number
}
export type GuideLang = 'en' | 'hi'

export const CHAPTERS: Record<GuideLang, Chapter[]> = timing as Record<GuideLang, Chapter[]>

/** The video file, captions and poster for a language (static files in /public/guide, served by the same host as the app). */
export function guideAssets(lang: GuideLang) {
  return { video: `/guide/guide-${lang}.mp4`, captions: `/guide/guide-${lang}.vtt`, poster: `/guide/poster-${lang}.webp` }
}

/** The step playing at a given time (the last chapter that has started); null before the first one. */
export function chapterAt(chapters: readonly Chapter[], time: number): Chapter | null {
  let found: Chapter | null = null
  for (const c of chapters) if (time + 0.05 >= c.start) found = c
  return found
}

/** Where to seek for a step number: a hair after the cut so the picture is already the new step. */
export function seekTime(chapters: readonly Chapter[], step: number): number {
  const c = chapters.find((x) => x.step === step)
  return c ? Math.max(0, c.start + 0.05) : 0
}

/** English or Hindi, from the app language; anything else falls back to English. */
export function guideLangFor(appLang: string): GuideLang {
  return appLang === 'hi' ? 'hi' : 'en'
}
