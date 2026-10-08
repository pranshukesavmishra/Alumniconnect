import { useInfiniteQuery } from '@tanstack/react-query'
import { Search, ShieldAlert, SlidersHorizontal, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { Input, Select } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useMyProfile } from '../auth/AuthProvider'

const PAGE = 30

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function DirectoryPage() {
  const { data: me } = useMyProfile()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const branch = params.get('branch') ?? ''
  const year = params.get('year') ?? ''
  const [showFilters, setShowFilters] = useState(!!(branch || year))
  const dq = useDebounced(q)

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (dq) next.set('q', dq)
    else next.delete('q')
    setParams(next, { replace: true })
  }, [dq])

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const query = useInfiniteQuery({
    queryKey: ['directory', dq, branch, year],
    enabled: me?.verification === 'verified' || !!me?.is_admin,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_members', {
        q: dq || null,
        p_branch: branch || null,
        p_year_from: year ? Number(year) : null,
        p_year_to: year ? Number(year) : null,
        p_limit: PAGE,
        p_offset: pageParam,
      })
      if (error) throw error
      return data as Profile[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })

  const people = query.data?.pages.flat() ?? []
  const verified = me?.verification === 'verified' || me?.is_admin

  return (
    <div>
      <PageHeader title="People" subtitle="Find JECians by name, batch, company or city" />
      <Page className="space-y-4">
        {!verified ? (
          <EmptyState icon={<ShieldAlert />} title="The directory is for verified members">
            You’ll be verified automatically once your Alumni Meet payment is confirmed. Admins can also verify you.
          </EmptyState>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  type="search"
                  aria-label="Search people"
                  placeholder="Name, company, city, skill…"
                  className="pl-11"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  enterKeyHint="search"
                />
              </div>
              <Button variant="secondary" className="size-12 px-0" aria-label="Filters" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
                <SlidersHorizontal className="size-5" />
              </Button>
            </div>
            {showFilters && (
              <div className="grid grid-cols-2 gap-2">
                <Select aria-label="Branch" value={branch} onChange={(e) => setFilter('branch', e.target.value)}>
                  <option value="">All branches</option>
                  {BRANCHES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
                <Select aria-label="Batch" value={year} onChange={(e) => setFilter('year', e.target.value)}>
                  <option value="">All batches</option>
                  {yearRange(1960, CURRENT_YEAR + 5).map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </Select>
              </div>
            )}
            {me?.grad_year && !year && !dq && (
              <button type="button" className="text-sm font-semibold text-primary" onClick={() => { setShowFilters(true); setFilter('year', String(me.grad_year)) }}>
                Show my batch ({me.grad_year})
              </button>
            )}

            {query.error && <Notice tone="danger" title={friendlyError(query.error)} />}
            {query.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-18" />
                ))}
              </div>
            ) : people.length === 0 ? (
              <EmptyState icon={<Users />} title="No one found">
                Try a different spelling or fewer filters.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link to={`/people/${p.id}`} className="flex items-center gap-3 p-3.5 hover:bg-surface-2">
                      <Avatar src={p.avatar_url} name={p.full_name} size={48} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{p.full_name}</p>
                        <p className="truncate text-sm">{p.current_title && p.current_company ? `${p.current_title} · ${p.current_company}` : (p.headline ?? '')}</p>
                        <p className="truncate text-sm text-muted">{[p.branch, p.grad_year, p.city].filter(Boolean).join(' · ')}</p>
                      </div>
                      {p.help_tags.includes('Referrals') && <Badge tone="accent">Referrals</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {query.hasNextPage && (
              <Button variant="secondary" block loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                Show more
              </Button>
            )}
          </>
        )}
      </Page>
    </div>
  )
}
