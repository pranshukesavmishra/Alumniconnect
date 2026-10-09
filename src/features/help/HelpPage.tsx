import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Flag, HandHelping, MessageCircle, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { HELP_TAGS } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'

interface HelpRow {
  id: string
  tag: string
  title: string
  body: string | null
  is_resolved: boolean
  created_at: string
  author_id: string
  author_name: string
  author_avatar: string | null
  author_batch: number | null
  matches_me: boolean
}

const PAGE = 20
const REPORT_REASONS = ['Spam or advertising', 'Asks for money', 'Inappropriate', 'Something else']

function useHelp(tag: string | null, forMe: boolean, resolved: boolean) {
  return useInfiniteQuery({
    queryKey: ['help', tag, forMe, resolved],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('list_help_requests', { p_tag: tag, p_for_me: forMe, p_include_resolved: resolved, p_limit: PAGE, p_offset: pageParam })
      if (error) throw error
      return data as HelpRow[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function HelpPage() {
  const { data: me } = useMyProfile()
  const uid = useUserId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tag, setTag] = useState<string | null>(null)
  const [forMe, setForMe] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reportFor, setReportFor] = useState<string | null>(null)
  const [busyDm, setBusyDm] = useState<string | null>(null)
  const list = useHelp(tag, forMe, resolved)
  const rows = list.data?.pages.flat() ?? []
  const verified = me?.verification === 'verified' || !!me?.is_admin
  const offers = me?.help_tags ?? []

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('resolve_help_request', { p_id: id, p_resolved: true })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Marked as resolved. Thank you to everyone who helped!')
      void qc.invalidateQueries({ queryKey: ['help'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('help_requests').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['help'] }),
    onError: (e) => toast.error(friendlyError(e)),
  })

  async function reply(authorId: string, reqId: string) {
    setBusyDm(reqId)
    try {
      navigate(`/chat/${await startDm(authorId)}`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusyDm(null)
    }
  }
  async function report(reason: string) {
    if (!reportFor) return
    const { error } = await supabase.rpc('report_help_request', { p_id: reportFor, p_reason: reason })
    if (error) return toast.error(friendlyError(error))
    toast.success('Thanks. Our moderators will review this.')
    setReportFor(null)
  }

  return (
    <div>
      <PageHeader title="Ask JEC" subtitle="Get help from batchmates who’ve been there" back="/" action={verified && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAsking(true)}>Ask</Button>} />
      <Page className="space-y-4">
        {verified && offers.length === 0 && (
          <Notice tone="info" title="Offer your help too">
            Add what you can help with (referrals, mock interviews…) in <a className="font-semibold text-primary underline" href="/me/edit">Edit profile</a>, and you’ll be told when someone asks.
          </Notice>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Topics">
          {offers.length > 0 && (
            <Chip active={forMe} onClick={() => setForMe((v) => !v)}>
              For me
            </Chip>
          )}
          {HELP_TAGS.map((t) => (
            <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </Chip>
          ))}
          <Chip active={resolved} onClick={() => setResolved((v) => !v)}>
            Include resolved
          </Chip>
        </div>
        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {list.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-3xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<HandHelping />} title="No questions here" action={verified ? <Button onClick={() => setAsking(true)}>Ask the first question</Button> : undefined}>
            Need a referral, interview practice or career advice? Ask, and batchmates who offered that help will be told.
          </EmptyState>
        ) : (
          <ul className="space-y-3" aria-label="Questions">
            {rows.map((h) => {
              const mine = h.author_id === uid
              return (
                <li key={h.id}>
                  <Card className={clsx('space-y-3 p-4', h.is_resolved && 'opacity-70')}>
                    <div className="flex items-center gap-2">
                      <Badge tone="primary">{h.tag}</Badge>
                      {h.matches_me && !mine && <Badge tone="accent">You can help</Badge>}
                      {h.is_resolved && (
                        <Badge tone="success">
                          <CheckCircle2 className="size-3" aria-hidden /> Resolved
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted">{relativeTime(h.created_at)}</span>
                    </div>
                    <div>
                      <p className="font-bold leading-snug">{h.title}</p>
                      {h.body && <p className="mt-1 whitespace-pre-line break-words text-[15px] text-muted [overflow-wrap:anywhere]">{h.body}</p>}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Avatar src={h.author_avatar} name={h.author_name} size={24} />
                      <span className="min-w-0 truncate">
                        {h.author_name}
                        {h.author_batch ? ` · Batch ${h.author_batch}` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {mine ? (
                        <>
                          {!h.is_resolved && (
                            <Button size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === h.id} icon={<CheckCircle2 className="size-4" />} onClick={() => resolve.mutate(h.id)}>
                              Mark resolved
                            </Button>
                          )}
                          <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => window.confirm('Delete this question?') && remove.mutate(h.id)}>
                            Delete
                          </Button>
                        </>
                      ) : (
                        <>
                          {!h.is_resolved && (
                            <Button size="sm" icon={<MessageCircle className="size-4" />} loading={busyDm === h.id} onClick={() => void reply(h.author_id, h.id)}>
                              Reply by message
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" icon={<Flag className="size-4" />} onClick={() => setReportFor(h.id)}>
                            Report
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Show more
          </Button>
        )}
      </Page>
      <AskSheet open={asking} onClose={() => setAsking(false)} onAsked={() => void qc.invalidateQueries({ queryKey: ['help'] })} />
      <Sheet open={!!reportFor} onClose={() => setReportFor(null)} label="Report this question">
        <h2 className="px-5 pb-1 pt-1 text-lg font-bold">Report this question</h2>
        <p className="px-5 pb-2 text-sm text-muted">Only moderators see your report.</p>
        {REPORT_REASONS.map((r) => (
          <SheetAction key={r} onClick={() => void report(r)}>
            {r}
          </SheetAction>
        ))}
      </Sheet>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={clsx('min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold', active ? 'bg-primary text-on-primary' : 'border border-border bg-surface')}>
      {children}
    </button>
  )
}

function AskSheet({ open, onClose, onAsked }: { open: boolean; onClose: () => void; onAsked: () => void }) {
  const [tag, setTag] = useState<string>(HELP_TAGS[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 5) return setError('Please write your question in a line or two (at least 5 characters).')
    setBusy(true)
    const { error: err } = await supabase.rpc('ask_for_help', { p_tag: tag, p_title: title.trim(), p_body: body.trim() || null })
    setBusy(false)
    if (err) return setError(friendlyError(err))
    toast.success('Your question is up. Members who offer this help have been told.')
    setTitle('')
    setBody('')
    onAsked()
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} label="Ask for help">
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">Ask JEC</h2>
          <p className="text-sm text-muted">Batchmates who offered this kind of help are told right away. Replies come as private messages.</p>
        </div>
        <Field label="Topic">
          {(p) => (
            <Select {...p} value={tag} onChange={(e) => setTag(e.target.value)}>
              {HELP_TAGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Your question">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Looking for a backend referral in Pune" />}</Field>
        <Field label="More detail" optional>{(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />}</Field>
        {error && <Notice tone="danger" title={error} />}
        <Button type="submit" size="lg" block loading={busy}>
          Ask
        </Button>
      </form>
    </Sheet>
  )
}
