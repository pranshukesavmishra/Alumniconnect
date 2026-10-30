// "Here is what we found": every field Magic fill (or LinkedIn) found, each with its own tick box and inline edit.
// Fields the member already filled are shown unticked with "Replaces: ..." so nothing is overwritten silently.
import { Briefcase, GraduationCap, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { useT, type MsgKey } from '../../i18n'
import type { Preview, ScalarItem } from './mapping'

function ScalarRow({ item, onChange }: { item: ScalarItem; onChange: (next: ScalarItem) => void }) {
  const tx = useT()
  const [editing, setEditing] = useState(false)
  const label = tx(`qp.field.${item.key}` as MsgKey)
  const set = (value: string) => onChange({ ...item, value, checked: true })
  return (
    <div className="flex items-start gap-1 p-3" data-field={item.key}>
      <div className="min-w-0 flex-1">
        <Checkbox checked={item.checked} onChange={(checked) => onChange({ ...item, checked })}>
          <span className="block text-sm text-muted">{label}</span>
          {!editing && <span className="block break-words font-semibold">{item.value}</span>}
          {item.replaces && <span className="block text-sm text-warning">{tx('qp.replaces', { value: item.current })}</span>}
        </Checkbox>
        {editing && (
          <div className="mt-2 flex items-start gap-2 pl-8">
            <div className="min-w-0 flex-1">
              {item.key === 'about' ? (
                <Textarea aria-label={label} maxLength={400} value={item.value} onChange={(e) => set(e.target.value)} />
              ) : item.key === 'branch' ? (
                <Select aria-label={label} value={item.value} onChange={(e) => set(e.target.value)}>
                  {BRANCHES.map((b) => <option key={b}>{b}</option>)}
                </Select>
              ) : item.key === 'grad_year' ? (
                <Select aria-label={label} value={item.value} onChange={(e) => set(e.target.value)}>
                  {yearRange(1960, CURRENT_YEAR + 5).map((y) => <option key={y}>{y}</option>)}
                </Select>
              ) : (
                <Input aria-label={label} maxLength={item.key === 'headline' ? 160 : 120} value={item.value} onChange={(e) => set(e.target.value)} />
              )}
            </div>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEditing(false)}>{tx('qp.doneEdit')}</Button>
          </div>
        )}
      </div>
      {!editing && (
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label={tx('qp.change', { field: label })} onClick={() => setEditing(true)}>
          <Pencil className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

export function PreviewCard({
  preview,
  onChange,
  onSave,
  onStartOver,
  saving,
  error,
}: {
  preview: Preview
  onChange: (p: Preview) => void
  onSave: () => void
  onStartOver: () => void
  saving: boolean
  error: unknown
}) {
  const tx = useT()
  const years = (a: number | null, b: number | null, current?: boolean) => (a || b || current ? ` · ${a ?? ''}–${current ? tx('qp.present') : (b ?? '')}` : '')
  return (
    <section className="space-y-4" aria-labelledby="qp-preview-title" data-testid="qp-preview">
      <div>
        <h2 id="qp-preview-title" className="text-lg font-bold">{tx('qp.previewTitle')}</h2>
        <p className="text-sm text-muted">{tx('qp.previewHint')}</p>
      </div>

      {preview.scalars.length > 0 && (
        <Card className="divide-y divide-border">
          {preview.scalars.map((s, i) => (
            <ScalarRow key={s.key} item={s} onChange={(next) => onChange({ ...preview, scalars: preview.scalars.map((x, j) => (j === i ? next : x)) })} />
          ))}
        </Card>
      )}

      {preview.lists.map((l, i) => (
        <Card key={l.key} className="space-y-2 p-3" data-field={l.key}>
          <Checkbox checked={l.checked} onChange={(checked) => onChange({ ...preview, lists: preview.lists.map((x, j) => (j === i ? { ...x, checked } : x)) })}>
            <span className="font-semibold">{tx(`qp.field.${l.key}` as MsgKey)}</span>
          </Checkbox>
          <ul className="flex flex-wrap gap-2 pl-8">
            {l.values.map((v) => (
              <li key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-0.5 text-sm">
                <span className="truncate">{v}</span>
                <button
                  type="button"
                  className="-my-1 grid size-11 shrink-0 place-items-center rounded-full hover:bg-border"
                  aria-label={tx('qp.remove', { value: v })}
                  onClick={() => onChange({ ...preview, lists: preview.lists.map((x, j) => (j === i ? { ...x, values: x.values.filter((y) => y !== v) } : x)) })}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {preview.experiences.length > 0 && (
        <Card className="divide-y divide-border" data-field="experiences">
          <p className="px-3 pt-3 text-sm font-semibold text-muted">{tx('qp.experience')}</p>
          {preview.experiences.map((e, i) => (
            <div key={`${e.title}|${e.company}|${i}`} className="p-3">
              <Checkbox checked={e.checked} onChange={(checked) => onChange({ ...preview, experiences: preview.experiences.map((x, j) => (j === i ? { ...x, checked } : x)) })}>
                <span className="flex gap-3">
                  <Briefcase className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block break-words font-semibold">{e.title}</span>
                    <span className="block break-words text-sm text-muted">{e.company}{years(e.start_year, e.end_year, e.is_current)}</span>
                    {e.exists && <span className="block text-sm text-muted">{tx('qp.already')}</span>}
                  </span>
                </span>
              </Checkbox>
            </div>
          ))}
        </Card>
      )}

      {preview.education.length > 0 && (
        <Card className="divide-y divide-border" data-field="education">
          <p className="px-3 pt-3 text-sm font-semibold text-muted">{tx('qp.education')}</p>
          {preview.education.map((e, i) => (
            <div key={`${e.school}|${i}`} className="p-3">
              <Checkbox checked={e.checked} onChange={(checked) => onChange({ ...preview, education: preview.education.map((x, j) => (j === i ? { ...x, checked } : x)) })}>
                <span className="flex gap-3">
                  <GraduationCap className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block break-words font-semibold">{e.school}</span>
                    <span className="block break-words text-sm text-muted">{[e.degree, e.field].filter(Boolean).join(', ')}{years(e.start_year, e.end_year)}</span>
                  </span>
                </span>
              </Checkbox>
            </div>
          ))}
        </Card>
      )}

      {!!error && <Notice tone="danger" title={friendlyError(error)} />}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" block loading={saving} onClick={onSave}>{tx('qp.save')}</Button>
        <Button size="lg" variant="ghost" block onClick={onStartOver}>{tx('qp.startOver')}</Button>
      </div>
    </section>
  )
}
