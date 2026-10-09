import { useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, Card, Notice, PageSkeleton } from '../../components/ui/Display'
import { Checkbox } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { FIELD_LABELS, IMPORT_FIELDS, IMPORT_TEMPLATE, parseMemberCsv, type ImportRow, type ParsedImport } from '../../lib/memberImport'
import { downloadFile } from '../../lib/ics'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { attentionKey } from './queries'

type Status = 'new' | 'exists' | 'duplicate' | 'invalid'
interface Checked { row: number; status: Status; problem: string | null; member_id: string | null; member_name: string | null }
const TONE = { new: 'success', exists: 'neutral', duplicate: 'warning', invalid: 'danger' } as const
const WORDS: Record<Status, string> = { new: 'New', exists: 'Already a member', duplicate: 'Possible duplicate', invalid: 'Problem' }

/** Add many members from a spreadsheet: choose file, see exactly what would happen (nothing is created yet), then confirm. */
export function AdminImport() {
  const { data: me, isLoading } = useMyProfile()
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [checked, setChecked] = useState<Checked[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(true)
  const [withDuplicates, setWithDuplicates] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: { line: number; message: string }[] } | null>(null)
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />

  async function pick(f: File | undefined) {
    setChecked(null)
    setProgress(null)
    setParsed(null)
    if (!f) return
    if (f.size > 2_000_000) return toast.error('That file is too large. Keep it under 2 MB.')
    const p = parseMemberCsv(await f.text())
    setParsed(p)
    if (p.error) return
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_import_preview', { p_rows: p.rows.map(({ line: _l, ...r }) => r) })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    setChecked((data as unknown as { rows: Checked[] }).rows)
  }

  const counts = { new: 0, exists: 0, duplicate: 0, invalid: 0 }
  for (const c of checked ?? []) counts[c.status]++
  const todo = (parsed && checked ? parsed.rows.filter((_, i) => checked[i]?.status === 'new' || (withDuplicates && checked[i]?.status === 'duplicate')) : []) as ImportRow[]

  async function run() {
    setBusy(true)
    const failed: { line: number; message: string }[] = []
    let done = 0
    setProgress({ done, total: todo.length, failed })
    for (const r of todo) {
      const { line, ...body } = r
      const { error } = await supabase.functions.invoke('admin-create-member', { body: { ...body, verified } })
      if (error) {
        const b = await (error as { context?: Response }).context?.json?.().catch(() => null)
        failed.push({ line, message: b?.message ?? friendlyError(error) })
      }
      done++
      setProgress({ done, total: todo.length, failed: [...failed] })
    }
    setBusy(false)
    void qc.invalidateQueries({ queryKey: ['admin-members'] })
    void qc.invalidateQueries({ queryKey: attentionKey })
    toast[failed.length ? 'warning' : 'success'](`${done - failed.length} of ${todo.length} members added`)
  }

  return (
    <div>
      <PageHeader title="Import members" subtitle="Add many profiles from a spreadsheet" back="/admin/members" />
      <Page wide className="space-y-4">
        <Card className="space-y-3 p-4">
          <p className="text-sm">Save your spreadsheet as CSV. It needs a <b>Full name</b> and an <b>Email</b> column; mobile, branch, batch, city, role and company are optional. Nothing is created until you confirm.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => downloadFile('members-template.csv', '﻿' + IMPORT_TEMPLATE, 'text/csv;charset=utf-8')}>Download template</Button>
            <Button size="sm" icon={<FileUp className="size-4" />} loading={busy && !progress} onClick={() => file.current?.click()}>Choose CSV file</Button>
            <input ref={file} type="file" accept=".csv,text/csv" aria-label="CSV file" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </Card>

        {parsed?.error && <Notice tone="danger" title={parsed.error} />}
        {parsed && !parsed.error && (
          <Card className="p-4 text-sm">
            <p className="font-semibold">Columns found</p>
            <p className="text-muted">{IMPORT_FIELDS.filter((f) => parsed.columns[f]).map((f) => FIELD_LABELS[f]).join(', ')}</p>
            {parsed.unknown.length > 0 && <p className="mt-1 text-muted">Ignored: {parsed.unknown.join(', ')}</p>}
          </Card>
        )}

        {checked && parsed && (
          <>
            <div className="flex flex-wrap gap-2" data-testid="import-counts">
              {(Object.keys(counts) as Status[]).map((s) => <Badge key={s} tone={TONE[s]}>{counts[s]} {WORDS[s].toLowerCase()}</Badge>)}
            </div>
            <Card className="max-h-[28rem] divide-y divide-border overflow-y-auto" data-testid="import-rows">
              {parsed.rows.map((r, i) => {
                const c = checked[i]!
                return (
                  <div key={r.line} className="flex items-start gap-3 p-3" data-status={c.status}>
                    <span className="w-8 shrink-0 pt-0.5 text-xs text-muted">#{r.line}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.full_name || '(no name)'} <span className="font-normal text-muted">{r.email}</span></p>
                      <p className="truncate text-sm text-muted">{c.problem ?? (c.member_name ? `${c.status === 'exists' ? 'Same e-mail as' : 'Looks like'} ${c.member_name}` : [r.branch, r.grad_year, r.city].filter(Boolean).join(' · '))}</p>
                    </div>
                    <Badge tone={TONE[c.status]}>{WORDS[c.status]}</Badge>
                  </div>
                )
              })}
            </Card>
            {counts.new + counts.duplicate > 0 && !progress && (
              <Card className="space-y-2 p-4">
                <Checkbox checked={verified} onChange={setVerified}>Mark them as verified JECians</Checkbox>
                {counts.duplicate > 0 && <Checkbox checked={withDuplicates} onChange={setWithDuplicates}>Also add the {counts.duplicate} possible duplicates (they may already be members under another e-mail)</Checkbox>}
                <Button size="lg" block loading={busy} disabled={todo.length === 0} onClick={run}>Add {todo.length} {todo.length === 1 ? 'member' : 'members'}</Button>
              </Card>
            )}
          </>
        )}
        {progress && (
          <Card className="space-y-2 p-4" data-testid="import-progress" aria-live="polite">
            <p className="font-semibold">{progress.done} of {progress.total} done</p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            {progress.failed.map((f) => <Notice key={f.line} tone="danger" title={`Row ${f.line}: ${f.message}`} />)}
          </Card>
        )}
      </Page>
    </div>
  )
}
