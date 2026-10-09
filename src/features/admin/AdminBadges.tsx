import clsx from 'clsx'
import { Printer, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { PageHeader, Page } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Notice, PageSkeleton } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Input } from '../../components/ui/Form'
import { QrCode } from '../../components/ui/QrCode'
import { buildBadges, paginate } from '../../lib/badges'
import { friendlyError } from '../../lib/errors'
import { plural } from '../../lib/format'
import type { RegistrationStatus } from '../../lib/types'
import { useAdminData, useAdminEvent, useEventCaps } from './queries'

type Scope = 'confirmed' | 'paid_or_waiting'
const PER_PAGE = 8

/** Name badges from the registration data: one for each person (guests too), 8 to an A4 sheet. Print or save as PDF. */
export function AdminBadges() {
  const { slug = '' } = useParams()
  const { data, isLoading, error } = useAdminEvent(slug)
  const caps = useEventCaps(data?.event.id)
  const admin = useAdminData(data?.event.id, caps)
  const [scope, setScope] = useState<Scope>('confirmed')
  const [guests, setGuests] = useState(true)
  const [q, setQ] = useState('')
  const [skip, setSkip] = useState<Set<string>>(new Set())

  // the print stylesheet hides the app's own navigation while this page is open
  useEffect(() => {
    document.body.classList.add('print-badges')
    return () => document.body.classList.remove('print-badges')
  }, [])

  const regs = admin.data?.registrations
  const statuses: RegistrationStatus[] = scope === 'confirmed' ? ['confirmed'] : ['confirmed', 'under_review']
  const all = useMemo(() => buildBadges(regs ?? [], { statuses, includeGuests: guests, sort: 'name' }), [regs, scope, guests]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase()
  const shown = all.filter((b) => !skip.has(b.key) && (!needle || [b.name, b.code, b.batch, b.city, b.host ?? ''].some((v) => v.toLowerCase().includes(needle))))

  if (isLoading || (admin.isLoading && !admin.data)) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!data || !caps?.finance) return <Navigate to="/admin" replace />
  if (admin.error) return <Page><Notice tone="danger" title={friendlyError(admin.error)} /></Page>

  const pages = paginate(shown, PER_PAGE)
  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="Name badges" subtitle={data.event.title} back={`/admin/events/${slug}?tab=dayof`} />
        <Page className="space-y-4">
          <ChoiceGroup<Scope>
            label="Who gets a badge"
            columns={2}
            value={scope}
            onChange={setScope}
            options={[{ value: 'confirmed', label: 'Confirmed only' }, { value: 'paid_or_waiting', label: 'Confirmed + payment being verified' }]}
          />
          <Checkbox checked={guests} onChange={setGuests}>A badge for each named guest too</Checkbox>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" aria-label="Filter badges" placeholder="Filter by name, code, batch or city" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted" data-testid="badge-count">{plural(shown.length, 'badge', 'badges')} · {plural(pages.length, 'sheet', 'sheets')} of {PER_PAGE}{skip.size ? ` · ${skip.size} left out` : ''}</p>
            <div className="flex gap-2">
              {skip.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSkip(new Set())}>Include all again</Button>}
              <Button icon={<Printer className="size-4" />} disabled={shown.length === 0} onClick={() => window.print()}>Print / save as PDF</Button>
            </div>
          </div>
          {shown.length === 0 && <Notice tone="info" title="No badges to print">Only confirmed registrations get a badge. Change the filter above to include people whose payment is still being verified.</Notice>}
        </Page>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-10 print:max-w-none print:p-0" data-testid="badge-sheets">
        {pages.map((pg, i) => (
          <section key={i} className={clsx('mb-8 grid grid-cols-2 gap-3 print:mb-0 print:gap-0', i > 0 && 'print:break-before-page', 'print:break-inside-avoid')} aria-label={`Sheet ${i + 1}`}>
            {pg.map((b) => (
              <article key={b.key} className="relative flex min-h-[15rem] flex-col justify-between rounded-2xl border border-dashed border-border bg-white p-4 text-black print:min-h-[6.2cm] print:rounded-none print:border-neutral-400" data-testid="badge">
                <button type="button" className="absolute right-2 top-2 grid size-9 place-items-center rounded-full text-xs text-neutral-500 hover:bg-neutral-100 print:hidden" aria-label={`Leave out the badge for ${b.name}`} onClick={() => setSkip((s) => new Set(s).add(b.key))}>
                  ✕
                </button>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-600">{data.event.title}</p>
                <div className="my-2">
                  <p className="text-[26px] font-extrabold leading-tight [overflow-wrap:anywhere]">{b.name}</p>
                  <p className="mt-1 text-[15px] font-semibold text-neutral-700">{[b.batch, b.city].filter(Boolean).join(' · ') || (b.host ? `With ${b.host}` : '')}</p>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="inline-block rounded-md bg-black px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">{b.role}</p>
                    <p className="mt-1 font-mono text-sm font-bold">{b.code}</p>
                    {b.food && <p className="text-xs text-neutral-600">{b.food}</p>}
                  </div>
                  <QrCode value={b.code} size={88} label={`QR code ${b.code}`} />
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
