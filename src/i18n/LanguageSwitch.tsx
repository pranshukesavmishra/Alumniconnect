import clsx from 'clsx'
import { useLang, type Lang } from './index'

const OPTIONS: { value: Lang; label: string; name: string }[] = [
  { value: 'en', label: 'English', name: 'English' },
  { value: 'hi', label: 'हिन्दी', name: 'Hindi' },
]

/** Two-button English / हिन्दी switch. Labels are always written in their own language. */
export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { lang, setLang } = useLang()
  return (
    <div role="group" aria-label="भाषा / Language" className={clsx('inline-flex rounded-full border border-border bg-surface p-0.5', compact && 'text-sm')}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={lang === o.value}
          onClick={() => setLang(o.value)}
          className={clsx(
            'min-h-11 rounded-full px-4 font-semibold transition-colors',
            lang === o.value ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
