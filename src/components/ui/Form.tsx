import clsx from 'clsx'
import { Check, CheckCircle2, Minus, Plus } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'

/** Shared control look: 48px+, 14px radius, soft inset, a calm 4px focus halo, clear invalid state. */
export const control =
  'w-full rounded-[14px] border border-border bg-surface px-3.5 min-h-12 text-[16px] text-text placeholder:text-subtle ' +
  'shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/15 disabled:opacity-60 disabled:bg-surface-2 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  /** a short confirmation shown in green under the control (e.g. "Looks good") */
  success?: ReactNode
  optional?: boolean
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, success, optional, children, className }: FieldProps) {
  const tx = useT()
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold tracking-[-0.005em] text-text">
        {label}
        {optional && <span className="font-normal text-muted"> ({tx('common.optional')})</span>}
      </label>
      {children({ id, 'aria-describedby': hint || error || success ? hintId : undefined, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={hintId} className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : success ? (
        <p id={hintId} className="flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {success}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Text input. `leading` / `trailing` add adornments inside the field (an icon, "₹", a unit, a clear button);
 * without them it renders a bare <input> exactly as before.
 */
export function Input({ className, leading, trailing, ...rest }: ComponentProps<'input'> & { leading?: ReactNode; trailing?: ReactNode }) {
  if (!leading && !trailing) return <input className={cn(control, className)} {...rest} />
  return (
    <div className="relative">
      {leading && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted [&_svg]:size-[18px]">{leading}</span>}
      <input className={cn(control, leading && 'pl-11', trailing && 'pr-12', className)} {...rest} />
      {trailing && <span className="absolute inset-y-0 right-1 flex items-center text-muted [&_svg]:size-[18px]">{trailing}</span>}
    </div>
  )
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'py-3 min-h-24 leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        control,
        'cursor-pointer appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%235b6475%27 stroke-width=%272%27 viewBox=%270 0 24 24%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-no-repeat bg-[right_0.9rem_center] pr-10',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

interface ChoiceOption<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Large radio cards: easier than a dropdown for 2–6 options. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 1,
  error,
}: {
  label: string
  options: readonly ChoiceOption<T>[]
  value: T | null | undefined
  onChange: (v: T) => void
  columns?: 1 | 2 | 3 | 4
  error?: string | null
}) {
  const name = useId()
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className={clsx('grid gap-2', { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[columns])}>
        {options.map((o) => {
          const checked = value === o.value
          return (
            <label
              key={o.value}
              className={clsx(
                'tap relative flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] border px-3.5 py-2.5 transition-[border-color,background-color,box-shadow] duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ring/20',
                checked
                  ? 'border-primary bg-primary-soft shadow-[0_0_0_1px_var(--primary),0_6px_16px_-10px_var(--primary-glow)]'
                  : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2/60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={clsx(
                  'grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                  checked ? 'border-primary bg-primary text-on-primary' : 'border-border-strong',
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium leading-tight">{o.label}</span>
                {o.hint && <span className="block text-sm text-muted">{o.hint}</span>}
              </span>
            </label>
          )
        })}
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
}) {
  const id = useId()
  // The box has its own 44px tap target; the text is a label too, but links inside it stay tappable on their own.
  return (
    <div className="flex items-start gap-1">
      <span className="relative -ml-3 grid size-11 shrink-0 place-items-center">
        <input
          id={id}
          type="checkbox"
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className={clsx(
            'grid size-[22px] place-items-center rounded-[7px] border-2 transition-[background-color,border-color,transform] duration-150 peer-focus-visible:ring-4 peer-focus-visible:ring-ring/25 peer-active:scale-90',
            checked ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface',
          )}
        >
          {checked && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </span>
      <label htmlFor={id} className="cursor-pointer pt-2.5 text-[15px] leading-snug">
        {children}
      </label>
    </div>
  )
}

export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
}: {
  value: number
  min?: number
  max: number
  onChange: (v: number) => void
  label: string
}) {
  const tx = useT()
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-surface shadow-e1" role="group" aria-label={label}>
      <button
        type="button"
        className="tap grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft disabled:opacity-30"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={tx('common.fewer', { label })}
      >
        <Minus className="size-4" />
      </button>
      <output className="w-7 text-center text-base font-semibold tabular-nums" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="tap grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft disabled:opacity-30"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={tx('common.more', { label })}
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

/** Radio cards — the same control as ChoiceGroup, named for what it looks like. */
export const RadioCards = ChoiceGroup

/**
 * On/off switch (role="switch"), animated thumb. Use for settings that apply immediately.
 * With `label` it renders a full-width row (label left, switch right); without, pass `aria-label`.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  'aria-label': ariaLabel,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  hint?: ReactNode
  disabled?: boolean
  'aria-label'?: string
  className?: string
}) {
  const id = useId()
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={hint ? `${id}-h` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group relative inline-flex h-11 w-[60px] shrink-0 items-center justify-center disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-[30px] w-[52px] rounded-full border transition-[background-color,border-color] duration-200',
          checked ? 'border-transparent bg-primary bg-(image:--grad-primary)' : 'border-border-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25),0_4px_10px_-4px_rgb(0_0_0/0.3)] transition-[left,width] duration-300 ease-[var(--ease-spring)] group-active:w-7',
            checked ? 'left-[24px] group-active:left-[20px]' : 'left-[2px]',
          )}
        />
      </span>
    </button>
  )
  if (!label) return <span className={className}>{sw}</span>
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && (
          <span id={`${id}-h`} className="block text-sm text-muted">
            {hint}
          </span>
        )}
      </label>
      {sw}
    </div>
  )
}
