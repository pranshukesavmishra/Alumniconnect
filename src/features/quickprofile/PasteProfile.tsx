// "Paste your profile": the main way to fill a profile, free for everyone.
//   copy your own LinkedIn profile text -> paste -> "Read my profile" -> the usual preview (ticks, edit) -> one Save.
// The text is read ON THE DEVICE (pasteParser.ts). When the site's free AI is switched on it is read by the AI first (better
// with odd layouts) and silently falls back to the on-device reading on any failure or limit. Raw text is never stored.
// Above the box, when available, "Suggest my profile" needs no pasting at all (SuggestProfile).
import { ClipboardPaste, FileSearch } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { Textarea } from '../../components/ui/Form'
import { isJec } from '../../lib/linkedin/common'
import { useT } from '../../i18n'
import { parsedHasContent, PASTE_MAX_CHARS } from './pasteParser'
import { readPasted } from './pasteRead'
import { PreviewCard } from './PreviewCard'
import { submitEducationHint } from './enrichQueries'
import { useAiAvailable } from './queries'
import { SuggestProfile } from './SuggestProfile'
import { useFoundProfile } from './useFoundProfile'

export function PasteProfile({ onSaved, autoFocus, suggest = true }: { onSaved?: () => void; autoFocus?: boolean; suggest?: boolean }) {
  const tx = useT()
  const ai = useAiAvailable()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [trimmed, setTrimmed] = useState(false)
  const source = useRef<'paste' | 'ai_suggest'>('paste')
  const found = useFoundProfile(onSaved)
  const canClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
  const max = PASTE_MAX_CHARS.toLocaleString('en-IN')

  function take(v: string) {
    setProblem(null)
    setTrimmed(v.length > PASTE_MAX_CHARS)
    setText(v.slice(0, PASTE_MAX_CHARS))
  }

  async function fromClipboard() {
    try {
      take(await navigator.clipboard.readText())
    } catch {
      setProblem(tx('pp.pasteFail'))
    }
  }

  async function read() {
    setProblem(null)
    if (!text.trim()) return setProblem(tx('pp.empty'))
    setBusy(true)
    try {
      const r = await readPasted(text, ai.available)
      if (!parsedHasContent(r.profile)) return setProblem(tx('pp.noneFound'))
      source.current = 'paste'
      found.show(r.profile)
      if (!found.preview) setProblem(null)
    } finally {
      setBusy(false)
    }
  }

  // After a save, tell the admins what the college entry said (never verifies by itself)
  async function save() {
    const jecRows = (found.preview?.education ?? []).filter((e) => e.checked && isJec(e.school))
    try {
      await found.commit()
    } catch {
      return
    }
    for (const e of jecRows.slice(0, 1)) void submitEducationHint(e, source.current).catch(() => undefined)
  }

  if (found.preview) {
    return <PreviewCard preview={found.preview} onChange={found.setPreview} onSave={() => void save()} onStartOver={found.reset} saving={found.save.isPending} error={found.save.error} />
  }

  return (
    <div className="space-y-4" data-testid="paste-profile">
      {suggest && (
        <SuggestProfile
          onSuggestion={(p) => {
            source.current = 'ai_suggest'
            found.show(p)
          }}
        />
      )}
      <div>
        <h2 className="text-lg font-bold">{tx('pp.title')}</h2>
        <p className="text-sm text-muted">{tx('pp.intro')}</p>
      </div>
      <details className="rounded-2xl bg-surface-2 p-3 text-sm" data-testid="paste-help">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{tx('pp.help.title')}</summary>
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <div>
            <p className="font-semibold">{tx('pp.help.phone')}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{tx('pp.help.phone1')}</li>
              <li>{tx('pp.help.phone2')}</li>
              <li>{tx('pp.help.phone3')}</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold">{tx('pp.help.computer')}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{tx('pp.help.computer1')}</li>
              <li>{tx('pp.help.computer2')}</li>
              <li>{tx('pp.help.computer3')}</li>
            </ol>
          </div>
        </div>
      </details>
      <label htmlFor="pp-box" className="block text-sm font-semibold">{tx('pp.label')}</label>
      <Textarea
        id="pp-box"
        data-testid="paste-box"
        autoFocus={autoFocus}
        rows={7}
        maxLength={PASTE_MAX_CHARS}
        placeholder={tx('pp.ph')}
        value={text}
        onChange={(e) => take(e.target.value)}
        aria-describedby="pp-hint"
        className="min-h-40"
      />
      <div id="pp-hint" className="flex items-start justify-between gap-3 text-sm text-muted">
        <span>{ai.available ? tx('pp.privacyAi') : tx('pp.privacyDevice')}</span>
        <span className="shrink-0 tabular-nums" data-testid="paste-count">{tx('pp.count', { n: text.length.toLocaleString('en-IN'), max })}</span>
      </div>
      {trimmed && <Notice tone="info" title={tx('pp.trimmed', { max })} />}
      {problem && <Notice tone="danger" title={problem} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canClipboard && (
          <Button size="lg" variant="secondary" block icon={<ClipboardPaste className="size-5" />} onClick={() => void fromClipboard()} data-testid="paste-clipboard">
            {tx('pp.paste')}
          </Button>
        )}
        <Button size="lg" block icon={<FileSearch className="size-5" />} loading={busy} onClick={() => void read()} data-testid="paste-read">
          {tx('pp.read')}
        </Button>
      </div>
    </div>
  )
}
