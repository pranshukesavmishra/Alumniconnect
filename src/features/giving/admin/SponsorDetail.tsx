import { Check, FileText, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../../components/layout/AppShell'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Badge, Card, Notice, PageSkeleton, SectionTitle } from '../../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { friendlyError } from '../../../lib/errors'
import { formatDate, formatDateTime } from '../../../lib/format'
import { formatPaise } from '../../../lib/money'
import { MemberPicker } from '../../admin/MemberPicker'
import { useAdminAccess } from '../../admin/access'
import { useUserId } from '../../auth/AuthProvider'
import { admin, coverUrl, uploadGivingImage, useAdminPackages, useAdminSponsor, type SponsorDetail as Detail } from '../api'
import { SPONSOR_STAGES, paiseToRupeesText } from '../helpers'
import { STAGE_LABEL, STAGE_TONE } from './SponsorsPanel'
import { money, todayIst, useRunner } from './util'

function PaymentSheet({ s, onClose }: { s: Detail; onClose: () => void }) {
  const { can } = useAdminAccess()
  const { run, busy } = useRunner()
  const due = Math.max(0, (s.committed_paise ?? 0) - s.paid_paise - s.pending_paise)
  const [amount, setAmount] = useState(due ? String(due / 100) : '')
  const [method, setMethod] = useState('upi')
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const instant = method === 'cash' || method === 'cheque'
  async function save() {
    const a = money(amount, 'The amount', { min: 1000 })
    if (a.error) return setErr(a.error)
    setErr(null)
    const ok = await run(() => admin.recordPayment(s.id, a.paise!, method, ref, reason), instant ? 'Payment recorded and verified.' : 'Payment recorded. It now waits in the Verify tab.')
    if (ok) onClose()
  }
  return (
    <Sheet open onClose={onClose} label="Record a payment">
      <div className="space-y-4 p-5" data-testid="payment-sheet">
        <h2 className="text-lg font-bold">Record a payment from {s.name}</h2>
        <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="pay-amount" />}</Field>
        <Field label="How">{(p) => <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)} data-testid="pay-method"><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option>{can('funds_verify') && <><option value="cheque">Cheque</option><option value="cash">Cash</option></>}</Select>}</Field>
        {!instant ? (
          <Field label="12-digit UTR" hint="It is checked against event payments and donations; each UTR can be used once.">{(p) => <Input {...p} inputMode="numeric" className="font-mono" value={ref} onChange={(e) => setRef(e.target.value)} data-testid="pay-utr" />}</Field>
        ) : (
          <>
            <Field label="Cheque number" optional>{(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
            <Field label="Why is this recorded by hand?">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </>
        )}
        {err && <Notice tone="danger" title={err} />}
        <Button block loading={busy} onClick={save} data-testid="pay-save">Record payment</Button>
      </div>
    </Sheet>
  )
}

export function SponsorDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const uid = useUserId()
  const { data: s, isLoading, error } = useAdminSponsor(id)
  const pk = useAdminPackages({ event: s?.event_id, campaign: s?.campaign_id }, !!s)
  const { run, busy } = useRunner()
  const [f, setF] = useState({ name: '', logo: '', website: '', blurb: '', cname: '', cemail: '', cphone: '', alumni: '', alumniName: '', pkg: '', committed: '', inKind: false, kindValue: '', kindDesc: '', follow: '', wall: true, owner: '' })
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')
  const [dl, setDl] = useState({ title: '', due: '' })
  const [pay, setPay] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [up, setUp] = useState(false)

  useEffect(() => {
    if (!s || loaded) return
    setF({ name: s.name, logo: s.logo_path ?? '', website: s.website ?? '', blurb: s.blurb ?? '', cname: s.contact_name ?? '', cemail: s.contact_email ?? '', cphone: s.contact_phone ?? '', alumni: s.alumni_id ?? '', alumniName: s.alumni_name ?? '',
      pkg: s.package_id ?? '', committed: paiseToRupeesText(s.committed_paise), inKind: s.is_in_kind, kindValue: paiseToRupeesText(s.in_kind_value_paise), kindDesc: s.in_kind_description ?? '', follow: s.follow_up_on ?? '', wall: s.show_on_wall, owner: s.owner_id ?? '' })
    setLoaded(true)
  }, [s, loaded])

  if (isLoading) return <PageSkeleton />
  if (error || !s) return <div><PageHeader title="Sponsor" back="/admin/funds?tab=sponsors" /><Page><Notice tone="danger" title={error ? friendlyError(error) : 'Not found'} /></Page></div>
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    const comm = money(f.committed, 'The agreed amount', { optional: true })
    const kv = f.inKind ? money(f.kindValue, 'The estimated value') : { paise: null, error: null }
    if (comm.error || kv.error) return setErr(comm.error ?? kv.error)
    setErr(null)
    await run(() => admin.saveSponsor(s!.id, { event_id: s!.event_id, campaign_id: s!.campaign_id, package_id: f.pkg || null, name: f.name, logo_path: f.logo || null, website: f.website, blurb: f.blurb, contact_name: f.cname, contact_email: f.cemail,
      contact_phone: f.cphone, alumni_id: f.alumni || null, owner_id: f.owner || null, committed_paise: comm.paise, is_in_kind: f.inKind, in_kind_description: f.kindDesc, in_kind_value_paise: kv.paise, follow_up_on: f.follow || null, show_on_wall: f.wall }), 'Saved.')
  }
  async function stage(to: string) {
    if (to === 'declined' && !window.confirm('Mark this sponsor as declined?')) return
    await run(() => admin.setStage(s!.id, to, null), `Moved to ${STAGE_LABEL[to]}.`)
  }

  return (
    <div>
      <PageHeader title={s.name} subtitle={s.for_title ?? undefined} back="/admin/funds?tab=sponsors" action={<Badge tone={STAGE_TONE[s.stage]}>{STAGE_LABEL[s.stage]}</Badge>} />
      <Page className="space-y-5">
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">Move along the pipeline</p>
          <div className="flex flex-wrap gap-2" data-testid="stage-buttons">
            {SPONSOR_STAGES.filter((x) => x !== s.stage && !(x === 'paid' && !s.is_in_kind)).map((x) => <Button key={x} size="sm" variant={x === 'declined' ? 'ghost' : 'secondary'} loading={busy} data-testid={`stage-${x}`} onClick={() => stage(x)}>{STAGE_LABEL[x]}</Button>)}
          </div>
          {!s.is_in_kind && <p className="text-sm text-muted">Agreed {formatPaise(s.committed_paise ?? 0, { zeroAsFree: false })} · received <b data-testid="received">{formatPaise(s.paid_paise, { zeroAsFree: false })}</b>{s.pending_paise > 0 && ` · ${formatPaise(s.pending_paise, { zeroAsFree: false })} waiting to be verified`}. “Paid” is set automatically when the payment is verified.</p>}
          {!s.is_in_kind && (s.stage === 'committed' || s.stage === 'paid') && <Button variant="secondary" onClick={() => setPay(true)} data-testid="record-payment">Record a payment</Button>}
        </Card>

        <Card className="space-y-4 p-4">
          <Field label="Name">{(p) => <Input {...p} maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="f-name" />}</Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Logo</p>
            <div className="flex flex-wrap items-center gap-2">
              {f.logo && <img src={coverUrl(f.logo) ?? ''} alt="" className="h-14 w-auto max-w-40 rounded-lg border border-border bg-white object-contain p-1" />}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary">
                <ImagePlus className="size-4" aria-hidden /> {up ? 'Uploading…' : f.logo ? 'Change logo' : 'Upload logo'}
                <input type="file" accept="image/*" className="sr-only" data-testid="logo-input" disabled={up} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setUp(true); try { set('logo', await uploadGivingImage(file)) } catch (er) { toast.error(friendlyError(er)) } finally { setUp(false) } }} />
              </label>
              {f.logo && <Button size="sm" variant="ghost" onClick={() => set('logo', '')}>Remove</Button>}
            </div>
          </div>
          <Field label="Website" optional hint="Logos link here. Must start with https://">{(p) => <Input {...p} inputMode="url" autoCapitalize="none" value={f.website} onChange={(e) => set('website', e.target.value)} data-testid="f-web" />}</Field>
          <Field label="Short blurb" optional>{(p) => <Input {...p} maxLength={300} value={f.blurb} onChange={(e) => set('blurb', e.target.value)} />}</Field>
          <Notice tone="info" title="Contact details are for sponsor managers only. Members never see them." />
          <Field label="Contact person" optional>{(p) => <Input {...p} value={f.cname} onChange={(e) => set('cname', e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact e-mail" optional>{(p) => <Input {...p} type="email" value={f.cemail} onChange={(e) => set('cemail', e.target.value)} />}</Field>
            <Field label="Contact phone" optional>{(p) => <Input {...p} type="tel" value={f.cphone} onChange={(e) => set('cphone', e.target.value)} />}</Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Alumnus who brought them</p>
            {f.alumni ? <p className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft p-3 font-semibold">{f.alumniName || 'Member'}<Button size="sm" variant="ghost" onClick={() => { set('alumni', ''); set('alumniName', '') }}>Remove</Button></p> : <MemberPicker label="Search a member" actionLabel="Pick" onPick={(mid, n) => { set('alumni', mid); set('alumniName', n) }} />}
          </div>
          <Field label="Package (tier)" optional>{(p) => <Select {...p} value={f.pkg} onChange={(e) => set('pkg', e.target.value)} data-testid="f-pkg"><option value="">No package</option>{(pk.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.is_in_kind ? 'in kind' : formatPaise(k.price_paise, { zeroAsFree: false })}{k.slots ? ` · ${k.available} left` : ''}</option>)}</Select>}</Field>
          <Checkbox checked={f.inKind} onChange={(v) => set('inKind', v)}>In-kind sponsor (goods or services, not cash)</Checkbox>
          {f.inKind ? (
            <>
              <Field label="Estimated value (₹)" hint="Shown apart from cash. Never added to the money totals.">{(p) => <Input {...p} inputMode="decimal" value={f.kindValue} onChange={(e) => set('kindValue', e.target.value)} data-testid="f-kindvalue" />}</Field>
              <Field label="What they provide" optional>{(p) => <Input {...p} maxLength={300} value={f.kindDesc} onChange={(e) => set('kindDesc', e.target.value)} />}</Field>
            </>
          ) : (
            <Field label="Agreed amount (₹)" optional hint="Empty = the package price when you mark them committed.">{(p) => <Input {...p} inputMode="decimal" value={f.committed} onChange={(e) => set('committed', e.target.value)} data-testid="f-committed" />}</Field>
          )}
          <Field label="Follow up on" optional hint="The owner gets a notification that day.">{(p) => <Input {...p} type="date" value={f.follow} onChange={(e) => set('follow', e.target.value)} data-testid="f-follow" />}</Field>
          <div className="flex flex-wrap items-center gap-2">{f.owner !== uid && uid && <Button size="sm" variant="secondary" onClick={() => set('owner', uid)}>Make me the owner</Button>}<span className="text-sm text-muted">Owner: {f.owner === uid ? 'you' : (s.owner_name ?? 'nobody')}</span></div>
          <Checkbox checked={f.wall} onChange={(v) => set('wall', v)}>Show on the sponsor wall once paid (in-kind: once committed)</Checkbox>
          {err && <Notice tone="danger" title={err} />}
          <Button block loading={busy} onClick={save} data-testid="save-sponsor">Save</Button>
        </Card>

        <section className="space-y-2" aria-label="Documents">
          <SectionTitle>Documents</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {(['proposal', 'agreement', 'invoice'] as const).map((d) => <ButtonLink key={d} to={`/admin/funds/sponsor/${s.id}/print?doc=${d}`} variant="secondary" size="sm" icon={<FileText className="size-4" />} data-testid={`doc-${d}`}>{d === 'proposal' ? 'Proposal' : d === 'agreement' ? 'Agreement' : 'Invoice / receipt'}</ButtonLink>)}
          </div>
        </section>

        <section className="space-y-2" aria-label="Deliverables">
          <SectionTitle>Deliverables checklist</SectionTitle>
          <Card className="divide-y divide-border">
            {s.deliverables.map((d) => (
              <div key={d.id} className="flex items-center gap-2 p-3" data-testid="deliverable">
                <button type="button" aria-label={d.done ? 'Mark not done' : 'Mark done'} aria-pressed={d.done} onClick={() => run(() => admin.saveDeliverable(s.id, d.id, d.title, d.due_on, !d.done))} className={`grid size-9 shrink-0 place-items-center rounded-full border ${d.done ? 'border-success bg-success text-white' : 'border-border'}`}>{d.done && <Check className="size-4" />}</button>
                <div className="min-w-0 flex-1"><p className={d.done ? 'text-muted line-through' : 'font-semibold'}>{d.title}</p>{d.due_on && <p className="text-xs text-muted">Due {formatDate(d.due_on)}</p>}</div>
                <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => run(() => admin.deleteDeliverable(d.id))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <div className="grid gap-2 p-3 sm:grid-cols-[1fr_9rem_auto]">
              <Input aria-label="New deliverable" placeholder="Logo received, banner printed, stage mention…" value={dl.title} onChange={(e) => setDl({ ...dl, title: e.target.value })} data-testid="dl-title" />
              <Input aria-label="Due date" type="date" min={todayIst()} value={dl.due} onChange={(e) => setDl({ ...dl, due: e.target.value })} />
              <Button icon={<Plus className="size-4" />} loading={busy} data-testid="dl-add" onClick={async () => { if (await run(() => admin.saveDeliverable(s.id, null, dl.title, dl.due || null, false))) setDl({ title: '', due: '' }) }}>Add</Button>
            </div>
          </Card>
        </section>

        {s.payments.length > 0 && (
          <section className="space-y-2" aria-label="Payments">
            <SectionTitle>Payments</SectionTitle>
            <Card className="divide-y divide-border">
              {s.payments.map((p) => <p key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span>{formatDate(p.created_at)} · {p.method}{p.utr ? ` ${p.utr}` : ''}</span><span className="flex items-center gap-2"><Badge tone={p.status === 'verified' ? 'success' : p.status === 'submitted' ? 'warning' : 'neutral'}>{p.status}</Badge><b className="tabular-nums">{formatPaise(p.amount_paise, { zeroAsFree: false })}</b></span></p>)}
            </Card>
          </section>
        )}

        <section className="space-y-2" aria-label="Notes">
          <SectionTitle>Notes and history</SectionTitle>
          <Card className="space-y-3 p-4">
            <Textarea aria-label="New note" rows={2} placeholder="Called Mr Rao, sending the proposal…" value={note} onChange={(e) => setNote(e.target.value)} data-testid="note-input" />
            <Button size="sm" loading={busy} data-testid="note-add" onClick={async () => { if (await run(() => admin.addNote(s.id, note))) setNote('') }}>Add note</Button>
          </Card>
          {s.notes.map((n) => <Card key={n.id} className="p-3.5"><p className="text-xs text-muted">{formatDateTime(n.created_at)}{n.author ? ` · ${n.author}` : ''}</p><p className={n.is_system ? 'text-sm text-muted' : 'text-[15px]'}>{n.body}</p></Card>)}
        </section>

        {s.stage === 'lead' || s.stage === 'declined' ? (
          <Button variant="danger" icon={<Trash2 className="size-4" />} loading={busy} onClick={async () => { if (window.confirm('Delete this sponsor?') && await run(() => admin.deleteSponsor(s.id), 'Sponsor deleted.')) nav('/admin/funds?tab=sponsors') }}>Delete sponsor</Button>
        ) : <Link to="/admin/funds?tab=sponsors" className="inline-flex min-h-11 items-center font-semibold text-primary">Back to the pipeline</Link>}
      </Page>
      {pay && <PaymentSheet s={s} onClose={() => setPay(false)} />}
    </div>
  )
}
