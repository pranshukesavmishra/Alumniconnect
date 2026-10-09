import { Download, Phone } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, SectionTitle } from '../../components/ui/Display'
import { formatPaise } from '../../lib/money'
import type { EventRow, Registration } from '../../lib/types'
import { useEventQuestions, useTicketTypes } from '../events/queries'
import { asText, ist, safe, saveCsv, stamp } from './export'
import type { AdminData } from './queries'
import { fundTotals, foodTally, live, perDay, pickupGroups, questionSummaries, responseRow, teamLists, ticketRevenue, tshirtTally, type Tally } from './responses'

const TEAM_NAMES: Record<string, string> = {
  core: 'Core Team',
  events: 'Events Team',
  venue_food: 'Venue & Food Team',
  transport: 'Transportation Team',
  hospitality: 'Hospitality Team',
  media: 'Photography & Media',
  other: 'Other',
}
const PERFORM_NAMES: Record<string, string> = { singing: 'Singing', dancing: 'Dancing', band: 'Band / Instrument', talk: 'Talk / Speech', poetry: 'Poetry / Shayari', comedy: 'Comedy', other: 'Other' }
const SPONSOR_NAMES: Record<string, string> = { main: 'Main sponsor', co: 'Co-sponsor', in_kind: 'In-kind', not_sure: 'Not sure yet' }

function Box({ title, count, children, id }: { title: string; count?: number | string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id}>
      <SectionTitle>
        <span id={id}>{title}</span>
        {count !== undefined && <span className="ml-2 font-semibold normal-case tracking-normal text-text">{count}</span>}
      </SectionTitle>
      <Card className="p-4">{children}</Card>
    </section>
  )
}

function Bars({ rows }: { rows: Tally[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}

function Who({ r, extra }: { r: Registration; extra?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="font-semibold">{r.full_name}</span>
        <span className="text-muted"> · {[r.grad_year, r.city].filter(Boolean).join(' · ')}</span>
        {extra && <span className="block text-muted">{extra}</span>}
      </span>
      {r.phone && (
        <a className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary" href={`tel:${r.phone.replace(/\s/g, '')}`}>
          <Phone className="size-3.5" aria-hidden /> {r.phone}
        </a>
      )}
    </li>
  )
}

const List = ({ children }: { children: ReactNode }) => <ul className="divide-y divide-border">{children}</ul>
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>

/** Everything members answered at registration, for the organisers. Managers only (phone and email are shown). */
export function AdminResponses({ event, data }: { event: EventRow; data: AdminData }) {
  const { data: tickets = [] } = useTicketTypes(event.id)
  const { data: questions = [] } = useEventQuestions(event.id)
  const regs = useMemo(() => live(data.registrations), [data.registrations])
  const days = useMemo(() => perDay(event, regs, tickets), [event, regs, tickets])
  const fund = useMemo(() => fundTotals(regs), [regs])
  const teams = useMemo(() => teamLists(regs), [regs])
  const pickups = useMemo(() => pickupGroups(regs), [regs])
  const summaries = useMemo(() => questionSummaries(questions, regs), [questions, regs])
  const paid = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of data.payments) if (p.status === 'verified' && p.method !== 'waiver') m.set(p.registration_id, (m.get(p.registration_id) ?? 0) + p.amount_paise)
    return m
  }, [data.payments])

  const accom = regs.filter((r) => r.needs_accommodation)
  const sponsors = regs.filter((r) => r.sponsor_interest)
  const performers = regs.filter((r) => r.perform_interest)
  const feedback = regs.filter((r) => r.feedback)
  const songs = regs.filter((r) => r.song_requests.length)
  const memories = regs.filter((r) => r.memory)
  const faculty = regs.filter((r) => r.faculty_wish)
  const emergency = regs.filter((r) => r.emergency_phone || r.medical_notes)

  const exportAll = () =>
    saveCsv(
      `${event.slug}-responses-${stamp()}.csv`,
      data.registrations.map((r) => responseRow(event, r, questions, tickets, paid.get(r.id) ?? 0, { safe, asText, ist })),
    )
  const exportPerformers = () =>
    saveCsv(
      `${event.slug}-performers-${stamp()}.csv`,
      performers.map((r) => ({
        Name: safe(r.full_name),
        Batch: r.grad_year ?? '',
        Contact: asText(r.phone),
        Type: r.perform_types.map((t) => PERFORM_NAMES[t] ?? t).join('; '),
        'Solo or group': r.perform_group ? 'Group' : 'Solo',
        'Group members': safe(r.perform_members),
        Description: safe(r.perform_description),
        Minutes: r.perform_minutes ?? '',
      })),
    )
  const exportSongs = () =>
    saveCsv(
      `${event.slug}-song-requests-${stamp()}.csv`,
      songs.flatMap((r) => r.song_requests.map((s) => ({ Song: safe(s), 'Requested by': safe(r.nickname || r.full_name), Batch: r.grad_year ?? '' }))),
    )

  if (data.registrations.length === 0) return <EmptyState title="No registrations yet">Answers will appear here as members register.</EmptyState>

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold">Responses</p>
          <p className="text-sm text-muted">{regs.length} registrations. Phone numbers and private notes are visible to event managers only.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download className="size-4" />} onClick={exportAll}>
            All responses (CSV)
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportPerformers} disabled={!performers.length}>
            Performers
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportSongs} disabled={!songs.length}>
            DJ song list
          </Button>
        </div>
      </Card>

      <Box id="r-days" title="Who is coming each day">
        <div className="grid gap-3 sm:grid-cols-2">
          {days.map((d) => (
            <div key={d.day} className="rounded-xl bg-surface-2 p-3">
              <p className="text-sm font-semibold">{d.label}</p>
              <p className="text-2xl font-bold tabular-nums">{d.people}</p>
              <p className="text-sm text-muted">
                people (including family) · {d.alumni} alumni
              </p>
            </div>
          ))}
        </div>
      </Box>

      <div className="grid gap-6 lg:grid-cols-2">
        <Box id="r-food" title="Meals (alumni + guests)">
          <Bars rows={foodTally(regs)} />
        </Box>
        <Box id="r-tshirt" title="T-shirts (alumni)">
          <Bars rows={tshirtTally(regs)} />
        </Box>
      </div>

      <Box id="r-fund" title="Reunion Fund" count={formatPaise(fund.pledged, { zeroAsFree: false })}>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted">Pledged</dt>
            <dd className="font-bold tabular-nums">{formatPaise(fund.pledged, { zeroAsFree: false })}</dd>
          </div>
          <div>
            <dt className="text-muted">Collected</dt>
            <dd className="font-bold tabular-nums text-success">{formatPaise(fund.collected, { zeroAsFree: false })}</dd>
          </div>
          <div>
            <dt className="text-muted">Waiting for payment</dt>
            <dd className="font-bold tabular-nums">{formatPaise(fund.waiting, { zeroAsFree: false })}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">Ticket revenue (confirmed, without the fund): {formatPaise(ticketRevenue(regs), { zeroAsFree: false })}. The fund is kept separate from ticket money.</p>
        {fund.donors.length > 0 && (
          <div className="mt-3">
            <List>
              {fund.donors.map((r) => (
                <Who key={r.id} r={r} extra={`${formatPaise(r.fund_paise)} · ${r.status === 'confirmed' ? 'paid' : 'not paid yet'}`} />
              ))}
            </List>
          </div>
        )}
      </Box>

      <Box id="r-teams" title="Volunteers by team" count={regs.filter((r) => r.org_team_interest).length}>
        {teams.length === 0 ? (
          <Empty>No one has offered to help yet.</Empty>
        ) : (
          <div className="space-y-4">
            {teams.map((t) => (
              <div key={t.team}>
                <p className="font-semibold">
                  {TEAM_NAMES[t.team]} <span className="text-muted">· {t.people.length}</span>
                </p>
                <List>
                  {t.people.map((r) => (
                    <Who key={r.id} r={r} />
                  ))}
                </List>
              </div>
            ))}
          </div>
        )}
      </Box>

      <Box id="r-perf" title="Performers" count={performers.length}>
        {performers.length === 0 ? (
          <Empty>No performance offers yet.</Empty>
        ) : (
          <List>
            {performers.map((r) => (
              <Who key={r.id} r={r} extra={`${r.perform_types.map((t) => PERFORM_NAMES[t] ?? t).join(', ')} · ${r.perform_group ? `group${r.perform_members ? ` (${r.perform_members})` : ''}` : 'solo'} · ${r.perform_minutes} min${r.perform_description ? ` · ${r.perform_description}` : ''}`} />
            ))}
          </List>
        )}
      </Box>

      <Box id="r-sponsor" title="Sponsor leads" count={sponsors.length}>
        {sponsors.length === 0 ? (
          <Empty>No sponsorship interest yet.</Empty>
        ) : (
          <List>
            {sponsors.map((r) => (
              <Who key={r.id} r={r} extra={`${SPONSOR_NAMES[r.sponsor_level ?? ''] ?? r.sponsor_level} · ${r.sponsor_org}${r.sponsor_note ? ` · ${r.sponsor_note}` : ''}${r.email ? ` · ${r.email}` : ''}`} />
            ))}
          </List>
        )}
      </Box>

      <div className="grid gap-6 lg:grid-cols-2">
        <Box id="r-accom" title="Needs help with accommodation" count={accom.length}>
          {accom.length === 0 ? (
            <Empty>No one yet.</Empty>
          ) : (
            <List>
              {accom.map((r) => (
                <Who key={r.id} r={r} extra={[r.arrival_date, r.arrival_note].filter(Boolean).join(' · ') || undefined} />
              ))}
            </List>
          )}
        </Box>
        <Box id="r-travel" title="Needs help with local travel / pickup" count={pickups.reduce((s, g) => s + g.people.length, 0)}>
          {pickups.length === 0 ? (
            <Empty>No one yet.</Empty>
          ) : (
            <div className="space-y-3">
              {pickups.map((g) => (
                <div key={g.date || 'none'}>
                  <p className="text-sm font-semibold">{g.date ? new Date(`${g.date}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : 'Arrival date not given'}</p>
                  <List>
                    {g.people.map((r) => (
                      <Who key={r.id} r={r} extra={[r.arrival_from && `from ${r.arrival_from}`, r.arrival_mode, r.arrival_note].filter(Boolean).join(' · ') || undefined} />
                    ))}
                  </List>
                </div>
              ))}
            </div>
          )}
        </Box>
      </div>

      <Box id="r-feedback" title="Feedback and suggestions" count={feedback.length}>
        {feedback.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ul className="space-y-3">
            {feedback.map((r) => (
              <li key={r.id} className="rounded-xl bg-surface-2 p-3 text-sm">
                <p className="whitespace-pre-line">{r.feedback}</p>
                <p className="mt-1 text-xs text-muted">
                  {r.full_name} · {r.grad_year ?? ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Box>

      {summaries.length > 0 && (
        <Box id="r-custom" title="Your own questions">
          <div className="space-y-5">
            {summaries.map((s) => (
              <div key={s.question.id}>
                <p className="font-semibold">
                  {s.question.label} <span className="text-sm font-normal text-muted">· {s.answered} answered{!s.question.is_active ? ' · switched off' : ''}</span>
                </p>
                {s.counts.length > 0 && s.question.kind !== 'short_text' && s.question.kind !== 'long_text' && <Bars rows={s.counts} />}
                {s.texts.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {s.texts.map((t, i) => (
                      <li key={i}>
                        <span className="text-muted">{t.name}:</span> {t.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Box>
      )}

      <Box id="r-memorable" title="Make it memorable">
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold">Song requests · {songs.length}</p>
            {songs.length === 0 ? <Empty>None yet.</Empty> : <p>{songs.flatMap((r) => r.song_requests).join(' · ')}</p>}
          </div>
          <div>
            <p className="font-semibold">Faculty members they would love to meet · {faculty.length}</p>
            {faculty.map((r) => (
              <p key={r.id}>
                <span className="text-muted">{r.full_name}:</span> {r.faculty_wish}
              </p>
            ))}
          </div>
          <div>
            <p className="font-semibold">Memories and shout-outs · {memories.length}</p>
            {memories.map((r) => (
              <p key={r.id}>
                {r.memory} <span className="text-muted">({r.full_name}{r.memory_wall_consent ? ', OK for the memory wall' : ', not for the wall'})</span>
              </p>
            ))}
          </div>
        </div>
      </Box>

      <Box id="r-private" title="Emergency contacts and medical needs (private)" count={emergency.length}>
        {emergency.length === 0 ? (
          <Empty>None given.</Empty>
        ) : (
          <List>
            {emergency.map((r) => (
              <Who key={r.id} r={r} extra={[r.emergency_name && `Emergency: ${r.emergency_name} ${r.emergency_phone ?? ''}`, r.medical_notes && `Needs: ${r.medical_notes}`].filter(Boolean).join(' · ')} />
            ))}
          </List>
        )}
      </Box>
    </div>
  )
}
