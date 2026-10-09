import { Card, KeyValue } from '../../components/ui/Display'
import { formatPaise } from '../../lib/money'
import type { EventRow, Registration } from '../../lib/types'
import { useEventQuestions, useTicketTypes } from '../events/queries'
import { answerText } from '../events/reunion'
import { daysText } from './responses'

const TEAMS: Record<string, string> = { core: 'Core', events: 'Events', venue_food: 'Venue & Food', transport: 'Transportation', hospitality: 'Hospitality', media: 'Photography & Media', other: 'Other' }
const LEVELS: Record<string, string> = { main: 'Main sponsor', co: 'Co-sponsor', in_kind: 'In-kind', not_sure: 'Not sure yet' }
const yn = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No')

/** The reunion answers of one registration in the admin person view. Private fields only for event managers. */
export function AdminReunionDetail({ event, reg, manager }: { event: EventRow; reg: Registration; manager: boolean }) {
  const { data: tickets = [] } = useTicketTypes(event.id)
  const { data: questions = [] } = useEventQuestions(event.id)
  return (
    <Card className="mt-4 px-4" aria-label="Reunion answers">
      <dl className="divide-y divide-border">
        <KeyValue label="Days">{daysText(event, reg, tickets) || '—'}</KeyValue>
        <KeyValue label="Country">{reg.country ?? '—'}</KeyValue>
        <KeyValue label="Designation">{[reg.designation, reg.company].filter(Boolean).join(' at ') || '—'}</KeyValue>
        {reg.past_experience && <KeyValue label="Past experience">{reg.past_experience}</KeyValue>}
        <KeyValue label="Local travel">{reg.needs_local_travel ? 'Needs help' : 'No'}</KeyValue>
        <KeyValue label="Organising team">{reg.org_team_interest ? reg.org_teams.map((t) => TEAMS[t] ?? t).join(', ') : yn(reg.org_team_interest)}</KeyValue>
        {manager && (
          <>
            <KeyValue label="Reunion Fund">{reg.fund_paise > 0 ? formatPaise(reg.fund_paise) : yn(reg.fund_interest)}</KeyValue>
            <KeyValue label="Sponsorship">
              {reg.sponsor_interest ? `${LEVELS[reg.sponsor_level ?? ''] ?? reg.sponsor_level} · ${reg.sponsor_org ?? ''}${reg.sponsor_note ? ` · ${reg.sponsor_note}` : ''}` : yn(reg.sponsor_interest)}
            </KeyValue>
          </>
        )}
        <KeyValue label="Performance">
          {reg.perform_interest ? `${reg.perform_types.join(', ')} · ${reg.perform_group ? 'group' : 'solo'} · ${reg.perform_minutes} min${reg.perform_description ? ` · ${reg.perform_description}` : ''}` : yn(reg.perform_interest)}
        </KeyValue>
        {reg.nickname && <KeyValue label="Badge name">{reg.nickname}</KeyValue>}
        {reg.hostel && <KeyValue label="Hostel">{reg.hostel}</KeyValue>}
        {reg.faculty_wish && <KeyValue label="Faculty to meet">{reg.faculty_wish}</KeyValue>}
        {reg.song_requests.length > 0 && <KeyValue label="Songs">{reg.song_requests.join(', ')}</KeyValue>}
        {reg.memory && (
          <KeyValue label="Memory">
            {reg.memory}
            {reg.memory_wall_consent ? ' (OK for the memory wall)' : ''}
          </KeyValue>
        )}
        {(reg.arrival_from || reg.arrival_date || reg.arrival_mode) && <KeyValue label="Arrival">{[reg.arrival_from, reg.arrival_date, reg.arrival_mode].filter(Boolean).join(' · ')}</KeyValue>}
        {manager && reg.emergency_phone && <KeyValue label="Emergency contact">{`${reg.emergency_name ?? ''} ${reg.emergency_phone}`}</KeyValue>}
        {manager && reg.medical_notes && <KeyValue label="Accessibility / medical">{reg.medical_notes}</KeyValue>}
        {manager && reg.feedback && <KeyValue label="Feedback">{reg.feedback}</KeyValue>}
        {questions
          .filter((q) => reg.custom_answers?.[q.id] !== undefined)
          .map((q) => (
            <KeyValue key={q.id} label={q.label}>
              {answerText(reg.custom_answers[q.id])}
            </KeyValue>
          ))}
      </dl>
    </Card>
  )
}
