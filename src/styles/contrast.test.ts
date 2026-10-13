import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REACTIONS, reactionKeyOf, reactionLabel } from '../components/ui/Reactions'
import { groupIconFor } from '../components/ui/GroupIcon'

// WCAG AA for the design-token pairs the components actually use, in both themes (parsed from src/index.css).
const css = readFileSync(join(__dirname, '../index.css'), 'utf8')

function block(selectorStart: string): Record<string, string> {
  const i = css.indexOf(selectorStart)
  if (i < 0) throw new Error(`no block ${selectorStart}`)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!
  return out
}

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// [foreground, background, minimum]
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 7], ['text', 'surface', 7], ['text', 'surface-2', 7], ['text', 'elevated', 7],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['subtle', 'surface', 4.5],
  ['primary', 'bg', 4.5], ['primary', 'surface', 4.5], ['primary', 'primary-soft', 4.5],
  ['on-primary', 'primary', 4.5], ['on-accent', 'accent', 4.5],
  ['gold-ink', 'surface', 4.5], ['gold-ink', 'bg', 4.5], ['gold-ink', 'accent-soft', 4.5],
  ['official', 'surface', 4.5], ['official', 'official-soft', 4.5], ['on-official', 'official', 4.5],
  ['success', 'success-soft', 4.5], ['on-success', 'success', 4.5],
  ['danger', 'danger-soft', 4.5], ['danger', 'surface', 4.5], ['on-danger', 'danger', 4.5],
  ['warning', 'warning-soft', 4.5], ['warning', 'accent-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['hero-text', 'hero', 7], ['hero-text', 'hero-2', 4.5],
]

describe.each([
  ['light', block(':root, [data-theme="light"]')],
  ['dark', block(':root[data-theme="dark"], [data-theme="dark"]')],
])('%s theme tokens', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
    expect(t[fg], `--${fg}`).toBeDefined()
    expect(t[bg], `--${bg}`).toBeDefined()
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min)
  })
})

describe('system dark block mirrors the explicit dark theme', () => {
  it('has the same values', () => {
    const explicit = block(':root[data-theme="dark"], [data-theme="dark"]')
    const sys = css.slice(css.indexOf(':root:not([data-theme="light"])'), css.indexOf('/* ---------- DARK (explicit'))
    for (const [k, v] of Object.entries(explicit)) {
      const m = sys.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{6})`))
      expect(m?.[1], `--${k}`).toBe(v)
    }
  })
})

describe('reactions and group icons stay backward compatible', () => {
  it('maps canonical and legacy stored values', () => {
    for (const r of REACTIONS) expect(reactionKeyOf(r.stored)).toBe(r.key)
    expect(reactionKeyOf('\u{2764}')).toBe('love') // heart without variation selector
    expect(reactionKeyOf('\u{1F60D}')).toBe('love')
    expect(reactionKeyOf('\u{1F525}')).toBe('celebrate')
    expect(reactionKeyOf('\u{2615}')).toBeNull()
    expect(reactionLabel('\u{2615}')).toBe('Reaction')
    expect(new Set(REACTIONS.map((r) => r.stored)).size).toBe(REACTIONS.length)
  })
  it('maps stored group icons, falling back by kind', () => {
    expect(groupIconFor('\u{1F4E3}').tone).toBe('maroon')
    expect(groupIconFor('\u{1F3DB}\u{FE0F}').tone).toBe('emerald')
    expect(groupIconFor('\u{2708}\u{FE0F}').tone).toBe('teal')
    expect(groupIconFor('zzz', 'batch').tone).toBe('gold')
  })
})
