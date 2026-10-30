// Pure text-layout helpers for the canvas renderers (share cards, the ID card PNG). No DOM: the caller passes a measure
// function (usually `(s) => ctx.measureText(s).width`), so these are unit-tested without a canvas.

export type Measure = (text: string) => number

const ELLIPSIS = '…'

/** Cuts a single line to fit maxWidth, adding an ellipsis when it had to be shortened. */
export function truncateToWidth(measure: Measure, text: string, maxWidth: number): string {
  const t = text.trim()
  if (measure(t) <= maxWidth) return t
  const chars = Array.from(t)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? ELLIPSIS : chars.slice(0, lo).join('').trimEnd() + ELLIPSIS
}

/**
 * Greedy word wrap. Explicit newlines start a new line. A single word wider than the line is broken by characters.
 * With maxLines, the last line ends in an ellipsis when text was left over.
 */
export function wrapText(measure: Measure, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const lines: string[] = []
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n')
  let overflow = false
  outer: for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      if (lines.length >= maxLines) {
        overflow = true
        break
      }
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) {
        if (lines.length >= maxLines) {
          overflow = true
          break outer
        }
        lines.push(line)
        line = ''
      }
      // the word alone may still be too wide: break it by characters
      if (measure(word) <= maxWidth) {
        line = word
        continue
      }
      let piece = ''
      for (const ch of Array.from(word)) {
        if (measure(piece + ch) <= maxWidth || !piece) piece += ch
        else {
          if (lines.length >= maxLines) {
            overflow = true
            break outer
          }
          lines.push(piece)
          piece = ch
        }
      }
      line = piece
    }
    if (line) {
      if (lines.length >= maxLines) {
        overflow = true
        break
      }
      lines.push(line)
    }
  }
  // trailing empty lines carry nothing
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (overflow && lines.length) {
    const last = lines.length - 1
    const chars = Array.from(lines[last]!)
    while (chars.length && measure(chars.join('').trimEnd() + ELLIPSIS) > maxWidth) chars.pop()
    lines[last] = chars.join('').trimEnd() + ELLIPSIS
  }
  return lines
}

/**
 * The largest font size (from `start` down to `min`, step 1) at which the text wraps into at most maxLines lines.
 * measureAt(size) returns a Measure for that font size.
 */
export function fitFontSize(measureAt: (size: number) => Measure, text: string, maxWidth: number, start: number, min: number, maxLines = 1): number {
  for (let size = start; size > min; size--) {
    const lines = wrapText(measureAt(size), text, maxWidth, maxLines + 1)
    if (lines.length <= maxLines) return size
  }
  return min
}

/** Initials for a photo placeholder: "Rakesh Kumar Sharma" -> "RS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const first = Array.from(parts[0]!)[0] ?? ''
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : ''
  return (first + last).toUpperCase()
}
