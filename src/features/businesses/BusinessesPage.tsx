import clsx from 'clsx'
import { MapPin, Plus, Search, Store, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { BUSINESS_CATEGORIES, useBusinesses, type BusinessCategory, type BusinessFilters, type BusinessListItem } from './queries'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={clsx('min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold', active ? 'bg-primary text-on-primary' : 'border border-border bg-surface')}>
      {children}
    </button>
  )
}

export function BusinessCard({ b }: { b: BusinessListItem }) {
  return (
    <Link to={`/businesses/${b.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-surface-2">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
            <Store className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-snug">{b.name}</p>
            <p className="text-[15px] text-muted">
              {b.category} · <MapPin className="-mt-0.5 inline size-3.5" aria-hidden /> {b.city}
            </p>
            <p className="mt-1 line-clamp-2 text-[15px]">{b.description}</p>
            {b.offer && (
              <div className="mt-2">
                <Badge tone="accent">
                  <Tag className="size-3" aria-hidden /> {b.offer}
                </Badge>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm text-muted">
          <Avatar src={b.owner_avatar} name={b.owner_name} size={24} />
          <span className="min-w-0 truncate">
            {b.owner_name}
            {b.owner_batch ? ` · Batch ${b.owner_batch}` : ''}
          </span>
        </div>
      </Card>
    </Link>
  )
}

export function BusinessesPage() {
  const { data: me } = useMyProfile()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [category, setCategory] = useState<BusinessCategory | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const filters: BusinessFilters = { query: dq, category, city: '' }
  const list = useBusinesses(filters)
  const rows = list.data?.pages.flat() ?? []
  const filtered = !!(dq.trim() || category)
  const verified = me?.verification === 'verified' || !!me?.is_admin

  return (
    <div>
      <PageHeader
        title="JEC Businesses"
        subtitle="Support businesses run by JECians"
        back="/"
        action={
          verified && (
            <ButtonLink to="/businesses/new" size="sm" icon={<Plus className="size-4" />}>
              List yours
            </ButtonLink>
          )
        }
      />
      <Page className="space-y-4">
        <label className="relative block">
          <span className="sr-only">Search businesses</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city or service" className="min-h-12 w-full rounded-full border border-border bg-surface pl-12 pr-4 text-[16px] focus:border-primary focus:outline-none" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Categories">
          {BUSINESS_CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </div>
        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {list.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-3xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Store />} title={filtered ? 'No businesses match' : 'No businesses listed yet'} action={verified ? <ButtonLink to="/businesses/new">List your business</ButtonLink> : undefined}>
            {filtered ? 'Try a different search or remove the category.' : 'Run a business or offer a service? List it here so batchmates can find and support you.'}
          </EmptyState>
        ) : (
          <ul className="space-y-3" aria-label="Businesses">
            {rows.map((b) => (
              <li key={b.id}>
                <BusinessCard b={b} />
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Show more
          </Button>
        )}
      </Page>
    </div>
  )
}
