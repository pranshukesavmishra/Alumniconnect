// Composes the how-to-use guide video (1080x1920, 30 fps): node scripts/guide/build.mjs en|hi   (GUIDE=<scratch dir>)
// Layers (brand bar, phone frame, subtitles, end card) are drawn by headless Chromium (Inter + Noto Sans Devanagari); the recorded
// screens are scaled into the phone frame and assembled with ffmpeg (crossfades + the TTS voice). Subtitles are timed from the real TTS durations.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LANG = process.argv[2] ?? 'en'
const G = process.env.GUIDE
const ROOT = new URL('../../', import.meta.url).pathname
const L = `${G}/layers/${LANG}`
const OUT = `${G}/out`
mkdirSync(L, { recursive: true })
mkdirSync(OUT, { recursive: true })
const lines = JSON.parse(readFileSync(`${G}/audio/${LANG}/lines.json`, 'utf8'))
const hi = LANG === 'hi'
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 28 })
const R = (n) => Math.round(n * 1000) / 1000

const COPY = {
  en: {
    title: 'How to use JEC Alumni Connect',
    steps: ['Sign in', 'Your profile', 'Register and pay', 'Your entry pass', 'Find batchmates', 'Share photos and videos', 'Stories and Home', 'Add to Home screen'],
    end: ['JEC Alumni Connect', 'Your batch, your college, one app.', 'alumniconnect-a6o.pages.dev'],
  },
  hi: {
    title: 'JEC Alumni Connect कैसे इस्तेमाल करें',
    steps: ['साइन इन', 'आपकी प्रोफ़ाइल', 'रजिस्टर और भुगतान', 'आपका एंट्री पास', 'बैचमेट खोजें', 'फ़ोटो और वीडियो', 'स्टोरी और होम', 'होम स्क्रीन पर जोड़ें'],
    end: ['JEC Alumni Connect', 'आपका बैच, आपका कॉलेज, एक ऐप।', 'alumniconnect-a6o.pages.dev'],
  },
}[LANG]

// ------------------------------------------------------------------ timeline
const GAP = 0.3, X = 0.4, LEAD = 0.5, TAIL = 1.9
const PAD = { 1: 0.5, 2: 0.6, 3: 0.2, 4: 0.1, 5: 0.2, 6: 0.1, 7: 0.1, 8: 0.1 }
const d = Object.fromEntries(lines.map((l) => [l.i, l.dur]))
const A = { 1: LEAD }
for (let i = 2; i <= 9; i++) A[i] = A[i - 1] + d[i - 1] + GAP + PAD[i - 1]
const S = { 1: 0 }
for (let i = 2; i <= 9; i++) S[i] = A[i] - X
const END = A[9] + d[9] + TAIL
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())
const SEGS = []
for (let i = 1; i <= 9; i++) SEGS.push({ i, start: S[i], len: (i < 9 ? S[i + 1] : END) - S[i] + (i < 9 ? X : 0) })
SEGS.forEach((s) => (s.len = R(s.len)))

// ------------------------------------------------------------------ layers
const FI = (w) => pathToFileURL(`${G}/fonts/node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`).href
const FD = (w) => pathToFileURL(`${ROOT}node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-${w}-normal.woff2`).href
const CSS = `
@font-face{font-family:'Inter';src:url(${FI(600)});font-weight:600}
@font-face{font-family:'Inter';src:url(${FI(700)});font-weight:700}
@font-face{font-family:'Inter';src:url(${FI(800)});font-weight:800}
@font-face{font-family:'NotoDeva';src:url(${FD(600)});font-weight:600}
@font-face{font-family:'NotoDeva';src:url(${FD(700)});font-weight:700}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{width:1080px;height:1920px;position:relative;overflow:hidden;font-family:'Inter','NotoDeva',sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:radial-gradient(900px 700px at 100% 100%,rgba(232,163,61,.28),transparent 62%),radial-gradient(1000px 800px at 0% 0%,rgba(46,170,125,.30),transparent 60%),linear-gradient(160deg,#031511,#08382a 55%,#0b4a37)}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.05) 1.6px,transparent 1.7px);background-size:36px 36px}
`
const PH = { x: 181, y: 150, w: 718, h: 1400 }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const crest = pathToFileURL(ROOT + 'public/jec-logo.png').href
const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`
let page
async function shot(name, body, transparent = false) {
  const f = `${L}/${name}.html`
  writeFileSync(f, html(body))
  await page.goto(pathToFileURL(f).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${L}/${name}.png`, omitBackground: transparent })
  return `${L}/${name}.png`
}
const topBar = (n) => `<div style="position:absolute;left:44px;right:44px;top:30px;height:96px;display:flex;align-items:center;gap:20px">
  <img src="${crest}" style="height:76px;width:auto"><div style="flex:1;font-size:${hi ? 36 : 38}px;font-weight:700;line-height:1.15">${esc(COPY.title)}</div>
  <div style="flex:none;background:#e8a33d;color:#2a1a02;font-weight:800;font-size:38px;border-radius:50px;padding:10px 26px">${n}/8</div></div>`
const stepLabel = (n) => `<div style="position:absolute;left:0;right:0;top:1578px;text-align:center;font-size:${hi ? 34 : 32}px;font-weight:700;letter-spacing:${hi ? 0 : '.14em'};text-transform:uppercase;color:#f0b24f">${esc(COPY.steps[n - 1])}</div>`

async function renderLayers() {
  const out = { top: {}, sub: [], end: null }
  for (let n = 1; n <= 8; n++) out.top[n] = await shot(`bg_${n}`, `<div class="bg"></div><div class="dots"></div>${topBar(n)}${stepLabel(n)}
    <div style="position:absolute;left:${PH.x - 14}px;top:${PH.y - 14}px;width:${PH.w + 28}px;height:${PH.h + 28}px;border-radius:58px;background:#0b1210;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.18)"></div>`)
  const e = COPY.end
  out.end = await shot('end', `<div class="bg"></div><div class="dots"></div>
    <div style="position:absolute;left:0;right:0;top:300px;display:flex;justify-content:center"><div style="width:340px;height:340px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 24px 70px rgba(0,0,0,.45),0 0 0 14px rgba(232,163,61,.35)"><img src="${pathToFileURL(ROOT + 'public/jec-logo.png').href}" style="height:270px;width:auto"></div></div>
    <div style="position:absolute;left:40px;right:40px;top:740px;text-align:center;font-size:96px;font-weight:800;letter-spacing:-.02em;line-height:1.05">${esc(e[0])}</div>
    <div style="position:absolute;left:60px;right:60px;top:900px;text-align:center;font-size:${hi ? 56 : 58}px;font-weight:600;color:#cfe6db;line-height:1.25">${esc(e[1])}</div>
    <div style="position:absolute;left:0;right:0;top:1090px;display:flex;justify-content:center"><div style="font-size:46px;font-weight:700;background:#e8a33d;color:#2a1a02;border-radius:60px;padding:22px 48px">${esc(e[2])}</div></div>`)
  return out
}

// ------------------------------------------------------------------ subtitles
function wrap(text, max) {
  const words = text.split(/\s+/), ls = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { ls.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) ls.push(cur)
  return ls
}
function chunkText(text, max = hi ? 26 : 29) {
  const sentences = text.match(/[^.!?।]+[.!?।]+["”]?(\s|$)|[^.!?।]+$/g)?.map((s) => s.trim()) ?? [text]
  const chunks = []
  let cur = ''
  for (const s of sentences) {
    const cand = (cur + ' ' + s).trim()
    if (cur && wrap(cand, max).length > 3) { chunks.push(cur); cur = s } else cur = cand
  }
  if (cur) chunks.push(cur)
  const fixed = []
  for (const c of chunks) {
    if (wrap(c, max).length <= 3) { fixed.push(c); continue }
    const w = c.split(/\s+/)
    const mid = Math.ceil(w.length / 2)
    fixed.push(w.slice(0, mid).join(' '), w.slice(mid).join(' '))
  }
  return fixed.map((c) => ({ text: c, lines: wrap(c, max) }))
}
const cues = []
for (const l of lines) {
  const ch = chunkText(l.text)
  const total = ch.reduce((a, c) => a + c.text.length, 0)
  let t = A[l.i]
  ch.forEach((c, k) => {
    const dd = (c.text.length / total) * l.dur
    cues.push({ start: t, end: k === ch.length - 1 ? A[l.i] + l.dur + 0.12 : t + dd, lines: c.lines, line: l.i })
    t += dd
  })
}
const tc = (s, sep) => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}` }
const srt = cues.map((c, i) => `${i + 1}\n${tc(c.start, ',')} --> ${tc(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n')
const vtt = 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${tc(c.start, '.')} --> ${tc(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n')
const slug = `guide-${LANG}`
writeFileSync(`${OUT}/${slug}.srt`, srt)
writeFileSync(`${OUT}/${slug}.vtt`, vtt)
writeFileSync(`${OUT}/${slug}-narration.txt`, `JEC Alumni Connect: how to use (${hi ? 'Hindi' : 'English'})\n\n` + lines.map((l) => `${l.i}. ${l.text}`).join('\n') + '\n')
// chapters for the app: the 8 steps, from the first spoken word of each step to the start of the next
const chapters = SEGS.filter((s) => s.i <= 8).map((s) => ({ step: s.i, title: COPY.steps[s.i - 1], start: R(Math.max(0, S[s.i] + (s.i > 1 ? X : 0))), end: R(s.i < 8 ? S[s.i + 1] + X : S[9] + X) }))
writeFileSync(`${OUT}/${slug}-chapters.json`, JSON.stringify({ lang: LANG, duration: R(END), chapters }, null, 1))

async function renderSubs() {
  const files = []
  for (let i = 0; i < cues.length; i++) {
    files.push(await shot(`sub_${i}`, `<div style="position:absolute;left:40px;right:40px;top:1640px;height:250px;display:flex;align-items:center;justify-content:center"><div style="background:rgba(3,14,11,.82);border:2px solid rgba(255,255,255,.14);border-radius:34px;padding:18px 36px 22px;font-size:${hi ? 52 : 56}px;line-height:1.28;font-weight:700;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.4)">${cues[i].lines.map(esc).join('<br>')}</div></div>`, true))
  }
  return files
}

// ------------------------------------------------------------------ segments
function holeLayer(topPng, out) {
  execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.open("${topPng}").convert("RGBA")
m = Image.new("L", im.size, 255)
d = ImageDraw.Draw(m)
d.rounded_rectangle([${PH.x}, ${PH.y}, ${PH.x + PH.w - 1}, ${PH.y + PH.h - 1}], radius=44, fill=0)
im.putalpha(m)
im.save("${out}")
`])
  return out
}
const warn = []
function buildSeg(seg, lay) {
  const out = `${L}/seg_${seg.i}.mp4`
  const len = seg.len
  if (seg.i === 9) {
    ff(['-loop', '1', '-framerate', '30', '-t', String(len), '-i', lay.end, '-vf', 'format=yuv420p', '-r', '30', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', out])
    return out
  }
  const clip = `${G}/rec/s${seg.i}.mp4`
  const nat = dur(clip)
  const f = Math.min(Math.max(nat / len, 0.85), 2.0)
  if (nat / len > 2.0) warn.push(`s${seg.i}: clip ${R(nat)}s into ${len}s needs ${R(nat / len)}x (capped, tail cut)`)
  const hole = holeLayer(lay.top[seg.i], `${L}/hole_${seg.i}.png`)
  const filt = `[1:v]setpts=PTS/${R(f)},fps=30,scale=${PH.w}:${PH.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len},trim=duration=${len},setpts=PTS-STARTPTS[c];[0:v][c]overlay=${PH.x}:${PH.y}[a];[a][2:v]overlay=0:0,format=yuv420p[vout]`
  ff(['-loop', '1', '-framerate', '30', '-t', String(len), '-i', lay.top[seg.i], '-i', clip, '-loop', '1', '-framerate', '30', '-t', String(len), '-i', hole, '-filter_complex', filt, '-map', '[vout]', '-t', String(len), '-r', '30', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', out])
  console.log(`seg ${seg.i} start ${R(seg.start)} len ${len} clip ${R(nat)} speed ${R(f)}x`)
  return out
}

page = await (async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' })
  globalThis.__b = b
  return (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage()
})()
const lay = await renderLayers()
const subFiles = await renderSubs()
await globalThis.__b.close()
const segFiles = SEGS.map((s) => buildSeg(s, lay))
if (warn.length) console.log('WARN', warn.join('; '))

// crossfade chain
{
  const filt = []
  let cur = '[0:v]'
  SEGS.slice(1).forEach((s, k) => { filt.push(`${cur}[${k + 1}:v]xfade=transition=fade:duration=${X}:offset=${R(s.start)}[x${k}]`); cur = `[x${k}]` })
  ff([...segFiles.flatMap((f) => ['-i', f]), '-filter_complex', filt.join(';'), '-map', cur, '-r', '30', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', `${L}/chain.mp4`])
}

// voice
{
  const inputs = lines.flatMap((l) => ['-i', `${G}/audio/${LANG}/line${l.i}.wav`])
  const filt = lines.map((l, k) => `[${k}:a]aresample=44100,pan=mono|c0=c0,adelay=${Math.round(A[l.i] * 1000)}[v${k}]`)
  filt.push(`${lines.map((_, k) => `[v${k}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${R(END)},atrim=0:${R(END)},afade=t=out:st=${R(END - 0.8)}:d=0.8,loudnorm=I=-16:TP=-1.5:LRA=9[aout]`)
  ff([...inputs, '-filter_complex', filt.join(';'), '-map', '[aout]', '-ar', '44100', '-c:a', 'pcm_s16le', `${L}/audio.wav`])
}

// final: subtitles + progress bar + audio
{
  const inputs = ['-i', `${L}/chain.mp4`, '-i', `${L}/audio.wav`]
  const filt = []
  let cur = '[0:v]', n = 2
  subFiles.forEach((f, i) => {
    inputs.push('-i', f)
    filt.push(`${cur}[${n}:v]overlay=0:0:enable='between(t,${R(cues[i].start)},${R(cues[i].end)})'[s${i}]`)
    cur = `[s${i}]`
    n++
  })
  inputs.push('-f', 'lavfi', '-i', `color=c=0xe8a33d:s=1080x8:r=30:d=${R(END)}`)
  filt.push(`${cur}[${n}:v]overlay=x='-w+w*t/${R(END)}':y=1912,format=yuv420p[vf]`)
  ff([...inputs, '-filter_complex', filt.join(';'), '-map', '[vf]', '-map', '1:a', '-t', String(R(END)), '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ac', '1', '-movflags', '+faststart', `${OUT}/guide-${LANG}-1080x1920.mp4`])
  // the lighter file for the app (720x1280, CRF 26, mono 96k)
  ff(['-i', `${OUT}/guide-${LANG}-1080x1920.mp4`, '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-movflags', '+faststart', `${OUT}/guide-${LANG}-720x1280.mp4`])
}
console.log('done', LANG, 'duration', R(END))
console.log(JSON.stringify({ A, S, END }))
