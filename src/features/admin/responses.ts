// Pure summaries and spreadsheet rows for the "Responses" tab (what members answered at registration).
// Cancelled registrations are left out everywhere. Phone/email columns exist only for managers (the tab is manager-only
// and the database already hides these columns from check-in volunteers).
import { FOOD_PREFS, ORG_TEAMS, TSHIRT_SIZES } from '../../lib/constants'
import type { EventQuestion, EventRow, Registration } from '../../lib/types'
import { answerText, dayLabel, eventDayCount } from '../events/reunion'

export const live = (regs: Registration[]) => regs.filter((r) => r.status !== 'cancelled')

const foodName = (v: string | null) => FOOD_PREFS.find((x) => x.value === v)?.label ?? ''

export interface Tally {
  label: string
  value: number
}

/** Alumni and people per event day, from the per-day headcount stored on each registration. */
export function perDay(event: Pick<EventRow, 'starts_at' | 'ends_at'>, regs: Registration[], tickets: { days: number[] | null }[]) {
  const n = eventDayCount(event, tickets)
  return Array.from({ length: n }, (_, i) => {
    const day = i + 1
    const going = live(regs).filter((r) => (r.day_heads?.[String(day)] ?? 0) > 0)
    return {
      day,
      label: dayLabel(event, day),
      alumni: going.filter((r) => !r.days || r.days.includes(day)).length,
      people: going.reduce((s, r) => s + (r.day_heads?.[String(day)] ?? 0), 0),
    }
  })
}

/** Meals to order: the alumnus's choice plus each guest's own (guests without a choice are counted as "not told"). */
export function foodTally(regs: Registration[]): Tally[] {
  const c = new Map<string, number>()
  const add = (k: string | null | undefined) => c.set(k || '?', (c.get(k || '?') ?? 0) + 1)
  for (const r of live(regs)) {
    add(r.food_pref)
    for (const g of r.guests) add(g.food)
  }
  const rows = FOOD_PREFS.map((f) => ({ label: f.label, value: c.get(f.value) ?? 0 }))
  return (c.get('?') ?? 0) > 0 ? [...rows, { label: 'Not told', value: c.get('?') ?? 0 }] : rows
}

export function tshirtTally(regs: Registration[]): Tally[] {
  return TSHIRT_SIZES.map((t) => ({ label: t, value: live(regs).filter((r) => r.tshirt_size === t).length }))
}

export function teamLists(regs: Registration[]) {
  return ORG_TEAMS.map((team) => ({ team, people: live(regs).filter((r) => r.org_teams?.includes(team)) })).filter((t) => t.people.length > 0)
}

export function pickupGroups(regs: Registration[]) {
  const by = new Map<string, Registration[]>()
  for (const r of live(regs).filter((x) => x.needs_local_travel)) {
    const k = r.arrival_date ?? ''
    by.set(k, [...(by.get(k) ?? []), r])
  }
  return [...by.entries()].sort((a, b) => (a[0] || '9').localeCompare(b[0] || '9')).map(([date, people]) => ({ date, people }))
}

/** Reunion Fund: pledged by everyone, collected once the registration is fully paid and confirmed. */
export function fundTotals(regs: Registration[]) {
  const donors = live(regs).filter((r) => r.fund_paise > 0)
  const collected = donors.filter((r) => r.status === 'confirmed').reduce((s, r) => s + r.fund_paise, 0)
  const pledged = donors.reduce((s, r) => s + r.fund_paise, 0)
  return { donors, pledged, collected, waiting: pledged - collected }
}

/** Ticket money (without the Reunion Fund) of confirmed registrations. */
export function ticketRevenue(regs: Registration[]): number {
  return live(regs)
    .filter((r) => r.status === 'confirmed')
    .reduce((s, r) => s + (r.amount_paise - r.fund_paise), 0)
}

export interface QuestionSummary {
  question: EventQuestion
  answered: number
  counts: Tally[]
  texts: { name: string; text: string }[]
}

export function questionSummaries(questions: EventQuestion[], regs: Registration[]): QuestionSummary[] {
  return questions.map((q) => {
    const rows = live(regs).filter((r) => r.custom_answers?.[q.id] !== undefined)
    const counts = new Map<string, number>()
    const texts: { name: string; text: string }[] = []
    for (const r of rows) {
      const v = r.custom_answers[q.id]
      if (q.kind === 'yes_no') counts.set(v ? 'Yes' : 'No', (counts.get(v ? 'Yes' : 'No') ?? 0) + 1)
      else if (q.kind === 'single' && typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1)
      else if (q.kind === 'multi' && Array.isArray(v)) for (const o of v) counts.set(o, (counts.get(o) ?? 0) + 1)
      else if (typeof v === 'string') texts.push({ name: r.full_name, text: v })
    }
    const order = q.kind === 'yes_no' ? ['Yes', 'No'] : q.options
    return { question: q, answered: rows.length, counts: order.map((o) => ({ label: o, value: counts.get(o) ?? 0 })), texts }
  })
}

const yn = (v: boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : '')
const rupees = (p: number) => (p / 100).toFixed(2)

/** Days the registration covers, e.g. "26 Dec, 27 Dec". */
export function daysText(event: EventRow, r: Registration, tickets: { days: number[] | null }[]): string {
  const n = eventDayCount(event, tickets)
  return Array.from({ length: n }, (_, i) => i + 1)
    .filter((d) => !r.days || r.days.includes(d))
    .map((d) => dayLabel(event, d))
    .join(', ')
}

interface Fmt {
  safe: (v: string | null | undefined) => string
  asText: (v: string | null | undefined) => string
  ist: (iso: string | null) => string
}

/** One row per registration, columns in the order of the old Google Form, then the new answers. */
export function responseRow(event: EventRow, r: Registration, questions: EventQuestion[], tickets: { days: number[] | null }[], paid: number, f: Fmt) {
  const { safe, asText, ist } = f
  const row: Record<string, unknown> = {
    Timestamp: ist(r.created_at),
    Code: r.code,
    Status: r.status,
    Name: safe(r.full_name),
    'Email Id': safe(r.email),
    'Contact Number': asText(r.phone),
    'JEC Graduation Year': r.grad_year ?? '',
    Branch: r.branch ?? '',
    'Current City & Country': safe([r.city, r.country].filter(Boolean).join(', ')),
    'Current Designation & Company': safe([r.designation, r.company].filter(Boolean).join(' at ')),
    'Past Work Experience & Companies': safe(r.past_experience),
    'Interested in attending (dates)': daysText(event, r, tickets),
    'People per day': Object.entries(r.day_heads ?? {})
      .map(([d, n]) => `${dayLabel(event, Number(d))}: ${n}`)
      .join('; '),
    'Interested in Organizing teams': yn(r.org_team_interest),
    'Organizing teams': r.org_teams.join('; '),
    'Need help with accommodation': yn(r.needs_accommodation),
    'Need help with local travel': yn(r.needs_local_travel),
    'Contribute to Reunion Fund': yn(r.fund_interest),
    'Reunion Fund (₹)': rupees(r.fund_paise),
    'Interested in sponsoring': yn(r.sponsor_interest),
    'Sponsorship level': r.sponsor_level ?? '',
    'Sponsor organisation': safe(r.sponsor_org),
    'Sponsor note': safe(r.sponsor_note),
    'Interested in performing': yn(r.perform_interest),
    'Performance type': r.perform_types.join('; '),
    'Solo or group': r.perform_group === null ? '' : r.perform_group ? 'Group' : 'Solo',
    'Group members': safe(r.perform_members),
    'Performance description': safe(r.perform_description),
    'Minutes needed': r.perform_minutes ?? '',
    'Any feedback or suggestions': safe(r.feedback),
    People: r.headcount,
    'With them': safe(r.guests.map((g) => `${g.name || '(no name)'} (${g.relation ?? ''}${g.food ? `, ${foodName(g.food)}` : ''})`).join('; ')),
    Food: foodName(r.food_pref),
    'T-shirt': r.tshirt_size ?? '',
    'Badge name': safe(r.nickname),
    Hostel: safe(r.hostel),
    'Faculty to meet': safe(r.faculty_wish),
    'Song requests': safe(r.song_requests.join('; ')),
    Memory: safe(r.memory),
    'Memory wall OK': yn(r.memory_wall_consent),
    'Arriving from': safe(r.arrival_from),
    'Arrival date': r.arrival_date ?? '',
    'Arrival mode': r.arrival_mode ?? '',
    'Arrival note': safe(r.arrival_note),
    'Emergency contact': safe(r.emergency_name),
    'Emergency phone': asText(r.emergency_phone),
    'Accessibility / medical': safe(r.medical_notes),
    'Tickets (₹)': rupees(r.amount_paise - r.fund_paise),
    'Total due (₹)': rupees(r.amount_paise),
    'Paid, verified (₹)': rupees(paid),
    'Photo consent': yn(r.photo_consent),
  }
  for (const q of questions) row[`Q: ${q.label}`] = safe(answerText(r.custom_answers?.[q.id]))
  return row
}
