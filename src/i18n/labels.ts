import { FOOD_PREFS, MEMBER_TYPES } from '../lib/constants'
import type { MsgKey } from './index'

type T = (key: MsgKey) => string

/** Translated option lists for the pickers that use the shared constants. */
export const foodOptions = (t: T) => FOOD_PREFS.map((o) => ({ value: o.value, label: t(`food.${o.value}` as MsgKey) }))
export const foodLabel = (t: T, v: string | null | undefined) => (v === 'veg' || v === 'non_veg' || v === 'jain' ? t(`food.${v}` as MsgKey) : (v ?? ''))
export const memberTypeOptions = (t: T) =>
  MEMBER_TYPES.map((o) => ({ value: o.value, label: t(`member.${o.value}` as MsgKey), hint: t(`member.${o.value}_hint` as MsgKey) }))
