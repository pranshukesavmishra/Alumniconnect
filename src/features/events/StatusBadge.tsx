import { Badge } from '../../components/ui/Display'
import type { PaymentStatus, RegistrationStatus } from '../../lib/types'

export const registrationStatusText: Record<RegistrationStatus, string> = {
  pending_payment: 'Payment pending',
  under_review: 'Being verified',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
}

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  const tone = { pending_payment: 'accent', under_review: 'primary', confirmed: 'success', cancelled: 'neutral' } as const
  return <Badge tone={tone[status]}>{registrationStatusText[status]}</Badge>
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map = {
    submitted: ['primary', 'Awaiting verification'],
    verified: ['success', 'Verified'],
    rejected: ['danger', 'Not verified'],
  } as const
  const [tone, text] = map[status]
  return <Badge tone={tone}>{text}</Badge>
}
