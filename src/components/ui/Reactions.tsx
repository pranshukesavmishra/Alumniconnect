import { HandHeart, Handshake, Heart, Laugh, Lightbulb, PartyPopper, Smile, Sparkles, ThumbsUp, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

/*
 * The professional reaction set (LinkedIn / Slack style): eight reactions drawn as white glyphs on brand-gradient
 * badges. Storage stays backward compatible — each reaction is still saved as its canonical emoji string (written here
 * as code-point escapes so no emoji appears in the UI source), and any older stored emoji maps to the closest key.
 */
export type ReactionKey = 'like' | 'love' | 'celebrate' | 'support' | 'insightful' | 'funny' | 'thanks' | 'wow'

interface ReactionDef {
  key: ReactionKey
  label: string
  /** the value stored in message_reactions.emoji */
  stored: string
  icon: LucideIcon
  gradient: string
  filled?: boolean
}

export const REACTIONS: readonly ReactionDef[] = [
  { key: 'like', label: 'Like', stored: '\u{1F44D}', icon: ThumbsUp, gradient: 'linear-gradient(140deg,#3fbf8e,#0b6b4f)', filled: true },
  { key: 'love', label: 'Love', stored: '\u{2764}\u{FE0F}', icon: Heart, gradient: 'linear-gradient(140deg,#f0727f,#a12c3a)', filled: true },
  { key: 'celebrate', label: 'Celebrate', stored: '\u{1F389}', icon: PartyPopper, gradient: 'linear-gradient(140deg,#f6cf6e,#c98a2e)' },
  { key: 'support', label: 'Support', stored: '\u{1F44F}', icon: HandHeart, gradient: 'linear-gradient(140deg,#b18ad4,#5b3479)' },
  { key: 'insightful', label: 'Insightful', stored: '\u{1F4A1}', icon: Lightbulb, gradient: 'linear-gradient(140deg,#4fd1c5,#12635e)' },
  { key: 'funny', label: 'Funny', stored: '\u{1F602}', icon: Laugh, gradient: 'linear-gradient(140deg,#ffc35c,#e0742e)' },
  { key: 'thanks', label: 'Thanks', stored: '\u{1F64F}', icon: Handshake, gradient: 'linear-gradient(140deg,#7c9be0,#2e3b72)' },
  { key: 'wow', label: 'Wow', stored: '\u{1F62E}', icon: Sparkles, gradient: 'linear-gradient(140deg,#6fc8f0,#1d5f86)' },
]

const BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r])) as Record<ReactionKey, ReactionDef>
/** Shown in the quick row; the rest sit behind "More reactions". */
export const QUICK_REACTION_KEYS: ReactionKey[] = ['like', 'love', 'celebrate', 'support', 'insightful', 'funny']

// Older stored values (the previous emoji picker) → closest reaction. Keys are code-point escapes on purpose.
const LEGACY: Record<string, ReactionKey> = {
  '\u{2764}': 'love', '\u{1F60D}': 'love', '\u{1F970}': 'love', '\u{1F49B}': 'love', '\u{1F49A}': 'love',
  '\u{1F44C}': 'like', '\u{2705}': 'like', '\u{1F4AF}': 'like', '\u{1F642}': 'like', '\u{1F60A}': 'like', '\u{1F60E}': 'like', '\u{1F607}': 'like',
  '\u{1F525}': 'celebrate', '\u{1F973}': 'celebrate', '\u{1F382}': 'celebrate', '\u{1F31F}': 'celebrate',
  '\u{1F64C}': 'support', '\u{1F4AA}': 'support', '\u{1F622}': 'support',
  '\u{1F914}': 'insightful',
  '\u{1F923}': 'funny', '\u{1F605}': 'funny',
  '\u{1F91D}': 'thanks',
}

/** Maps any stored value to a reaction key, or null for values we do not know (shown as a neutral reaction). */
export function reactionKeyOf(stored: string | null | undefined): ReactionKey | null {
  if (!stored) return null
  const hit = REACTIONS.find((r) => r.stored === stored)
  if (hit) return hit.key
  return LEGACY[stored] ?? LEGACY[stored.replace(/\u{FE0F}/gu, '')] ?? null
}

export function reactionDef(key: ReactionKey): ReactionDef {
  return BY_KEY[key]
}

/** Human label for a stored value ("Like", or "Reaction" for unknown ones). */
export function reactionLabel(stored: string | null | undefined): string {
  const k = reactionKeyOf(stored)
  return k ? BY_KEY[k].label : 'Reaction'
}

/** The badge for a reaction: white glyph on its gradient, inner highlight. Decorative (name it on the button). */
export function ReactionIcon({ reaction, size = 24, className }: { reaction: ReactionKey | string | null; size?: number; className?: string }) {
  const key = reaction && reaction in BY_KEY ? (reaction as ReactionKey) : reactionKeyOf(reaction)
  const def = key ? BY_KEY[key] : null
  const Icon = def?.icon ?? Smile
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.2)] ring-1 ring-black/5', className)}
      style={{ width: size, height: size, backgroundImage: def?.gradient ?? 'linear-gradient(140deg,#a8a294,#6b685b)' }}
    >
      <Icon style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={2.2} fill={def?.filled ? 'currentColor' : 'none'} />
    </span>
  )
}
