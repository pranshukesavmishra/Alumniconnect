import { cn } from '../../lib/cn'
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useT } from '../../i18n'

// Design System 2.0: these live in their own files now; re-exported so existing imports keep working.
export { Card, GlassPanel, SectionHeader, Divider, cardClass, type CardVariant } from './Card'
export { Avatar, AvatarStack, avatarGradient, initialsOf } from './Avatar'
export { Skeleton, SkeletonRow, SkeletonCard, SkeletonProfile, SkeletonList } from './Skeleton'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'official' | 'gold' | 'info' | 'founding' | 'solid'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border/70',
  primary: 'bg-primary-soft text-primary border-primary/15',
  success: 'bg-success-soft text-success border-success/15',
  warning: 'bg-warning-soft text-warning border-warning/15',
  danger: 'bg-danger-soft text-danger border-danger/15',
  accent: 'bg-accent-soft text-warning border-accent/25',
  info: 'bg-info-soft text-info border-info/15',
  /** crest maroon: official / verified-by-JEC markers, used sparingly */
  official: 'bg-official text-on-official border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]',
  /** gold foil: honours ("Founding member", "Patron", sponsor tiers) */
  gold: 'bg-accent-soft text-gold-ink border-accent/40',
  founding: 'bg-(image:--grad-gold) text-on-accent border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]',
  solid: 'bg-primary text-on-primary border-transparent',
}

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 [&_svg]:size-3.5',
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** A selectable pill (filters, interests). Toggle state is exposed with aria-pressed. 44px tall tap target. */
export function Chip({
  selected,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'tap inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors [&_svg]:size-4',
        selected
          ? 'border-transparent bg-primary text-on-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_14px_-8px_var(--primary-glow)]'
          : 'border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

const noticeIcon = { info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle }

export function Notice({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children?: ReactNode
  className?: string
  action?: ReactNode
}) {
  const Icon = noticeIcon[tone]
  const cls = {
    info: 'bg-primary-soft/70 border-primary/15',
    success: 'bg-success-soft/80 border-success/15',
    warning: 'bg-warning-soft/80 border-warning/20',
    danger: 'bg-danger-soft/80 border-danger/20',
  }[tone]
  const iconCls = {
    info: 'text-primary bg-primary/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/12',
    danger: 'text-danger bg-danger/12',
  }[tone]
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-4 text-text', cls, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', iconCls)} aria-hidden>
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 space-y-1 self-center text-[15px]">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className="text-muted [&_strong]:text-text">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  )
}

export function PageSkeleton() {
  const tx = useT()
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" aria-busy="true" aria-label={tx('common.loading')}>
      <div className="skeleton h-8 w-2/3 rounded-xl" />
      <div className="skeleton h-40 w-full rounded-3xl" />
      <div className="skeleton h-20 w-full rounded-3xl" />
      <div className="skeleton h-20 w-full rounded-3xl" />
    </div>
  )
}

/**
 * Nothing to show yet. Give it an `illustration` (from ./Illustrations) for big moments, or an `icon` (lucide element)
 * which is shown in a soft brand tile with a glow.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  children,
  action,
  className,
  compact,
}: {
  icon?: ReactNode
  illustration?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-8' : 'py-12', className)}>
      {illustration ? (
        <div className="mb-4 w-full max-w-[220px] [&_svg]:h-auto [&_svg]:w-full" aria-hidden>
          {illustration}
        </div>
      ) : icon ? (
        <div className="relative mb-4" aria-hidden>
          <span className="absolute inset-0 -z-0 scale-150 rounded-full bg-primary/10 blur-xl" />
          <span className="relative grid size-16 place-items-center rounded-[22px] border border-primary/10 bg-primary-soft text-primary shadow-[inset_0_1px_0_var(--highlight)] [&_svg]:size-7 [&_svg]:stroke-[1.8]">
            {icon}
          </span>
        </div>
      ) : null}
      <p className="font-display text-[21px] font-semibold leading-tight tracking-[-0.015em]">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-[15px] text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Legacy small uppercase section label (still fine for dense lists). For new screens prefer SectionHeader. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[15px] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[15px] font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
