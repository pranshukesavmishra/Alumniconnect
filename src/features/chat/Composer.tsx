import clsx from 'clsx'
import { BarChart3, Camera, Check, FileText, Image as ImageIcon, Mic, Paperclip, Pencil, Plus, Reply, Send, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { Avatar } from '../../components/ui/Display'
import { fileProblem, formatBytes, isPhoto, MAX_PHOTOS } from './media'
import { formatDuration, previewOf, type Message, type Poll, type ReplyPreview } from './merge'
import { friendlyError } from '../../lib/errors'
import { MAX_VOICE_SECONDS, useVoiceRecorder, voiceSupported } from './useVoiceRecorder'
import { useMentionCandidates, type SendInput } from './queries'

const MAX_PICK = 30

interface Picked {
  file: File
  url?: string
}

export function ChatComposer({
  chatId,
  isGroup,
  me,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onEdit,
  onTyping,
  slowSeconds,
  cooldownUntil,
}: {
  chatId: string
  isGroup: boolean
  me: string | null
  replyTo: ReplyPreview | null
  onCancelReply: () => void
  editing: Message | null
  onCancelEdit: () => void
  onSend: (input: SendInput) => void
  onEdit: (id: string, body: string) => Promise<boolean>
  onTyping: () => void
  /** group slow mode (0 = off) */
  slowSeconds: number
  /** when this member may send again (ms since epoch; 0 = now) */
  cooldownUntil: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [cooldownUntil])
  const waitSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const voice = useVoiceRecorder()
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const savedDraft = useRef('')
  const [caret, setCaret] = useState(0)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)

  // "@" + letters right before the caret opens member suggestions (groups only, not while editing)
  const mention = isGroup && !editing ? /(?:^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(text.slice(0, caret)) : null
  const prefix = mention && !mentionDismissed ? (mention[1] ?? '') : null
  const { data: candidates = [] } = useMentionCandidates(chatId, prefix, prefix !== null)
  const suggestions = prefix !== null ? candidates : []
  useEffect(() => setMentionIdx(0), [prefix])

  function pickMention(name: string) {
    if (prefix === null) return
    const first = name.split(' ')[0] ?? name
    const start = caret - prefix.length - 1
    const next = `${text.slice(0, start)}@${first} ${text.slice(caret)}`
    setText(next)
    const pos = start + first.length + 2
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  // Editing: put the message text in the box; cancelling restores what was being typed.
  useEffect(() => {
    if (editing) {
      savedDraft.current = text
      setText(editing.body ?? '')
      requestAnimationFrame(() => input.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the edited message changes
  }, [editing?.id])
  useEffect(() => {
    if (replyTo) input.current?.focus()
  }, [replyTo])

  // Auto-grow up to ~6 lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  // Free preview memory.
  const urls = useRef<string[]>([])
  useEffect(() => {
    urls.current = picked.flatMap((p) => (p.url ? [p.url] : []))
  }, [picked])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function add(files: FileList | File[] | null) {
    if (!files) return
    const next: Picked[] = []
    for (const f of Array.from(files)) {
      const problem = fileProblem(f)
      if (problem) {
        toast.error(problem)
        continue
      }
      next.push({ file: f, url: isPhoto(f) ? URL.createObjectURL(f) : undefined })
    }
    const room = MAX_PICK - picked.length
    if (next.length > room) {
      toast.error(`You can attach up to ${MAX_PICK} files at a time.`)
      next.slice(Math.max(room, 0)).forEach((p) => p.url && URL.revokeObjectURL(p.url))
    }
    if (room > 0) setPicked([...picked, ...next.slice(0, room)])
    setAttachOpen(false)
    requestAnimationFrame(() => input.current?.focus())
  }

  function removePicked(i: number) {
    setPicked((cur) => {
      const p = cur[i]
      if (p?.url) URL.revokeObjectURL(p.url)
      return cur.filter((_, j) => j !== i)
    })
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length) {
      e.preventDefault()
      add(files)
    }
  }

  async function startVoice() {
    try {
      await voice.start()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  async function sendVoice() {
    const r = await voice.stop()
    if (!r) return toast('Hold on a little longer — voice messages need at least 1 second.')
    onSend({ body: '', kind: 'voice', files: [r.file], duration: r.seconds, replyTo })
    onCancelReply()
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!editing && waitSeconds > 0) return
    const body = text.trim()
    if (editing) {
      if (!body && editing.kind === 'text') return
      if (body === (editing.body ?? '').trim()) return onCancelEdit()
      setSaving(true)
      const ok = await onEdit(editing.id, body)
      setSaving(false)
      if (ok) {
        setText(savedDraft.current)
        onCancelEdit()
      }
      return
    }
    if (!body && !picked.length) return
    const photos = picked.filter((p) => p.url).map((p) => p.file)
    const docs = picked.filter((p) => !p.url).map((p) => p.file)
    let caption = body
    // photos go as albums of up to 10 (caption on the first); each document is its own message
    for (let i = 0; i < photos.length; i += MAX_PHOTOS) {
      onSend({ body: caption, kind: 'image', files: photos.slice(i, i + MAX_PHOTOS), replyTo })
      caption = ''
    }
    for (const d of docs) {
      onSend({ body: caption, kind: 'file', files: [d], replyTo: photos.length ? null : replyTo })
      caption = ''
    }
    if (!photos.length && !docs.length) onSend({ body, replyTo })
    picked.forEach((p) => p.url && URL.revokeObjectURL(p.url))
    setPicked([])
    setText('')
    onCancelReply()
    input.current?.focus()
  }

  const showMic = !editing && !text.trim() && picked.length === 0 && voiceSupported()
  const canSend = editing ? !!text.trim() || editing.kind !== 'text' : (!!text.trim() || picked.length > 0) && waitSeconds === 0
  const banner = editing ? (
    <Bar icon={<Pencil className="size-4" />} title="Edit message" text={editing.body ?? previewOf(editing)} onClose={() => {
      setText(savedDraft.current)
      onCancelEdit()
    }} />
  ) : replyTo ? (
    <Bar icon={<Reply className="size-4" />} title={`Replying to ${replyTo.sender_id === me ? 'yourself' : (replyTo.sender?.full_name ?? 'member')}`} text={previewOf(replyTo)} onClose={onCancelReply} />
  ) : null

  return (
    <div>
      {banner}
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mention a member" className="mb-2 max-h-56 overflow-y-auto rounded-2xl border border-border bg-surface shadow-md">
          {suggestions.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === mentionIdx}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(c.full_name)} className={clsx('flex min-h-12 w-full items-center gap-3 px-3 text-left', i === mentionIdx && 'bg-primary-soft')}>
                <Avatar src={c.avatar_url} name={c.full_name} size={32} />
                <span className="truncate font-medium">{c.full_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 && (
        <ul className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Attachments to send">
          {picked.map((p, i) => (
            <li key={i} className="relative shrink-0">
              {p.url ? (
                <img src={p.url} alt={p.file.name} className="size-20 rounded-xl object-cover" />
              ) : (
                <div className="flex h-20 w-40 flex-col justify-center gap-1 rounded-xl border border-border bg-surface p-2">
                  <FileText className="size-5 text-primary" aria-hidden />
                  <span className="truncate text-xs font-semibold">{p.file.name}</span>
                  <span className="text-xs text-muted">{formatBytes(p.file.size)}</span>
                </div>
              )}
              <button type="button" onClick={() => removePicked(i)} className="absolute -right-1.5 -top-1.5 grid size-7 place-items-center rounded-full bg-text text-bg shadow" aria-label={`Remove ${p.file.name}`}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {voice.recording ? (
        <div className="flex items-center gap-2" role="group" aria-label="Recording voice message">
          <button type="button" onClick={() => void voice.cancel()} className="grid size-12 shrink-0 place-items-center rounded-full text-danger hover:bg-danger-soft" aria-label="Discard recording">
            <Trash2 className="size-5" />
          </button>
          <div className="flex min-h-12 flex-1 items-center gap-3 rounded-3xl border border-border bg-surface px-4" role="status">
            <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden />
            <span className="font-semibold tabular-nums">{formatDuration(voice.seconds)}</span>
            <span className="text-sm text-muted">Recording… max {MAX_VOICE_SECONDS / 60} min</span>
          </div>
          <button type="button" onClick={() => void sendVoice()} className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary" aria-label="Send voice message">
            <Send className="size-5" />
          </button>
        </div>
      ) : (
      <form onSubmit={submit} className="flex items-end gap-2">
        {!editing && (
          <button type="button" onClick={() => setAttachOpen(true)} className="grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Attach photo or file">
            <Paperclip className="size-5" />
          </button>
        )}
        <textarea
          ref={input}
          aria-label="Message"
          rows={1}
          className="max-h-40 min-h-12 flex-1 resize-none rounded-3xl border border-border bg-surface px-4 py-3 text-[16px] leading-snug focus:border-primary focus:outline-none"
          placeholder={picked.length ? 'Add a caption' : isGroup ? 'Message the group' : 'Message'}
          value={text}
          maxLength={4000}
          enterKeyHint="send"
          onPaste={onPaste}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setMentionDismissed(false)
            if (e.target.value && !editing) onTyping()
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pickMention(suggestions[mentionIdx]!.full_name)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMentionDismissed(true)
                return
              }
            }
            if (e.key === 'Escape' && (editing || replyTo)) {
              e.preventDefault()
              if (editing) {
                setText(savedDraft.current)
                onCancelEdit()
              } else onCancelReply()
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {showMic ? (
          <button type="button" onClick={() => void startVoice()} className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary" aria-label="Record voice message">
            <Mic className="size-5" />
          </button>
        ) : (
        <button
          type="submit"
          disabled={!canSend || saving}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-opacity disabled:opacity-40"
          aria-label={editing ? 'Save edit' : 'Send'}
        >
          {editing ? <Check className="size-5" /> : <Send className="size-5" />}
        </button>
        )}
      </form>
      )}
      {slowSeconds > 0 && !editing && (
        <p className="mt-1 text-center text-xs text-muted" role="status">
          {waitSeconds > 0 ? `Slow mode: you can send again in ${waitSeconds}s` : `Slow mode is on: one message every ${slowSeconds >= 60 ? `${Math.round(slowSeconds / 60)} min` : `${slowSeconds}s`}`}
        </p>
      )}
      {text.length > 3500 && <p className="mt-1 text-right text-xs text-muted">{4000 - text.length} characters left</p>}

      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={docInput} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} label="Attach">
        <SheetAction icon={<ImageIcon className="size-5" />} onClick={() => photoInput.current?.click()}>Photos</SheetAction>
        <SheetAction icon={<Camera className="size-5" />} onClick={() => cameraInput.current?.click()}>Camera</SheetAction>
        <SheetAction icon={<FileText className="size-5" />} onClick={() => docInput.current?.click()}>Document (PDF, Word, Excel…)</SheetAction>
        <SheetAction icon={<BarChart3 className="size-5" />} onClick={() => { setAttachOpen(false); setPollOpen(true) }}>Poll</SheetAction>
        <p className="px-5 pt-2 text-xs text-muted">Up to 25 MB per file. Files are visible only to people in this chat.</p>
      </Sheet>
      <PollSheet open={pollOpen} onClose={() => setPollOpen(false)} onCreate={(poll) => { onSend({ body: '', kind: 'poll', poll, replyTo }); onCancelReply(); setPollOpen(false) }} />
    </div>
  )
}

function PollSheet({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (p: Poll) => void }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  useEffect(() => {
    if (!open) {
      setQuestion('')
      setOptions(['', ''])
      setMultiple(false)
    }
  }, [open])
  const clean = options.map((o) => o.trim()).filter(Boolean)
  const valid = question.trim().length > 0 && clean.length >= 2 && new Set(clean.map((o) => o.toLowerCase())).size === clean.length
  return (
    <Sheet open={open} onClose={onClose} label="Create a poll">
      <form
        className="space-y-3 px-5 pb-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onCreate({ question: question.trim(), options: clean, multiple })
        }}
      >
        <h2 className="text-lg font-bold">Create a poll</h2>
        <input aria-label="Question" placeholder="Ask a question" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-[16px] focus:border-primary focus:outline-none" />
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} maxLength={100} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} className="min-h-12 flex-1 rounded-xl border border-border bg-surface px-3 text-[16px] focus:border-primary focus:outline-none" />
              {options.length > 2 && (
                <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="grid size-12 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={`Remove option ${i + 1}`}>
                  <X className="size-5" />
                </button>
              )}
            </div>
          ))}
          {options.length < 12 && (
            <button type="button" onClick={() => setOptions([...options, ''])} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
              <Plus className="size-4" aria-hidden /> Add option
            </button>
          )}
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="size-5 accent-[var(--primary)]" />
          Allow multiple answers
        </label>
        {clean.length >= 2 && new Set(clean.map((o) => o.toLowerCase())).size !== clean.length && <p className="text-sm text-danger">Options must be different.</p>}
        <button type="submit" disabled={!valid} className="min-h-12 w-full rounded-full bg-primary font-semibold text-on-primary disabled:opacity-40">Send poll</button>
      </form>
    </Sheet>
  )
}

function Bar({ icon, title, text, onClose }: { icon: ReactNode; title: string; text: string; onClose: () => void }) {
  return (
    <div className={clsx('mb-2 flex items-center gap-2 rounded-2xl border-l-4 border-primary bg-primary-soft py-1.5 pl-3 pr-1')}>
      <span className="text-primary" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">{title}</span>
        <span className="block truncate text-sm text-muted">{text}</span>
      </span>
      <button type="button" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface" aria-label="Cancel">
        <X className="size-5" />
      </button>
    </div>
  )
}
