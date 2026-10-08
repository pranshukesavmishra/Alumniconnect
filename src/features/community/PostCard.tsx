import clsx from 'clsx'
import { Flag, Heart, MessageCircle, MoreHorizontal, Send, Share2, Trash2 } from 'lucide-react'
import { Fragment, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Avatar, Card } from '../../components/ui/Display'
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
          <a key={i} href={part} target="_blank" rel="noreferrer nofollow" className="break-all text-primary underline">
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

export function PostCard({ post, showGroup = true }: { post: Post; showGroup?: boolean }) {
  const uid = useUserId()
  const like = useToggleLike()
  const del = useDeletePost()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const long = post.body.length > 420
  const mine = post.author_id === uid

  async function share() {
    const text = `${post.author.full_name} on JEC Alumni Connect:\n\n${post.body.slice(0, 280)}`
    if (navigator.share) {
      await navigator.share({ text, url: `${window.location.origin}/` }).catch(() => undefined)
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 p-4 pb-2">
        <Link to={`/people/${post.author.id}`} className="shrink-0">
          <Avatar src={post.author.avatar_url} name={post.author.full_name} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/people/${post.author.id}`} className="block truncate font-semibold hover:underline">
            {post.author.full_name}
          </Link>
          <p className="truncate text-sm text-muted">{authorLine(post.author)}</p>
          <p className="text-xs text-muted">
            {relativeTime(post.created_at)}
            {showGroup && (
              <>
                {' · '}
                {post.group ? (
                  <Link to={`/groups/${post.group.slug}`} className="font-medium text-primary">
                    {post.group.icon} {post.group.name}
                  </Link>
                ) : (
                  'All of JEC'
                )}
              </>
            )}
          </p>
        </div>
        <div className="relative">
          <button type="button" aria-label="More" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal className="size-5" />
          </button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-lg" onMouseLeave={() => setMenu(false)}>
              {mine ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-danger hover:bg-danger-soft"
                  onClick={() => {
                    setMenu(false)
                    if (window.confirm('Delete this post?')) del.mutate(post, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Post deleted') })
                  }}
                >
                  <Trash2 className="size-4" /> Delete post
                </button>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-surface-2"
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
                  <Flag className="size-4" /> Report post
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="whitespace-pre-line break-words px-4 text-[15px] leading-relaxed">
        <Linkified text={long && !expanded ? `${post.body.slice(0, 400)}…` : post.body} />
        {long && (
          <button type="button" className="ml-1 font-semibold text-primary" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {post.media.length > 0 && (
        <div className={clsx('mt-3 grid gap-0.5', post.media.length > 1 && 'grid-cols-2')}>
          {post.media.map((m, i) => (
            <a key={m.path} href={publicUrl('post-media', m.path) ?? '#'} target="_blank" rel="noreferrer" className={clsx('block overflow-hidden bg-surface-2', post.media.length === 3 && i === 0 && 'row-span-2')}>
              <img
                src={publicUrl('post-media', m.path) ?? ''}
                alt=""
                loading="lazy"
                decoding="async"
                width={m.w}
                height={m.h}
                className={clsx('w-full object-cover', post.media.length === 1 ? 'max-h-[28rem]' : 'aspect-square h-full')}
              />
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          aria-pressed={post.liked}
          onClick={() => like.mutate(post, { onError: (e) => toast.error(friendlyError(e)) })}
          className={clsx('flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold', post.liked ? 'text-danger' : 'text-muted hover:bg-surface-2')}
        >
          <Heart className={clsx('size-5', post.liked && 'fill-current')} aria-hidden />
          {post.like_count > 0 ? post.like_count : 'Like'}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2">
          <MessageCircle className="size-5" aria-hidden />
          {post.comment_count > 0 ? post.comment_count : 'Comment'}
        </button>
        <button type="button" onClick={share} className="ml-auto flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2">
          <Share2 className="size-5" aria-hidden /> Share
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
    <div className="border-t border-border bg-surface-2/40 px-4 py-3">
      {isLoading ? (
        <p className="text-sm text-muted">Loading comments…</p>
      ) : (
        <ul className="space-y-3">
          {data?.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar src={c.author.avatar_url} name={c.author.full_name} size={32} />
              <div className="min-w-0 rounded-2xl bg-surface px-3 py-2">
                <Link to={`/people/${c.author.id}`} className="text-sm font-semibold hover:underline">
                  {c.author.full_name}
                </Link>
                <p className="whitespace-pre-line break-words text-[15px]">
                  <Linkified text={c.body} />
                </p>
                <p className="text-xs text-muted">{relativeTime(c.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          aria-label="Write a comment"
          className="min-h-11 flex-1 rounded-full border border-border bg-surface px-4 text-[15px] focus:border-primary focus:outline-none"
          placeholder="Write a comment…"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim() || add.isPending} aria-label="Send comment" className="grid size-11 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-40">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  )
}
