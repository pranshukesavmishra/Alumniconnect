import { useT } from '../../i18n'
import { Badge } from '../../components/ui/Display'
import type { PaymentStatus, RegistrationStatus } from '../../lib/types'

export const registrationStatusText: Record<RegistrationStatus, string> = {
  pending_payment: 'Payment pending',
  under_review: 'Being verified',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
}

/** Translation keys for the same statuses (the English text above is still used by admin screens). */
const STATUS_KEYS = { pending_payment: 'status.pending_payment', under_review: 'status.under_review', confirmed: 'status.confirmed', cancelled: 'status.cancelled' } as const

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  const tone = { pending_payment: 'accent', under_review: 'primary', confirmed: 'success', cancelled: 'neutral' } as const
  const tx = useT()
  return <Badge tone={tone[status]}>{tx(STATUS_KEYS[status])}</Badge>
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map = {
    submitted: ['primary', 'pay.submitted'],
    verified: ['success', 'pay.verified'],
    rejected: ['danger', 'pay.rejected'],
    refunded: ['neutral', 'pay.refunded'],
  } as const
  const tx = useT()
  const [tone, text] = map[status]
  return <Badge tone={tone}>{tx(text)}</Badge>
}
