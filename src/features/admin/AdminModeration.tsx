import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Flag, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'

interface ReportRow {
  target_type: 'post' | 'comment' | 'message' | 'profile'
  target_id: string
  report_count: number
  last_reported: string
  reasons: string
  preview: string | null
  author_id: string | null
  author_name: string | null
  removed: boolean
  place: string | null
}

const KIND_LABEL: Record<ReportRow['target_type'], string> = { post: 'Post', comment: 'Comment', message: 'Chat message', profile: 'Profile' }

/** Every open report on one screen: read what was reported, then remove/hide it or dismiss the report. */
export function useReports(status: 'open' | 'actioned' | 'dismissed', enabled = true) {
  return useQuery({
    queryKey: ['admin-reports', status],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_reports', { p_status: status })
      if (error) throw error
      return data as ReportRow[]
    },
  })
}

export function useOpenReportCount(enabled: boolean) {
  const { data } = useReports('open', enabled)
  return enabled ? (data?.length ?? 0) : 0
}

export function AdminModeration() {
  const { data: me, isLoading: meLoading } = useMyProfile()
  const [status, setStatus] = useState<'open' | 'actioned' | 'dismissed'>('open')
  const { data, isLoading, error } = useReports(status, !!me?.is_admin)
  const qc = useQueryClient()

  const act = useMutation({
    mutationFn: async ({ r, action }: { r: ReportRow; action: 'remove' | 'dismiss' }) => {
      if (action === 'dismiss') {
        const { error } = await supabase.rpc('admin_dismiss_reports', { p_type: r.target_type, p_id: r.target_id })
        if (error) throw error
      } else if (r.target_type === 'message') {
        const { error } = await supabase.rpc('admin_remove_message', { p_message: r.target_id })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('moderate', { p_type: r.target_type, p_id: r.target_id, p_hide: true, p_report_status: 'actioned' })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reports'] }),
  })

  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/" replace />

  const tabs: { id: typeof status; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'actioned', label: 'Actioned' },
    { id: 'dismissed', label: 'Dismissed' },
  ]
  return (
    <div>
      <PageHeader title="Reports" subtitle="What members have flagged" back="/admin" />
      <Page className="space-y-4">
        <div role="tablist" className="flex gap-2">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={status === t.id} onClick={() => setStatus(t.id)} className={`min-h-11 rounded-full px-4 text-sm font-semibold ${status === t.id ? 'bg-primary text-on-primary' : 'border border-border bg-surface'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading ? (
          <PageSkeleton />
        ) : !data?.length ? (
          <EmptyState icon={<ShieldCheck />} title={status === 'open' ? 'Nothing to review' : 'No reports here'}>
            {status === 'open' ? 'When members report a post, comment or chat message it will appear here.' : undefined}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.map((r) => (
              <li key={`${r.target_type}-${r.target_id}`}>
                <Card className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning"><Flag className="size-3" aria-hidden /> {KIND_LABEL[r.target_type]}</Badge>
                    <Badge tone="danger">{r.report_count} {r.report_count === 1 ? 'report' : 'reports'}</Badge>
                    {r.place && <Badge>{r.place}</Badge>}
                    {r.removed && <Badge tone="neutral"><EyeOff className="size-3" aria-hidden /> Removed</Badge>}
                    <span className="ml-auto text-xs text-muted">{relativeTime(r.last_reported)}</span>
                  </div>
                  <blockquote className="whitespace-pre-line break-words rounded-2xl bg-surface-2 p-3 text-[15px] [overflow-wrap:anywhere]">{r.preview?.trim() ? r.preview : <span className="text-muted">(no text)</span>}</blockquote>
                  <p className="text-sm text-muted">
                    By{' '}
                    {r.author_id ? <Link to={`/people/${r.author_id}`} className="font-semibold text-primary">{r.author_name ?? 'member'}</Link> : 'unknown'} · Reported for: {r.reasons}
                  </p>
                  {status === 'open' && (
                    <div className="flex flex-wrap gap-2">
                      {r.target_type !== 'profile' && !r.removed && (
                        <Button
                          variant="danger"
                          icon={<Trash2 className="size-4" />}
                          loading={act.isPending && act.variables?.r === r && act.variables.action === 'remove'}
                          onClick={() => {
                            if (window.confirm(r.target_type === 'message' ? 'Remove this message for everyone?' : 'Hide this from members?')) act.mutate({ r, action: 'remove' }, { onSuccess: () => toast.success('Done'), onError: (e) => toast.error(friendlyError(e)) })
                          }}
                        >
                          {r.target_type === 'message' ? 'Remove message' : 'Hide'}
                        </Button>
                      )}
                      <Button variant="secondary" loading={act.isPending && act.variables?.r === r && act.variables.action === 'dismiss'} onClick={() => act.mutate({ r, action: 'dismiss' }, { onSuccess: () => toast.success('Dismissed'), onError: (e) => toast.error(friendlyError(e)) })}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </div>
  )
}
