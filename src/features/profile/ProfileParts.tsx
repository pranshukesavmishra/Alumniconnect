// Visual building blocks for the profile, Me and member cards (Layer 3c). Pure presentation: data comes from the
// existing queries (profile, experiences, member_achievements, group_members, connections).
import { useQuery } from '@tanstack/react-query'
import {
  BadgeCheck, BookOpen, Camera, ChevronRight, ClipboardList, Crown, Flag, Gem, Gift, GraduationCap, HandHeart, HeartHandshake, Link as LinkIcon,
  Lock, Network, PartyPopper, Star, type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Avatar, avatarGradient, initialsOf, nameHash } from '../../components/ui/Avatar'
import { AvatarStack } from '../../components/ui/Avatar'
import { SectionHeader } from '../../components/ui/Card'
import { Sheet } from '../../components/ui/Sheet'
import { GlowOrbs } from '../../components/ui/Fx'
import { useLang, useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Education, Experience } from '../../lib/types'
import { useUserId } from '../auth/AuthProvider'
import { useShownBadges } from '../badges/api'
import { badgeHow, badgeTitle, progressText, sortForDisplay, type BadgeTier, type ShownBadge } from '../badges/catalog'

// ------------------------------------------------------------------ cover art

/** A tiny seeded PRNG so a member's cover is always the same. */
function rng(seed: number) {
  let s = seed || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const COVER_GLOWS = [
  ['rgb(31 145 106 / 0.85)', 'rgb(228 173 69 / 0.5)', 'rgb(20 120 118 / 0.7)'],
  ['rgb(20 120 118 / 0.85)', 'rgb(240 180 79 / 0.45)', 'rgb(139 30 45 / 0.45)'],
  ['rgb(63 174 133 / 0.75)', 'rgb(185 67 79 / 0.4)', 'rgb(228 173 69 / 0.45)'],
  ['rgb(42 143 138 / 0.8)', 'rgb(90 111 176 / 0.45)', 'rgb(31 145 106 / 0.6)'],
] as const

type Motif = 'circuit' | 'arches' | 'waves' | 'gears'
function motifFor(branch: string | null | undefined): Motif {
  const b = (branch ?? '').toLowerCase()
  if (/comput|inform|electronic|communic|mca|data|intellig/.test(b)) return 'circuit'
  if (/civil|structur|environ/.test(b)) return 'arches'
  if (/electric|power|voltage/.test(b)) return 'waves'
  return 'gears'
}

function MotifSvg({ motif, seed }: { motif: Motif; seed: number }) {
  const r = rng(seed)
  const paths: ReactNode[] = []
  if (motif === 'circuit') {
    for (let i = 0; i < 14; i++) {
      const x = Math.round(r() * 800)
      const y = Math.round(r() * 240)
      const len = 40 + Math.round(r() * 120)
      const turn = r() > 0.5 ? 1 : -1
      paths.push(<path key={i} d={`M${x} ${y} h${len} l${18 * turn} ${18 * turn} h${len / 2}`} />)
      paths.push(<circle key={`c${i}`} cx={x + len * 1.5 + 18 * turn} cy={y + 18 * turn} r="3.5" />)
    }
  } else if (motif === 'arches') {
    for (let i = 0; i < 9; i++) {
      const x = i * 100 - 20
      paths.push(<path key={i} d={`M${x} 260 v-90 a50 50 0 0 1 100 0 v90`} />)
      paths.push(<path key={`i${i}`} d={`M${x + 22} 260 v-80 a28 28 0 0 1 56 0 v80`} />)
    }
  } else if (motif === 'waves') {
    for (let i = 0; i < 7; i++) {
      const y = 30 + i * 32
      const a = 10 + r() * 16
      paths.push(<path key={i} d={`M0 ${y} C 100 ${y - a}, 200 ${y + a}, 300 ${y} S 500 ${y - a}, 600 ${y} S 800 ${y + a}, 900 ${y}`} />)
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const cx = Math.round(r() * 800)
      const cy = Math.round(r() * 240)
      const rad = 26 + Math.round(r() * 40)
      paths.push(<circle key={i} cx={cx} cy={cy} r={rad} />)
      paths.push(<circle key={`in${i}`} cx={cx} cy={cy} r={rad * 0.45} />)
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2
        paths.push(<path key={`t${i}-${k}`} d={`M${cx + Math.cos(ang) * rad} ${cy + Math.sin(ang) * rad} l${Math.cos(ang) * 9} ${Math.sin(ang) * 9}`} />)
      }
    }
  }
  return (
    <svg viewBox="0 0 800 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" fill="none" stroke="white" strokeOpacity="0.13" strokeWidth="1.4" aria-hidden>
      {paths}
    </svg>
  )
}

/**
 * The generated cover banner: aurora seeded by batch + branch, a motif for the branch (circuits, arches, waves, gears),
 * glow orbs and the batch year as a watermark. Decorative.
 */
export function ProfileCover({ year, branch, className, children }: { year?: number | null; branch?: string | null; className?: string; children?: ReactNode }) {
  const seed = nameHash(`${year ?? ''}|${branch ?? ''}`)
  const g = COVER_GLOWS[seed % COVER_GLOWS.length]!
  const bg = useMemo(
    () =>
      [
        `radial-gradient(55% 75% at ${10 + (seed % 30)}% 0%, ${g[0]}, transparent 70%)`,
        `radial-gradient(45% 60% at ${70 + (seed % 25)}% 20%, ${g[1]}, transparent 70%)`,
        `radial-gradient(70% 80% at 60% 120%, ${g[2]}, transparent 70%)`,
        'linear-gradient(160deg, #0b4a37 0%, #062a20 60%, #041a14 100%)',
      ].join(','),
    [seed, g],
  )
  return (
    <div className={cn('relative isolate overflow-hidden bg-hero text-white', className)} style={{ backgroundImage: bg }} data-testid="profile-cover">
      <GlowOrbs className="opacity-60" />
      <MotifSvg motif={motifFor(branch)} seed={seed} />
      <div aria-hidden className="fx-grid fx-grid-light absolute inset-0 opacity-60" />
      {year ? (
        <span aria-hidden className="absolute -bottom-6 right-3 select-none font-display text-[120px] font-semibold leading-none tracking-tight text-white/[0.07] sm:text-[160px]">
          {year}
        </span>
      ) : null}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
      {children && <div className="relative">{children}</div>}
    </div>
  )
}

const KIND_BG: Record<string, string> = {
  official: 'radial-gradient(70% 90% at 15% 0%, rgb(209 106 119 / 0.75), transparent 70%), radial-gradient(50% 70% at 95% 10%, rgb(228 173 69 / 0.45), transparent 70%), linear-gradient(150deg, #8b1e2d 0%, #4d0f19 60%, #2a070d 100%)',
  department: 'radial-gradient(70% 90% at 10% 0%, rgb(79 209 197 / 0.6), transparent 70%), radial-gradient(50% 70% at 95% 20%, rgb(228 173 69 / 0.35), transparent 70%), linear-gradient(150deg, #12635e 0%, #0b3b38 60%, #062220 100%)',
  year: 'radial-gradient(70% 90% at 10% 0%, rgb(63 174 133 / 0.8), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(228 173 69 / 0.5), transparent 70%), linear-gradient(150deg, #0b6b4f 0%, #084434 60%, #04261c 100%)',
  batch: 'radial-gradient(70% 90% at 10% 0%, rgb(63 174 133 / 0.7), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(79 111 181 / 0.5), transparent 70%), linear-gradient(150deg, #0b5a4a 0%, #0a3a3a 60%, #05201f 100%)',
  channel: 'radial-gradient(70% 90% at 10% 0%, rgb(124 155 224 / 0.7), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(79 209 161 / 0.4), transparent 70%), linear-gradient(150deg, #2e3b72 0%, #1b2450 60%, #0e1430 100%)',
}
const CIRCLE_BG = [
  'radial-gradient(70% 90% at 10% 0%, rgb(177 138 212 / 0.75), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(228 173 69 / 0.45), transparent 70%), linear-gradient(150deg, #5b3479 0%, #34184a 60%, #1c0c29 100%)',
  'radial-gradient(70% 90% at 10% 0%, rgb(246 207 110 / 0.75), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(209 106 119 / 0.45), transparent 70%), linear-gradient(150deg, #a8661b 0%, #6b3a10 60%, #3a1e06 100%)',
  'radial-gradient(70% 90% at 10% 0%, rgb(79 209 197 / 0.7), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(177 138 212 / 0.45), transparent 70%), linear-gradient(150deg, #12635e 0%, #0d3f4a 60%, #071f26 100%)',
  'radial-gradient(70% 90% at 10% 0%, rgb(240 114 127 / 0.65), transparent 70%), radial-gradient(50% 70% at 95% 15%, rgb(246 207 110 / 0.45), transparent 70%), linear-gradient(150deg, #8a3a2a 0%, #5a1f1a 60%, #2d0d0b 100%)',
]
const KIND_MOTIF: Record<string, Motif> = { official: 'arches', department: 'gears', year: 'waves', batch: 'circuit', channel: 'waves' }
const MOTIFS: Motif[] = ['circuit', 'arches', 'waves', 'gears']

/** Cover art for a group: a gradient by kind (maroon for official, teal departments, emerald batches, ink channels; circles seeded). */
export function GroupCover({ kind, seed, className, children }: { kind: string; seed: string; className?: string; children?: ReactNode }) {
  const h = nameHash(seed)
  const bg = KIND_BG[kind] ?? CIRCLE_BG[h % CIRCLE_BG.length]!
  return (
    <div className={cn('relative isolate overflow-hidden text-white', className)} style={{ backgroundImage: bg }}>
      <MotifSvg motif={KIND_MOTIF[kind] ?? MOTIFS[h % 4]!} seed={h} />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgb(0_0_0/0.45))]" />
      {children && <div className="relative h-full">{children}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ logos

/** A company / school "logo": initials on a rich deterministic gradient with an inner highlight. */
export function OrgLogo({ name, size = 44, className, jec }: { name: string; size?: number; className?: string; jec?: boolean }) {
  const words = name.replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+/).filter((w) => w && !/^(of|the|and|&|pvt|ltd|limited|inc)$/i.test(w))
  const ini = words.length >= 2 ? (words[0]![0]! + words[1]![0]!).toUpperCase() : initialsOf(name).slice(0, 2)
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_16px_-8px_rgb(0_0_0/0.5)] ring-1 ring-black/5', className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.max(11, size * 0.36),
        backgroundImage: jec ? 'linear-gradient(135deg,#b9434f,#621925)' : avatarGradient(name),
        textShadow: '0 1px 1px rgb(0 0 0 / 0.2)',
      }}
    >
      {ini}
    </span>
  )
}

export const isJec = (s: string | null | undefined) => /jabalpur engineering|^jec\b|\bjec jabalpur/i.test(s ?? '')

// ------------------------------------------------------------------ badges

const BADGE_ICONS: Record<string, LucideIcon> = {
  BadgeCheck, Crown, Star, Link: LinkIcon, Network, GraduationCap, HandHeart, BookOpen, Camera, PartyPopper, HeartHandshake, Gift, Gem, ClipboardList, Flag,
}

const TIER_FACE: Record<BadgeTier, { face: string; rim: string; glow: string }> = {
  bronze: { face: 'radial-gradient(circle at 32% 25%, #f7d2b0 0%, #d08a52 38%, #8a4b22 100%)', rim: 'linear-gradient(140deg,#f3c79c,#7a3f19)', glow: 'rgb(208 138 82 / 0.45)' },
  silver: { face: 'radial-gradient(circle at 32% 25%, #ffffff 0%, #cfd6da 40%, #7d8a91 100%)', rim: 'linear-gradient(140deg,#ffffff,#6f7b82)', glow: 'rgb(180 192 198 / 0.45)' },
  gold: { face: 'radial-gradient(circle at 32% 25%, #fff1c4 0%, #ecc56a 38%, #a8661b 100%)', rim: 'linear-gradient(140deg,#fbe3a0,#8a5213)', glow: 'rgb(228 173 69 / 0.5)' },
  platinum: {
    face: 'radial-gradient(circle at 32% 25%, #ffffff 0%, #c9efe2 30%, #7fb8d6 60%, #3d6f8f 100%)',
    rim: 'conic-gradient(from 200deg, #e6fff6, #a7dfc6, #f4dc9e, #b8c8f0, #e6fff6)',
    glow: 'rgb(127 184 214 / 0.5)',
  },
}

/** A glossy medal for an achievement badge. Decorative; name it on the surrounding button. */
export function BadgeMedallion({ badge, size = 64, locked }: { badge: Pick<ShownBadge, 'icon' | 'tier'>; size?: number; locked?: boolean }) {
  const Icon = BADGE_ICONS[badge.icon] ?? Star
  const t = TIER_FACE[badge.tier]
  return (
    <span
      aria-hidden
      className={cn('relative inline-grid shrink-0 place-items-center rounded-full', locked && 'grayscale opacity-55')}
      style={{ width: size, height: size, padding: Math.max(2, size * 0.055), backgroundImage: t.rim, boxShadow: locked ? undefined : `0 10px 24px -10px ${t.glow}, 0 2px 4px rgb(0 0 0 / 0.18)` }}
    >
      <span className="relative grid size-full place-items-center overflow-hidden rounded-full shadow-[inset_0_2px_3px_rgb(255_255_255/0.6),inset_0_-3px_6px_rgb(0_0_0/0.25)]" style={{ backgroundImage: t.face }}>
        <span className="absolute inset-[14%] rounded-full border border-white/35" />
        <Icon className="relative text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]" style={{ width: size * 0.42, height: size * 0.42 }} strokeWidth={2.1} />
        <span className="absolute -left-1/4 top-0 h-1/2 w-[150%] -rotate-12 bg-gradient-to-b from-white/45 to-transparent" />
      </span>
      {locked && (
        <span className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full bg-surface-3 text-muted ring-2 ring-bg">
          <Lock className="size-3" />
        </span>
      )}
    </span>
  )
}

export function tierLabel(tier: BadgeTier, tx: ReturnType<typeof useT>) {
  return tx(`pp.tier.${tier}` as 'pp.tier.gold')
}

/** The badge sheet: a big medal, what it means, and when it was earned (or how to earn it). */
export function BadgeSheet({ badge, onClose }: { badge: ShownBadge | null; onClose: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const b = badge
  return (
    <Sheet open={!!b} onClose={onClose} label={b ? badgeTitle(b, lang) : tx('pp.badges')}>
      {b && (
        <div className="flex flex-col items-center px-2 pb-2 pt-4 text-center" data-testid="badge-sheet">
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-0 scale-150 rounded-full bg-[radial-gradient(circle,rgb(228_173_69/0.28),transparent_65%)]" />
            <BadgeMedallion badge={b} size={112} locked={!b.earned} />
          </div>
          <p className="text-eyebrow mt-5 text-gold-ink">{tierLabel(b.tier, tx)}</p>
          <h2 className="text-h1 mt-1">{badgeTitle(b, lang)}</h2>
          <p className="text-body mt-2 max-w-xs text-muted">{badgeHow(b, lang)}</p>
          {b.earned ? (
            b.earnedAt && <p className="mt-4 rounded-full bg-success-soft px-4 py-1.5 text-sm font-semibold text-success">{tx('pp.earnedOn', { date: formatDate(b.earnedAt, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
          ) : (
            progressText(b) && <p className="mt-4 rounded-full bg-surface-2 px-4 py-1.5 text-sm font-semibold tabular-nums text-muted">{progressText(b)}</p>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** Earned badges as a horizontal strip of medals (labels below, never cut inside the circle). */
export function BadgesStrip({ userId, isMe }: { userId: string; isMe: boolean }) {
  const tx = useT()
  const { lang } = useLang()
  const { badges, isLoading } = useShownBadges(userId)
  const [open, setOpen] = useState<ShownBadge | null>(null)
  const sorted = sortForDisplay(badges)
  const earned = sorted.filter((b) => b.earned)
  const shown = earned.length ? earned : isMe ? sorted.filter((b) => b.attainable).slice(0, 4) : []
  if (isLoading || !shown.length) return null
  return (
    <section aria-labelledby="pp-badges" data-testid="profile-badges">
      <SectionHeader
        eyebrow={tx('pp.badgesEyebrow', { count: earned.length })}
        title={<span id="pp-badges">{tx('pp.badges')}</span>}
        action={
          isMe ? (
            <Link to="/me/badges" className="inline-flex min-h-11 items-center gap-0.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary-soft">
              {tx('pp.seeAll')} <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : undefined
        }
      />
      <ul className="-mx-4 flex snap-x gap-1 overflow-x-auto px-3 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shown.map((b) => (
          <li key={b.key} className="snap-start">
            <button
              type="button"
              onClick={() => setOpen(b)}
              className="fx-press flex w-[92px] flex-col items-center gap-2 rounded-2xl px-1 py-2 hover:bg-surface-2"
              aria-label={`${badgeTitle(b, lang)}, ${tierLabel(b.tier, tx)}`}
            >
              <BadgeMedallion badge={b} size={64} locked={!b.earned} />
              <span className="text-caption line-clamp-2 text-center font-semibold leading-tight">{badgeTitle(b, lang)}</span>
            </button>
          </li>
        ))}
      </ul>
      <BadgeSheet badge={open} onClose={() => setOpen(null)} />
    </section>
  )
}

// ------------------------------------------------------------------ counts

/** Connections (from the achievements progress, capped at 50 by the database), groups joined, badges earned. */
export function useProfileStats(userId: string | undefined) {
  const { badges } = useShownBadges(userId)
  const groups = useQuery({
    queryKey: ['pp-group-count', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', userId!)
      if (error) throw error
      return count ?? 0
    },
  })
  const conn = badges.find((b) => b.key === 'super_connector')?.progress ?? badges.find((b) => b.key === 'connector')?.progress ?? null
  return {
    connections: conn,
    connectionsCapped: conn !== null && conn >= 50,
    groups: groups.data ?? null,
    badges: badges.length ? badges.filter((b) => b.earned).length : null,
  }
}

/** My accepted connections (ids). */
export function useMyConnectionIds() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['pp-my-connections', uid],
    enabled: !!uid,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('connections').select('requester, addressee').eq('status', 'accepted').or(`requester.eq.${uid},addressee.eq.${uid}`)
      if (error) throw error
      return new Set((data ?? []).map((c) => (c.requester === uid ? c.addressee : c.requester) as string))
    },
  })
}

/** Mutual connections with another member: my connections (first 40) checked with are_connected(). */
export function useMutualConnections(otherId: string | undefined, enabled = true) {
  const uid = useUserId()
  const mine = useMyConnectionIds()
  return useQuery({
    queryKey: ['pp-mutual', uid, otherId, mine.data?.size],
    enabled: enabled && !!otherId && !!mine.data && otherId !== uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = [...mine.data!].filter((id) => id !== otherId).slice(0, 40)
      const hits = await Promise.all(ids.map(async (id) => ((await supabase.rpc('are_connected', { a: otherId, b: id })).data ? id : null)))
      const mutual = hits.filter((x): x is string => !!x)
      if (!mutual.length) return []
      const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', mutual)
      return (data ?? []) as { id: string; full_name: string; avatar_url: string | null }[]
    },
  })
}

export function MutualConnections({ otherId }: { otherId: string }) {
  const tx = useT()
  const { data } = useMutualConnections(otherId)
  if (!data?.length) return null
  const first = data[0]!.full_name.split(' ')[0]!
  const text = data.length === 1 ? tx('pp.mutualOne', { name: first }) : tx('pp.mutualMany', { name: first, count: data.length - 1 })
  return (
    <div className="flex items-center gap-3" data-testid="mutual-connections">
      <AvatarStack people={data.map((p) => ({ name: p.full_name, src: p.avatar_url }))} max={3} size={28} />
      <p className="text-caption text-muted">{text}</p>
    </div>
  )
}

// ------------------------------------------------------------------ timeline

function period(e: Experience, present: string) {
  const from = e.start_date ? formatDate(e.start_date, { month: 'short', year: 'numeric' }) : ''
  const to = e.is_current ? present : e.end_date ? formatDate(e.end_date, { month: 'short', year: 'numeric' }) : ''
  return [from, to].filter(Boolean).join(' – ')
}

function duration(e: Experience, tx: ReturnType<typeof useT>) {
  if (!e.start_date) return null
  const s = new Date(e.start_date)
  const end = e.is_current || !e.end_date ? new Date() : new Date(e.end_date)
  const months = Math.max(1, (end.getFullYear() - s.getFullYear()) * 12 + end.getMonth() - s.getMonth() + 1)
  const y = Math.floor(months / 12)
  const mo = months % 12
  return [y ? tx('pp.yrs', { count: y }) : null, mo ? tx('pp.mos', { count: mo }) : null].filter(Boolean).join(' ')
}

/** Work history as a vertical timeline: company logo tiles joined by a gradient line; the current role glows. */
export function CareerTimeline({ items }: { items: Experience[] }) {
  const tx = useT()
  return (
    <ol className="relative">
      {items.map((e, i) => (
        <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0" data-testid="timeline-item">
          {i < items.length - 1 && (
            <span aria-hidden className="absolute bottom-0 left-[21px] top-12 w-0.5 rounded-full bg-gradient-to-b from-primary/50 via-border-strong to-border" />
          )}
          <span className="relative">
            <OrgLogo name={e.company} jec={isJec(e.company)} />
            {e.is_current && <span aria-hidden className="absolute -right-1 -top-1 size-3.5 rounded-full border-2 border-surface bg-success shadow-[0_0_0_4px_rgb(31_145_106/0.18)]" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-title leading-snug">{e.title}</p>
            <p className="text-body font-medium">{e.company}</p>
            <p className="text-caption mt-0.5 text-muted">
              {[period(e, tx('pp.present')), duration(e, tx), e.location].filter(Boolean).join(' · ')}
            </p>
            {e.description && <p className="text-body mt-2 line-clamp-4 whitespace-pre-line text-muted">{e.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function EducationList({ items }: { items: Education[] }) {
  return (
    <ul className="space-y-4">
      {items.map((e) => (
        <li key={e.id} className="flex gap-4">
          <OrgLogo name={e.school} jec={isJec(e.school)} />
          <div className="min-w-0 pt-0.5">
            <p className="text-title leading-snug">{e.school}</p>
            <p className="text-body">{[e.degree, e.field].filter(Boolean).join(', ')}</p>
            {(e.start_year || e.end_year) && <p className="text-caption text-muted">{[e.start_year, e.end_year].filter(Boolean).join(' – ')}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ small pieces

/** A meta chip on the profile (batch, branch, city). */
export function MetaChip({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/80 bg-surface px-3 text-[13px] font-semibold text-text shadow-e1 [&_svg]:size-3.5 [&_svg]:text-primary', className)}>
      {icon}
      {children}
    </span>
  )
}

/** Avatar with a gradient ring (verified gold / plain brand) — used where no story ring applies. */
export function RingAvatar({ name, src, size, verified }: { name: string; src?: string | null; size: number; verified?: boolean }) {
  return <Avatar name={name} src={src} size={size} ring={verified ? 'verified' : 'seen'} />
}
