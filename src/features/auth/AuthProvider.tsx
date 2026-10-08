import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { clearAllDrafts } from '../../hooks/useDraft'

interface AuthState {
  session: Session | null
  /** true until the stored session has been read on startup */
  loading: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })
  const qc = useQueryClient()

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setState({ session: data.session, loading: false })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false })
      if (event === 'SIGNED_OUT') {
        qc.clear()
        clearAllDrafts()
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [qc])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function useUserId(): string | null {
  return useAuth().session?.user.id ?? null
}

export const profileKey = (id: string | null) => ['profile', id] as const

export function useMyProfile() {
  const uid = useUserId()
  return useQuery({
    queryKey: profileKey(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid!).single()
      if (error) throw error
      return data as Profile
    },
  })
}

export async function signOut() {
  clearAllDrafts()
  const { error } = await supabase.auth.signOut()
  // offline or expired token: still remove the session from this device
  if (error) await supabase.auth.signOut({ scope: 'local' })
}
