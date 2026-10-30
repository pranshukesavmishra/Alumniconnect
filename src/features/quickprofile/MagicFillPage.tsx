// /me/magic: Magic fill (and Fill from LinkedIn) on their own page, opened from Edit profile and the Home nudge.
import { useNavigate, useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { PageSkeleton } from '../../components/ui/Display'
import { safeNext } from '../../lib/safeNext'
import { useT } from '../../i18n'
import { useMyProfile } from '../auth/AuthProvider'
import { LinkedInFill } from './LinkedInFill'
import { MagicFill } from './MagicFill'
import { PrefillClaimCard } from './PrefillClaimCard'
import { usePrefillMatch } from './queries'

export function MagicFillPage() {
  const tx = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ? safeNext(params.get('next')) : '/me'
  const { data: profile } = useMyProfile()
  const claim = usePrefillMatch()
  if (!profile) return <PageSkeleton />
  const done = () => navigate(next)
  return (
    <div>
      <PageHeader title={tx('qp.magicTitle')} subtitle={tx('qp.magicSub')} back={next} />
      <Page className="space-y-5">
        {claim.data && <PrefillClaimCard match={claim.data} onClaimed={done} />}
        <LinkedInFill onSaved={done} />
        <MagicFill onSaved={done} autoFocus />
      </Page>
    </div>
  )
}
