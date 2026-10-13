/** A tiny tap of vibration on key actions (Android; ignored elsewhere and when the person prefers reduced motion). */
export function haptic(pattern: number | number[] = 8) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate(pattern)
  } catch {
    /* not allowed (e.g. no user gesture yet) */
  }
}
