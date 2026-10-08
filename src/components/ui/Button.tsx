import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'success'
type Size = 'md' | 'lg' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors select-none ' +
  'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.99]'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-primary border border-border hover:bg-primary-soft',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-white hover:opacity-90',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
  success: 'bg-success text-white hover:opacity-90',
}

const sizes: Record<Size, string> = {
  sm: 'min-h-9 px-3.5 text-sm',
  md: 'min-h-11 px-5 text-[15px]',
  lg: 'min-h-13 px-6 text-base',
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
      className={clsx(base, variants[variant], sizes[size], block && 'w-full', className)}
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
    <Link className={clsx(base, variants[variant], sizes[size], block && 'w-full', className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
