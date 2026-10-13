import { m } from 'motion/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useId } from 'react'
import { useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { useTheme, type ThemePref } from '../../lib/theme'
import { SPRING } from './Motion'

const OPTIONS: { value: ThemePref; label: MsgKey; icon: typeof Sun }[] = [
  { value: 'system', label: 'ds.theme.system', icon: Monitor },
  { value: 'light', label: 'ds.theme.light', icon: Sun },
  { value: 'dark', label: 'ds.theme.dark', icon: Moon },
]

/** System / Light / Dark switch (stored on this device). Same pattern as the language switch: a group of pressed buttons. */
export function ThemeToggle({ className }: { className?: string }) {
  const tx = useT()
  const { pref, setTheme } = useTheme()
  const layoutId = useId()
  return (
    <div role="group" aria-label={tx('ds.theme.title')} className={cn('inline-flex gap-1 rounded-full border border-border/70 bg-surface-2 p-1', className)}>
      {OPTIONS.map((o) => {
        const on = pref === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(o.value)}
            className={cn('relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors', on ? 'text-text' : 'text-muted hover:text-text')}
          >
            {on && (
              <m.span
                layoutId={layoutId}
                transition={SPRING}
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface shadow-[inset_0_1px_0_var(--highlight),var(--shadow-2)] dark:bg-surface-3"
              />
            )}
            <o.icon className="relative size-4" aria-hidden />
            <span className="relative">{tx(o.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
