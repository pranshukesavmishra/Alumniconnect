import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { useT } from '../../i18n'
import { useImportProviderPhoto } from './queries'

/**
 * A member who signed in with Google or LinkedIn but has no profile photo gets the shared photo once
 * (first visit on this device). Removing the photo later is respected: we only ever try once per member.
 */
export function useAutoPhoto() {
  const tx = useT()
  const { session } = useAuth()
  const { data: profile } = useMyProfile()
  const importPhoto = useImportProviderPhoto()
  const tried = useRef(false)
  const uid = session?.user.id
  useEffect(() => {
    if (!uid || !profile || tried.current || profile.avatar_url) return
    const social = (session?.user.identities ?? []).some((i) => i.provider === 'google' || i.provider === 'linkedin_oidc')
    if (!social) return
    const key = `photo-auto:${uid}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      /* storage blocked: the ref still stops repeats in this visit */
    }
    tried.current = true
    importPhoto.mutate('any', {
      onSuccess: (r) => toast.success(r.source === 'linkedin' ? tx('welcome.photoLinkedin') : tx('welcome.photoGoogle')),
      onError: () => undefined, // no photo shared, or already handled: stay quiet
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per member
  }, [uid, profile?.avatar_url, profile?.id])
}
