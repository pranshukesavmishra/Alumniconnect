import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, EmptyState, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

interface Person {
  id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  current_title: string | null
  current_company: string | null
}
const P = 'id, full_name, avatar_url, grad_year, branch, current_title, current_company'

export function ConnectionsPage() {
  const uid = useUserId()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['connections', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connections')
        .select(`requester, addressee, status, r:profiles!connections_requester_fkey(${P}), a:profiles!connections_addressee_fkey(${P})`)
      if (error) throw error
      return data as unknown as { requester: string; addressee: string; status: string; r: Person; a: Person }[]
    },
  })

  async function respond(other: string, accept: boolean) {
    const { error } = await supabase.rpc('respond_connection', { p_other: other, p_accept: accept })
    if (error) return toast.error(friendlyError(error))
    void qc.invalidateQueries({ queryKey: ['connections', uid] })
  }

  if (isLoading) return <PageSkeleton />
  const rows = data ?? []
  const incoming = rows.filter((c) => c.status === 'pending' && c.addressee === uid)
  const connected = rows.filter((c) => c.status === 'accepted').map((c) => (c.requester === uid ? c.a : c.r))
  const line = (p: Person) => (p.current_title && p.current_company ? `${p.current_title} · ${p.current_company}` : [p.grad_year ? `Batch ${p.grad_year}` : null, shortBranch(p.branch)].filter(Boolean).join(' · '))

  return (
    <div>
      <PageHeader title="Connections" back="/me" />
      <Page className="space-y-6">
        {incoming.length > 0 && (
          <section>
            <SectionTitle>Requests ({incoming.length})</SectionTitle>
            <Card className="divide-y divide-border">
              {incoming.map((c) => (
                <div key={c.requester} className="flex items-center gap-3 p-3.5">
                  <Link to={`/people/${c.r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar src={c.r.avatar_url} name={c.r.full_name} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.r.full_name}</span>
                      <span className="block truncate text-sm text-muted">{line(c.r)}</span>
                    </span>
                  </Link>
                  <Button size="sm" onClick={() => respond(c.requester, true)}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => respond(c.requester, false)}>Ignore</Button>
                </div>
              ))}
            </Card>
          </section>
        )}
        <section>
          <SectionTitle>Your connections ({connected.length})</SectionTitle>
          {connected.length ? (
            <Card className="divide-y divide-border">
              {connected.map((p) => (
                <Link key={p.id} to={`/people/${p.id}`} className="flex items-center gap-3 p-3.5 hover:bg-surface-2">
                  <Avatar src={p.avatar_url} name={p.full_name} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.full_name}</span>
                    <span className="block truncate text-sm text-muted">{line(p)}</span>
                  </span>
                </Link>
              ))}
            </Card>
          ) : (
            <EmptyState icon={<Users />} title="No connections yet" action={<Link to="/people" className="font-semibold text-primary">Find batchmates</Link>} />
          )}
        </section>
      </Page>
    </div>
  )
}
