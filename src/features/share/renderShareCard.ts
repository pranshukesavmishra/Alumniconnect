// Story-size (1080 x 1920) share images, drawn by hand on a canvas: the brand aurora, the JEC crest, a centre piece
// (an ID card, a badge medallion or a yearbook cover) and wrapped text. Used by the ID card, badge and yearbook screens.
import { MEDAL, type MedalTone } from '../badges/medal'
import { wrapText } from './canvasText'
import { canvasToPng, drawAurora, drawCover, drawGuilloche, drawWaves, ensureFonts, goldGradient, loadImage, roundRect, SANS, SERIF } from './canvasArt'

export const STORY_W = 1080
export const STORY_H = 1920

export type ShareArt =
  | { type: 'image'; canvas: HTMLCanvasElement; tilt?: number }
  | { type: 'badge'; tone: MedalTone; icon: HTMLImageElement | null; locked?: boolean }
  | { type: 'yearbook'; year: number; cover?: string | null }

export interface ShareCardInput {
  eyebrow: string
  title: string
  subtitle?: string
  art: ShareArt
  /** small line at the bottom, e.g. the app address */
  footer: string
  /** college line under the crest */
  college: string
  collegeSub: string
}

/** Draws a glossy medallion (the canvas twin of BadgeMedallion). */
export function drawMedallion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, tone: MedalTone, icon: HTMLImageElement | null) {
  const f = MEDAL[tone]
  ctx.save()
  // glow
  const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.7)
  glow.addColorStop(0, f.glow)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4)
  // drop shadow
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = r * 0.25
  ctx.shadowOffsetY = r * 0.08
  // scalloped rim
  const teeth = 28
  ctx.beginPath()
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.94
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  f.rim.forEach((c, i) => rim.addColorStop(i / (f.rim.length - 1), c))
  ctx.fillStyle = rim
  ctx.fill()
  ctx.shadowColor = 'transparent'
  // face
  const face = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.05, cx, cy, r * 0.8)
  f.face.forEach((c, i) => face.addColorStop(i / (f.face.length - 1), c))
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2)
  ctx.fillStyle = face
  ctx.fill()
  // bevel rings
  ctx.lineWidth = r * 0.025
  ctx.strokeStyle = f.bevel
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = r * 0.012
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
  ctx.stroke()
  // icon
  if (icon) {
    const s = r * 0.72
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = r * 0.06
    ctx.shadowOffsetY = r * 0.02
    ctx.drawImage(icon, cx - s / 2, cy - s / 2, s, s)
    ctx.shadowColor = 'transparent'
  }
  // gloss
  ctx.beginPath()
  ctx.ellipse(cx, cy - r * 0.38, r * 0.56, r * 0.3, 0, 0, Math.PI * 2)
  const gloss = ctx.createLinearGradient(cx, cy - r * 0.7, cx, cy - r * 0.08)
  gloss.addColorStop(0, 'rgba(255,255,255,0.45)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fill()
  ctx.restore()
}

function drawCentred(ctx: CanvasRenderingContext2D, lines: string[], y: number, lineHeight: number) {
  lines.forEach((l, i) => ctx.fillText(l, STORY_W / 2, y + i * lineHeight))
  return y + lines.length * lineHeight
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = STORY_W
  canvas.height = STORY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  const W = STORY_W

  drawAurora(ctx, W, STORY_H)
  drawGuilloche(ctx, W * 0.85, 260, 520, 'rgba(244,220,158,0.07)', 1.4)
  drawWaves(ctx, 0, STORY_H - 420, W, 300, 'rgba(255,255,255,0.035)', 22, 1.2)

  // crest + college
  const crest = await loadImage('/jec-logo.png')
  if (crest) {
    const ch = 150
    const cw = (crest.width / crest.height) * ch
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 30
    ctx.drawImage(crest, (W - cw) / 2, 120, cw, ch)
    ctx.restore()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#f4dc9e'
  ctx.font = `700 30px ${SANS}`
  ctx.fillText(input.college.toUpperCase(), W / 2, 330)
  ctx.fillStyle = 'rgba(207,230,219,0.85)'
  ctx.font = `500 28px ${SANS}`
  ctx.fillText(input.collegeSub, W / 2, 374)

  // centre piece
  const art = input.art
  let artBottom = 1180
  if (art.type === 'image') {
    const maxW = 900
    const s = maxW / art.canvas.width
    const w = art.canvas.width * s
    const h = art.canvas.height * s
    const y = 470
    ctx.save()
    ctx.translate(W / 2, y + h / 2)
    ctx.rotate(((art.tilt ?? -4) * Math.PI) / 180)
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 80
    ctx.shadowOffsetY = 40
    ctx.drawImage(art.canvas, -w / 2, -h / 2, w, h)
    ctx.restore()
    artBottom = y + h + 120
  } else if (art.type === 'badge') {
    drawMedallion(ctx, W / 2, 780, 280, art.tone, art.icon)
    artBottom = 1140
  } else {
    const cover = await loadImage(art.cover ?? null)
    const x = 140
    const y = 470
    const w = W - 280
    const h = 640
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 70
    ctx.shadowOffsetY = 30
    roundRect(ctx, x - 14, y - 14, w + 28, h + 28, 40)
    ctx.fillStyle = goldGradient(ctx, x, y, w, h)
    ctx.fill()
    ctx.restore()
    if (cover) {
      drawCover(ctx, cover, x, y, w, h, 28)
      const shade = ctx.createLinearGradient(0, y + h * 0.35, 0, y + h)
      shade.addColorStop(0, 'rgba(3,20,15,0)')
      shade.addColorStop(1, 'rgba(3,20,15,0.85)')
      ctx.save()
      roundRect(ctx, x, y, w, h, 28)
      ctx.clip()
      ctx.fillStyle = shade
      ctx.fillRect(x, y, w, h)
      ctx.restore()
    } else {
      ctx.save()
      roundRect(ctx, x, y, w, h, 28)
      ctx.clip()
      drawAurora(ctx, W, STORY_H)
      drawGuilloche(ctx, W / 2, y + h / 2, 380, 'rgba(244,220,158,0.12)', 1.2)
      ctx.restore()
    }
    ctx.fillStyle = goldGradient(ctx, x, y + h - 300, w, 260)
    ctx.font = `600 260px ${SERIF}`
    ctx.fillText(String(art.year), W / 2, y + h - 70)
    artBottom = y + h + 120
  }

  // text block
  let y = artBottom
  ctx.fillStyle = '#ecc56a'
  ctx.font = `700 32px ${SANS}`
  ctx.fillText(input.eyebrow.toUpperCase(), W / 2, y)
  y += 96
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 84px ${SERIF}`
  const titleLines = wrapText((s) => ctx.measureText(s).width, input.title, W - 160, 3)
  y = drawCentred(ctx, titleLines, y, 96)
  if (input.subtitle) {
    y += 20
    ctx.fillStyle = 'rgba(207,230,219,0.92)'
    ctx.font = `500 40px ${SANS}`
    const sub = wrapText((s) => ctx.measureText(s).width, input.subtitle, W - 200, 3)
    drawCentred(ctx, sub, y, 54)
  }

  // footer pill
  ctx.font = `600 30px ${SANS}`
  const fw = ctx.measureText(input.footer).width + 80
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  roundRect(ctx, (W - fw) / 2, STORY_H - 170, fw, 72, 36)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(input.footer, W / 2, STORY_H - 123)

  return canvasToPng(canvas)
}
