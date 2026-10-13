import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { useModal } from './Sheet'

/**
 * Centred modal for confirmations and short decisions (on every screen size; for longer content use Sheet).
 * Labelled by its title; `description` is announced as the dialog description.
 * Put the safe choice first in `actions` (e.g. Cancel), the main choice last.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  actions,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  useModal(open, panel, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-5 backdrop-blur-[3px] animate-[fadeIn_160ms_ease-out]" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-sm rounded-[28px] border border-border/60 bg-elevated p-6 text-center shadow-[inset_0_1px_0_var(--highlight),var(--shadow-5)] outline-none',
          'animate-[pop-in_240ms_var(--ease-spring)]',
          className,
        )}
      >
        {icon && <div className="mb-3 flex justify-center">{icon}</div>}
        <h2 id={`${id}-t`} className="text-h2">
          {title}
        </h2>
        {description && (
          <p id={`${id}-d`} className="mt-2 text-[15px] text-muted">
            {description}
          </p>
        )}
        {children && <div className="mt-4 text-left">{children}</div>}
        {actions && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center [&>*]:flex-1">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
