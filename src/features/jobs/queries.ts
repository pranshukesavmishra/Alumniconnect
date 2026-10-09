import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export type JobType = 'full_time' | 'part_time' | 'internship' | 'contract'
export type WorkMode = 'onsite' | 'hybrid' | 'remote'

export const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'internship', label: 'Internship' },
  { value: 'contract', label: 'Contract' },
]
export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
]
export const typeLabel = (v: JobType) => JOB_TYPES.find((t) => t.value === v)?.label ?? v
export const modeLabel = (v: WorkMode) => WORK_MODES.find((t) => t.value === v)?.label ?? v

export interface JobListItem {
  id: string
  title: string
  company: string
  location: string | null
  job_type: JobType
  work_mode: WorkMode
  experience: string | null
  can_refer: boolean
  created_at: string
  expires_at: string
  poster_id: string
  poster_name: string
  poster_avatar: string | null
  poster_batch: number | null
  saved: boolean
}

export interface JobDetail {
  id: string
  posted_by: string
  title: string
  company: string
  location: string | null
  job_type: JobType
  work_mode: WorkMode
  experience: string | null
  description: string
  apply_url: string | null
  apply_email: string | null
  can_refer: boolean
  is_closed: boolean
  is_hidden: boolean
  expires_at: string
  created_at: string
  poster: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null; current_title: string | null; current_company: string | null } | null
}

const PAGE = 20

export interface JobFilters {
  query: string
  type: JobType | null
  mode: WorkMode | null
  saved: boolean
}

export function useJobs(f: JobFilters) {
  return useInfiniteQuery({
    queryKey: ['jobs', f],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_jobs', {
        p_query: f.query.trim() || null,
        p_type: f.type,
        p_mode: f.mode,
        p_only_saved: f.saved,
        p_limit: PAGE,
        p_offset: pageParam,
      })
      if (error) throw error
      return data as JobListItem[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ['job', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*, poster:profiles!jobs_posted_by_fkey(id, full_name, avatar_url, grad_year, branch, current_title, current_company)')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as JobDetail | null
    },
  })
}

export function useJobSaved(id: string | undefined) {
  const uid = useUserId()
  return useQuery({
    queryKey: ['job-saved', id, uid],
    enabled: !!id && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_saves').select('job_id').eq('job_id', id!).maybeSingle()
      if (error) throw error
      return !!data
    },
  })
}

export function useToggleSave(id: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (save: boolean) => {
      const { error } = save ? await supabase.from('job_saves').insert({ job_id: id, user_id: uid }) : await supabase.from('job_saves').delete().eq('job_id', id).eq('user_id', uid!)
      if (error && error.code !== '23505') throw error
    },
    onMutate: (save) => {
      qc.setQueryData(['job-saved', id, uid], save)
    },
    onError: (_e, save) => qc.setQueryData(['job-saved', id, uid], !save),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export interface MyJob {
  id: string
  title: string
  company: string
  is_closed: boolean
  is_hidden: boolean
  expires_at: string
  created_at: string
}

export function useMyJobs() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-jobs', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs').select('id, title, company, is_closed, is_hidden, expires_at, created_at').eq('posted_by', uid!).order('created_at', { ascending: false })
      if (error) throw error
      return data as MyJob[]
    },
  })
}

export function useUpdateMyJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; closed?: boolean; extendDays?: number }) => {
      const { error } = await supabase.rpc('update_my_job', { p_id: input.id, p_closed: input.closed ?? null, p_extend_days: input.extendDays ?? null })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['my-jobs'] })
      void qc.invalidateQueries({ queryKey: ['job', v.id] })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useDeleteMyJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('jobs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-jobs'] })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}
