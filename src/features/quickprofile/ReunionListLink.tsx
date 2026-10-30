// The single entry button on Admin > Members for the reunion list (prefill without accounts).
import { ListChecks } from 'lucide-react'
import { ButtonLink } from '../../components/ui/Button'
import { useT } from '../../i18n'

export function ReunionListLink() {
  const tx = useT()
  return (
    <ButtonLink to="/admin/members/reunion-list" size="sm" variant="secondary" icon={<ListChecks className="size-4" />}>
      {tx('qp.admin.title')}
    </ButtonLink>
  )
}
