import { Printer } from 'lucide-react'
import { useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Notice, PageSkeleton } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { useReceipt } from './api'
import { PrintArea } from './parts'

/** Printable receipt. Tax-exemption text is shown only when the committee entered it in the fund settings. */
export function ReceiptPage() {
  const tx = useT()
  const { id } = useParams()
  const { data: r, isLoading, error } = useReceipt(id)
  if (isLoading) return <PageSkeleton />
  if (!r) return <div><PageHeader title={tx('give.receipt')} back="/give/mine" /><Page><Notice tone="danger" title={error ? friendlyError(error) : tx('give.notFound')} /></Page></div>
  const rows: [string, string | null][] = [
    [tx('give.rc.no'), r.receipt_no],
    [tx('give.rc.date'), formatDate(r.date)],
    [tx('give.rc.from'), r.donor_name + (r.donor_batch ? ` (${tx('common.batch', { year: r.donor_batch })})` : '')],
    [tx('give.rc.for'), [r.campaign_title ?? r.event_title, r.item_name].filter(Boolean).join(' · ') || null],
    [tx('give.rc.amount'), formatPaise(r.amount_paise, { zeroAsFree: false })],
    [tx('give.rc.mode'), r.method === 'upi' ? 'UPI' : r.method === 'bank_transfer' ? tx('give.rc.bank') : r.method === 'cheque' ? tx('give.rc.cheque') : tx('give.rc.cash')],
    [tx('give.rc.ref'), r.utr ?? r.reference],
    [tx('give.rc.dedication'), r.dedication],
  ]
  return (
    <div>
      <div className="print:hidden"><PageHeader title={tx('give.receipt')} back="/give/mine" action={<Button size="sm" variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()} data-testid="print-btn">{tx('give.print')}</Button>} /></div>
      <Page>
        <PrintArea>
          <div data-testid="receipt">
            <div className="-m-6 mb-4 flex items-center gap-3 bg-[linear-gradient(135deg,#0b4a37,#062a20)] p-5 text-white print:bg-white print:text-black">
              <img src="/jec-logo.png" alt="" className="size-12 rounded-xl bg-white p-1" />
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight">{r.assoc_name ?? 'JEC Alumni Association'}</p>
                <p className="text-xs text-[#ecc56a] print:text-gray-600">{tx('evx.receiptVerified')}</p>
              </div>
            </div>
            {r.assoc_details && <p className="whitespace-pre-line text-sm text-gray-600">{r.assoc_details}</p>}
            <h1 className="mt-4 text-xl font-bold uppercase tracking-wide">{tx('give.rc.title')}</h1>
            {r.status === 'refunded' && <p className="mt-1 font-bold text-red-700">{tx('give.rc.refunded')}</p>}
            <dl className="mt-3 divide-y divide-gray-200">
              {rows.filter((x) => x[1]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-gray-600">{k}</dt><dd className="text-right font-semibold [overflow-wrap:anywhere]">{v}</dd></div>
              ))}
            </dl>
            {r.tax_text && <p className="mt-4 whitespace-pre-line text-sm" data-testid="tax-text">{r.tax_text}</p>}
            {r.foreign_notice && <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{r.foreign_notice}</p>}
            {r.footer && <p className="mt-4 whitespace-pre-line border-t border-gray-200 pt-3 text-sm text-gray-600">{r.footer}</p>}
            <p className="mt-4 text-center font-serif text-base italic text-[#0b6b4f]">{tx('evx.receiptThanks')}</p>
          </div>
        </PrintArea>
      </Page>
    </div>
  )
}
