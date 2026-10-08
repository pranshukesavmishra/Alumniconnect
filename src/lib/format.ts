const TZ = 'Asia/Kolkata'

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts }).format(new Date(iso))
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "26–27 Dec 2026" or "26 Dec 2026" */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'Date to be announced'
  const s = new Date(start)
  const e = end ? new Date(end) : null
  const day = (d: Date) => formatDate(d.toISOString(), { day: 'numeric' })
  if (!e || formatDate(start) === formatDate(e.toISOString())) return formatDate(start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const sameMonth = formatDate(start, { month: 'short', year: 'numeric' }) === formatDate(e.toISOString(), { month: 'short', year: 'numeric' })
  return sameMonth
    ? `${day(s)}–${formatDate(e.toISOString(), { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${formatDate(start, { day: 'numeric', month: 'short' })} – ${formatDate(e.toISOString())}`
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return formatDate(iso)
}
