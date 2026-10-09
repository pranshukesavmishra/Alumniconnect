// Keyboard shortcuts for reviewing payments one at a time.

export type ReviewAction = 'verify' | 'reject' | 'skip' | 'back' | 'proof' | 'copy' | 'help'

interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: unknown
}

/** Which action a key press means, or null (typing in a field, or a browser shortcut, never counts). */
export function reviewAction(e: KeyLike): ReviewAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const t = (e.target ?? null) as { tagName?: string; isContentEditable?: boolean } | null
  const tag = t?.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return null
  switch (e.key) {
    case 'v': case 'V':
      return 'verify'
    case 'r': case 'R': case 'x': case 'X':
      return 'reject'
    case 's': case 'S': case 'n': case 'N': case 'ArrowRight': case 'j': case 'J':
      return 'skip'
    case 'b': case 'B': case 'p': case 'P': case 'ArrowLeft': case 'k': case 'K':
      return 'back'
    case 'o': case 'O':
      return 'proof'
    case 'c': case 'C':
      return 'copy'
    case '?':
      return 'help'
    default:
      return null
  }
}

/** Moves through the queue without falling off either end. */
export function stepIndex(index: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, index + dir))
}

/** After a payment leaves the queue (verified or rejected) the same position shows the next one; clamp at the end. */
export function indexAfterRemoval(index: number, newLength: number): number {
  return Math.max(0, Math.min(index, newLength - 1))
}
