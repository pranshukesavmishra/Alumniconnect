import { cn } from '../../lib/cn'
import { haptic as vibrate } from '../../lib/haptics'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-ghost' | 'success' | 'gold' | 'glass'
export type ButtonSize = 'md' | 'lg' | 'sm'

const base =
  'relative inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.005em] select-none ' +
  'transition-[background-color,box-shadow,transform,color,border-color,opacity] duration-200 ease-[var(--ease-out)] ' +
  'disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:shrink-0'

/** Exported so custom elements (e.g. an <a href> or <label>) can look like a button: `buttonClass('secondary')`. */
export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary bg-(image:--grad-primary) text-on-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.12),0_10px_24px_-10px_var(--primary-glow)] ' +
    'hover:brightness-[1.06] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.12),0_14px_30px_-10px_var(--primary-glow)]',
  secondary: 'bg-surface text-text border border-border shadow-[inset_0_1px_0_var(--highlight),var(--shadow-1)] hover:bg-surface-2 hover:border-border-strong',
  outline: 'border border-primary/60 text-primary hover:bg-primary-soft hover:border-primary',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-on-danger shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_20px_-10px_var(--danger)] hover:brightness-[1.06]',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
  success: 'bg-success text-on-success shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-[1.06]',
  gold:
    'bg-accent bg-(image:--grad-gold) text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_1px_2px_rgb(0_0_0/0.1),0_10px_24px_-10px_rgb(212_146_42/0.7)] hover:brightness-[1.04]',
  glass: 'glass-dark text-white hover:bg-white/15',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-4 text-sm [&_svg]:size-4',
  md: 'min-h-12 px-6 text-[15px]',
  lg: 'min-h-14 px-7 text-base',
}
const iconSizes: Record<ButtonSize, string> = { sm: 'size-11 p-0', md: 'size-12 p-0', lg: 'size-14 p-0' }

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(base, buttonVariants[variant], sizes[size], extra)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  block?: boolean
  icon?: ReactNode
  /** Small vibration on press (Android), for key actions like Register, Send, Check in. */
  haptic?: boolean
}

export function Button({ variant = 'primary', size = 'md', loading, block, icon, haptic, className, children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(base, buttonVariants[variant], sizes[size], block && 'w-full', loading && 'btn-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (haptic) vibrate()
        onClick?.(e)
      }}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

/** Round icon-only button. `label` is required: it becomes the accessible name. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  children,
  ...rest
}: Omit<ButtonProps, 'icon' | 'block' | 'children'> & { label: string; children: ReactNode }) {
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} className={cn(iconSizes[size], variant === 'ghost' && 'text-text hover:bg-surface-2', className)} {...rest}>
      {children}
    </Button>
  )
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; icon?: ReactNode }) {
  return (
    <Link className={cn(base, buttonVariants[variant], sizes[size], block && 'w-full', className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
