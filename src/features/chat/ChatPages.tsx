import clsx from 'clsx'
import { MessagesSquare, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDate, relativeTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { Linkified } from '../community/PostCard'
import { useConversations, useMessages, useSendMessage, type Conversation } from './queries'

function Row({ c }: { c: Conversation }) {
  return (
    <Link to={`/chat/${c.id}`} className="flex items-center gap-3 p-3.5 hover:bg-surface-2">
      <Avatar src={c.other.avatar_url} name={c.other.full_name} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={clsx('truncate', c.unread ? 'font-bold' : 'font-semibold')}>{c.other.full_name}</p>
          <p className="shrink-0 text-xs text-muted">{relativeTime(c.last_message_at)}</p>
        </div>
        <p className={clsx('truncate text-sm', c.unread ? 'font-semibold text-text' : 'text-muted')}>{c.last_message ?? 'No messages yet'}</p>
      </div>
      {c.unread && <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </Link>
  )
}

export function ChatListPage() {
  const uid = useUserId()
  const { data: me } = useMyProfile()
  const { data, isLoading } = useConversations()
  if (isLoading) return <PageSkeleton />
  if (me?.verification !== 'verified' && !me?.is_admin) {
    return (
      <div>
        <PageHeader title="Messages" />
        <EmptyState icon={<ShieldAlert />} title="Messages are for verified members">You’ll be verified once your Alumni Meet payment is confirmed, or when two verified JECians vouch for you.</EmptyState>
      </div>
    )
  }
  const list = data ?? []
  const requests = list.filter((c) => c.is_request && c.started_by !== uid)
  const main = list.filter((c) => !(c.is_request && c.started_by !== uid))
  return (
    <div>
      <PageHeader title="Messages" />
      <Page className="space-y-6">
        {requests.length > 0 && (
          <section>
            <SectionTitle>Message requests ({requests.length})</SectionTitle>
            <Card className="divide-y divide-border">{requests.map((c) => <Row key={c.id} c={c} />)}</Card>
          </section>
        )}
        {main.length ? (
          <Card className="divide-y divide-border">{main.map((c) => <Row key={c.id} c={c} />)}</Card>
        ) : (
          <EmptyState icon={<MessagesSquare />} title="No conversations yet" action={<Link to="/people" className="font-semibold text-primary">Find a batchmate to message</Link>}>
            Open anyone’s profile and tap Message.
          </EmptyState>
        )}
      </Page>
    </div>
  )
}

export function ChatThreadPage() {
  const { id = '' } = useParams()
  const uid = useUserId()
  const qc = useQueryClient()
  const { data: convs } = useConversations()
  const conv = convs?.find((c) => c.id === id)
  const { data: messages, isLoading, error } = useMessages(id)
  const send = useSendMessage(id)
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  useEffect(() => {
    if (!id || !messages?.length) return
    void supabase.rpc('mark_conversation_read', { p_conversation: id }).then(() => qc.invalidateQueries({ queryKey: ['conversations', uid] }))
  }, [id, messages?.length, qc, uid])

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    send.mutate(body, {
      onError: (err) => {
        setText(body)
        toast.error(friendlyError(err))
      },
    })
  }

  const isIncomingRequest = conv?.is_request && conv.started_by !== uid
  return (
    <div className="flex h-dvh flex-col md:h-dvh">
      <PageHeader
        title={conv ? <Link to={`/people/${conv.other.id}`} className="hover:underline">{conv.other.full_name}</Link> : 'Conversation'}
        subtitle={conv ? [conv.other.branch, conv.other.grad_year].filter(Boolean).join(' ') : undefined}
        back="/chat"
      />
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading ? (
          <PageSkeleton />
        ) : (
          <ul className="space-y-2">
            {messages?.map((m, i) => {
              const mine = m.sender_id === uid
              const prev = messages[i - 1]
              const newDay = !prev || formatDate(prev.created_at) !== formatDate(m.created_at)
              return (
                <li key={m.id}>
                  {newDay && <p className="my-3 text-center text-xs font-semibold text-muted">{formatDate(m.created_at, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
                  <div className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={clsx('max-w-[80%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2 text-[15px]', mine ? 'rounded-br-md bg-primary text-on-primary [&_a]:text-on-primary' : 'rounded-bl-md bg-surface', m.pending && 'opacity-60')}>
                      <Linkified text={m.body} />
                      <p className={clsx('mt-0.5 text-right text-[11px]', mine ? 'text-on-primary/70' : 'text-muted')}>
                        {m.pending ? 'Sending…' : new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div ref={bottom} />
      </div>
      {isIncomingRequest && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <Notice tone="info" title="Message request">
            Reply to accept, or simply ignore it. You can block this member from their profile.
          </Notice>
        </div>
      )}
      <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl gap-2 border-t border-border bg-bg px-4 py-3 pb-[calc(0.75rem+4.5rem+env(safe-area-inset-bottom))] md:pb-3">
        <textarea
          aria-label="Message"
          rows={1}
          className="max-h-32 min-h-12 flex-1 resize-none rounded-3xl border border-border bg-surface px-4 py-3 text-[16px] focus:border-primary focus:outline-none"
          placeholder="Write a message…"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              submit(e)
            }
          }}
        />
        <Button type="submit" className="size-12 shrink-0 px-0" aria-label="Send" disabled={!text.trim()}>
          <Send className="size-5" />
        </Button>
      </form>
    </div>
  )
}
