// Achievement badges. The database decides who earned what (member_achievements() in
// supabase/migrations/20261020000092_achievements.sql); this file holds what the app shows for each key:
// lucide icon name, tier, English + Hindi titles and how to earn it. Keep BADGE_KEYS in the database's order.

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum'
export type BadgeKey =
  | 'verified_jecian'
  | 'founding_member'
  | 'profile_star'
  | 'connector'
  | 'super_connector'
  | 'mentor'
  | 'helper'
  | 'storyteller'
  | 'photographer'
  | 'reunion_2026'
  | 'volunteer'
  | 'donor'
  | 'patron'
  | 'organiser'
  | 'batch_rep'

export interface BadgeDef {
  key: BadgeKey
  /** a lucide-react icon name (PascalCase), e.g. 'BadgeCheck' */
  icon: string
  tier: BadgeTier
  title: { en: string; hi: string }
  /** how it is earned, shown on locked badges */
  how: { en: string; hi: string }
  /** the number to reach, when the badge has progress (connections, stories, photos, rupees for patron) */
  target?: number
  /** progress is money in paise (patron) */
  money?: boolean
}

export const BADGE_KEYS: readonly BadgeKey[] = [
  'verified_jecian', 'founding_member', 'profile_star', 'connector', 'super_connector', 'mentor', 'helper', 'storyteller',
  'photographer', 'reunion_2026', 'volunteer', 'donor', 'patron', 'organiser', 'batch_rep',
]

export const BADGES: Record<BadgeKey, BadgeDef> = {
  verified_jecian: {
    key: 'verified_jecian', icon: 'BadgeCheck', tier: 'bronze',
    title: { en: 'Verified JECian', hi: 'सत्यापित JECian' },
    how: { en: 'Get your membership verified', hi: 'अपनी सदस्यता सत्यापित करवाएँ' },
  },
  founding_member: {
    key: 'founding_member', icon: 'Crown', tier: 'platinum',
    title: { en: 'Founding Member', hi: 'संस्थापक सदस्य' },
    how: { en: 'One of the first 500 verified members', hi: 'पहले 500 सत्यापित सदस्यों में से एक' },
  },
  profile_star: {
    key: 'profile_star', icon: 'Star', tier: 'silver', target: 100,
    title: { en: 'Profile Star', hi: 'प्रोफ़ाइल स्टार' },
    how: { en: 'Complete your profile', hi: 'अपनी प्रोफ़ाइल पूरी करें' },
  },
  connector: {
    key: 'connector', icon: 'Link', tier: 'bronze', target: 10,
    title: { en: 'Connector', hi: 'कनेक्टर' },
    how: { en: 'Make 10 connections', hi: '10 कनेक्शन बनाएँ' },
  },
  super_connector: {
    key: 'super_connector', icon: 'Network', tier: 'gold', target: 50,
    title: { en: 'Super Connector', hi: 'सुपर कनेक्टर' },
    how: { en: 'Make 50 connections', hi: '50 कनेक्शन बनाएँ' },
  },
  mentor: {
    key: 'mentor', icon: 'GraduationCap', tier: 'gold', target: 1,
    title: { en: 'Mentor', hi: 'मेंटर' },
    how: { en: 'Become a mentor for juniors', hi: 'जूनियर्स के मेंटर बनें' },
  },
  helper: {
    key: 'helper', icon: 'HandHeart', tier: 'bronze', target: 1,
    title: { en: 'Helper', hi: 'मददगार' },
    how: { en: 'Offer help on Ask JEC', hi: 'Ask JEC पर मदद की पेशकश करें' },
  },
  storyteller: {
    key: 'storyteller', icon: 'BookOpen', tier: 'silver', target: 5,
    title: { en: 'Storyteller', hi: 'कहानीकार' },
    how: { en: 'Share 5 posts or stories', hi: '5 पोस्ट या स्टोरी साझा करें' },
  },
  photographer: {
    key: 'photographer', icon: 'Camera', tier: 'silver', target: 10,
    title: { en: 'Photographer', hi: 'फ़ोटोग्राफ़र' },
    how: { en: 'Get 10 event photos approved', hi: 'इवेंट की 10 फ़ोटो स्वीकृत करवाएँ' },
  },
  reunion_2026: {
    key: 'reunion_2026', icon: 'PartyPopper', tier: 'gold',
    title: { en: 'Reunion 2026', hi: 'रीयूनियन 2026' },
    how: { en: 'Confirm your place at the Grand Reunion 2026', hi: 'ग्रैंड रीयूनियन 2026 में अपनी जगह पक्की करें' },
  },
  volunteer: {
    key: 'volunteer', icon: 'HeartHandshake', tier: 'silver',
    title: { en: 'Volunteer', hi: 'स्वयंसेवक' },
    how: { en: 'Join an organising team or the event desk', hi: 'आयोजन टीम या इवेंट डेस्क से जुड़ें' },
  },
  donor: {
    key: 'donor', icon: 'Gift', tier: 'silver', target: 1,
    title: { en: 'Donor', hi: 'दानदाता' },
    how: { en: 'Make a verified gift to a JEC fund', hi: 'JEC फ़ंड में सत्यापित योगदान दें' },
  },
  patron: {
    key: 'patron', icon: 'Gem', tier: 'platinum', target: 1_000_000, money: true,
    title: { en: 'Patron', hi: 'संरक्षक' },
    how: { en: 'Give ₹10,000 or more in all', hi: 'कुल ₹10,000 या अधिक का योगदान दें' },
  },
  organiser: {
    key: 'organiser', icon: 'ClipboardList', tier: 'gold',
    title: { en: 'Organiser', hi: 'आयोजक' },
    how: { en: 'Serve on the association or an event team', hi: 'एसोसिएशन या किसी इवेंट टीम में सेवा दें' },
  },
  batch_rep: {
    key: 'batch_rep', icon: 'Flag', tier: 'gold',
    title: { en: 'Batch Representative', hi: 'बैच प्रतिनिधि' },
    how: { en: 'Represent your batch', hi: 'अपने बैच का प्रतिनिधित्व करें' },
  },
}

export const TIER_ORDER: Record<BadgeTier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 }

/** One badge as the database returns it (member_achievements().badges[]). */
export interface BadgeState {
  key: string
  earned: boolean
  earned_at: string | null
  progress: number | null
  target: number | null
  /** false when the badge can no longer be earned (founding member, serial above 500) */
  attainable: boolean
}

export interface ShownBadge extends Omit<BadgeDef, 'target'> {
  earned: boolean
  earnedAt: string | null
  progress: number | null
  target: number | null
  attainable: boolean
  /** 0..1 for a progress bar, null when the badge has no progress */
  ratio: number | null
}

/** Joins the server state with the catalogue. Unknown keys from a newer database are skipped; catalogue order is kept. */
export function shownBadges(states: readonly BadgeState[] | null | undefined): ShownBadge[] {
  const byKey = new Map((states ?? []).map((s) => [s.key, s]))
  const out: ShownBadge[] = []
  for (const key of BADGE_KEYS) {
    const s = byKey.get(key)
    if (!s) continue
    const def = BADGES[key]
    const target = s.target ?? def.target ?? null
    const ratio = s.earned ? 1 : s.progress !== null && target ? Math.max(0, Math.min(1, s.progress / target)) : null
    out.push({ ...def, earned: s.earned, earnedAt: s.earned_at, progress: s.progress, target, attainable: s.attainable, ratio })
  }
  return out
}

/** Earned first (highest tier, then most recent), then the closest to being earned; badges that can't be earned last. */
export function sortForDisplay(badges: ShownBadge[]): ShownBadge[] {
  return [...badges].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1
    if (a.earned) return TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '')
    if (a.attainable !== b.attainable) return a.attainable ? -1 : 1
    return (b.ratio ?? -1) - (a.ratio ?? -1)
  })
}

/** "6/10", or for money "₹4,000 / ₹10,000". Null when there is nothing to count. */
export function progressText(b: Pick<ShownBadge, 'progress' | 'target' | 'money' | 'earned'>, locale = 'en-IN'): string | null {
  if (b.earned || b.progress === null || !b.target) return null
  if (b.money) {
    const fmt = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString(locale)}`
    return `${fmt(b.progress)} / ${fmt(b.target)}`
  }
  return `${b.progress}/${b.target}`
}

export const badgeTitle = (b: Pick<BadgeDef, 'title'>, lang: string) => (lang === 'hi' ? b.title.hi : b.title.en)
export const badgeHow = (b: Pick<BadgeDef, 'how'>, lang: string) => (lang === 'hi' ? b.how.hi : b.how.en)
