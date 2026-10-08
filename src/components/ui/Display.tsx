import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-2xl border border-border bg-surface', className)} {...rest} />
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-warning',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', toneClass[tone], className)}>
      {children}
    </span>
  )
}

const noticeIcon = { info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle }

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const Icon = noticeIcon[tone]
  const cls = {
    info: 'bg-primary-soft text-text',
    success: 'bg-success-soft text-text',
    warning: 'bg-warning-soft text-text',
    danger: 'bg-danger-soft text-text',
  }[tone]
  const iconCls = { info: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone]
  return (
    <div className={clsx('flex gap-3 rounded-2xl p-4', cls, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className={clsx('mt-0.5 size-5 shrink-0', iconCls)} aria-hidden />
      <div className="min-w-0 space-y-1 text-[15px]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted [&_strong]:text-text">{children}</div>}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-xl', className)} aria-hidden />
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[15px] text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Avatar({ src, name, size = 48, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  return (
    <span
      className={clsx('inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft font-semibold text-primary', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : initials}
    </span>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-[15px] text-muted">{label}</dt>
      <dd className="text-right text-[15px] font-medium">{children}</dd>
    </div>
  )
}
