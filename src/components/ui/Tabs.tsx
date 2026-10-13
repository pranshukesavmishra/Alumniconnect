import { m } from 'motion/react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { SPRING } from './Motion'

export interface TabOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  /** small count bubble */
  count?: number
}

/**
 * Tabs with a spring-animated pill (motion `layoutId`). Arrow keys move between tabs.
 * - `variant="segmented"` (default): pill inside a sunken track — for 2–4 views of the same thing.
 * - `variant="pills"`: free-floating pills, scrolls sideways — for filters/categories.
 * - `variant="underline"`: classic tab bar with an animated underline.
 * Each tab is role="tab" with aria-selected; pass `idPrefix` + render panels with `tabPanelProps()` if you need aria-controls.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'segmented',
  block,
  className,
}: {
  options: readonly TabOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  variant?: 'segmented' | 'pills' | 'underline'
  block?: boolean
  className?: string
}) {
  const layoutId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const n = (i + dir + options.length) % options.length
    refs.current[n]?.focus()
    onChange(options[n]!.value)
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'relative flex',
        variant === 'segmented' && 'gap-1 rounded-full border border-border/70 bg-surface-2 p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.05)]',
        variant === 'pills' && '-mx-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        variant === 'underline' && 'gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]',
        block ? 'w-full' : variant === 'segmented' && 'w-fit max-w-full',
        className,
      )}
    >
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors duration-200 [&_svg]:size-4',
              block && 'flex-1',
              variant === 'segmented' && (on ? 'text-text' : 'text-muted hover:text-text'),
              variant === 'pills' && (on ? 'text-on-primary' : 'border border-border bg-surface text-text hover:bg-surface-2'),
              variant === 'underline' && cn('rounded-none px-3', on ? 'text-primary' : 'text-muted hover:text-text'),
            )}
          >
            {on && variant !== 'underline' && (
              <m.span
                layoutId={layoutId}
                transition={SPRING}
                aria-hidden
                className={cn(
                  'absolute inset-0 rounded-full',
                  variant === 'segmented' && 'bg-surface shadow-[inset_0_1px_0_var(--highlight),var(--shadow-2)] dark:bg-surface-3',
                  variant === 'pills' && 'bg-primary bg-(image:--grad-primary) shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_14px_-8px_var(--primary-glow)]',
                )}
              />
            )}
            {on && variant === 'underline' && (
              <m.span layoutId={layoutId} transition={SPRING} aria-hidden className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-primary" />
            )}
            <span className="relative inline-flex items-center gap-1.5">
              {o.icon}
              {o.label}
              {o.count != null && o.count > 0 && (
                <span className={cn('min-w-5 rounded-full px-1.5 text-[11px] leading-5 tabular-nums', on && variant === 'pills' ? 'bg-white/20' : 'bg-primary-soft text-primary')}>
                  {o.count > 99 ? '99+' : o.count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Same control, read as a segmented switch between views. */
export const SegmentedControl = Tabs
