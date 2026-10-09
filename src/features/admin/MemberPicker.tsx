import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Avatar, Card } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { Button } from '../../components/ui/Button'
import { searchProfiles } from './queries'

/** Search members by name and pick one. The parent decides what picking does. */
export function MemberPicker({ label = 'Search members by name', actionLabel, onPick, busy }: { label?: string; actionLabel: string; onPick: (id: string, name: string) => void; busy?: boolean }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const results = useQuery({ queryKey: ['member-picker', debounced], enabled: debounced.length >= 2, queryFn: () => searchProfiles(debounced) })
  return (
    <div className="space-y-2">
      <Input type="search" aria-label={label} placeholder={label} value={q} onChange={(e) => setQ(e.target.value)} />
      {debounced.length >= 2 && results.isError && <p className="text-sm text-danger">Couldn’t search just now. Try again.</p>}
      {debounced.length >= 2 && results.data && results.data.length === 0 && <p className="text-sm text-muted">No member with that name.</p>}
      {!!results.data?.length && (
        <Card className="divide-y divide-border">
          {results.data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <Avatar src={p.avatar_url} name={p.full_name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.full_name}</p>
                <p className="truncate text-sm text-muted">{[p.branch, p.grad_year, p.city].filter(Boolean).join(' · ')}</p>
              </div>
              <Button size="sm" variant="secondary" loading={busy} aria-label={`${actionLabel}: ${p.full_name}`} onClick={() => onPick(p.id, p.full_name)}>
                {actionLabel}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
