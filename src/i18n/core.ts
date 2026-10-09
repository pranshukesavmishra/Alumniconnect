// A tiny, dependency-free i18n layer. English (en.ts) is the source of truth; hi.ts must have exactly the same keys.
//
//   const t = useT();  t('nav.home');  t('home.inDays', { count: 5 });  t('hello', { name })
//
// Interpolation: `{name}` is replaced by params.name.
// Plurals: a message with plural forms is stored as two keys, `foo_one` and `foo_other`, and called as
// t('foo', { count }). The form is chosen from `count`:
//   English: count === 1 -> one, anything else -> other.
//   Hindi:   count === 0 or count === 1 -> one (CLDR: Hindi treats 0 and 1 as singular), anything else -> other.
// A key missing in the active language falls back to English; a key missing everywhere renders as the key itself.
import { en } from './en'
import { hi } from './hi'

export type Lang = 'en' | 'hi'
export const LANGS: Lang[] = ['en', 'hi']

type AllKeys = keyof typeof en
type Plural<K> = K extends `${infer B}_one` | `${infer B}_other` ? B : never
/** Keys accepted by t(): plain keys, plus the base name of every `_one`/`_other` pair. */
export type MsgKey = Exclude<AllKeys, `${string}_one` | `${string}_other`> | Plural<AllKeys>
export type Params = Record<string, string | number>
export type Dict = Record<string, string>

const DICTS: Record<Lang, Dict> = { en, hi }
const STORAGE_KEY = 'jec-lang'

export function pluralForm(lang: Lang, n: number): 'one' | 'other' {
  if (lang === 'hi') return n === 0 || n === 1 ? 'one' : 'other'
  return n === 1 ? 'one' : 'other'
}

export function translate(lang: Lang, key: string, params?: Params, dicts: Record<Lang, Dict> = DICTS): string {
  const pick = (d: Dict) => {
    if (params && typeof params.count === 'number') {
      const m = d[`${key}_${pluralForm(lang, params.count)}`]
      if (m !== undefined) return m
    }
    return d[key]
  }
  const msg = pick(dicts[lang]) ?? pick(dicts.en) ?? key
  if (!params) return msg
  return msg.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

export function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en' // storage can throw (private window, blocked site data)
  }
}

export function storeLang(l: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* ignore */
  }
}

// The active language outside React too (friendlyError and other plain functions).
let current: Lang = readStoredLang()
export function setCurrentLang(l: Lang) {
  current = l
}
export function currentLang(): Lang {
  return current
}
/** Locale for Intl date formatting; Hindi keeps Western digits (0-9). */
export function dateLocale(): string {
  return current === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN'
}
export function tr(key: MsgKey, params?: Params): string {
  return translate(current, key, params)
}

