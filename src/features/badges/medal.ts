// Medallion finishes, shared by the SVG medallion (BadgeMedallion.tsx) and the canvas share card.
import type { BadgeKey, BadgeTier } from './catalog'

export type MedalTone = 'bronze' | 'silver' | 'gold' | 'emerald' | 'maroon'

export interface MedalFinish {
  /** metallic rim, light to dark to light */
  rim: string[]
  /** the enamel face, centre to edge */
  face: string[]
  /** inner bevel line */
  bevel: string
  /** icon colour */
  ink: string
  /** soft glow behind the medal */
  glow: string
  label: { en: string; hi: string }
}

export const MEDAL: Record<MedalTone, MedalFinish> = {
  bronze: {
    rim: ['#ffe0c2', '#d98e57', '#8a4a22', '#e8a777', '#5c2e12'],
    face: ['#c8794a', '#8e4a24', '#4f2410'],
    bevel: 'rgba(255,214,180,0.75)',
    ink: '#fff4ea',
    glow: 'rgba(217,142,87,0.45)',
    label: { en: 'Bronze', hi: 'कांस्य' },
  },
  silver: {
    rim: ['#ffffff', '#c9d1d9', '#7d8792', '#eef2f5', '#59626c'],
    face: ['#a9b4be', '#6f7a85', '#3c444d'],
    bevel: 'rgba(255,255,255,0.85)',
    ink: '#ffffff',
    glow: 'rgba(201,209,217,0.45)',
    label: { en: 'Silver', hi: 'रजत' },
  },
  gold: {
    rim: ['#fff6d2', '#f4dc9e', '#c98b26', '#ffe9a8', '#7a4a12'],
    face: ['#efc35e', '#c98b26', '#7a4a12'],
    bevel: 'rgba(255,244,200,0.9)',
    ink: '#fffaf0',
    glow: 'rgba(228,173,69,0.55)',
    label: { en: 'Gold', hi: 'स्वर्ण' },
  },
  emerald: {
    rim: ['#fff6d2', '#f4dc9e', '#c98b26', '#ffe9a8', '#7a4a12'],
    face: ['#3fae85', '#0b6b4f', '#062a20'],
    bevel: 'rgba(167,223,198,0.8)',
    ink: '#fff1c4',
    glow: 'rgba(63,174,133,0.55)',
    label: { en: 'Emerald', hi: 'पन्ना' },
  },
  maroon: {
    rim: ['#fff6d2', '#f4dc9e', '#c98b26', '#ffe9a8', '#7a4a12'],
    face: ['#c4525f', '#8b1e2d', '#3d0a12'],
    bevel: 'rgba(240,197,202,0.8)',
    ink: '#fff1c4',
    glow: 'rgba(185,67,79,0.5)',
    label: { en: 'Official', hi: 'आधिकारिक' },
  },
}

const OFFICIAL: ReadonlySet<string> = new Set<BadgeKey>(['organiser', 'batch_rep'])

/** Platinum badges get the emerald enamel; official roles (organiser, batch rep) the crest maroon. */
export function medalToneOf(b: { key: string; tier: BadgeTier }): MedalTone {
  if (OFFICIAL.has(b.key)) return 'maroon'
  if (b.tier === 'platinum') return 'emerald'
  return b.tier
}
