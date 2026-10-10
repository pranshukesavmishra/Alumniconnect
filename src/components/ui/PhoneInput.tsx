import clsx from 'clsx'
import { ChevronDown, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLang, useT } from '../../i18n'
import {
  COUNTRIES,
  checkNational,
  cleanNational,
  countryByIso,
  flagEmoji,
  parsePhone,
  phoneProblem,
  rememberIso,
  rememberedIso,
  toE164,
  type Country,
} from '../../lib/phone'
import { Input } from './Form'
import { Sheet } from './Sheet'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Country names in the reader's language (and English, so a search works either way). */
function useCountryNames() {
  const { lang } = useLang()
  return useMemo(() => {
    const make = (l: string) => {
      try {
        return new Intl.DisplayNames([l], { type: 'region' })
      } catch {
        return null
      }
    }
    const local = make(lang)
    const english = make('en')
    const nameOf = (iso: string) => local?.of(iso) ?? english?.of(iso) ?? iso
    const englishOf = (iso: string) => english?.of(iso) ?? iso
    return { nameOf, englishOf }
  }, [lang])
}

/** Messages for a number that is not good yet. null when it is fine (or empty and not required). */
export function usePhoneError() {
  const tx = useT()
  const { nameOf } = useCountryNames()
  return useCallback(
    (raw: string | null | undefined, required = false): string | null => {
      const p = phoneProblem(raw)
      if (!p) return null
      if (p.kind === 'empty') return required ? tx('phone.errRequired') : null
      if (p.kind === 'format') return tx('phone.errFormat')
      const country = nameOf(p.country.iso)
      if (p.kind === 'start') return tx('phone.errStartIn')
      const params = { country, dial: p.country.dial, min: p.country.min, max: p.country.max }
      return p.country.min === p.country.max ? tx('phone.errDigits', { ...params, n: p.country.min }) : tx('phone.errRange', params)
    },
    [tx, nameOf],
  )
}

interface PhoneInputProps {
  /** E.164 ("+447700900123"), or an older stored format; '' when empty */
  value: string
  /** gets E.164 (or '' when the number box is empty) */
  onChange: (e164: string) => void
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  autoComplete?: string
  disabled?: boolean
  name?: string
}

/**
 * Pick the country (flag, name, dial code - searchable, India first), then type the national number.
 * The value going in and out is E.164, so "+91 98765 43210" and "9876543210" saved earlier open as India + the number.
 */
export function PhoneInput({ value, onChange, id, disabled, name, autoComplete = 'tel-national', ...aria }: PhoneInputProps) {
  const tx = useT()
  const { nameOf } = useCountryNames()
  const parsed = useMemo(() => parsePhone(value), [value])
  const [country, setCountry] = useState<Country>(() => parsed?.country ?? countryByIso(rememberedIso()))
  const [typed, setTyped] = useState(() => (parsed ? parsed.national : value.replace(/\D/g, '')))
  const [open, setOpen] = useState(false)
  const last = useRef(value)

  // a value that did not come from this box (the form loaded, was reset) replaces what is shown
  useEffect(() => {
    if (value === last.current) return
    last.current = value
    const p = parsePhone(value)
    if (p) {
      setCountry((cur) => (cur.dial === p.country.dial ? cur : p.country))
      setTyped(p.national)
    } else {
      setTyped(value.replace(/\D/g, ''))
    }
  }, [value])

  const emit = (c: Country, national: string) => {
    const next = toE164(c, national)
    last.current = next
    onChange(next)
  }

  const onType = (raw: string) => {
    // a whole number pasted with its "+" or 00 sets the country too
    if (/^\s*(\+|00)/.test(raw)) {
      const p = parsePhone(raw)
      if (p) {
        setCountry(p.country)
        rememberIso(p.country.iso)
        setTyped(p.national)
        emit(p.country, p.national)
        return
      }
    }
    const digits = cleanNational(country, raw.replace(/\D/g, '')).slice(0, 15)
    setTyped(digits)
    emit(country, digits)
  }

  const choose = (c: Country) => {
    setCountry(c)
    rememberIso(c.iso)
    setOpen(false)
    emit(c, typed)
  }

  const example = country.iso === 'IN' ? '98765 43210' : '123456789012'.slice(0, Math.min(country.min, 10))
  const countryLabel = tx('phone.countryAria', { country: nameOf(country.iso), dial: country.dial })
  const bad = typed.length > 0 && checkNational(country, typed) === 'long'

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={countryLabel}
          aria-haspopup="dialog"
          data-testid="phone-country"
          className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[16px] text-text hover:bg-surface-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        >
          <span aria-hidden className="text-xl leading-none">{flagEmoji(country.iso)}</span>
          <span className="tabular-nums">+{country.dial}</span>
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
        <Input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder={example}
          value={typed}
          onChange={(e) => onType(e.target.value)}
          aria-invalid={aria['aria-invalid'] || bad || undefined}
          aria-describedby={aria['aria-describedby']}
          className="min-w-0 flex-1"
        />
      </div>
      <CountrySheet open={open} onClose={() => setOpen(false)} selected={country} onPick={choose} />
    </>
  )
}

function CountrySheet({ open, onClose, selected, onPick }: { open: boolean; onClose: () => void; selected: Country; onPick: (c: Country) => void }) {
  if (!open) return null
  return <CountryList onClose={onClose} selected={selected} onPick={onPick} />
}

function CountryList({ onClose, selected, onPick }: { onClose: () => void; selected: Country; onPick: (c: Country) => void }) {
  const tx = useT()
  const { nameOf, englishOf } = useCountryNames()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const uid = useId()
  const list = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => {
    const all = COUNTRIES.map((c) => ({ c, name: nameOf(c.iso), search: fold(`${nameOf(c.iso)} ${englishOf(c.iso)} ${c.iso} +${c.dial}`) }))
    all.sort((a, b) => (a.c.iso === 'IN' ? -1 : b.c.iso === 'IN' ? 1 : a.name.localeCompare(b.name)))
    const needle = fold(q.trim())
    if (!needle) return all
    const digits = needle.replace(/\D/g, '')
    return all.filter((r) => (needle.startsWith('+') || /^\d+$/.test(needle) ? r.c.dial.startsWith(digits) : r.search.includes(needle)))
  }, [q, nameOf, englishOf])

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, rows])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = rows[active]
      if (r) onPick(r.c)
    }
  }

  return (
    <Sheet open onClose={onClose} label={tx('phone.pickTitle')}>
      <div className="sticky top-0 z-10 bg-bg px-4 pb-2 pt-1">
        <h2 className="mb-2 text-lg font-bold">{tx('phone.pickTitle')}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={rows[active] ? `${uid}-${rows[active]!.c.iso}` : undefined}
            aria-label={tx('phone.search')}
            placeholder={tx('phone.search')}
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
            className="min-h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-3 text-[16px] text-text placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted">{tx('phone.noMatch')}</p>
      ) : (
        <ul ref={list} id={`${uid}-list`} role="listbox" aria-label={tx('phone.pickTitle')} className="pb-2">
          {rows.map((r, i) => (
            <li
              key={r.c.iso}
              id={`${uid}-${r.c.iso}`}
              role="option"
              aria-selected={r.c.iso === selected.iso}
              data-active={i === active}
              onClick={() => onPick(r.c)}
              onMouseMove={() => active !== i && setActive(i)}
              className={clsx('flex min-h-12 cursor-pointer items-center gap-3 px-5 text-[16px]', i === active && 'bg-surface-2', r.c.iso === selected.iso && 'font-semibold')}
            >
              <span aria-hidden className="text-xl leading-none">{flagEmoji(r.c.iso)}</span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="tabular-nums text-muted">+{r.c.dial}</span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
