import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle, Skeleton } from '../../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { friendlyError } from '../../../lib/errors'
import { formatDate } from '../../../lib/format'
import { formatPaise } from '../../../lib/money'
import { useAdminAccess } from '../../admin/access'
import { admin, useAdminCampaigns, useAdminEvents, useAdminPackages, useAdminSponsors, useSuggestedLeads, type AdminPackage } from '../api'
import { SPONSOR_STAGES, paiseToRupeesText } from '../helpers'
import { money, useRunner } from './util'

export const STAGE_LABEL: Record<string, string> = { lead: 'Lead', contacted: 'Contacted', proposal_sent: 'Proposal sent', committed: 'Committed', paid: 'Paid', delivered: 'Delivered', declined: 'Declined' }
export const STAGE_TONE: Record<string, 'neutral' | 'primary' | 'warning' | 'success' | 'danger'> = { lead: 'neutral', contacted: 'primary', proposal_sent: 'primary', committed: 'warning', paid: 'success', delivered: 'success', declined: 'danger' }

function PackageSheet({ scope, p, onClose }: { scope: { event?: string; campaign?: string }; p: AdminPackage | null; onClose: () => void }) {
  const { run, busy } = useRunner()
  const [name, setName] = useState(p?.name ?? '')
  const [rank, setRank] = useState(String(p?.rank ?? 10))
  const [price, setPrice] = useState(p ? paiseToRupeesText(p.price_paise) : '')
  const [slots, setSlots] = useState(p?.slots ? String(p.slots) : '')
  const [benefits, setBenefits] = useState((p?.benefits ?? []).join('\n'))
  const [kind, setKind] = useState(p?.is_in_kind ?? false)
  const [active, setActive] = useState(p?.is_active ?? true)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    const pr = kind && !price.trim() ? { paise: 0, error: null } : money(price, 'The price', { min: kind ? 0 : 1000 })
    if (pr.error) return setErr(pr.error)
    setErr(null)
    const ok = await run(() => admin.savePackage(p?.id ?? null, { event_id: scope.event ?? null, campaign_id: scope.campaign ?? null, name, rank: Number(rank) || 10, price_paise: pr.paise, slots: slots ? Number(slots) : null, benefits: benefits.split('\n'), is_in_kind: kind, is_active: active }), 'Package saved.')
    if (ok) onClose()
  }
  return (
    <Sheet open onClose={onClose} label="Sponsor package">
      <div className="space-y-4 p-5" data-testid="package-sheet">
        <h2 className="text-lg font-bold">{p ? 'Edit package' : 'New package'}</h2>
        <Field label="Name" hint="Title sponsor, Gold, Silver, Supporter, In-kind…">{(x) => <Input {...x} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="pk-name" />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (₹)">{(x) => <Input {...x} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="pk-price" />}</Field>
          <Field label="Slots" optional hint="Empty = unlimited">{(x) => <Input {...x} inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value)} data-testid="pk-slots" />}</Field>
          <Field label="Order" hint="1 = shown first">{(x) => <Input {...x} inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} data-testid="pk-rank" />}</Field>
        </div>
        <Field label="Benefits (one per line)" hint="Logo on the event page, banner, stage mention, stall, social posts…">{(x) => <Textarea {...x} rows={5} value={benefits} onChange={(e) => setBenefits(e.target.value)} data-testid="pk-benefits" />}</Field>
        <Checkbox checked={kind} onChange={setKind}>In-kind package (goods or services; the value is not counted as cash)</Checkbox>
        <Checkbox checked={active} onChange={setActive}>Offered to sponsors</Checkbox>
        {err && <Notice tone="danger" title={err} />}
        <Button block loading={busy} onClick={save} data-testid="pk-save">Save package</Button>
      </div>
    </Sheet>
  )
}

function NewSponsorSheet({ scope, onClose }: { scope: { event?: string; campaign?: string }; onClose: () => void }) {
  const { run, busy } = useRunner()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  async function save() {
    const ok = await run(() => admin.saveSponsor(null, { event_id: scope.event ?? null, campaign_id: scope.campaign ?? null, name, contact_name: contact }), 'Sponsor added as a lead.')
    if (ok) onClose()
  }
  return (
    <Sheet open onClose={onClose} label="Add a sponsor">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">Add a sponsor lead</h2>
        <Field label="Organisation or person">{(x) => <Input {...x} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-testid="sp-name" />}</Field>
        <Field label="Contact person" optional hint="Visible to sponsor managers only.">{(x) => <Input {...x} maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} />}</Field>
        <Button block loading={busy} onClick={save} data-testid="sp-add">Add lead</Button>
      </div>
    </Sheet>
  )
}

export function SponsorsPanel() {
  const { can } = useAdminAccess()
  const events = useAdminEvents()
  const campaigns = useAdminCampaigns()
  const [scopeKey, setScopeKey] = useState('')
  useEffect(() => { if (!scopeKey && events.data?.[0]) setScopeKey(`e:${events.data[0].id}`) }, [events.data, scopeKey])
  const scope = scopeKey.startsWith('e:') ? { event: scopeKey.slice(2) } : scopeKey.startsWith('c:') ? { campaign: scopeKey.slice(2) } : {}
  const pk = useAdminPackages(scope)
  const sp = useAdminSponsors(scope)
  const leads = useSuggestedLeads(scope.event)
  const { run, busy } = useRunner()
  const [pkg, setPkg] = useState<AdminPackage | 'new' | null>(null)
  const [adding, setAdding] = useState(false)
  const [stage, setStage] = useState('all')
  const manage = can('sponsors_manage')
  const list = (sp.data ?? []).filter((s) => stage === 'all' || s.stage === stage)
  const cash = (sp.data ?? []).filter((s) => !s.is_in_kind)
  const committed = cash.filter((s) => ['committed', 'paid', 'delivered'].includes(s.stage)).reduce((a, s) => a + (s.committed_paise ?? 0), 0)
  const paid = cash.reduce((a, s) => a + s.paid_paise, 0)
  const inKind = (sp.data ?? []).filter((s) => s.is_in_kind && ['committed', 'paid', 'delivered'].includes(s.stage)).reduce((a, s) => a + (s.in_kind_value_paise ?? 0), 0)

  return (
    <section className="space-y-4" aria-label="Sponsors">
      <Field label="Sponsorship for">
        {(p) => (
          <Select {...p} value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} data-testid="sponsor-scope">
            {(events.data ?? []).map((e) => <option key={e.id} value={`e:${e.id}`}>Event: {e.title}</option>)}
            {(campaigns.data ?? []).filter((c) => c.status !== 'draft').map((c) => <option key={c.id} value={`c:${c.id}`}>Appeal: {c.title}</option>)}
          </Select>
        )}
      </Field>
      {sp.error && <Notice tone="danger" title={friendlyError(sp.error)} />}
      <div className="grid grid-cols-3 gap-2 text-center" data-testid="sponsor-totals">
        <Card className="p-3"><p className="text-xs text-muted">Committed (cash)</p><p className="font-bold tabular-nums">{formatPaise(committed, { zeroAsFree: false })}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Received (verified)</p><p className="font-bold tabular-nums" data-testid="sponsor-paid">{formatPaise(paid, { zeroAsFree: false })}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">In-kind (estimate)</p><p className="font-bold tabular-nums" data-testid="sponsor-inkind">{formatPaise(inKind, { zeroAsFree: false })}</p></Card>
      </div>

      <div className="space-y-2">
        <SectionTitle action={manage && scopeKey && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setPkg('new')} data-testid="add-package">Package</Button>}>Packages</SectionTitle>
        {pk.isLoading ? <Skeleton className="h-16" /> : !pk.data?.length ? <p className="text-sm text-muted">No packages yet. Add tiers such as Title sponsor, Gold, Silver, Supporter or In-kind.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pk.data.map((k) => (
              <Card key={k.id} className="space-y-1.5 p-4" data-testid="package-card" data-name={k.name}>
                <div className="flex items-start justify-between gap-2"><p className="font-bold">{k.name}</p><b className="tabular-nums">{k.is_in_kind ? 'In kind' : formatPaise(k.price_paise, { zeroAsFree: false })}</b></div>
                <p className="text-sm text-muted" data-testid="package-counter">{k.sold} sold{k.slots ? ` of ${k.slots} · ${k.available} available` : ' · unlimited'}{!k.is_active ? ' · not offered' : ''}</p>
                {k.benefits.length > 0 && <ul className="list-disc pl-5 text-sm">{k.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
                {manage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setPkg(k)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => { if (window.confirm(`Delete the ${k.name} package?`)) void run(() => admin.deletePackage(k.id), 'Package deleted.') }}>Delete</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {!!leads.data?.length && manage && (
        <div className="space-y-2" data-testid="suggested-leads">
          <SectionTitle>Suggested leads from registrations</SectionTitle>
          {leads.data.map((l) => (
            <Card key={l.registration_id} className="space-y-1 p-4" data-testid="lead-row">
              <p className="font-bold">{l.org ?? l.name} <span className="font-normal text-muted">· {l.name}{l.batch ? ` · batch ${l.batch}` : ''}</span></p>
              <p className="text-sm text-muted">Level: {l.level ?? 'not sure'}{l.note ? ` · ${l.note}` : ''}</p>
              <p className="text-sm text-muted">{[l.phone, l.email].filter(Boolean).join(' · ')}</p>
              <Button size="sm" icon={<UserPlus className="size-4" />} loading={busy} data-testid="import-lead" onClick={() => run(() => admin.importLead(l.registration_id), 'Added to the pipeline.')}>Add to pipeline</Button>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <SectionTitle action={manage && scopeKey && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)} data-testid="add-sponsor">Sponsor</Button>}>Pipeline</SectionTitle>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {['all', ...SPONSOR_STAGES].map((s) => (
            <button key={s} type="button" onClick={() => setStage(s)} aria-pressed={stage === s} className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold ${stage === s ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface'}`}>
              {s === 'all' ? 'All' : STAGE_LABEL[s]} {s === 'all' ? (sp.data?.length ?? 0) : (sp.data ?? []).filter((x) => x.stage === s).length}
            </button>
          ))}
        </div>
        {sp.isLoading ? <Skeleton className="h-20" /> : !list.length ? <EmptyState title="No sponsors here yet" /> : (
          <div className="space-y-3">
            {list.map((s) => (
              <Card key={s.id} className="space-y-1.5 p-4" data-testid="sponsor-row" data-name={s.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STAGE_TONE[s.stage]}>{STAGE_LABEL[s.stage]}</Badge>
                  {s.package_name && <Badge>{s.package_name}</Badge>}
                  {s.is_in_kind && <Badge tone="accent">In kind</Badge>}
                </div>
                {manage ? <Link to={`/admin/funds/sponsor/${s.id}`} className="block text-lg font-bold text-primary">{s.name}</Link> : <p className="text-lg font-bold">{s.name}</p>}
                <p className="text-sm text-muted">
                  {s.is_in_kind ? `Worth about ${formatPaise(s.in_kind_value_paise ?? 0, { zeroAsFree: false })}` : s.committed_paise ? `Agreed ${formatPaise(s.committed_paise, { zeroAsFree: false })} · received ${formatPaise(s.paid_paise, { zeroAsFree: false })}` : 'No amount agreed yet'}
                  {s.owner_name ? ` · owner ${s.owner_name}` : ''}{s.follow_up_on ? ` · follow up ${formatDate(s.follow_up_on)}` : ''}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
      {pkg && <PackageSheet scope={scope} p={pkg === 'new' ? null : pkg} onClose={() => setPkg(null)} />}
      {adding && <NewSponsorSheet scope={scope} onClose={() => setAdding(false)} />}
    </section>
  )
}
