import clsx from 'clsx'
import { Download, Phone, Printer, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, EmptyState, Notice, SectionTitle, Skeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDate, plural } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { EventRow } from '../../lib/types'
import { ArrivalsCounter, GateSearch } from './CheckInTools'
import { saveCsv, spreadsheetSafe } from './export'
import { loggedExport } from './exportLog'
import { useArrivals, useAttendance } from './opsQueries'
import { telHref } from '../../lib/phone'

const hourLabel = (h: string) => {
  const [day, time] = h.split(' ')
  return `${formatDate(day)} ${time}`
}

/** The day itself: live arrivals, find-and-check-in at the desk, badges, and who has not come. */
export function AdminDayOf({ event, manager }: { event: EventRow; manager: boolean }) {
  const qc = useQueryClient()
  const arrivals = useArrivals(event.id)
  const attendance = useAttendance(event.id, manager)

  async function checkIn(code: string) {
    const { data, error } = await supabase.rpc('check_in', { p_event: event.id, p_code: code, p_undo: false })
    if (error) return void toast.error(friendlyError(error))
    const row = (data as { registration: { full_name: string; status: string; headcount: number }; already_checked_in: boolean }[])[0]
    if (!row) return
    if (row.registration.status !== 'confirmed') toast.error(`${row.registration.full_name} is not confirmed: send them to the help desk.`)
    else if (row.already_checked_in) toast.message(`${row.registration.full_name} was already checked in.`)
    else toast.success(`Welcome, ${row.registration.full_name} (${plural(row.registration.headcount, 'person', 'people')})`)
    void qc.invalidateQueries({ queryKey: ['event-arrivals', event.id] })
    void qc.invalidateQueries({ queryKey: ['admin-data', event.id] })
    void qc.invalidateQueries({ queryKey: ['event-attendance', event.id] })
  }

  const a = arrivals.data
  const maxHour = Math.max(1, ...(a?.hourly.map((h) => h.people) ?? [1]))

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3">
        <ArrivalsCounter eventId={event.id} />
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/admin/events/${event.slug}/check-in`} icon={<ScanLine className="size-4" />}>Open the QR scanner</ButtonLink>
          {manager && <ButtonLink to={`/admin/events/${event.slug}/badges`} variant="secondary" icon={<Printer className="size-4" />}>Print name badges</ButtonLink>}
        </div>
      </div>

      <section className="space-y-2">
        <SectionTitle>Find and check in</SectionTitle>
        <GateSearch eventId={event.id} onPick={checkIn} />
      </section>

      {arrivals.isError && <Notice tone="danger" title={friendlyError(arrivals.error)} />}

      {a && a.days.length > 0 && (
        <section className="space-y-2" aria-label="Arrivals per day">
          <SectionTitle>Per day</SectionTitle>
          <Card className="divide-y divide-border">
            {a.days.map((d) => {
              const pct = d.capacity ? Math.min(100, Math.round((d.people / d.capacity) * 100)) : 0
              const full = !!d.capacity && d.people >= d.capacity
              return (
                <div key={d.day} className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{formatDate(d.day)}{d.label ? ` · ${d.label}` : ''}</span>
                    <span className={clsx('tabular-nums', full && 'font-bold text-danger')}>{d.people}{d.capacity ? ` / ${d.capacity}` : ''} people{full ? ' · full' : ''}</span>
                  </div>
                  {d.capacity && (
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${formatDate(d.day)} capacity used`}>
                      <div className={clsx('h-full rounded-full', full ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <SectionTitle>Just arrived</SectionTitle>
        {!a ? (
          <Skeleton className="h-24" />
        ) : a.recent.length === 0 ? (
          <p className="text-sm text-muted">No one has checked in yet.</p>
        ) : (
          <Card className="divide-y divide-border">
            {a.recent.map((r) => (
              <div key={r.code + r.at} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0 truncate font-semibold">{r.full_name} <span className="font-normal text-muted">· {plural(r.headcount, 'person', 'people')}</span></span>
                <span className="shrink-0 text-muted">{new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
              </div>
            ))}
          </Card>
        )}
        {!!a?.hourly.length && (
          <ul className="space-y-1.5 pt-2" aria-label="Arrivals by hour">
            {a.hourly.map((h) => (
              <li key={h.hour} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="truncate text-muted">{hourLabel(h.hour)}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(h.people / maxHour) * 100}%` }} /></span>
                <span className="text-right font-semibold tabular-nums">{h.people}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manager && (
        <section className="space-y-3" aria-label="Attendance report">
          <SectionTitle>Attendance by batch</SectionTitle>
          {attendance.isLoading ? (
            <Skeleton className="h-32" />
          ) : attendance.isError ? (
            <Notice tone="danger" title={friendlyError(attendance.error)} />
          ) : !attendance.data || attendance.data.by_batch.length === 0 ? (
            <EmptyState title="No confirmed registrations yet" />
          ) : (
            <>
              <Card className="overflow-x-auto p-4">
                <table className="w-full min-w-[18rem] text-left text-sm">
                  <thead><tr className="text-muted"><th scope="col" className="py-1.5 font-medium">Batch</th><th scope="col" className="py-1.5 text-right font-medium">Confirmed</th><th scope="col" className="py-1.5 text-right font-medium">Arrived</th><th scope="col" className="py-1.5 text-right font-medium">Not yet</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {attendance.data.by_batch.map((b) => (
                      <tr key={String(b.batch)}>
                        <td className="py-2 font-medium">{b.batch ?? 'Unknown'}</td>
                        <td className="py-2 text-right tabular-nums">{b.confirmed}</td>
                        <td className="py-2 text-right tabular-nums">{b.arrived}</td>
                        <td className={clsx('py-2 text-right tabular-nums', b.no_show > 0 && 'font-semibold text-warning')}>{b.no_show}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{plural(attendance.data.no_shows.length, 'confirmed registration', 'confirmed registrations')} not arrived</p>
                <Button size="sm" variant="secondary" icon={<Download className="size-4" />} disabled={attendance.data.no_shows.length === 0}
                  onClick={() => loggedExport(event.id, 'not_arrived', attendance.data!.no_shows.length, () => saveCsv(`${event.slug}-not-arrived.csv`, attendance.data!.no_shows.map((n) => ({ Code: n.code, Name: spreadsheetSafe(n.full_name), Batch: n.batch ?? '', Branch: n.branch ?? '', People: n.headcount, Mobile: n.phone ? `="${n.phone.replace(/"/g, '')}"` : '' }))))}>
                  CSV
                </Button>
              </div>
              {attendance.data.no_shows.length > 0 && (
                <Card className="divide-y divide-border" data-testid="no-shows">
                  {attendance.data.no_shows.slice(0, 50).map((n) => (
                    <div key={n.code} className="flex items-center gap-3 p-3 text-sm">
                      <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{n.full_name}</span> <span className="text-muted">· {n.code} · {plural(n.headcount, 'person', 'people')}</span></span>
                      {n.phone && (
                        <a href={telHref(n.phone)} className="grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label={`Call ${n.full_name}`}>
                          <Phone className="size-4" />
                        </a>
                      )}
                    </div>
                  ))}
                  {attendance.data.no_shows.length > 50 && <p className="p-3 text-xs text-muted">Showing 50. Download the CSV for everyone.</p>}
                </Card>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
