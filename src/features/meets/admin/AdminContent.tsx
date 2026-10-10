import clsx from 'clsx'
import { CalendarHeart, Film } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../../components/layout/AppShell'
import { useT } from '../../../i18n'
import { GlimpsesAdmin } from './GlimpsesAdmin'
import { MeetsAdmin } from './MeetsAdmin'

/** Organise > Content: the glimpse clips and the past-meets archive (permission: gallery_manage). */
export function AdminContent() {
  const tx = useT()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'meets' ? 'meets' : 'glimpses'
  const tabs = [
    { id: 'glimpses' as const, label: tx('glimpse.tab'), icon: Film },
    { id: 'meets' as const, label: tx('meets.tab'), icon: CalendarHeart },
  ]
  return (
    <div>
      <PageHeader title={tx('content.title')} subtitle={tx('content.subtitle')} back="/admin" />
      <Page className="space-y-4">
        <div role="tablist" aria-label={tx('content.title')} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setSp(t.id === 'glimpses' ? {} : { tab: t.id }, { replace: true })}
              className={clsx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold', tab === t.id ? 'bg-surface text-primary shadow-sm' : 'text-muted')}
            >
              <t.icon className="size-4" aria-hidden />{t.label}
            </button>
          ))}
        </div>
        {tab === 'glimpses' ? <GlimpsesAdmin /> : <MeetsAdmin editId={sp.get('edit')} />}
      </Page>
    </div>
  )
}
