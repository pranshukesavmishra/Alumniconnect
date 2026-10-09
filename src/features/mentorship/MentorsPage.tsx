import clsx from 'clsx'
import { GraduationCap, MessageCircle, Search, UserRoundPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import {
  MENTOR_TOPICS,
  useEndMentorship,
  useMentors,
  useMyMentorProfile,
  useMyMentorships,
  usePauseMentoring,
  useRequestMentor,
  useRespondMentorship,
  useSaveMentorProfile,
  type MentorProfile,
  type MentorRow,
  type MentorshipRow,
} from './queries'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={clsx('min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold', active ? 'bg-primary text-on-primary' : 'border border-border bg-surface')}>
      {children}
    </button>
  )
}

export function MentorsPage() {
  const { pathname } = useLocation()
  const mine = pathname.endsWith('/mine')
  const { data: me } = useMyProfile()
  const profile = useMyMentorProfile()
  const [editing, setEditing] = useState(false)
  const pause = usePauseMentoring()
  const verified = me?.verification === 'verified' || !!me?.is_admin
  const mp = profile.data

  return (
    <div>
      <PageHeader
        title="Mentorship"
        subtitle="Learn from seniors, guide the next batch"
        back="/"
        action={
          verified && (
            <Button size="sm" variant={mp ? 'secondary' : 'primary'} icon={<UserRoundPlus className="size-4" />} onClick={() => setEditing(true)}>
              {mp ? 'My mentor profile' : 'Become a mentor'}
            </Button>
          )
        }
      />
      <Page className="space-y-4">
        <nav className="grid grid-cols-2 gap-1 rounded-full border border-border bg-surface p-1" aria-label="Mentorship sections">
          <Link to="/mentors" aria-current={!mine ? 'page' : undefined} className={clsx('grid min-h-11 place-items-center rounded-full text-sm font-semibold', !mine ? 'bg-primary text-on-primary' : 'text-muted')}>
            Find a mentor
          </Link>
          <Link to="/mentors/mine" aria-current={mine ? 'page' : undefined} className={clsx('grid min-h-11 place-items-center rounded-full text-sm font-semibold', mine ? 'bg-primary text-on-primary' : 'text-muted')}>
            My mentorships
          </Link>
        </nav>
        {mp && (
          <Card className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold">You are a mentor</p>
              <p className="text-sm text-muted">{mp.is_accepting ? `Taking new mentees (up to ${mp.max_mentees})` : 'Paused: no new requests'}</p>
            </div>
            <Button size="sm" variant="secondary" loading={pause.isPending} onClick={() => pause.mutate(!mp.is_accepting, { onError: (e) => toast.error(friendlyError(e)) })}>
              {mp.is_accepting ? 'Pause' : 'Resume'}
            </Button>
          </Card>
        )}
        {mine ? <MyMentorships /> : <FindMentors verified={verified} />}
      </Page>
      <MentorProfileSheet open={editing} onClose={() => setEditing(false)} current={mp ?? null} />
    </div>
  )
}

// ------------------------------------------------------------------ find a mentor
function FindMentors({ verified }: { verified: boolean }) {
  const uid = useUserId()
  const [topic, setTopic] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [requesting, setRequesting] = useState<MentorRow | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const list = useMentors(topic, dq)
  const rows = list.data?.pages.flat() ?? []

  return (
    <>
      <label className="relative block">
        <span className="sr-only">Search mentors</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, company or branch" className="min-h-12 w-full rounded-full border border-border bg-surface pl-12 pr-4 text-[16px] focus:border-primary focus:outline-none" />
      </label>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Topics">
        {MENTOR_TOPICS.map((t) => (
          <Chip key={t} active={topic === t} onClick={() => setTopic(topic === t ? null : t)}>
            {t}
          </Chip>
        ))}
      </div>
      {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
      {list.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-3xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<GraduationCap />} title={topic || dq ? 'No mentors match' : 'No mentors yet'}>
          {topic || dq ? 'Try a different topic or search.' : 'Be the first: tap “Become a mentor” and share what you can guide others on.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Mentors">
          {rows.map((m) => (
            <li key={m.user_id}>
              <MentorCard m={m} mine={m.user_id === uid} canRequest={verified} onRequest={() => setRequesting(m)} />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          Show more
        </Button>
      )}
      <RequestSheet mentor={requesting} onClose={() => setRequesting(null)} />
    </>
  )
}

function MentorCard({ m, mine, canRequest, onRequest }: { m: MentorRow; mine: boolean; canRequest: boolean; onRequest: () => void }) {
  const open = m.my_status === 'requested' || m.my_status === 'accepted'
  const full = m.open_slots <= 0
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar src={m.avatar_url} name={m.full_name} size={48} />
        <div className="min-w-0 flex-1">
          <Link to={`/people/${m.user_id}`} className="font-bold leading-snug hover:underline">
            {m.full_name}
          </Link>
          <p className="truncate text-sm text-muted">
            {[m.grad_year ? `Batch ${m.grad_year}` : null, m.branch].filter(Boolean).join(' · ')}
          </p>
          {(m.current_title || m.current_company || m.headline) && <p className="truncate text-sm text-muted">{m.current_title ? [m.current_title, m.current_company].filter(Boolean).join(' at ') : (m.current_company ?? m.headline)}</p>}
        </div>
      </div>
      <p className="whitespace-pre-line break-words text-[15px] [overflow-wrap:anywhere]">{m.bio}</p>
      <div className="flex flex-wrap gap-1.5">
        {m.topics.map((t) => (
          <Badge key={t} tone="primary">
            {t}
          </Badge>
        ))}
        {m.availability && <Badge>{m.availability}</Badge>}
        {!m.is_accepting ? <Badge tone="warning">Not taking mentees now</Badge> : full ? <Badge tone="warning">No free slots</Badge> : <Badge tone="success">{m.open_slots === 1 ? '1 slot open' : `${m.open_slots} slots open`}</Badge>}
      </div>
      {!mine && (
        <div className="flex flex-wrap items-center gap-2">
          {m.my_status === 'requested' && <Badge tone="accent">Request sent</Badge>}
          {m.my_status === 'accepted' && (
            <Link to="/mentors/mine" className="text-sm font-semibold text-primary">
              You are mentored by {m.full_name.split(' ')[0]}. Open My mentorships
            </Link>
          )}
          {!open && canRequest && (
            <Button size="sm" disabled={!m.is_accepting || full} onClick={onRequest}>
              {m.my_status === 'declined' || m.my_status === 'ended' ? 'Request again' : 'Request'}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

function RequestSheet({ mentor, onClose }: { mentor: MentorRow | null; onClose: () => void }) {
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const request = useRequestMentor()
  useEffect(() => {
    if (mentor) {
      setTopic(mentor.topics[0] ?? '')
      setError(null)
    }
  }, [mentor])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!mentor) return
    setError(null)
    const msg = message.trim()
    if (msg.length < 20) return setError('Tell the mentor what you need help with (at least 20 characters).')
    request.mutate(
      { mentor: mentor.user_id, topic, message: msg },
      {
        onSuccess: () => {
          toast.success(`Request sent to ${mentor.full_name}`)
          setMessage('')
          onClose()
        },
        onError: (e) => setError(friendlyError(e)),
      },
    )
  }
  return (
    <Sheet open={!!mentor} onClose={onClose} label="Request a mentor">
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">Request {mentor?.full_name}</h2>
          <p className="text-sm text-muted">Say what you want to learn. If they accept, you can message each other.</p>
        </div>
        <Field label="Topic">
          {(p) => (
            <Select {...p} value={topic} onChange={(e) => setTopic(e.target.value)}>
              {mentor?.topics.map((t) => <option key={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Your message" hint={`${message.trim().length}/600`}>
          {(p) => <Textarea {...p} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={600} rows={5} placeholder="Where you are now and what you want from this mentorship" />}
        </Field>
        {error && <Notice tone="danger" title={error} />}
        <Button type="submit" size="lg" block loading={request.isPending}>
          Send request
        </Button>
      </form>
    </Sheet>
  )
}

// ------------------------------------------------------------------ my mentorships
function MyMentorships() {
  const list = useMyMentorships()
  const respond = useRespondMentorship()
  const end = useEndMentorship()
  const navigate = useNavigate()
  const rows = list.data ?? []
  const incoming = rows.filter((r) => r.role === 'mentor' && r.status === 'requested')
  const active = rows.filter((r) => r.status === 'accepted')
  const outgoing = rows.filter((r) => r.role === 'mentee' && r.status !== 'accepted')
  const past = rows.filter((r) => r.role === 'mentor' && (r.status === 'declined' || r.status === 'ended'))

  if (list.isLoading) return <Skeleton className="h-40 rounded-3xl" />
  if (list.error) return <Notice tone="danger" title={friendlyError(list.error)} />
  if (rows.length === 0)
    return (
      <EmptyState icon={<GraduationCap />} title="No mentorships yet" action={<Button onClick={() => navigate('/mentors')}>Find a mentor</Button>}>
        Request a mentor, or become one, and your conversations will show up here.
      </EmptyState>
    )

  const answer = (id: string, accept: boolean) =>
    respond.mutate(
      { id, accept },
      { onSuccess: () => toast.success(accept ? 'Accepted. You can now message them.' : 'Declined'), onError: (e) => toast.error(friendlyError(e)) },
    )
  const finish = (r: MentorshipRow) => {
    if (!window.confirm(r.status === 'requested' ? 'Withdraw this request?' : 'End this mentorship?')) return
    end.mutate(r.id, { onSuccess: () => toast.success(r.status === 'requested' ? 'Request withdrawn' : 'Mentorship ended'), onError: (e) => toast.error(friendlyError(e)) })
  }

  return (
    <div className="space-y-5">
      {incoming.length > 0 && (
        <Section title="Requests for you">
          {incoming.map((r) => (
            <Row key={r.id} r={r} showMessage>
              <Button size="sm" loading={respond.isPending && respond.variables?.id === r.id && respond.variables.accept} onClick={() => answer(r.id, true)}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" onClick={() => answer(r.id, false)}>
                Decline
              </Button>
            </Row>
          ))}
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Active">
          {active.map((r) => (
            <Row key={r.id} r={r}>
              <Button size="sm" icon={<MessageCircle className="size-4" />} disabled={!r.chat_id} onClick={() => navigate(`/chat/${r.chat_id}`)}>
                Message
              </Button>
              <Button size="sm" variant="danger-ghost" onClick={() => finish(r)}>
                End
              </Button>
            </Row>
          ))}
        </Section>
      )}
      {outgoing.length > 0 && (
        <Section title="Your requests">
          {outgoing.map((r) => (
            <Row key={r.id} r={r}>
              {r.status === 'requested' && (
                <Button size="sm" variant="secondary" onClick={() => finish(r)}>
                  Withdraw
                </Button>
              )}
            </Row>
          ))}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Past">
          {past.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  )
}

const STATUS: Record<MentorshipRow['status'], { label: string; tone: 'accent' | 'success' | 'neutral' | 'warning' }> = {
  requested: { label: 'Waiting for reply', tone: 'accent' },
  accepted: { label: 'Active', tone: 'success' },
  declined: { label: 'Declined', tone: 'warning' },
  ended: { label: 'Ended', tone: 'neutral' },
}

function Row({ r, showMessage, children }: { r: MentorshipRow; showMessage?: boolean; children?: React.ReactNode }) {
  const s = STATUS[r.status]
  return (
    <li>
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-3">
          <Avatar src={r.other_avatar} name={r.other_name} size={40} />
          <div className="min-w-0 flex-1">
            <Link to={`/people/${r.other_id}`} className="block truncate font-bold hover:underline">
              {r.other_name}
            </Link>
            <p className="text-sm text-muted">
              {r.role === 'mentor' ? 'Your mentee' : 'Your mentor'}
              {r.other_batch ? ` · Batch ${r.other_batch}` : ''} · {relativeTime(r.created_at)}
            </p>
          </div>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">{r.topic}</Badge>
        </div>
        {showMessage && <p className="whitespace-pre-line break-words text-[15px] [overflow-wrap:anywhere]">{r.message}</p>}
        {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
      </Card>
    </li>
  )
}

// ------------------------------------------------------------------ become / edit mentor
function MentorProfileSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: MentorProfile | null }) {
  const [topics, setTopics] = useState<string[]>([])
  const [bio, setBio] = useState('')
  const [availability, setAvailability] = useState('')
  const [max, setMax] = useState('3')
  const [error, setError] = useState<string | null>(null)
  const save = useSaveMentorProfile()
  useEffect(() => {
    if (open) {
      setTopics(current?.topics ?? [])
      setBio(current?.bio ?? '')
      setAvailability(current?.availability ?? '')
      setMax(String(current?.max_mentees ?? 3))
      setError(null)
    }
  }, [open, current])

  function toggle(t: string) {
    setTopics((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 5 ? cur : [...cur, t]))
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (topics.length < 1) return setError('Choose at least one topic.')
    if (bio.trim().length < 20) return setError('Tell mentees about yourself (at least 20 characters).')
    save.mutate(
      { topics, bio: bio.trim(), availability: availability.trim(), max_mentees: Number(max), is_accepting: current?.is_accepting ?? true },
      {
        onSuccess: () => {
          toast.success(current ? 'Mentor profile updated' : 'You are now listed as a mentor')
          onClose()
        },
        onError: (err) => setError(friendlyError(err)),
      },
    )
  }
  return (
    <Sheet open={open} onClose={onClose} label="Mentor profile">
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">{current ? 'Your mentor profile' : 'Become a mentor'}</h2>
          <p className="text-sm text-muted">Share what you can guide others on. You decide who to accept.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Topics (up to 5)</legend>
          <div className="flex flex-wrap gap-2">
            {MENTOR_TOPICS.map((t) => (
              <Chip key={t} active={topics.includes(t)} onClick={() => toggle(t)}>
                {t}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label="About you" hint={`${bio.trim().length}/600`}>
          {(p) => <Textarea {...p} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={600} rows={4} placeholder="Your experience and how you can help" />}
        </Field>
        <Field label="Time you can give" optional>
          {(p) => <Input {...p} value={availability} onChange={(e) => setAvailability(e.target.value)} maxLength={80} placeholder="e.g. 2 hours a month" />}
        </Field>
        <Field label="Mentees at a time">
          {(p) => (
            <Select {...p} value={max} onChange={(e) => setMax(e.target.value)}>
              {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => <option key={n}>{n}</option>)}
            </Select>
          )}
        </Field>
        {error && <Notice tone="danger" title={error} />}
        <Button type="submit" size="lg" block loading={save.isPending}>
          {current ? 'Save' : 'Become a mentor'}
        </Button>
      </form>
    </Sheet>
  )
}
