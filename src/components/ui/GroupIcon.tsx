import { BookOpen, BriefcaseBusiness, Camera, ChartColumn, Code, Dumbbell, FileText, Footprints, Globe, GraduationCap, HeartHandshake, Landmark, Laptop, Leaf, MapPin, Megaphone, Mic, Mountain, Music, Palette, Plane, Rocket, Sparkles, Trophy, Users, Utensils, Flower2, type LucideIcon } from 'lucide-react'
import { IconTile, type TileSize, type TileTone, type TileStyle } from './IconTile'

/*
 * Groups store an `icon` text (historically an emoji, e.g. from the seed data or the "propose a circle" form).
 * The UI never shows that emoji: it maps it to a brand icon tile. New circles pick from GROUP_ICONS and still store
 * the matching emoji (as a code-point escape here) so the data stays compatible.
 */
export interface GroupIconDef {
  key: string
  label: string
  stored: string
  icon: LucideIcon
  tone: TileTone
}

export const GROUP_ICONS: readonly GroupIconDef[] = [
  { key: 'sparkles', label: 'Sparkles', stored: '\u{2728}', icon: Sparkles, tone: 'gold' },
  { key: 'people', label: 'People', stored: '\u{1F465}', icon: Users, tone: 'emerald' },
  { key: 'city', label: 'City', stored: '\u{1F4CD}', icon: MapPin, tone: 'maroon' },
  { key: 'career', label: 'Career', stored: '\u{1F4BC}', icon: BriefcaseBusiness, tone: 'ink' },
  { key: 'tech', label: 'Technology', stored: '\u{1F4BB}', icon: Laptop, tone: 'teal' },
  { key: 'startups', label: 'Startups', stored: '\u{1F680}', icon: Rocket, tone: 'plum' },
  { key: 'travel', label: 'Travel', stored: '\u{2708}\u{FE0F}', icon: Plane, tone: 'teal' },
  { key: 'outdoors', label: 'Outdoors', stored: '\u{1F97E}', icon: Mountain, tone: 'emerald' },
  { key: 'photo', label: 'Photography', stored: '\u{1F4F7}', icon: Camera, tone: 'ink' },
  { key: 'sports', label: 'Sports', stored: '\u{1F3CF}', icon: Trophy, tone: 'gold' },
  { key: 'music', label: 'Music', stored: '\u{1F3B5}', icon: Music, tone: 'plum' },
  { key: 'books', label: 'Books', stored: '\u{1F4DA}', icon: BookOpen, tone: 'maroon' },
  { key: 'world', label: 'World', stored: '\u{1F30D}', icon: Globe, tone: 'teal' },
  { key: 'running', label: 'Running', stored: '\u{1F3C3}', icon: Footprints, tone: 'emerald' },
  { key: 'wellness', label: 'Wellness', stored: '\u{1F9D8}', icon: Flower2, tone: 'plum' },
  { key: 'food', label: 'Food', stored: '\u{1F37D}\u{FE0F}', icon: Utensils, tone: 'gold' },
  { key: 'art', label: 'Art', stored: '\u{1F3A8}', icon: Palette, tone: 'maroon' },
  { key: 'code', label: 'Code', stored: '\u{1F468}\u{200D}\u{1F4BB}', icon: Code, tone: 'ink' },
  { key: 'fitness', label: 'Fitness', stored: '\u{1F4AA}', icon: Dumbbell, tone: 'teal' },
  { key: 'green', label: 'Environment', stored: '\u{1F33F}', icon: Leaf, tone: 'emerald' },
  { key: 'giving', label: 'Giving back', stored: '\u{1F91D}', icon: HeartHandshake, tone: 'maroon' },
]
/** The ones offered when proposing a circle. */
export const CIRCLE_ICON_CHOICES = GROUP_ICONS.slice(0, 16)

// seed / system icons not in the picker
const EXTRA: Record<string, { icon: LucideIcon; tone: TileTone }> = {
  '\u{1F4E3}': { icon: Megaphone, tone: 'maroon' },
  '\u{1F3DB}': { icon: Landmark, tone: 'emerald' },
  '\u{1F393}': { icon: GraduationCap, tone: 'gold' },
  '\u{1F4C4}': { icon: FileText, tone: 'ink' },
  '\u{1F3A4}': { icon: Mic, tone: 'plum' },
  '\u{1F4CA}': { icon: ChartColumn, tone: 'teal' },
}

const strip = (s: string) => s.replace(/[\u{FE0F}\u{200D}]/gu, '')

export function groupIconFor(stored: string | null | undefined, kind?: string | null): { icon: LucideIcon; tone: TileTone } {
  if (stored) {
    const s = strip(stored.trim())
    const hit = GROUP_ICONS.find((g) => strip(g.stored) === s)
    if (hit) return { icon: hit.icon, tone: hit.tone }
    if (EXTRA[s]) return EXTRA[s]
  }
  if (kind === 'channel' || kind === 'official') return { icon: Megaphone, tone: 'maroon' }
  if (kind === 'batch' || kind === 'year') return { icon: GraduationCap, tone: 'gold' }
  if (kind === 'department') return { icon: Landmark, tone: 'emerald' }
  if (kind === 'city' || kind === 'meetup') return { icon: MapPin, tone: 'teal' }
  return { icon: Users, tone: 'emerald' }
}

/** A group's icon as a brand tile (never the stored emoji). Decorative. */
export function GroupIcon({ icon, kind, size = 'lg', variant = 'soft', className }: { icon?: string | null; kind?: string | null; size?: TileSize; variant?: TileStyle; className?: string }) {
  const g = groupIconFor(icon, kind)
  return <IconTile icon={g.icon} tone={g.tone} size={size} variant={variant} className={className} />
}
