// Canvas drawing primitives shared by the share-card renderer and the ID card PNG: the brand aurora, guilloche lines,
// a crisp QR code, images and fonts. Everything is drawn by hand (no DOM screenshots), so the output is the same on
// every phone.
import QRCode from 'qrcode'

export const SERIF = '"Fraunces Variable", "Noto Sans Devanagari", Georgia, serif'
export const SANS = '"Inter Variable", "Noto Sans Devanagari", system-ui, sans-serif'
export const MONO = 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace'

export const GOLD = ['#fff1c4', '#f4dc9e', '#e4ad45', '#b5741c', '#f4dc9e'] as const

/** Waits (briefly) for the brand fonts so the canvas does not fall back to a system face. */
export async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const wanted = [`600 64px ${SERIF}`, `600 32px ${SANS}`, `500 32px ${SANS}`, `700 32px ${SANS}`]
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => undefined))), new Promise((r) => setTimeout(r, 1500))])
}

export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const t = setTimeout(() => resolve(null), 6000)
    img.onload = () => {
      clearTimeout(t)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(t)
      resolve(null)
    }
    img.src = src
  })
}

/** An inline SVG element (e.g. a lucide icon in the page) as an image, with currentColor replaced. */
export function svgElementToImage(svg: SVGElement | null | undefined, color = '#ffffff'): Promise<HTMLImageElement | null> {
  if (!svg || typeof XMLSerializer === 'undefined') return Promise.resolve(null)
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '96')
  clone.setAttribute('height', '96')
  const text = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color)
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`)
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Gold foil gradient across a box. */
export function goldGradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w, y + h)
  GOLD.forEach((c, i) => g.addColorStop(i / (GOLD.length - 1), c))
  return g
}

/** The brand aurora: deep forest base with emerald, teal, gold and a whisper of maroon glow. */
export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const base = ctx.createLinearGradient(0, 0, w * 0.4, h)
  base.addColorStop(0, '#0b4a37')
  base.addColorStop(0.55, '#062a20')
  base.addColorStop(1, '#03140f')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  glow(w * 0.12, h * 0.08, w * 0.85, 'rgba(31,145,106,0.70)')
  glow(w * 0.95, h * 0.14, w * 0.6, 'rgba(228,173,69,0.38)')
  glow(w * 0.7, h * 1.02, w * 0.9, 'rgba(20,120,118,0.55)')
  glow(0, h, w * 0.5, 'rgba(139,30,45,0.30)')
}

/** Fine guilloche rosette lines (banknote-style security pattern). */
export function drawGuilloche(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, lineWidth = 1) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  for (let k = 0; k < 14; k++) {
    const r = radius * (0.35 + k * 0.05)
    ctx.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 180) {
      const rr = r + Math.sin(a * 12 + k * 0.5) * radius * 0.04 + Math.cos(a * 5) * radius * 0.02
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr
      if (a === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** Wavy horizontal security lines across a box. */
export function drawWaves(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, count = 18, lineWidth = 1) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  for (let i = 0; i < count; i++) {
    const oy = y + (h / count) * i
    ctx.beginPath()
    for (let px = 0; px <= w; px += 4) {
      const py = oy + Math.sin(px / (w / 7) + i * 0.45) * (h / count) * 1.6
      if (px === 0) ctx.moveTo(x + px, py)
      else ctx.lineTo(x + px, py)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** A QR code drawn module by module (crisp at any size) on a white rounded tile. */
export function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, opts: { pad?: number; radius?: number; dark?: string } = {}) {
  const pad = opts.pad ?? size * 0.06
  ctx.save()
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, opts.radius ?? size * 0.08)
  ctx.fill()
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const cell = (size - pad * 2) / n
  ctx.fillStyle = opts.dark ?? '#062a20'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell))
    }
  }
  ctx.restore()
}

/** An image cropped to cover a box (like object-fit: cover), clipped to a rounded rectangle. */
export function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, radius = 0) {
  const s = Math.max(w / img.width, h / img.height)
  const iw = img.width * s
  const ih = img.height * s
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
  ctx.restore()
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png'))
}

/**
 * Shares an image through the phone's share sheet when it can take files; otherwise downloads it.
 * Resolves to what happened ('shared' | 'downloaded' | 'cancelled').
 */
export async function shareOrDownload(blob: Blob, filename: string, text?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
