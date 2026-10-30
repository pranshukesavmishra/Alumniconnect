import {
  Award,
  BadgeCheck,
  BookOpen,
  Camera,
  ClipboardList,
  Crown,
  Flag,
  Gem,
  Gift,
  GraduationCap,
  HandHeart,
  HeartHandshake,
  Link,
  Network,
  PartyPopper,
  Star,
  type LucideIcon,
} from 'lucide-react'

// The icons the badge catalogue names (src/features/badges/catalog.ts), without pulling in all of lucide.
const ICONS: Record<string, LucideIcon> = {
  BadgeCheck,
  BookOpen,
  Camera,
  ClipboardList,
  Crown,
  Flag,
  Gem,
  Gift,
  GraduationCap,
  HandHeart,
  HeartHandshake,
  Link,
  Network,
  PartyPopper,
  Star,
}

export const badgeIcon = (name: string): LucideIcon => ICONS[name] ?? Award
