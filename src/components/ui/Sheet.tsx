import clsx from 'clsx'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Bottom sheet on phones, centred dialog on larger screens. Closes on Escape or a tap outside,
 * moves focus inside while open, returns it afterwards, and stops the page behind from scrolling.
 */
export function Sheet({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null)
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
        const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
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
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 md:items-center md:p-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-bg pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-xl outline-none md:max-w-md md:rounded-3xl md:pb-3',
          'animate-[sheet-in_160ms_ease-out]',
          className,
        )}
      >
        <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 rounded-full bg-border md:hidden" aria-hidden />
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
      className={clsx('flex min-h-13 w-full items-center gap-4 px-5 text-left text-[16px] font-medium hover:bg-surface-2 disabled:opacity-50', danger ? 'text-danger' : 'text-text')}
    >
      {icon && <span className={clsx('grid size-6 place-items-center', danger ? 'text-danger' : 'text-muted')} aria-hidden>{icon}</span>}
      {children}
    </button>
  )
}
