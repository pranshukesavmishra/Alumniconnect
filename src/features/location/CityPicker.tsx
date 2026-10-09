import { MapPin, Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Input } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { cityLabel, useCitySuggestions, type CitySuggestion } from './queries'

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function CityPicker({ onPick, label, placeholder }: { onPick: (c: CitySuggestion) => void; label?: string; placeholder?: string }) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebounced(text, 250)
  const { data, isFetching } = useCitySuggestions(debounced)
  const list = data ?? []
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open && debounced.length >= 2}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-label={label ?? t('nearby.searchCity')}
        placeholder={placeholder ?? t('nearby.searchPh')}
        className="pl-11"
        value={text}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault()
            setOpen(false)
            setText('')
            onPick(list[0])
          }
        }}
      />
      {open && debounced.trim().length >= 2 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t('nearby.suggestions')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-border bg-surface shadow-pop"
        >
          {list.length === 0 && !isFetching && <li className="px-4 py-3 text-sm text-muted">{t('nearby.noCity')}</li>}
          {list.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-2"
                onClick={() => {
                  setOpen(false)
                  setText('')
                  onPick(c)
                }}
              >
                <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 truncate">{cityLabel(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

