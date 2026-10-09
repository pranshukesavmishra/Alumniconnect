import clsx from 'clsx'
import { Check, Minus, Plus } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { useT } from '../../i18n'

const control =
  'w-full rounded-xl border border-border bg-surface px-3.5 min-h-12 text-[16px] text-text placeholder:text-muted/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60 ' +
  'aria-[invalid=true]:border-danger'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, optional, children, className }: FieldProps) {
  const tx = useT()
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-text">
        {label}
        {optional && <span className="font-normal text-muted"> ({tx('common.optional')})</span>}
      </label>
      {children({ id, 'aria-describedby': hint || error ? hintId : undefined, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={hintId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={clsx(control, className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={clsx(control, 'py-3 min-h-24', className)} {...rest} />
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select
      className={clsx(
        control,
        'appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%235b6475%27 stroke-width=%272%27 viewBox=%270 0 24 24%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-no-repeat bg-[right_0.9rem_center] pr-10',
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
                'relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                checked ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50',
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
                  'grid size-5 shrink-0 place-items-center rounded-full border-2',
                  checked ? 'border-primary bg-primary text-on-primary' : 'border-border',
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
            'grid size-5 place-items-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
            checked ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface',
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
    <div className="inline-flex items-center rounded-full border border-border bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        className="grid size-11 place-items-center rounded-full text-primary disabled:opacity-30"
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
        className="grid size-11 place-items-center rounded-full text-primary disabled:opacity-30"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={tx('common.more', { label })}
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
