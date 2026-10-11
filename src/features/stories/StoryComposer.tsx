import clsx from 'clsx'
import { Camera, Film, Image as ImageIcon, Lock, Type, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { formatDuration, formatSize, type VideoInfo } from '../photos/video'
import { UploadAborted } from '../photos/driveUpload'
import {
  prepareStoryVideo, storyError, useAudienceCount, useMyStories, useNotifyStory, usePostStory, useStoryEvents, useStoryGroups,
  type PostStage,
} from './api'
import {
  BG_KEYS, bgStyle, captionProblem, DAILY_LIMIT, draftProblem, isPhotoFile, linkProblem, MAX_CAPTION, MAX_LINK_LABEL, MAX_STORY_VIDEO_BYTES, MAX_TEXT, MAX_VIDEO_MS, postedToday, textCardSize,
  type Audience, type BgKey, type StoryKind, type StoryVideoProblem,
} from './rules'

const MAX_PHOTO_BYTES = 40 * 1024 * 1024

interface Props {
  open: boolean
  onClose: () => void
  /** an official story (needs the stories_post permission): more audiences, a link, the notification */
  official?: boolean
  onPosted?: (id: string) => void
}

/** The sheet for posting a story: choose a photo, a short video or a text card, pick who sees it, post. Used by members (two audiences) and the story team. */
export function StoryComposer({ open, onClose, official = false, onPosted }: Props) {
  const tx = useT()
  const [kind, setKind] = useState<StoryKind>('photo')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [bg, setBg] = useState<BgKey>('indigo')
  const [caption, setCaption] = useState('')
  const [audience, setAudience] = useState<Audience>(official ? 'all' : 'connections')
  const [eventId, setEventId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [link, setLink] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [notify, setNotify] = useState(false)
  const [stage, setStage] = useState<PostStage | null>(null)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const post = usePostStory()
  const notifyStory = useNotifyStory()
  const events = useStoryEvents()
  const groups = useStoryGroups()
  const mine = useMyStories()
  const count = useAudienceCount(audience, eventId || null, groupId || null, open && official)
  const busy = post.isPending

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function reset() {
    setFile(null)
    setVideo(null)
    setFileError(null)
    setText('')
    setCaption('')
    setLink('')
    setLinkLabel('')
    setNotify(false)
    setStage(null)
    setProgress(null)
    setError(null)
    setEventId('')
    setGroupId('')
    setAudience(official ? 'all' : 'connections')
  }

  function chooseKind(k: StoryKind) {
    if (busy) return
    setKind(k)
    setFile(null)
    setVideo(null)
    setFileError(null)
    setError(null)
  }

  async function onPick(f: File | undefined) {
    if (!f) return
    setError(null)
    setFileError(null)
    setVideo(null)
    setFile(null)
    if (kind === 'photo') {
      if (!isPhotoFile(f)) return setFileError(tx('stories.fileNotPhoto'))
      if (f.size > MAX_PHOTO_BYTES) return setFileError(tx('stories.fileTooBigPhoto', { mb: MAX_PHOTO_BYTES / 1024 / 1024 }))
      setFile(f)
      return
    }
    setReading(true)
    try {
      const r = await prepareStoryVideo(f)
      if (r.problem) {
        setFileError(videoProblemText(r.problem))
        return
      }
      setVideo(r.info)
      setFile(f)
    } catch {
      setFileError(videoProblemText('unreadable'))
    } finally {
      setReading(false)
    }
  }

  function videoProblemText(p: StoryVideoProblem): string {
    switch (p) {
      case 'format':
        return tx('stories.vpFormat')
      case 'empty':
        return tx('stories.vpEmpty')
      case 'tooBig':
        return tx('stories.vpBig', { mb: MAX_STORY_VIDEO_BYTES / 1024 / 1024 })
      case 'tooLong':
        return tx('stories.vpLong', { sec: MAX_VIDEO_MS / 1000 })
      case 'tooShort':
        return tx('stories.vpShort')
      default:
        return tx('stories.vpUnreadable')
    }
  }

  const problem = draftProblem({ kind, text, caption, hasFile: !!file, audience, official, eventId, groupId, link, linkLabel })
  const todayCount = mine.data ? postedToday(mine.data.map((s) => s.created_at)) : 0
  const eventTitle = events.data?.find((e) => e.id === eventId)?.title
  const groupName = groups.data?.find((g) => g.id === groupId)?.name

  async function submit() {
    if (problem || busy) return
    setError(null)
    setStage(null)
    setProgress(null)
    abort.current = new AbortController()
    try {
      const id = await post.mutateAsync({
        story: { kind, official, audience, eventId: eventId || null, groupId: groupId || null, caption, text, bg, file, video, link: official ? link : undefined, linkLabel },
        hooks: { onStage: setStage, onProgress: (sent, total) => setProgress({ sent, total }), signal: abort.current.signal },
      })
      if (official && notify) {
        try {
          const n = await notifyStory.mutateAsync(id)
          toast.success(tx('stories.notified', { count: n }))
        } catch (e) {
          toast.error(storyError(e))
        }
      }
      toast.success(tx('stories.posted'))
      reset()
      onPosted?.(id)
      onClose()
    } catch (e) {
      if (e instanceof UploadAborted || (e as Error)?.name === 'AbortError') setError(tx('stories.cancelled'))
      else setError(storyError(e))
    } finally {
      setStage(null)
      setProgress(null)
    }
  }

  const tab = (k: StoryKind, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === k}
      onClick={() => chooseKind(k)}
      data-testid={`story-kind-${k}`}
      className={clsx('inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}
    >
      {icon}
      {label}
    </button>
  )

  const audienceOption = (value: Audience, title: string, hint: string, icon: React.ReactNode) => (
    <label
      key={value}
      className={clsx('flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3', audience === value ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}
    >
      <input type="radio" name="story-audience" className="mt-1 size-5 accent-[var(--primary)]" checked={audience === value} onChange={() => setAudience(value)} disabled={busy} data-testid={`story-audience-${value}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold">{icon}{title}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
    </label>
  )

  const stageText = stage === 'photo' ? tx('stories.stagePhoto') : stage === 'saving' ? tx('stories.stageSaving') : stage === 'sending' ? tx('stories.stageSending') : ''

  return (
    <Sheet open={open} onClose={() => (busy ? undefined : onClose())} label={tx(official ? 'stories.composerOfficial' : 'stories.composer')} className="md:max-w-lg">
      <form
        className="space-y-4 px-5 pb-3 pt-1"
        data-testid="story-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <h2 className="text-lg font-bold">{tx(official ? 'stories.composerOfficial' : 'stories.composer')}</h2>
          <p className="text-sm text-muted">{tx(official ? 'stories.composerOfficialHelp' : 'stories.composerHelp')}</p>
        </div>

        <div role="tablist" aria-label={tx('stories.kind')} className="flex gap-1 rounded-full bg-surface-2 p-1">
          {tab('photo', <ImageIcon className="size-4" aria-hidden />, tx('stories.kindPhoto'))}
          {tab('video', <Film className="size-4" aria-hidden />, tx('stories.kindVideo'))}
          {tab('text', <Type className="size-4" aria-hidden />, tx('stories.kindText'))}
        </div>

        {kind !== 'text' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" icon={<Camera className="size-4" />} disabled={busy || reading} onClick={() => camera.current?.click()} data-testid="story-pick-camera">
                {tx(kind === 'photo' ? 'stories.takePhoto' : 'stories.recordVideo')}
              </Button>
              <Button type="button" variant="secondary" size="sm" icon={<ImageIcon className="size-4" />} disabled={busy || reading} onClick={() => gallery.current?.click()} data-testid="story-pick-gallery">
                {tx('stories.fromGallery')}
              </Button>
              <input
                ref={camera}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept={kind === 'photo' ? 'image/*' : 'video/*'}
                capture={kind === 'photo' ? 'environment' : 'user'}
                data-testid="story-file-camera"
                onChange={(e) => {
                  void onPick(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <input
                ref={gallery}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept={kind === 'photo' ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : 'video/mp4,video/quicktime,video/webm'}
                data-testid="story-file-gallery"
                onChange={(e) => {
                  void onPick(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            {kind === 'video' && (
              <Notice tone="info">
                {tx('stories.videoTip', { sec: MAX_VIDEO_MS / 1000, mb: MAX_STORY_VIDEO_BYTES / 1024 / 1024 })}
              </Notice>
            )}
            {reading && <p className="text-sm text-muted" role="status">{tx('stories.reading')}</p>}
            {fileError && <p className="text-sm text-danger" role="alert" data-testid="story-file-error">{fileError}</p>}
            {file && preview && (
              <div className="overflow-hidden rounded-2xl bg-black" data-testid="story-preview">
                {kind === 'photo' ? (
                  <img src={preview} alt={tx('stories.previewAlt')} className="mx-auto max-h-72 object-contain" />
                ) : (
                  <video src={preview} className="mx-auto max-h-72" muted playsInline controls preload="metadata" aria-label={tx('stories.previewAlt')} />
                )}
              </div>
            )}
            {file && kind === 'video' && video && (
              <p className="text-sm text-muted" data-testid="story-video-facts">
                {formatDuration(video.duration_ms)} · {formatSize(file.size)}
              </p>
            )}
          </div>
        )}

        {kind === 'text' && (
          <div className="space-y-3">
            <div className="grid min-h-44 place-items-center rounded-2xl p-5 text-center text-white" style={{ background: bgStyle(bg) }} data-testid="story-text-preview">
              <p dir="auto" className="max-w-full whitespace-pre-line break-words font-bold leading-tight [overflow-wrap:anywhere]" style={{ fontSize: Math.round(textCardSize(text) * 0.8) }}>
                {text.trim() || tx('stories.textPlaceholder')}
              </p>
            </div>
            <Field label={tx('stories.textLabel')} hint={tx('stories.counter', { n: text.length, max: MAX_TEXT })}>
              {(p) => <Textarea {...p} value={text} maxLength={MAX_TEXT} rows={3} onChange={(e) => setText(e.target.value)} placeholder={tx('stories.textPlaceholder')} disabled={busy} data-testid="story-text" />}
            </Field>
            <div role="radiogroup" aria-label={tx('stories.background')} className="flex flex-wrap gap-2">
              {BG_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={bg === k}
                  aria-label={tx(`stories.bg_${k}`)}
                  onClick={() => setBg(k)}
                  className={clsx('size-11 rounded-full border-2', bg === k ? 'border-primary ring-2 ring-primary/40' : 'border-transparent')}
                  style={{ background: bgStyle(k) }}
                />
              ))}
            </div>
          </div>
        )}

        <Field label={tx('stories.caption')} optional hint={tx('stories.counter', { n: caption.length, max: MAX_CAPTION })} error={captionProblem(caption) ? tx('stories.captionLong', { max: MAX_CAPTION }) : null}>
          {(p) => <Input {...p} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={MAX_CAPTION + 20} placeholder={tx('stories.captionPlaceholder')} disabled={busy} data-testid="story-caption-input" />}
        </Field>

        {official && (
          <div className="space-y-2">
            <Field label={tx('stories.link')} optional hint={tx('stories.linkHint')} error={link.trim() && linkProblem(link, linkLabel) === 'invalid' ? tx('stories.linkInvalid') : null}>
              {(p) => <Input {...p} value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" autoCapitalize="none" placeholder="https://" disabled={busy} data-testid="story-link-input" />}
            </Field>
            {link.trim() && (
              <Field label={tx('stories.linkLabel')} optional>
                {(p) => <Input {...p} value={linkLabel} maxLength={MAX_LINK_LABEL} onChange={(e) => setLinkLabel(e.target.value)} placeholder={tx('stories.linkDefault')} disabled={busy} data-testid="story-link-label" />}
              </Field>
            )}
          </div>
        )}

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-sm font-semibold">{tx('stories.whoSees')}</legend>
          {official ? (
            <>
              {audienceOption('all', tx('stories.audAllOfficial'), tx('stories.audAllOfficialHint'), <Users className="size-4" aria-hidden />)}
              {audienceOption('event', tx('stories.audEvent'), tx('stories.audEventHint'), <Lock className="size-4" aria-hidden />)}
              {audienceOption('group', tx('stories.audGroup'), tx('stories.audGroupHint'), <Users className="size-4" aria-hidden />)}
            </>
          ) : (
            <>
              {audienceOption('connections', tx('stories.audConnections'), tx('stories.audConnectionsHint'), <Lock className="size-4" aria-hidden />)}
              {audienceOption('all', tx('stories.audAll'), tx('stories.audAllHint'), <Users className="size-4" aria-hidden />)}
            </>
          )}
        </fieldset>

        {official && audience === 'event' && (
          <Field label={tx('stories.pickEvent')}>
            {(p) => (
              <Select {...p} value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={busy} data-testid="story-event">
                <option value="">{tx('stories.choose')}</option>
                {events.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </Select>
            )}
          </Field>
        )}
        {official && audience === 'group' && (
          <Field label={tx('stories.pickGroup')}>
            {(p) => (
              <Select {...p} value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy} data-testid="story-group">
                <option value="">{tx('stories.choose')}</option>
                {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            )}
          </Field>
        )}

        {official && (
          <Notice tone={audience === 'all' ? 'info' : 'warning'} title={tx('stories.lockTitle')}>
            <span data-testid="story-lock-note">
              {audience === 'all' && tx('stories.lockAll')}
              {audience === 'event' && (eventTitle ? tx('stories.lockEvent', { event: eventTitle }) : tx('stories.lockEventPick'))}
              {audience === 'group' && (groupName ? tx('stories.lockGroup', { group: groupName }) : tx('stories.lockGroupPick'))}
              {count.data != null && <> {tx('stories.aboutPeople', { count: count.data })}</>}
            </span>
          </Notice>
        )}

        {official && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} data-testid="story-notify" />
            <span>
              <span className="block font-semibold">{tx('stories.alsoNotify')}</span>
              <span className="block text-sm text-muted">{tx('stories.alsoNotifyHint')}</span>
            </span>
          </label>
        )}

        {!official && todayCount >= DAILY_LIMIT - 5 && <p className="text-sm text-muted">{tx('stories.dailyCount', { n: todayCount, max: DAILY_LIMIT })}</p>}

        {busy && (
          <div role="status" aria-live="polite" className="space-y-2" data-testid="story-progress">
            <p className="text-sm font-semibold">{stageText}</p>
            {stage === 'sending' && progress && (
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.sent / progress.total) * 100)}>
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(progress.sent / progress.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert" data-testid="story-error">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {busy && stage === 'sending' ? (
            <Button type="button" variant="secondary" className="flex-1" onClick={() => abort.current?.abort()}>{tx('stories.cancelUpload')}</Button>
          ) : (
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{tx('common.cancel')}</Button>
          )}
          <Button type="submit" className="flex-1" loading={busy} disabled={!!problem || reading} data-testid="story-post">
            {tx(error ? 'stories.tryAgain' : 'stories.post')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
