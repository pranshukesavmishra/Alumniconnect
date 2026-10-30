// "Suggest my profile": no typing, no pasting. The server searches PUBLIC web pages for the signed-in member's own name and
// the college (Gemini with Google Search grounding) and returns a suggestion with up to 3 sources. It is only a suggestion:
// "Yes, this is me" opens the normal preview (ticks, edit, one Save); "Not me" dismisses it and is remembered.
// Shown only when the site's AI status says suggestions are on.
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { useT } from '../../i18n'
import type { AiProfile } from './mapping'
import { AiFillError, aiSuggest, useAiAvailable, type SuggestReply } from './queries'

const KEY = 'jec.qp.suggestNo'
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const remember = () => {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* storage blocked: it may be offered again, which is harmless */
  }
}

export function SuggestProfile({ onSuggestion }: { onSuggestion: (p: AiProfile) => void }) {
  const tx = useT()
  const ai = useAiAvailable()
  const [gone, setGone] = useState(dismissed)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SuggestReply | null>(null)
  const [note, setNote] = useState<string | null>(null)
  if (!ai.suggest || gone) return null

  async function ask() {
    setNote(null)
    setBusy(true)
    try {
      const r = await aiSuggest()
      if (r.found) setResult(r)
      else setNote(tx('sg.nothing'))
    } catch (e) {
      setNote(e instanceof AiFillError && e.code === 'limit' ? tx('sg.limit') : tx('sg.error'))
    } finally {
      setBusy(false)
    }
  }

  if (result?.profile) {
    const p = result.profile
    return (
      <Card className="space-y-3 p-4" data-testid="suggest-card" aria-labelledby="sg-label">
        <p id="sg-label" className="text-sm font-bold text-primary">{tx('sg.label')}</p>
        <div className="space-y-1">
          {p.headline && <p className="break-words font-semibold">{p.headline}</p>}
          {!p.headline && p.current_title && <p className="break-words font-semibold">{[p.current_title, p.current_company].filter(Boolean).join(', ')}</p>}
          <ul className="space-y-0.5 text-sm text-muted">
            {p.experiences.slice(0, 4).map((e, i) => (
              <li key={`${e.title}|${e.company}|${i}`} className="break-words">{e.title}, {e.company}</li>
            ))}
            {p.education.slice(0, 2).map((e, i) => (
              <li key={`${e.school}|${i}`} className="break-words">{e.school}</li>
            ))}
          </ul>
        </div>
        {result.sources.length > 0 && <p className="break-words text-sm text-muted">{tx('sg.sources', { list: result.sources.map((s) => s.title).join(', ') })}</p>}
        <p className="text-sm text-warning">{tx('sg.confidence')}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" block onClick={() => onSuggestion(p)} data-testid="suggest-yes">{tx('sg.yes')}</Button>
          <Button
            size="lg"
            variant="secondary"
            block
            data-testid="suggest-no"
            onClick={() => {
              remember()
              setGone(true)
            }}
          >
            {tx('sg.no')}
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="space-y-3 p-4" data-testid="suggest-box">
      <div>
        <h2 className="text-lg font-bold">{tx('sg.title')}</h2>
        <p className="text-sm text-muted">{tx('sg.intro')}</p>
      </div>
      <p className="text-sm text-muted">{tx('sg.consent')}</p>
      {note && <Notice tone="info" title={note} />}
      <Button size="lg" block icon={<Search className="size-5" />} loading={busy} onClick={() => void ask()} data-testid="suggest-btn">
        {busy ? tx('sg.working') : tx('sg.button')}
      </Button>
    </Card>
  )
}
