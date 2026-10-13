import clsx from 'clsx'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'

/** Modal plumbing shared by Sheet and Dialog: focus in, Tab trapped, Escape closes, page scroll locked, focus restored. */
export function useModal(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = panel.current?.querySelector<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
    ;(first ?? panel.current)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      } else if (e.key === 'Tab' && panel.current) {
        // keep keyboard focus inside the sheet
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (!items.length) return
        const [a, z] = [items[0]!, items[items.length - 1]!]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      before?.focus?.({ preventScroll: true })
    }
  }, [open, panel])
}

/**
 * Bottom sheet on phones, centred dialog on larger screens. Closes on Escape, a tap outside, or (phones) a swipe down on
 * the grab handle. Moves focus inside while open, returns it afterwards, and stops the page behind from scrolling.
 */
export function Sheet({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null)
  useModal(open, panel, onClose)
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null)
  const [dy, setDy] = useState(0)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (open) {
      setDy(0)
      setLeaving(false)
    }
  }, [open])

  const onDown = (e: RPointerEvent) => {
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    if (!drag.current) return
    const d = Math.max(0, e.clientY - drag.current.y)
    drag.current.dy = d
    setDy(d)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const v = d.dy / Math.max(1, performance.now() - d.t)
    if (d.dy > 110 || (d.dy > 40 && v > 0.6)) {
      setLeaving(true)
      setDy(window.innerHeight)
      window.setTimeout(onClose, 200)
    } else setDy(0)
  }

  if (!open) return null
  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-50 flex items-end justify-center bg-scrim backdrop-blur-[3px] md:items-center md:p-6',
        'animate-[fadeIn_180ms_ease-out]',
        leaving && 'opacity-0 transition-opacity duration-200',
      )}
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={dy ? { transform: `translateY(${dy}px)`, transition: drag.current ? 'none' : 'transform 220ms var(--ease-out)' } : undefined}
        className={clsx(
          'relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-bg pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-e5 outline-none md:max-w-md md:rounded-[28px] md:border md:border-border/60 md:pb-3',
          'shadow-[inset_0_1px_0_var(--highlight),var(--shadow-5)]',
          'animate-[sheet-up_380ms_var(--ease-out)] md:animate-[pop-in_220ms_var(--ease-out)]',
          className,
        )}
      >
        <div
          className="sticky top-0 z-10 -mb-2 flex h-6 cursor-grab touch-none items-start justify-center pt-2.5 md:hidden"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden
        >
          <span className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A full-width row button for sheets (44px+ tap target). */
export function SheetAction({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex min-h-13 w-full items-center gap-4 px-5 text-left text-[16px] font-medium transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50',
        danger ? 'text-danger' : 'text-text',
      )}
    >
      {icon && (
        <span
          className={clsx('grid size-9 place-items-center rounded-xl [&_svg]:size-[18px]', danger ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted')}
          aria-hidden
        >
          {icon}
        </span>
      )}
      {children}
    </button>
  )
}
