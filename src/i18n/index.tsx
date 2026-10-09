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
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { profileKey, useMyProfile, useUserId } from '../features/auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { readStoredLang, setCurrentLang, storeLang, translate, type Lang, type MsgKey, type Params } from './core'

export { LANGS, pluralForm, translate, tr, type Lang, type MsgKey, type Params } from './core'

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
}
const I18nContext = createContext<I18nState>({ lang: 'en', setLang: () => undefined })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang())
  const uid = useUserId()
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  setCurrentLang(lang)

  // the member's saved language wins when their profile loads
  const saved = profile?.language
  useEffect(() => {
    if (saved === 'en' || saved === 'hi') {
      setLangState(saved)
      storeLang(saved)
    }
  }, [saved])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback(
    (l: Lang) => {
      setCurrentLang(l)
      setLangState(l)
      storeLang(l)
      if (!uid) return
      qc.setQueryData<Profile>(profileKey(uid), (p) => (p ? { ...p, language: l } : p))
      void supabase.from('profiles').update({ language: l }).eq('id', uid).then(() => undefined)
    },
    [uid, qc],
  )

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useLang(): I18nState {
  return useContext(I18nContext)
}

export function useT(): (key: MsgKey, params?: Params) => string {
  const { lang } = useContext(I18nContext)
  return useCallback((key, params) => translate(lang, key, params), [lang])
}
