import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export const MENTOR_TOPICS = ['Career growth', 'Interview prep', 'Higher studies', 'Startups', 'Leadership', 'Switching careers', 'Government exams', 'Work abroad'] as const

export interface MentorRow {
  user_id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  headline: string | null
  current_title: string | null
  current_company: string | null
  topics: string[]
  bio: string
  availability: string | null
  is_accepting: boolean
  max_mentees: number
  open_slots: number
  my_status: 'requested' | 'accepted' | 'declined' | 'ended' | null
}

export interface MentorProfile {
  user_id: string
  topics: string[]
  bio: string
  availability: string | null
  is_accepting: boolean
  max_mentees: number
}

export interface MentorshipRow {
  id: string
  role: 'mentor' | 'mentee'
  other_id: string
  other_name: string
  other_avatar: string | null
  other_batch: number | null
  topic: string
  message: string
  status: 'requested' | 'accepted' | 'declined' | 'ended'
  created_at: string
  responded_at: string | null
  ended_at: string | null
  chat_id: string | null
}

const PAGE = 20

export function useMentors(topic: string | null, query: string) {
  return useInfiniteQuery({
    queryKey: ['mentors', topic, query],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('list_mentors', { p_topic: topic, p_query: query.trim() || null, p_limit: PAGE, p_offset: pageParam })
      if (error) throw error
      return data as MentorRow[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function useMyMentorProfile() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-mentor-profile', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('mentor_profiles').select('user_id, topics, bio, availability, is_accepting, max_mentees').eq('user_id', uid!).maybeSingle()
      if (error) throw error
      return data as MentorProfile | null
    },
  })
}

export function useMyMentorships() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-mentorships', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_mentorships')
      if (error) throw error
      return data as MentorshipRow[]
    },
  })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['mentors'] })
    void qc.invalidateQueries({ queryKey: ['my-mentorships'] })
    void qc.invalidateQueries({ queryKey: ['my-mentor-profile'] })
  }
}

export function useSaveMentorProfile() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (fields: { topics: string[]; bio: string; availability: string; max_mentees: number; is_accepting: boolean }) => {
      const { error } = await supabase.rpc('become_mentor', { p_fields: fields })
      if (error) throw error
    },
    onSuccess: refresh,
  })
}

export function usePauseMentoring() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (accepting: boolean) => {
      const { error } = await supabase.rpc('pause_mentoring', { p_accepting: accepting })
      if (error) throw error
    },
    onSuccess: refresh,
  })
}

export function useRequestMentor() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: { mentor: string; topic: string; message: string }) => {
      const { error } = await supabase.rpc('request_mentor', { p_mentor: input.mentor, p_topic: input.topic, p_message: input.message })
      if (error) throw error
    },
    onSuccess: refresh,
  })
}

export function useRespondMentorship() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc('respond_mentorship', { p_id: input.id, p_accept: input.accept })
      if (error) throw error
    },
    onSettled: refresh,
  })
}

export function useEndMentorship() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('end_mentorship', { p_id: id })
      if (error) throw error
    },
    onSettled: refresh,
  })
}
