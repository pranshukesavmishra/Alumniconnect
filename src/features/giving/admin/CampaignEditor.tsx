import { ImagePlus, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../../components/layout/AppShell'
import { Button } from '../../../components/ui/Button'
import { Badge, Card, Notice, PageSkeleton, SectionTitle } from '../../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { friendlyError } from '../../../lib/errors'
import { formatPaise } from '../../../lib/money'
import { admin, coverUrl, uploadGivingImage, useAdminCampaign, useAdminSettings, type AdminCampaign } from '../api'
import { CAMPAIGN_TYPES, paiseToRupeesText } from '../helpers'
import { fromLocalInput, money, toLocalInput, useRunner } from './util'

const TYPE_LABEL: Record<string, string> = { project: 'Project (crowdfunding)', scholarship: 'Scholarship fund', adopt: 'Adopt a lab or classroom', alumni_fund: 'Alumni fund', drive: 'Donation drive' }

interface ItemRow { id?: string; name: string; description: string; price: string }
interface MsRow { id?: string; percent: string; title: string; unlocks: string }

function UploadButton({ label, onDone }: { label: string; onDone: (path: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft">
      <ImagePlus className="size-4" aria-hidden /> {busy ? 'Uploading…' : label}
      <input type="file" accept="image/*" className="sr-only" disabled={busy} data-testid="upload-input"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setBusy(true)
          try { onDone(await uploadGivingImage(f)) } catch (err) { toast.error(friendlyError(err)) } finally { setBusy(false) }
        }} />
    </label>
  )
}

function Updates({ c }: { c: AdminCampaign }) {
  const { run, busy } = useRunner()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [image, setImage] = useState<string | null>(null)
  return (
    <section className="space-y-3" aria-label="Updates">
      <SectionTitle>Updates for donors</SectionTitle>
      {c.status === 'draft' ? <p className="text-sm text-muted">Publish the appeal first, then post updates here.</p> : (
        <Card className="space-y-3 p-4">
          <Field label="Title" optional>{(p) => <Input {...p} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="What is new?">{(p) => <Textarea {...p} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="update-body" />}</Field>
          <div className="flex flex-wrap items-center gap-2">
            <UploadButton label={image ? 'Change picture' : 'Add a picture'} onDone={setImage} />
            {image && <img src={coverUrl(image) ?? ''} alt="" className="h-11 w-16 rounded-lg object-cover" />}
          </div>
          <Button loading={busy} data-testid="post-update" onClick={async () => { if (await run(() => admin.postUpdate(c.id, title, body, image), 'Update posted. Donors have been notified.')) { setTitle(''); setBody(''); setImage(null) } }}>Post update</Button>
        </Card>
      )}
      {c.updates.map((u) => (
        <Card key={u.id} className="flex items-start justify-between gap-3 p-3.5">
          <div className="min-w-0"><p className="font-semibold">{u.title ?? 'Update'}</p><p className="line-clamp-2 text-sm text-muted">{u.body}</p></div>
          <Button size="sm" variant="ghost" aria-label="Delete update" onClick={() => { if (window.confirm('Delete this update?')) void run(() => admin.deleteUpdate(u.id), 'Update deleted.') }}><Trash2 className="size-4" /></Button>
        </Card>
      ))}
    </section>
  )
}

export function CampaignEditor() {
  const { id = 'new' } = useParams()
  const nav = useNavigate()
  const isNew = id === 'new'
  const { data: c, isLoading, error } = useAdminCampaign(id)
  const settings = useAdminSettings()
  const { run, busy } = useRunner()
  const [f, setF] = useState({ type: 'project', title: '', summary: '', story: '', goal: '', starts: '', ends: '', cover: '' as string, suggested: '500, 1000, 2500, 5000', upi: '', payee: '', dept: '', from: '', to: '' })
  const [items, setItems] = useState<ItemRow[]>([])
  const [ms, setMs] = useState<MsRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(isNew)

  useEffect(() => {
    if (!c || loaded) return
    setF({ type: c.type, title: c.title, summary: c.summary ?? '', story: c.story ?? '', goal: paiseToRupeesText(c.goal_paise), starts: toLocalInput(c.starts_at), ends: toLocalInput(c.ends_at), cover: c.cover_path ?? '',
      suggested: c.suggested_paise.map((p) => p / 100).join(', '), upi: c.upi_id ?? '', payee: c.payee_name ?? '', dept: c.department ?? '', from: c.batch_from ? String(c.batch_from) : '', to: c.batch_to ? String(c.batch_to) : '' })
    setItems(c.items.map((i) => ({ id: i.id, name: i.name, description: i.description ?? '', price: paiseToRupeesText(i.price_paise) })))
    setMs(c.milestones.map((m) => ({ id: m.id, percent: String(m.percent), title: m.title, unlocks: m.unlocks ?? '' })))
    setLoaded(true)
  }, [c, loaded])

  if (!isNew && isLoading) return <PageSkeleton />
  if (!isNew && (error || !c)) return <div><PageHeader title="Appeal" back="/admin/funds" /><Page><Notice tone="danger" title={error ? friendlyError(error) : 'Not found'} /></Page></div>
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    const goal = money(f.goal, 'The goal', { min: 100000 })
    if (goal.error) return setErr(goal.error)
    const sugg: number[] = []
    for (const part of f.suggested.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = money(part, 'A suggested amount', { min: 1000 })
      if (m.error) return setErr(m.error)
      sugg.push(m.paise!)
    }
    const itemsOut: Record<string, unknown>[] = []
    for (const i of items) {
      const pr = money(i.price, `The price of ${i.name || 'an item'}`, { min: 1000 })
      if (pr.error) return setErr(pr.error)
      itemsOut.push({ id: i.id, name: i.name, description: i.description, price_paise: pr.paise })
    }
    const msOut = ms.map((m) => ({ id: m.id, percent: Number(m.percent), title: m.title, unlocks: m.unlocks }))
    if (msOut.some((m) => !Number.isInteger(m.percent) || m.percent < 1 || m.percent > 100)) return setErr('Each milestone needs a percentage between 1 and 100.')
    setErr(null)
    let newId: string | null = null
    const ok = await run(async () => {
      newId = await admin.saveCampaign(isNew ? null : id, {
        type: f.type, title: f.title, summary: f.summary, story: f.story, goal_paise: goal.paise, starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
        cover_path: f.cover || null, suggested_paise: sugg, upi_id: f.upi, payee_name: f.payee, department: f.dept, batch_from: f.from ? Number(f.from) : null, batch_to: f.to ? Number(f.to) : null,
        items: itemsOut, milestones: msOut,
      })
    }, 'Saved.')
    if (ok && isNew && newId) nav(`/admin/funds/campaign/${newId}`, { replace: true })
  }

  const defaultUpi = settings.data?.default_upi_id
  return (
    <div>
      <PageHeader title={isNew ? 'New appeal' : f.title || 'Appeal'} back="/admin/funds" action={c && <Badge tone={c.status === 'live' ? 'success' : 'neutral'}>{c.status}</Badge>} />
      <Page className="space-y-5">
        {c && (
          <Card className="space-y-3 p-4" aria-label="Status">
            <p className="text-sm text-muted">{formatPaise(c.raised_paise, { zeroAsFree: false })} raised of {formatPaise(c.goal_paise, { zeroAsFree: false })} · {c.donor_count} donors</p>
            <div className="flex flex-wrap gap-2">
              {c.status === 'draft' && <Button loading={busy} data-testid="publish" onClick={() => run(() => admin.setStatus(c.id, 'live'), 'Published. Members have been told.')}>Publish</Button>}
              {c.status === 'live' && <Button variant="secondary" loading={busy} onClick={() => run(() => admin.setStatus(c.id, 'paused'), 'Paused.')}>Pause</Button>}
              {c.status === 'paused' && <Button loading={busy} onClick={() => run(() => admin.setStatus(c.id, 'live'), 'Live again.')}>Resume</Button>}
              {(c.status === 'live' || c.status === 'paused') && <Button variant="secondary" loading={busy} onClick={() => { if (window.confirm('Mark this appeal as completed? It stops taking gifts.')) void run(() => admin.setStatus(c.id, 'completed'), 'Completed.') }}>Complete</Button>}
              {(c.status === 'live' || c.status === 'paused') && <Button variant="secondary" icon={<Star className="size-4" />} loading={busy} data-testid="feature" onClick={() => run(() => admin.setFeatured(c.id, !c.is_featured), c.is_featured ? 'No longer featured.' : 'Featured on Home and the hub.')}>{c.is_featured ? 'Unfeature' : 'Feature'}</Button>}
              {c.status === 'draft' && <Button variant="danger" icon={<Trash2 className="size-4" />} loading={busy} onClick={async () => { if (window.confirm('Delete this draft?') && await run(() => admin.deleteCampaign(c.id), 'Deleted.')) nav('/admin/funds') }}>Delete</Button>}
            </div>
            {c.status === 'draft' && !defaultUpi && !f.upi && <Notice tone="warning" title="No UPI id yet">Add one below, or set the default in the Settings tab, before you publish.</Notice>}
          </Card>
        )}

        <Card className="space-y-4 p-4">
          <Field label="Kind of appeal">{(p) => <Select {...p} value={f.type} onChange={(e) => set('type', e.target.value)} data-testid="f-type">{CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>}</Field>
          <Field label="Title" hint="For example: Build the Convocation Hall">{(p) => <Input {...p} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="f-title" />}</Field>
          <Field label="One-line summary" optional>{(p) => <Input {...p} maxLength={300} value={f.summary} onChange={(e) => set('summary', e.target.value)} data-testid="f-summary" />}</Field>
          <Field label="The story" optional hint="Why this matters, what the money will do.">{(p) => <Textarea {...p} rows={6} maxLength={8000} value={f.story} onChange={(e) => set('story', e.target.value)} data-testid="f-story" />}</Field>
          <Field label="Goal (₹)" hint="At least ₹1,000.">{(p) => <Input {...p} inputMode="decimal" value={f.goal} onChange={(e) => set('goal', e.target.value)} data-testid="f-goal" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opens" optional>{(p) => <Input {...p} type="datetime-local" value={f.starts} onChange={(e) => set('starts', e.target.value)} />}</Field>
            <Field label="Closes" optional>{(p) => <Input {...p} type="datetime-local" value={f.ends} onChange={(e) => set('ends', e.target.value)} data-testid="f-ends" />}</Field>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Cover picture</p>
            {f.cover && <img src={coverUrl(f.cover) ?? ''} alt="" className="mb-2 h-36 w-full rounded-2xl object-cover" />}
            <div className="flex flex-wrap gap-2"><UploadButton label={f.cover ? 'Change cover' : 'Upload cover'} onDone={(p) => set('cover', p)} />{f.cover && <Button variant="ghost" size="sm" onClick={() => set('cover', '')}>Remove</Button>}</div>
          </div>
          <Field label="Suggested amounts (₹, comma separated)" hint="Up to 8, each between ₹10 and ₹10,00,000.">{(p) => <Input {...p} value={f.suggested} onChange={(e) => set('suggested', e.target.value)} data-testid="f-suggested" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="UPI id for this appeal" optional hint={defaultUpi ? `Empty = default (${defaultUpi})` : 'Empty = the default in Settings'}>{(p) => <Input {...p} autoCapitalize="none" value={f.upi} onChange={(e) => set('upi', e.target.value)} data-testid="f-upi" />}</Field>
            <Field label="Payee name" optional>{(p) => <Input {...p} maxLength={50} value={f.payee} onChange={(e) => set('payee', e.target.value)} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Department" optional>{(p) => <Input {...p} maxLength={80} value={f.dept} onChange={(e) => set('dept', e.target.value)} />}</Field>
            <Field label="Batch from" optional>{(p) => <Input {...p} inputMode="numeric" value={f.from} onChange={(e) => set('from', e.target.value)} />}</Field>
            <Field label="Batch to" optional>{(p) => <Input {...p} inputMode="numeric" value={f.to} onChange={(e) => set('to', e.target.value)} />}</Field>
          </div>
        </Card>

        <section className="space-y-3" aria-label="Items">
          <SectionTitle action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setItems([...items, { name: '', description: '', price: '' }])} data-testid="add-item">Add item</Button>}>Items (for adopt-a-lab style appeals)</SectionTitle>
          {items.map((i, n) => (
            <Card key={i.id ?? n} className="space-y-3 p-4" data-testid="item-row">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Field label="Item">{(p) => <Input {...p} maxLength={120} value={i.name} onChange={(e) => setItems(items.map((x, k) => (k === n ? { ...x, name: e.target.value } : x)))} data-testid="item-name" />}</Field>
                <Field label="Price (₹)">{(p) => <Input {...p} inputMode="decimal" value={i.price} onChange={(e) => setItems(items.map((x, k) => (k === n ? { ...x, price: e.target.value } : x)))} data-testid="item-price" />}</Field>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setItems(items.filter((_, k) => k !== n))}>Remove</Button>
            </Card>
          ))}
        </section>

        <section className="space-y-3" aria-label="Milestones">
          <SectionTitle action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setMs([...ms, { percent: '', title: '', unlocks: '' }])} data-testid="add-milestone">Add milestone</Button>}>Milestones</SectionTitle>
          {ms.map((m, n) => (
            <Card key={m.id ?? n} className="space-y-3 p-4" data-testid="ms-row">
              <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
                <Field label="Percent">{(p) => <Input {...p} inputMode="numeric" value={m.percent} onChange={(e) => setMs(ms.map((x, k) => (k === n ? { ...x, percent: e.target.value } : x)))} data-testid="ms-percent" />}</Field>
                <Field label="Title">{(p) => <Input {...p} maxLength={120} value={m.title} onChange={(e) => setMs(ms.map((x, k) => (k === n ? { ...x, title: e.target.value } : x)))} data-testid="ms-title" />}</Field>
              </div>
              <Field label="What it unlocks" optional>{(p) => <Input {...p} maxLength={300} value={m.unlocks} onChange={(e) => setMs(ms.map((x, k) => (k === n ? { ...x, unlocks: e.target.value } : x)))} data-testid="ms-unlocks" />}</Field>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setMs(ms.filter((_, k) => k !== n))}>Remove</Button>
            </Card>
          ))}
        </section>

        {err && <Notice tone="danger" title={err} />}
        <Button block loading={busy} onClick={save} data-testid="save-campaign">{isNew ? 'Create draft' : 'Save changes'}</Button>
        {c && <Updates c={c} />}
      </Page>
    </div>
  )
}
