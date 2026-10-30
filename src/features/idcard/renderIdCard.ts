// The ID card drawn on a canvas (for "Download" and "Share"): the same design as the on-screen card, at 2x a
// 1012 x 638 base (credit-card ratio). Hand-drawn so the file looks identical on every phone; no DOM screenshots.
import { drawGuilloche, drawQr, drawWaves, ensureFonts, goldGradient, loadImage, MONO, roundRect, SANS, SERIF, canvasToPng } from '../share/canvasArt'
import { fitFontSize, initials, truncateToWidth, wrapText } from '../share/canvasText'

export const CARD_W = 1012
export const CARD_H = 638

export interface CardDrawData {
  name: string
  photo: string | null
  /** "B.E. CSE · Class of 2008" */
  line: string
  membershipNo: string
  memberSince: string
  roles: string[]
  verifyUrl: string | null
  labels: { college: string; collegeSub: string; alumniId: string; membershipNo: string; memberSince: string; noQr: string }
}

export async function drawIdCard(d: CardDrawData, scale = 2): Promise<HTMLCanvasElement> {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * scale
  canvas.height = CARD_H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.scale(scale, scale)
  const W = CARD_W
  const H = CARD_H

  // body
  roundRect(ctx, 0, 0, W, H, 44)
  ctx.save()
  ctx.clip()
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#13875f')
  bg.addColorStop(0.42, '#0a5540')
  bg.addColorStop(1, '#03170f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.1, 0, 0, W * 0.1, 0, W * 0.7)
  glow.addColorStop(0, 'rgba(111,200,165,0.45)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  drawGuilloche(ctx, W * 0.84, H * 0.28, 330, 'rgba(244,220,158,0.13)', 1)
  drawWaves(ctx, 0, H * 0.62, W, H * 0.4, 'rgba(255,255,255,0.05)', 16, 1)
  // holographic band
  const holo = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, H)
  holo.addColorStop(0.3, 'rgba(255,255,255,0)')
  holo.addColorStop(0.45, 'rgba(160,255,220,0.10)')
  holo.addColorStop(0.5, 'rgba(255,230,160,0.16)')
  holo.addColorStop(0.55, 'rgba(200,170,255,0.08)')
  holo.addColorStop(0.7, 'rgba(255,255,255,0)')
  ctx.fillStyle = holo
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  // foil frame
  ctx.lineWidth = 2
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H)
  roundRect(ctx, 16, 16, W - 32, H - 32, 32)
  ctx.globalAlpha = 0.55
  ctx.stroke()
  ctx.globalAlpha = 1

  // header
  const crest = await loadImage('/jec-logo.png')
  if (crest) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 12
    ctx.drawImage(crest, 48, 44, 86 * (crest.width / crest.height), 86)
    ctx.restore()
  }
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = goldGradient(ctx, 150, 50, 420, 40)
  ctx.font = `700 22px ${SANS}`
  ctx.fillText(truncateToWidth((s) => ctx.measureText(s).width, d.labels.college.toUpperCase(), 520), 152, 80)
  ctx.fillStyle = 'rgba(220,240,230,0.82)'
  ctx.font = `500 19px ${SANS}`
  ctx.fillText(d.labels.collegeSub, 152, 110)
  ctx.textAlign = 'right'
  ctx.fillStyle = goldGradient(ctx, 760, 50, 200, 40)
  ctx.font = `700 20px ${SANS}`
  ctx.fillText(d.labels.alumniId.toUpperCase(), W - 50, 80)

  // photo
  const px = 48
  const py = 176
  const pw = 172
  const ph = 212
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  roundRect(ctx, px - 4, py - 4, pw + 8, ph + 8, 26)
  ctx.fillStyle = goldGradient(ctx, px, py, pw, ph)
  ctx.fill()
  ctx.restore()
  const photo = await loadImage(d.photo)
  ctx.save()
  roundRect(ctx, px, py, pw, ph, 22)
  ctx.clip()
  if (photo) {
    const s = Math.max(pw / photo.width, ph / photo.height)
    ctx.drawImage(photo, px + (pw - photo.width * s) / 2, py + (ph - photo.height * s) / 2, photo.width * s, photo.height * s)
  } else {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph)
    g.addColorStop(0, '#1f916a')
    g.addColorStop(1, '#062a20')
    ctx.fillStyle = g
    ctx.fillRect(px, py, pw, ph)
    ctx.fillStyle = '#f4dc9e'
    ctx.textAlign = 'center'
    ctx.font = `600 72px ${SERIF}`
    ctx.fillText(initials(d.name), px + pw / 2, py + ph / 2 + 26)
  }
  ctx.restore()

  // name + line
  const tx = 252
  const maxW = 740 - tx
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ffffff'
  const size = fitFontSize((sz) => {
    ctx.font = `600 ${sz}px ${SERIF}`
    return (s) => ctx.measureText(s).width
  }, d.name, maxW, 54, 34, 2)
  ctx.font = `600 ${size}px ${SERIF}`
  const nameLines = wrapText((s) => ctx.measureText(s).width, d.name, maxW, 2)
  let y = 222
  for (const l of nameLines) {
    ctx.fillText(l, tx, y)
    y += size * 1.08
  }
  ctx.fillStyle = 'rgba(220,240,230,0.92)'
  ctx.font = `500 24px ${SANS}`
  y += 6
  for (const l of wrapText((s) => ctx.measureText(s).width, d.line, maxW, 2)) {
    ctx.fillText(l, tx, y)
    y += 32
  }
  // role chips
  let cx = tx
  y += 6
  ctx.font = `700 17px ${SANS}`
  for (const r of d.roles.slice(0, 3)) {
    const w = ctx.measureText(r.toUpperCase()).width + 28
    if (cx + w > 740) break
    roundRect(ctx, cx, y, w, 34, 17)
    ctx.fillStyle = 'rgba(244,220,158,0.16)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(244,220,158,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#f4dc9e'
    ctx.fillText(r.toUpperCase(), cx + 14, y + 23)
    cx += w + 10
  }

  // footer
  ctx.fillStyle = 'rgba(244,220,158,0.85)'
  ctx.font = `700 16px ${SANS}`
  ctx.fillText(d.labels.membershipNo.toUpperCase(), 48, 482)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 36px ${MONO}`
  ctx.fillText(d.membershipNo, 48, 528)
  ctx.fillStyle = 'rgba(244,220,158,0.85)'
  ctx.font = `700 16px ${SANS}`
  ctx.fillText(d.labels.memberSince.toUpperCase(), 48, 568)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(d.memberSince, 48, 598)

  const qs = 196
  const qx = W - 48 - qs
  const qy = H - 48 - qs
  if (d.verifyUrl) drawQr(ctx, d.verifyUrl, qx, qy, qs, { radius: 18 })
  else {
    roundRect(ctx, qx, qy, qs, qs, 18)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.textAlign = 'center'
    ctx.font = `600 20px ${SANS}`
    wrapText((s) => ctx.measureText(s).width, d.labels.noQr, qs - 30, 3).forEach((l, i) => ctx.fillText(l, qx + qs / 2, qy + qs / 2 - 10 + i * 26))
  }
  return canvas
}

export async function idCardPng(d: CardDrawData): Promise<Blob> {
  return canvasToPng(await drawIdCard(d))
}
