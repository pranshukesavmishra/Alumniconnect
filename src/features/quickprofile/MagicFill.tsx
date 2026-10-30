// Magic fill: one box ("tell us about yourself, paste LinkedIn text, or speak") -> preview -> one Save.
// Works without AI too: when the function is not configured or the day's limit is used, it says so and the caller
// keeps its manual fields.
import { Mic, MicOff, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { Textarea } from '../../components/ui/Form'
import { useLang, useT } from '../../i18n'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMember } from '../profile/queries'
import { buildPreview, previewIsEmpty, previewToSave, type AiProfile, type Preview } from './mapping'
import { PreviewCard } from './PreviewCard'
import { AI_OFF_CODES, AiFillError, useAiFill, useSaveQuickProfile } from './queries'
import { useSpeech } from './useSpeech'

export const MAX_CHARS = 12_000

/** Preview + save for any found profile (Magic fill, LinkedIn). */
export function useFoundProfile(onSaved?: () => void) {
  const tx = useT()
  const uid = useUserId()
  const { data: profile } = useMyProfile()
  const member = useMember(uid ?? undefined)
  const save = useSaveQuickProfile()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [nothing, setNothing] = useState(false)
  return {
    preview,
    nothing,
    setPreview,
    show(ai: AiProfile) {
      if (!profile) return
      const p = buildPreview(ai, profile, member.data?.experiences ?? [])
      setNothing(previewIsEmpty(p))
      setPreview(previewIsEmpty(p) ? null : p)
    },
    reset() {
      setPreview(null)
      setNothing(false)
      save.reset()
    },
    save,
    async commit() {
      if (!preview || !profile) return
      await save.mutateAsync(previewToSave(preview, profile))
      toast.success(tx('qp.saved'))
      setPreview(null)
      onSaved?.()
    },
  }
}

export function MagicFill({ onSaved, onUnavailable, autoFocus }: { onSaved?: () => void; onUnavailable?: () => void; autoFocus?: boolean }) {
  const tx = useT()
  const { lang } = useLang()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState<string | null>(null)
  const fill = useAiFill()
  const found = useFoundProfile(onSaved)
  const speech = useSpeech(lang, (t) => setText((cur) => (cur ? `${cur.trimEnd()} ${t}` : t).slice(0, MAX_CHARS)))

  async function submit() {
    setProblem(null)
    if (speech.listening) speech.stop()
    const t = text.trim()
    if (!t) return setProblem(tx('qp.empty'))
    if (t.length > MAX_CHARS) return setProblem(tx('qp.tooLong', { max: MAX_CHARS.toLocaleString('en-IN') }))
    try {
      found.show(await fill.mutateAsync(t))
    } catch (e) {
      const code = e instanceof AiFillError ? e.code : 'failed'
      if (AI_OFF_CODES.includes(code)) {
        setOff(code === 'limit' ? tx('qp.aiLimit') : tx('qp.aiOff'))
        onUnavailable?.()
      } else {
        setProblem(e instanceof AiFillError && e.message ? e.message : tx('qp.aiError'))
      }
    }
  }

  if (found.preview) {
    return (
      <PreviewCard
        preview={found.preview}
        onChange={found.setPreview}
        onSave={() => void found.commit().catch(() => undefined)}
        onStartOver={found.reset}
        saving={found.save.isPending}
        error={found.save.error}
      />
    )
  }

  if (off) return <Notice tone="info" title={off} />

  const count = text.length
  return (
    <div className="space-y-3" data-testid="magic-fill">
      <label htmlFor="qp-box" className="block text-sm font-semibold">{tx('qp.boxLabel')}</label>
      <div className="relative">
        <Textarea
          id="qp-box"
          autoFocus={autoFocus}
          rows={5}
          maxLength={MAX_CHARS}
          placeholder={tx('qp.boxPh')}
          value={speech.interim ? `${text}${text ? ' ' : ''}${speech.interim}` : text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="qp-box-hint"
          className={speech.supported ? 'pr-14' : undefined}
        />
        {speech.supported && (
          <button
            type="button"
            data-testid="qp-mic"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? tx('qp.micStop') : tx('qp.mic')}
            className={`absolute bottom-2 right-2 grid size-11 place-items-center rounded-full ${speech.listening ? 'animate-pulse bg-danger text-white' : 'bg-primary-soft text-primary hover:bg-primary hover:text-on-primary'}`}
          >
            {speech.listening ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
        )}
      </div>
      <div id="qp-box-hint" className="flex items-start justify-between gap-3 text-sm text-muted">
        <span aria-live="polite">{speech.listening ? tx('qp.listening') : speech.error === 'denied' ? tx('qp.micDenied') : speech.error ? tx('qp.micFailed') : tx('qp.privacy')}</span>
        <span className="shrink-0 tabular-nums">{tx('qp.count', { n: count.toLocaleString('en-IN'), max: MAX_CHARS.toLocaleString('en-IN') })}</span>
      </div>
      {problem && <Notice tone="danger" title={problem} />}
      {found.nothing && <Notice tone="info" title={tx('qp.nothingFound')} />}
      <Button size="lg" block icon={<Sparkles className="size-5" />} loading={fill.isPending} onClick={() => void submit()}>
        {tx('qp.fill')}
      </Button>
    </div>
  )
}
