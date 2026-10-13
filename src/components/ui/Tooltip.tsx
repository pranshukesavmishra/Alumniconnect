import { useId, type ReactElement, type ReactNode } from 'react'
import { cloneElement } from 'react'
import { cn } from '../../lib/cn'

/**
 * Desktop hint on hover / keyboard focus (hidden on touch screens, where it would never show anyway).
 * Never put essential information only in a tooltip — the trigger must have its own accessible name.
 * The tip is linked with aria-describedby.
 */
export function Tooltip({ content, children, side = 'top', className }: { content: ReactNode; children: ReactElement<Record<string, unknown>>; side?: 'top' | 'bottom'; className?: string }) {
  const id = useId()
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-40 hidden w-max max-w-60 -translate-x-1/2 rounded-xl bg-text px-2.5 py-1.5 text-xs font-medium text-bg opacity-0 shadow-e3',
          'transition-[opacity,transform] duration-150 [@media(hover:hover)]:block',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          side === 'top' ? 'bottom-full mb-2 translate-y-1 group-hover/tip:translate-y-0' : 'top-full mt-2 -translate-y-1 group-hover/tip:translate-y-0',
        )}
      >
        {content}
      </span>
    </span>
  )
}
