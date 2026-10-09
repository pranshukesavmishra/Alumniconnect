import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Textarea } from '../../components/ui/Form'
import { QUESTION_KINDS } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { EventQuestion, QuestionKind } from '../../lib/types'
import { eventKeys, useEventQuestions } from '../events/queries'

export const KIND_NAMES: Record<QuestionKind, string> = {
  yes_no: 'Yes / No',
  single: 'Choose one',
  multi: 'Choose several',
  short_text: 'Short answer',
  long_text: 'Long answer',
}

interface Draft {
  id?: string
  kind: QuestionKind
  label: string
  help: string
  options: string
  required: boolean
  is_active: boolean
}

const blank = (): Draft => ({ kind: 'yes_no', label: '', help: '', options: '', required: false, is_active: true })

/** Organisers' own registration questions: add, edit, reorder, switch off. Members' answers are validated against these on the server. */
export function QuestionsEditor({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const { data: questions, isLoading, error } = useEventQuestions(eventId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: eventKeys.questions(eventId) })
  const optionList = (d: Draft) => d.options.split('\n').map((o) => o.trim()).filter(Boolean)

  async function save() {
    if (!draft) return
    const options = optionList(draft)
    if (draft.label.trim().length < 3) return setProblem('Write the question (at least 3 characters).')
    if ((draft.kind === 'single' || draft.kind === 'multi') && options.length < 2) return setProblem('Give at least two options, one per line.')
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return setProblem('Options must be different from each other.')
    if (options.some((o) => o.length > 80)) return setProblem('Each option can be at most 80 characters.')
    setProblem(null)
    setBusy(true)
    const row = {
      label: draft.label.trim(),
      help: draft.help.trim() || null,
      options: draft.kind === 'single' || draft.kind === 'multi' ? options : [],
      required: draft.required,
      is_active: draft.is_active,
    }
    const { error: err } = draft.id
      ? await supabase.from('event_questions').update(row).eq('id', draft.id)
      : await supabase.from('event_questions').insert({ ...row, kind: draft.kind, event_id: eventId, sort: (questions?.at(-1)?.sort ?? 0) + 1 })
    setBusy(false)
    if (err) return setProblem(friendlyError(err))
    toast.success(draft.id ? 'Question saved' : 'Question added')
    setDraft(null)
    await refresh()
  }

  async function move(i: number, dir: -1 | 1) {
    const a = questions?.[i]
    const b = questions?.[i + dir]
    if (!a || !b) return
    // give both a distinct, ordered sort value
    const r1 = await supabase.from('event_questions').update({ sort: b.sort === a.sort ? b.sort + dir : b.sort }).eq('id', a.id)
    const r2 = await supabase.from('event_questions').update({ sort: a.sort }).eq('id', b.id)
    if (r1.error || r2.error) toast.error(friendlyError(r1.error ?? r2.error))
    await refresh()
  }

  async function remove(q: EventQuestion) {
    if (!window.confirm(`Delete “${q.label}”? Answers already given stay in the registrations but will no longer be shown. Switching the question off keeps everything.`)) return
    const { error: err } = await supabase.from('event_questions').delete().eq('id', q.id)
    if (err) return toast.error(friendlyError(err))
    toast.success('Question deleted')
    await refresh()
  }

  async function toggle(q: EventQuestion) {
    const { error: err } = await supabase.from('event_questions').update({ is_active: !q.is_active }).eq('id', q.id)
    if (err) return toast.error(friendlyError(err))
    await refresh()
  }

  return (
    <section className="space-y-3" aria-labelledby="extra-questions">
      <SectionTitle
        action={
          !draft && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setDraft(blank())}>
              Add question
            </Button>
          )
        }
      >
        <span id="extra-questions">Extra registration questions</span>
      </SectionTitle>
      <p className="text-sm text-muted">Shown to members in the last step of registration, in this order. Answers appear in Responses and in the export.</p>
      {error && <Notice tone="danger" title={friendlyError(error)} />}
      {!isLoading && !questions?.length && !draft && <EmptyState title="No extra questions">Add one if you need to ask something the form does not cover.</EmptyState>}

      {(questions ?? []).map((q, i) =>
        draft?.id === q.id ? null : (
          <Card key={q.id} className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold">{q.label}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <Badge>{KIND_NAMES[q.kind]}</Badge>
                {q.required && <Badge tone="primary">Required</Badge>}
                {!q.is_active && <Badge tone="warning">Switched off</Badge>}
                {q.options.length > 0 && <span className="truncate">{q.options.join(' · ')}</span>}
              </p>
            </div>
            <div className="flex shrink-0">
              <button type="button" aria-label={`Move “${q.label}” up`} disabled={i === 0} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </button>
              <button type="button" aria-label={`Move “${q.label}” down`} disabled={i === (questions?.length ?? 0) - 1} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30" onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Edit “${q.label}”`}
                className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft"
                onClick={() => setDraft({ id: q.id, kind: q.kind, label: q.label, help: q.help ?? '', options: q.options.join('\n'), required: q.required, is_active: q.is_active })}
              >
                <Pencil className="size-4" />
              </button>
              <button type="button" aria-label={q.is_active ? `Switch off “${q.label}”` : `Switch on “${q.label}”`} className="min-h-10 px-2 text-sm font-semibold text-primary" onClick={() => toggle(q)}>
                {q.is_active ? 'Switch off' : 'Switch on'}
              </button>
              <button type="button" aria-label={`Delete “${q.label}”`} className="grid size-10 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" onClick={() => remove(q)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          </Card>
        ),
      )}

      {draft && (
        <Card className="space-y-4 p-4">
          <p className="font-semibold">{draft.id ? 'Edit question' : 'New question'}</p>
          {!draft.id && (
            <ChoiceGroup label="Type of answer" columns={2} options={QUESTION_KINDS.map((k) => ({ value: k, label: KIND_NAMES[k] }))} value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} />
          )}
          <Field label="Question">{(p) => <Input {...p} maxLength={200} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />}</Field>
          <Field label="Help text" optional hint="A short line under the question.">
            {(p) => <Input {...p} maxLength={300} value={draft.help} onChange={(e) => setDraft({ ...draft, help: e.target.value })} />}
          </Field>
          {(draft.kind === 'single' || draft.kind === 'multi') && (
            <Field label="Options" hint="One option per line, at least two.">
              {(p) => <Textarea {...p} rows={4} value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} />}
            </Field>
          )}
          <Checkbox checked={draft.required} onChange={(required) => setDraft({ ...draft, required })}>
            Members must answer this
          </Checkbox>
          <Checkbox checked={draft.is_active} onChange={(is_active) => setDraft({ ...draft, is_active })}>
            Show this question
          </Checkbox>
          {problem && <Notice tone="danger" title={problem} />}
          <div className="flex gap-2">
            <Button loading={busy} onClick={save}>
              {draft.id ? 'Save question' : 'Add question'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null)
                setProblem(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </section>
  )
}
