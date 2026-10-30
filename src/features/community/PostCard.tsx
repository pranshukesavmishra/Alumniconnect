import clsx from 'clsx'
import { BadgeCheck, ExternalLink, Flag, Globe2, MessageCircle, MoreHorizontal, Send, Share2, Trash2, Users } from 'lucide-react'
import { Fragment, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Avatar, Card } from '../../components/ui/Display'
import { ReactionIcon } from '../../components/ui/Reactions'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { GroupIcon } from '../../components/ui/GroupIcon'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { publicUrl } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { report, useAddComment, useComments, useDeletePost, useToggleLike, type Post } from './queries'

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]}!?])/g

/** Plain text with clickable links (React escapes everything else). */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer nofollow" className="break-all font-medium text-primary underline decoration-primary/30 underline-offset-2">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function authorLine(a: Post['author']) {
  const role = a.current_title && a.current_company ? `${a.current_title} · ${a.current_company}` : null
  return role ?? [a.branch, a.grad_year].filter(Boolean).join(' ')
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A link preview card (no remote fetch: domain + path, styled like a rich preview). */
function LinkPreview({ url }: { url: string }) {
  let path = ''
  try {
    const u = new URL(url)
    path = decodeURIComponent(u.pathname + u.search).replace(/\/$/, '')
  } catch {
    /* plain text */
  }
  return (
    <a href={url} target="_blank" rel="noreferrer nofollow" className="fx-press mx-4 mt-3 flex items-center gap-3 overflow-hidden rounded-2xl border border-border/80 bg-surface-2/60 p-3 hover:bg-surface-2" data-testid="link-preview">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#2a8f8a,#12534f)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]">
        <Globe2 className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{hostOf(url)}</span>
        {path && <span className="text-caption block truncate text-muted">{path}</span>}
      </span>
      <ExternalLink className="size-4 shrink-0 text-subtle" aria-hidden />
    </a>
  )
}

/** Photos: 1 = large, 2 = side by side, 3 = one tall + two, 4 = 2x2; rounded inside the card. */
function MediaGrid({ media }: { media: Post['media'] }) {
  const n = media.length
  return (
    <div className={clsx('mx-4 mt-3 grid gap-1 overflow-hidden rounded-2xl', n > 1 && 'grid-cols-2', n === 3 && 'grid-rows-2')}>
      {media.map((m, i) => (
        <a
          key={m.path}
          href={publicUrl('post-media', m.path) ?? '#'}
          target="_blank"
          rel="noreferrer"
          className={clsx('group relative block overflow-hidden bg-surface-2', n === 3 && i === 0 && 'row-span-2')}
        >
          <img
            src={publicUrl('post-media', m.path) ?? ''}
            alt=""
            loading="lazy"
            decoding="async"
            width={m.w}
            height={m.h}
            className={clsx('w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]', n === 1 ? 'max-h-[30rem]' : n === 3 && i === 0 ? 'h-full' : 'aspect-square h-full')}
          />
        </a>
      ))}
    </div>
  )
}

export function PostCard({ post, showGroup = true }: { post: Post; showGroup?: boolean }) {
  const tx = useT()
  const uid = useUserId()
  const like = useToggleLike()
  const del = useDeletePost()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const long = post.body.length > 420
  const mine = post.author_id === uid
  const verified = post.author.verification === 'verified'
  const linkInBody = !!post.link_url && post.body.includes(post.link_url)
  const firstUrl = post.link_url ?? post.body.match(URL_RE)?.[0] ?? null

  async function share() {
    const text = `${post.author.full_name} on JEC Alumni Connect:\n\n${post.body.slice(0, 280)}`
    if (navigator.share) {
      await navigator.share({ text, url: `${window.location.origin}/` }).catch(() => undefined)
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
  }

  const action = 'fx-press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors'

  return (
    <Card className="overflow-hidden" data-testid="post-card">
      <div className="flex items-start gap-3 p-4 pb-2">
        <Link to={`/people/${post.author.id}`} className="shrink-0">
          <Avatar src={post.author.avatar_url} name={post.author.full_name} size={46} ring={verified ? 'verified' : 'none'} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <Link to={`/people/${post.author.id}`} className="truncate text-[16px] font-semibold hover:underline">
              {post.author.full_name}
            </Link>
            {verified && <BadgeCheck className="size-4 shrink-0 text-primary" fill="currentColor" stroke="var(--surface)" aria-label={tx('pp.verified')} />}
          </div>
          <p className="text-caption truncate text-muted">{authorLine(post.author)}</p>
          <p className="text-caption mt-0.5 flex min-w-0 items-center gap-1.5 text-subtle">
            <span className="shrink-0">{relativeTime(post.created_at)}</span>
            {showGroup && (
              <>
                <span aria-hidden>·</span>
                {post.group ? (
                  <Link to={`/groups/${post.group.slug}`} className="inline-flex min-w-0 items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-0.5 pr-2 font-semibold text-primary">
                    <GroupIcon icon={post.group.icon} kind={post.group.kind} size="sm" className="!size-5 !rounded-full [&_svg]:!size-3" />
                    <span className="truncate">{post.group.name}</span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden /> All of JEC
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <button type="button" aria-label="More" className="-mr-2 grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setMenu(true)}>
          <MoreHorizontal className="size-5" />
        </button>
        <Sheet open={menu} onClose={() => setMenu(false)} label={tx('pp.more')}>
          <div className="pb-2">
            <SheetAction icon={<Share2 />} onClick={() => { setMenu(false); void share() }}>
              Share
            </SheetAction>
            {mine ? (
              <SheetAction
                danger
                icon={<Trash2 />}
                onClick={() => {
                  setMenu(false)
                  if (window.confirm('Delete this post?')) del.mutate(post, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Post deleted') })
                }}
              >
                Delete post
              </SheetAction>
            ) : (
              <SheetAction
                icon={<Flag />}
                onClick={async () => {
                  setMenu(false)
                  const reason = window.prompt('Why are you reporting this post? (spam, offensive, not related to JEC…)')
                  if (!reason || reason.trim().length < 3) return
                  try {
                    await report('post', post.id, reason.trim())
                    toast.success('Thanks. The moderators will review it.')
                  } catch (e) {
                    toast.error(friendlyError(e))
                  }
                }}
              >
                Report post
              </SheetAction>
            )}
          </div>
        </Sheet>
      </div>

      <div className="text-body-lg whitespace-pre-line break-words px-4 leading-relaxed">
        <Linkified text={long && !expanded ? `${post.body.slice(0, 400)}…` : post.body} />
        {long && (
          <button type="button" className="ml-1 font-semibold text-primary" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {post.media.length > 0 && <MediaGrid media={post.media} />}
      {post.media.length === 0 && firstUrl && (linkInBody || post.link_url) && <LinkPreview url={firstUrl} />}

      {(post.like_count > 0 || post.comment_count > 0) && (
        <div className="text-caption mx-4 mt-3 flex items-center gap-2 text-muted" data-testid="post-summary">
          {post.like_count > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex">
                <ReactionIcon reaction="like" size={20} className="ring-2 ring-surface" />
                {post.like_count > 2 && <ReactionIcon reaction="celebrate" size={20} className="-ml-1.5 ring-2 ring-surface" />}
              </span>
              <span className="tabular-nums">{post.like_count}</span>
            </span>
          )}
          {post.comment_count > 0 && (
            <button type="button" className="ml-auto min-h-8 hover:text-text hover:underline" onClick={() => setOpen(true)}>
              {tx('feed.comments', { count: post.comment_count })}
            </button>
          )}
        </div>
      )}

      <div className="mx-2 mt-2 flex items-center gap-1 border-t border-border/70 py-1.5">
        <button
          type="button"
          aria-pressed={post.liked}
          onClick={() => like.mutate(post, { onError: (e) => toast.error(friendlyError(e)) })}
          className={clsx(action, post.liked ? 'text-primary' : 'text-muted hover:bg-surface-2')}
        >
          {post.liked ? <ReactionIcon reaction="like" size={22} /> : <ReactionIcon reaction="like" size={22} className="opacity-35 grayscale" />}
          {tx('cx.like')}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={clsx(action, 'text-muted hover:bg-surface-2')}>
          <MessageCircle className="size-5" aria-hidden />
          {tx('cx.comment')}
        </button>
        <button type="button" onClick={share} className={clsx(action, 'text-muted hover:bg-surface-2')}>
          <Share2 className="size-5" aria-hidden /> {tx('cx.share')}
        </button>
      </div>
      {open && <Comments postId={post.id} />}
    </Card>
  )
}

function Comments({ postId }: { postId: string }) {
  const { data, isLoading } = useComments(postId, true)
  const add = useAddComment(postId)
  const [text, setText] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    add.mutate(text, { onSuccess: () => setText(''), onError: (err) => toast.error(friendlyError(err)) })
  }

  return (
    <div className="border-t border-border/70 bg-surface-2/40 px-4 py-3">
      {isLoading ? (
        <p className="text-sm text-muted">Loading comments…</p>
      ) : (
        <ul className="space-y-3">
          {data?.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar src={c.author.avatar_url} name={c.author.full_name} size={34} />
              <div className="min-w-0">
                <div className="rounded-2xl rounded-tl-md bg-surface px-3.5 py-2 shadow-e1">
                  <Link to={`/people/${c.author.id}`} className="text-sm font-semibold hover:underline">
                    {c.author.full_name}
                  </Link>
                  <p className="whitespace-pre-line break-words text-[15px]">
                    <Linkified text={c.body} />
                  </p>
                </div>
                <p className="text-caption mt-0.5 px-2 text-subtle">{relativeTime(c.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          aria-label="Write a comment"
          className="min-h-11 flex-1 rounded-full border border-border bg-surface px-4 text-[16px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
          placeholder="Write a comment…"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim() || add.isPending} aria-label="Send comment" className="fx-press grid size-11 place-items-center rounded-full bg-primary bg-(image:--grad-primary) text-on-primary shadow-[0_6px_14px_-8px_var(--primary-glow)] disabled:opacity-40">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  )
}
