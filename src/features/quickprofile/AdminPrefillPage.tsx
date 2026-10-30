// /admin/members/reunion-list: organisers upload the reunion form responses (CSV or Excel) into the prefill store.
// No accounts are created and nobody is messaged; members claim their own row when they sign in. Shows who claimed.
import { CheckCircle2, CircleDashed, FileUp, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, Card, Chip, Notice } from '../../components/ui/Display'
import { Field, Input } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { useT, type MsgKey } from '../../i18n'
import { useAdminAccess } from '../admin/access'
import { readPrefillFile, toImportPayload, type ParsedPrefill, type PrefillField } from './prefillImport'
import { useAdminPrefillDelete, useAdminPrefillImport, useAdminPrefillList } from './queries'

const COL_LABEL: Record<PrefillField, MsgKey> = {
  full_name: 'qp.field.full_name', email: 'qp.col.email', phone: 'qp.col.phone', member_type: 'qp.col.member_type', grad_year: 'qp.field.grad_year',
  join_year: 'qp.col.join_year', branch: 'qp.field.branch', city: 'qp.field.city', country: 'qp.field.country', organisation: 'qp.col.organisation',
  designation: 'qp.col.designation',
}
const ERR: Record<NonNullable<ParsedPrefill['error']>, MsgKey> = { empty: 'qp.admin.errEmpty', no_name: 'qp.admin.errName', no_contact: 'qp.admin.errContact', too_many: 'qp.admin.errMany' }

export function AdminPrefillPage() {
  const tx = useT()
  const { can } = useAdminAccess()
  const file = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState(() => tx('qp.admin.sourceDefault'))
  const [parsed, setParsed] = useState<ParsedPrefill | null>(null)
  const [reading, setReading] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'claimed' | 'unclaimed'>('all')
  const list = useAdminPrefillList(q, status)
  const imp = useAdminPrefillImport()
  const del = useAdminPrefillDelete()
  const canImport = can('members_import')

  async function pick(f: File | undefined) {
    setParsed(null)
    if (!f) return
    if (f.size > 5_000_000) return toast.error(tx('qp.admin.errMany'))
    setReading(true)
    try {
      setParsed(await readPrefillFile(f))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setReading(false)
    }
  }

  const ready = parsed && !parsed.error ? parsed.rows.filter((r) => !r.problem) : []
  const skipped = parsed && !parsed.error ? parsed.rows.length - ready.length : 0
  const rows = list.data ?? []
  const total = rows[0]?.total ?? 0
  const claimedTotal = rows[0]?.claimed_total ?? 0

  return (
    <div>
      <PageHeader title={tx('qp.admin.title')} subtitle={tx('qp.admin.sub')} back="/admin/members" />
      <Page wide className="space-y-4">
        {canImport && (
          <Card className="space-y-3 p-4">
            <p className="text-sm">{tx('qp.admin.intro')}</p>
            <Field label={tx('qp.admin.source')}>{(p) => <Input {...p} maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} />}</Field>
            <Button icon={<FileUp className="size-4" />} loading={reading} onClick={() => file.current?.click()}>{tx('qp.admin.choose')}</Button>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label={tx('qp.admin.fileAria')}
              className="sr-only"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {parsed?.error && <Notice tone="danger" title={tx(ERR[parsed.error])} />}
            {parsed && !parsed.error && (
              <div className="space-y-2 text-sm" data-testid="prefill-parsed">
                <p className="text-muted">{tx('qp.admin.columns', { list: (Object.keys(parsed.columns) as PrefillField[]).map((c) => tx(COL_LABEL[c])).join(', ') })}</p>
                <p className="font-semibold">{tx('qp.admin.ready', { n: ready.length })}</p>
                {skipped > 0 && <p className="text-warning">{tx('qp.admin.skipped', { n: skipped })}</p>}
                <Button
                  size="lg"
                  block
                  disabled={!ready.length}
                  loading={imp.isPending}
                  onClick={() =>
                    imp.mutate(
                      { rows: toImportPayload(ready), source: source.trim() || tx('qp.admin.sourceDefault') },
                      {
                        onSuccess: (r) => {
                          toast.success(tx('qp.admin.done', { added: r.added, updated: r.updated, claimed: r.claimed_skipped }))
                          setParsed(null)
                        },
                        onError: (e) => toast.error(friendlyError(e)),
                      },
                    )
                  }
                >
                  {tx('qp.admin.import', { n: ready.length })}
                </Button>
              </div>
            )}
          </Card>
        )}

        <div className="space-y-3">
          <Field label={tx('qp.admin.search')}>{(p) => <Input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tx('qp.admin.filter')}>
            {(['all', 'claimed', 'unclaimed'] as const).map((s) => (
              <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{tx(`qp.admin.${s}` as MsgKey)}</Chip>
            ))}
            {total > 0 && status === 'all' && <Badge tone="primary">{tx('qp.admin.stats', { claimed: claimedTotal, total })}</Badge>}
          </div>
        </div>

        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {!list.isLoading && rows.length === 0 && <p className="text-muted">{tx('qp.admin.empty')}</p>}
        {rows.length > 0 && (
          <Card className="divide-y divide-border" data-testid="prefill-list">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start gap-3 p-3" data-claimed={r.claimed}>
                {r.claimed ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{r.full_name}</p>
                  <p className="break-words text-sm text-muted">{[r.grad_year, r.branch, [r.designation, r.organisation].filter(Boolean).join(', '), r.city].filter(Boolean).join(' · ')}</p>
                  <p className="break-words text-xs text-muted">{[r.email_masked, r.phone_tail].filter(Boolean).join(' · ')}</p>
                  <p className={`text-sm ${r.claimed ? 'text-success' : 'text-muted'}`}>{r.claimed ? tx('qp.admin.claimedBy', { name: r.claimed_by_name ?? '' }) : tx('qp.admin.notClaimed')}</p>
                </div>
                {canImport && !r.claimed && (
                  <button
                    type="button"
                    className="grid size-11 shrink-0 place-items-center rounded-full text-danger hover:bg-danger/10"
                    aria-label={tx('qp.admin.delete', { name: r.full_name })}
                    onClick={() => del.mutate(r.id, { onError: (e) => toast.error(friendlyError(e)) })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </Card>
        )}
      </Page>
    </div>
  )
}
