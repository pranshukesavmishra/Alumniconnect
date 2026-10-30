// "I'm attending" story card (1080 × 1920), drawn on a canvas in the browser: aurora, crest, the member's name and
// batch, the dates, and a QR code to the Meet page. Shared as a file where the phone supports it, else downloaded.
import { qrDataUrl } from '../../components/ui/QrCode'

export const CARD_W = 1080
export const CARD_H = 1920

export type Measure = (text: string, font: string) => number

/**
 * Greedy word wrap: as many words per line as fit `maxWidth`, at most `maxLines` lines; the last kept line ends in an
 * ellipsis when text was cut. A single word wider than the line is broken by characters (long names, no spaces).
 */
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  const push = (line: string) => lines.push(line)
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (measure(next, font) <= maxWidth) {
      cur = next
      continue
    }
    if (cur) push(cur)
    if (measure(w, font) <= maxWidth) {
      cur = w
      continue
    }
    // break an over-long word
    let part = ''
    for (const ch of w) {
      if (measure(part + ch, font) > maxWidth && part) {
        push(part)
        part = ch
      } else part += ch
    }
    cur = part
  }
  if (cur) push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]!
  while (last.length > 1 && measure(`${last}…`, font) > maxWidth) last = last.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}

export interface ShareCardText {
  name: string
  batch: string | null
  line: string // "I'm attending"
  title: string // "JEC Alumni Meet 2026"
  dates: string // "26–27 Dec 2026"
  scan: string
  footer: string
  url: string
}

export interface CardLayout {
  nameLines: string[]
  titleLines: string[]
  nameSize: number
}

export const FONT_SERIF = '"Fraunces Variable", "Fraunces", Georgia, serif'
export const FONT_SANS = '"Inter Variable", "Inter", "Noto Sans Devanagari", system-ui, sans-serif'

/** Text layout for the card: the name steps down a size when long so it stays within two lines. */
export function layoutCard(t: ShareCardText, measure: Measure): CardLayout {
  const maxW = CARD_W - 2 * 96
  let nameSize = 112
  let nameLines = wrapText(t.name, maxW, `600 ${nameSize}px ${FONT_SERIF}`, measure, 2)
  while (nameSize > 72 && (nameLines.length > 2 || nameLines.some((l) => l.endsWith('…')))) {
    nameSize -= 8
    nameLines = wrapText(t.name, maxW, `600 ${nameSize}px ${FONT_SERIF}`, measure, 2)
  }
  const titleLines = wrapText(t.title, maxW, `600 92px ${FONT_SERIF}`, measure, 3)
  return { nameLines, titleLines, nameSize }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, CARD_W, CARD_H)
}

/** Draws the card and returns a PNG blob. */
export async function renderShareCard(t: ShareCardText): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined)

  // aurora background
  const bg = ctx.createLinearGradient(0, 0, CARD_W * 0.4, CARD_H)
  bg.addColorStop(0, '#0b4a37')
  bg.addColorStop(0.55, '#062a20')
  bg.addColorStop(1, '#03140f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  glow(ctx, 140, 220, 760, 'rgba(31,145,106,0.75)')
  glow(ctx, 1000, 340, 620, 'rgba(228,173,69,0.42)')
  glow(ctx, 760, 1900, 900, 'rgba(20,120,118,0.55)')
  glow(ctx, 0, 1800, 520, 'rgba(139,30,45,0.30)')
  // dotted texture
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  for (let y = 40; y < CARD_H; y += 44) for (let x = 40; x < CARD_W; x += 44) ctx.fillRect(x, y, 3, 3)

  const measure: Measure = (s, font) => {
    ctx.font = font
    return ctx.measureText(s).width
  }
  const L = layoutCard(t, measure)
  const left = 96

  // crest + eyebrow
  const crest = await loadImage('/jec-logo.png')
  if (crest) ctx.drawImage(crest, left, 150, 150, 150 * (crest.height / crest.width))
  ctx.fillStyle = '#ecc56a'
  ctx.font = `700 34px ${FONT_SANS}`
  ctx.fillText(t.footer.toUpperCase(), left + 182, 238)

  // "I'm attending" + title
  let y = 520
  ctx.fillStyle = 'rgba(207,230,219,0.92)'
  ctx.font = `500 52px ${FONT_SANS}`
  ctx.fillText(t.line, left, y)
  y += 112
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 92px ${FONT_SERIF}`
  for (const line of L.titleLines) {
    ctx.fillText(line, left, y)
    y += 104
  }
  // dates pill (gold)
  y += 10
  ctx.font = `700 46px ${FONT_SANS}`
  const dw = ctx.measureText(t.dates).width + 72
  const gold = ctx.createLinearGradient(left, y, left + dw, y + 88)
  gold.addColorStop(0, '#f6d98c')
  gold.addColorStop(1, '#d4922a')
  ctx.fillStyle = gold
  roundRect(ctx, left, y, dw, 88, 44)
  ctx.fill()
  ctx.fillStyle = '#2b1a05'
  ctx.fillText(t.dates, left + 36, y + 60)

  // name card (glass)
  y += 200
  const cardH = 120 + L.nameLines.length * (L.nameSize + 12) + (t.batch ? 70 : 0)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  roundRect(ctx, left - 24, y, CARD_W - 2 * (left - 24), cardH, 48)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  ctx.stroke()
  let ny = y + 70 + L.nameSize * 0.8
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${L.nameSize}px ${FONT_SERIF}`
  for (const line of L.nameLines) {
    ctx.fillText(line, left + 24, ny)
    ny += L.nameSize + 12
  }
  if (t.batch) {
    ctx.fillStyle = '#ecc56a'
    ctx.font = `600 44px ${FONT_SANS}`
    ctx.fillText(t.batch, left + 24, ny + 8)
  }

  // QR in a white panel, bottom right; scan hint bottom left
  const qrSize = 300
  const qx = CARD_W - left - qrSize - 32
  const qy = CARD_H - 160 - qrSize - 32
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, qx, qy, qrSize + 64, qrSize + 64, 40)
  ctx.fill()
  const qrUrl = await qrDataUrl(t.url, qrSize)
  const qr = await loadImage(qrUrl)
  if (qr) ctx.drawImage(qr, qx + 32, qy + 32, qrSize, qrSize)
  ctx.fillStyle = 'rgba(207,230,219,0.9)'
  ctx.font = `500 38px ${FONT_SANS}`
  const scanLines = wrapText(t.scan, qx - left - 40, ctx.font, measure, 3)
  let sy = qy + qrSize + 64 - (scanLines.length - 1) * 50 - 20
  for (const line of scanLines) {
    ctx.fillText(line, left, sy)
    sy += 50
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
}

/** Share the image (Web Share Level 2) or fall back to a download. Returns how it went out. */
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: 'image/png' }) : null
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (file && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}
