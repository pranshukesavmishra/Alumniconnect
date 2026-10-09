import { cn } from '../../lib/cn'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'success'
type Size = 'md' | 'lg' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.005em] transition-[background-color,box-shadow,transform] duration-150 select-none ' +
  'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-[0_8px_20px_-10px_var(--primary)] hover:bg-primary-hover',
  secondary: 'bg-surface text-text border border-border shadow-sm hover:bg-surface-2',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-on-danger hover:opacity-90',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
  success: 'bg-success text-on-success hover:opacity-90',
}

const sizes: Record<Size, string> = {
  sm: 'min-h-11 px-4 text-sm',
  md: 'min-h-12 px-6 text-[15px]',
  lg: 'min-h-14 px-7 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, block, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
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
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean; icon?: ReactNode }) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], block && 'w-full', className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
