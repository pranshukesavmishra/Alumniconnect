// One tiny question on Home, at most one a day, always dismissible: "Is this you?" (reunion list), "What do you do
// now?" (Magic fill), "Open to mentoring?", "Add 3 skills".
import { MessageCircleQuestion, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, Chip } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import type { Profile } from '../../lib/types'
import { useT } from '../../i18n'
import { istDay } from '../home/homeLogic'
import { useUpdateProfile } from '../profile/queries'
import { suggestSkills, unionList } from './mapping'
import { nudgeCandidates, nudgeDone, pickNudge, type NudgeId } from './nudges'
import { PrefillClaimCard } from './PrefillClaimCard'
import { usePrefillMatch, type PrefillMatch } from './queries'

const KEY = 'jec.qp.nudge'
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* storage blocked: the nudge may show again, which is harmless */
  }
}

export function HomeNudge({ profile }: { profile: Profile }) {
  const claim = usePrefillMatch()
  if (claim.isLoading) return null
  return <Nudge profile={profile} claim={claim.data ?? null} />
}

function Nudge({ profile, claim }: { profile: Profile; claim: PrefillMatch | null }) {
  const tx = useT()
  const update = useUpdateProfile()
  const today = istDay()
  const [closed, setClosed] = useState(false)
  const candidates = useMemo(() => nudgeCandidates(profile, !!claim), [profile, claim])
  // chosen once per visit (the stored day keeps it to one question a day)
  const [id] = useState<NudgeId | null>(() => {
    const pick = pickNudge(candidates, read(), today)
    if (pick.store) write(pick.store)
    return pick.id
  })
  if (closed || !id || !candidates.includes(id)) return null
  const finish = () => {
    write(nudgeDone(today, id))
    setClosed(true)
  }

  if (id === 'claim' && claim) return <PrefillClaimCard match={claim} onClaimed={finish} />

  return (
    <Card className="relative p-4" data-testid="home-nudge" data-nudge={id}>
      <button type="button" onClick={finish} aria-label={tx('qp.dismiss')} className="absolute right-1 top-1 grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2">
        <X className="size-4" aria-hidden />
      </button>
      <p className="flex items-center gap-2 pr-10 text-xs font-semibold uppercase tracking-wide text-muted">
        <MessageCircleQuestion className="size-4" aria-hidden /> {tx('qp.nudgeLabel')}
      </p>
      {id === 'role' && <RoleNudge />}
      {id === 'mentor' && (
        <div className="mt-2 space-y-3">
          <p className="font-semibold">{tx('qp.nudgeMentorQ')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { profile: { help_tags: unionList(profile.help_tags, ['Career guidance'], 12) } },
                  { onSuccess: () => (toast.success(tx('qp.nudgeMentorThanks')), finish()), onError: (e) => toast.error(friendlyError(e)) },
                )
              }
            >
              {tx('qp.yes')}
            </Button>
            <Button variant="secondary" onClick={finish}>{tx('qp.notNow')}</Button>
          </div>
        </div>
      )}
      {id === 'skills' && <SkillsNudge profile={profile} onDone={finish} />}
    </Card>
  )
}

function RoleNudge() {
  const tx = useT()
  return (
    <div className="mt-2 space-y-3">
      <p className="font-semibold">{tx('qp.nudgeRoleQ')}</p>
      <ButtonLink to="/me/magic?next=/" icon={<Sparkles className="size-4" />}>{tx('qp.magicBtn')}</ButtonLink>
    </div>
  )
}

function SkillsNudge({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const tx = useT()
  const update = useUpdateProfile()
  const options = useMemo(() => suggestSkills(profile.current_title ?? profile.headline, profile.skills), [profile])
  const [picked, setPicked] = useState<string[]>(options)
  return (
    <div className="mt-2 space-y-3">
      <p className="font-semibold">{tx('qp.nudgeSkillsQ')}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <Chip key={s} selected={picked.includes(s)} onClick={() => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}>
            {s}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!picked.length}
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              { profile: { skills: unionList(profile.skills, picked, 50) } },
              { onSuccess: () => (toast.success(tx('qp.nudgeSkillsThanks')), onDone()), onError: (e) => toast.error(friendlyError(e)) },
            )
          }
        >
          {tx('qp.nudgeSkillsAdd')}
        </Button>
        <Button variant="secondary" onClick={onDone}>{tx('qp.notNow')}</Button>
      </div>
    </div>
  )
}
