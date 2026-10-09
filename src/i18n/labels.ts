import { ARRIVAL_MODES, FOOD_PREFS, MEMBER_TYPES, ORG_TEAMS, PERFORM_TYPES, SPONSOR_LEVELS, TSHIRT_SIZES } from '../lib/constants'
import type { MsgKey } from './index'

type T = (key: MsgKey) => string

/** Translated option lists for the pickers that use the shared constants. */
export const foodOptions = (t: T) => FOOD_PREFS.map((o) => ({ value: o.value, label: t(`food.${o.value}` as MsgKey) }))
export const foodLabel = (t: T, v: string | null | undefined) =>
  v === 'veg' || v === 'non_veg' || v === 'jain' || v === 'none' ? t(`food.${v}` as MsgKey) : (v ?? '')
export const memberTypeOptions = (t: T) =>
  MEMBER_TYPES.map((o) => ({ value: o.value, label: t(`member.${o.value}` as MsgKey), hint: t(`member.${o.value}_hint` as MsgKey) }))

/** "S – Small" */
export const tshirtLabel = (t: T, v: string | null | undefined) => ((TSHIRT_SIZES as readonly string[]).includes(v ?? '') ? t(`rr.size.${v}` as MsgKey) : (v ?? ''))
export const teamLabel = (t: T, v: string) => ((ORG_TEAMS as readonly string[]).includes(v) ? t(`rr.team.${v}` as MsgKey) : v)
export const performLabel = (t: T, v: string) => ((PERFORM_TYPES as readonly string[]).includes(v) ? t(`rr.perf.${v}` as MsgKey) : v)
export const sponsorLabel = (t: T, v: string | null | undefined) => ((SPONSOR_LEVELS as readonly string[]).includes(v ?? '') ? t(`rr.sponsor.${v}` as MsgKey) : (v ?? ''))
export const modeLabel = (t: T, v: string | null | undefined) => ((ARRIVAL_MODES as readonly string[]).includes(v ?? '') ? t(`rr.mode.${v}` as MsgKey) : (v ?? ''))
