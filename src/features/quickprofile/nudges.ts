// Home nudges: at most one tiny one-tap question a day, never blocking. Pure rules (unit tested).
import type { Profile } from '../../lib/types'

export type NudgeId = 'claim' | 'role' | 'mentor' | 'skills'

/** What is still worth asking, most useful first. */
export function nudgeCandidates(p: Pick<Profile, 'current_title' | 'headline' | 'help_tags' | 'skills' | 'member_type'>, hasClaim: boolean): NudgeId[] {
  const out: NudgeId[] = []
  if (hasClaim) out.push('claim')
  if (!p.current_title?.trim() && !p.headline?.trim()) out.push('role')
  if (p.member_type !== 'student' && !p.help_tags.includes('Career guidance')) out.push('mentor')
  if (p.skills.length < 3) out.push('skills')
  return out
}

/** "2026-10-30|mentor|shown" -> the nudge for today. One a day: answered or dismissed means nothing more today. */
export function pickNudge(candidates: NudgeId[], stored: string | null, today: string): { id: NudgeId | null; store: string | null } {
  const [day, id, state] = (stored ?? '').split('|')
  if (day === today) {
    if (state !== 'shown') return { id: null, store: null }
    if (candidates.includes(id as NudgeId)) return { id: id as NudgeId, store: null }
    return { id: null, store: null }
  }
  const first = candidates[0] ?? null
  return { id: first, store: first ? `${today}|${first}|shown` : null }
}

export const nudgeDone = (today: string, id: NudgeId) => `${today}|${id}|done`
