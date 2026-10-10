import { Printer } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../../components/layout/AppShell'
import { Button } from '../../../components/ui/Button'
import { Notice, PageSkeleton } from '../../../components/ui/Display'
import { friendlyError } from '../../../lib/errors'
import { formatDate } from '../../../lib/format'
import { formatPaise } from '../../../lib/money'
import { useSponsorDocument } from '../api'
import { PrintArea } from '../parts'

const TITLE = { proposal: 'Sponsorship proposal', agreement: 'Sponsorship agreement', invoice: 'Invoice and receipt' } as const

/** Printable proposal, agreement and invoice/receipt for one sponsor, using the association details and footer from the fund settings. */
export function SponsorPrint() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const doc = (sp.get('doc') as keyof typeof TITLE) in TITLE ? (sp.get('doc') as keyof typeof TITLE) : 'proposal'
  const { data: d, isLoading, error } = useSponsorDocument(id)
  if (isLoading) return <PageSkeleton />
  if (!d) return <div><PageHeader title="Document" back={`/admin/funds/sponsor/${id}`} /><Page><Notice tone="danger" title={friendlyError(error)} /></Page></div>
  const money = (p: number | null) => formatPaise(p ?? 0, { zeroAsFree: false })
  const due = Math.max(0, (d.agreed_paise ?? 0) - d.paid_paise)
  return (
    <div>
      <div className="print:hidden"><PageHeader title={TITLE[doc]} back={`/admin/funds/sponsor/${id}`} action={<Button size="sm" variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()} data-testid="print-btn">Print</Button>} /></div>
      <Page>
        <PrintArea>
          <div data-testid="sponsor-doc" data-doc={doc}>
            <p className="text-lg font-bold">{d.assoc_name ?? 'JEC Alumni Association'}</p>
            {d.assoc_details && <p className="whitespace-pre-line text-sm text-gray-600">{d.assoc_details}</p>}
            <h1 className="mt-4 text-xl font-bold uppercase tracking-wide">{TITLE[doc]}</h1>
            <p className="text-sm text-gray-600">{formatDate(new Date().toISOString())}</p>
            <dl className="mt-3 divide-y divide-gray-200">
              <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">Sponsor</dt><dd className="text-right font-semibold">{d.sponsor}{d.contact_name ? ` (attn. ${d.contact_name})` : ''}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">For</dt><dd className="text-right font-semibold">{d.for_title}</dd></div>
              {d.package && <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">Package</dt><dd className="text-right font-semibold">{d.package}</dd></div>}
              {d.is_in_kind ? (
                <>
                  <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">In-kind support</dt><dd className="text-right font-semibold">{d.in_kind_description ?? 'Goods or services'}</dd></div>
                  <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">Estimated value</dt><dd className="text-right font-semibold">{money(d.in_kind_value_paise)}</dd></div>
                </>
              ) : (
                <div className="flex justify-between gap-4 py-2"><dt className="text-gray-600">Sponsorship amount</dt><dd className="text-right font-semibold">{money(d.agreed_paise)}</dd></div>
              )}
            </dl>
            {d.benefits.length > 0 && <><h2 className="mt-4 font-bold">Benefits to the sponsor</h2><ul className="list-disc pl-5">{d.benefits.map((b) => <li key={b}>{b}</li>)}</ul></>}
            {doc === 'proposal' && !d.is_in_kind && (
              <div className="mt-4 space-y-1 text-sm">
                <p className="font-bold">How to pay</p>
                <p>UPI: <b>{d.upi_id ?? 'to be shared by the committee'}</b>{d.payee_name ? ` (${d.payee_name})` : ''}. Please send us the 12-digit UTR so we can confirm the payment.</p>
              </div>
            )}
            {doc === 'agreement' && (
              <div className="mt-4 space-y-3 text-sm">
                <p>The sponsor agrees to provide the support described above, and the association agrees to deliver the listed benefits{d.deliverables.length ? ', including:' : '.'}</p>
                {d.deliverables.length > 0 && <ul className="list-disc pl-5">{d.deliverables.map((x) => <li key={x.title}>{x.title}{x.due_on ? ` (by ${formatDate(x.due_on)})` : ''}</li>)}</ul>}
                <div className="grid grid-cols-2 gap-8 pt-10"><p className="border-t border-gray-400 pt-1">For the sponsor</p><p className="border-t border-gray-400 pt-1">For the association</p></div>
              </div>
            )}
            {doc === 'invoice' && (
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-bold">Payments received</p>
                {d.payments.length === 0 ? <p>None yet.</p> : (
                  <table className="w-full"><tbody className="divide-y divide-gray-200">{d.payments.map((p) => <tr key={p.receipt_no}><td className="py-1.5">{p.receipt_no}</td><td>{formatDate(p.date)}</td><td>{p.method}{p.utr ? ` ${p.utr}` : ''}</td><td className="text-right font-semibold">{money(p.amount_paise)}</td></tr>)}</tbody></table>
                )}
                {!d.is_in_kind && <p>Total received: <b>{money(d.paid_paise)}</b>{due > 0 ? ` · balance due ${money(due)}` : ' · paid in full'}</p>}
              </div>
            )}
            {d.tax_text && <p className="mt-4 whitespace-pre-line text-sm">{d.tax_text}</p>}
            {d.foreign_notice && <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{d.foreign_notice}</p>}
            {d.footer && <p className="mt-4 whitespace-pre-line border-t border-gray-200 pt-3 text-sm text-gray-600">{d.footer}</p>}
          </div>
        </PrintArea>
      </Page>
    </div>
  )
}
