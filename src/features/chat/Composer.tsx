import clsx from 'clsx'
import { Camera, Check, FileText, Image as ImageIcon, Paperclip, Pencil, Reply, Send, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { fileProblem, formatBytes, isPhoto, MAX_PHOTOS } from './media'
import { previewOf, type Message, type ReplyPreview } from './merge'
import type { SendInput } from './queries'

const MAX_PICK = 30

interface Picked {
  file: File
  url?: string
}

export function ChatComposer({
  isGroup,
  me,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onEdit,
  onTyping,
}: {
  isGroup: boolean
  me: string | null
  replyTo: ReplyPreview | null
  onCancelReply: () => void
  editing: Message | null
  onCancelEdit: () => void
  onSend: (input: SendInput) => void
  onEdit: (id: string, body: string) => Promise<boolean>
  onTyping: () => void
}) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const savedDraft = useRef('')

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

  async function submit(e?: FormEvent) {
    e?.preventDefault()
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

  const canSend = editing ? !!text.trim() || editing.kind !== 'text' : !!text.trim() || picked.length > 0
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
            if (e.target.value && !editing) onTyping()
          }}
          onKeyDown={(e) => {
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
        <button
          type="submit"
          disabled={!canSend || saving}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-opacity disabled:opacity-40"
          aria-label={editing ? 'Save edit' : 'Send'}
        >
          {editing ? <Check className="size-5" /> : <Send className="size-5" />}
        </button>
      </form>
      {text.length > 3500 && <p className="mt-1 text-right text-xs text-muted">{4000 - text.length} characters left</p>}

      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={docInput} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} label="Attach">
        <SheetAction icon={<ImageIcon className="size-5" />} onClick={() => photoInput.current?.click()}>Photos</SheetAction>
        <SheetAction icon={<Camera className="size-5" />} onClick={() => cameraInput.current?.click()}>Camera</SheetAction>
        <SheetAction icon={<FileText className="size-5" />} onClick={() => docInput.current?.click()}>Document (PDF, Word, Excel…)</SheetAction>
        <p className="px-5 pt-2 text-xs text-muted">Up to 25 MB per file. Files are visible only to people in this chat.</p>
      </Sheet>
    </div>
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
