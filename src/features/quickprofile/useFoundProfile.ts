import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../i18n'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useMember } from '../profile/queries'
import { buildPreview, previewIsEmpty, previewToSave, type AiProfile, type Preview } from './mapping'
import { useSaveQuickProfile } from './queries'

export const MAX_CHARS = 12_000

/** Preview + save for any found profile (Magic fill, LinkedIn). */
export function useFoundProfile(onSaved?: () => void) {
  const tx = useT()
  const uid = useUserId()
  const { data: profile } = useMyProfile()
  const member = useMember(uid ?? undefined)
  const save = useSaveQuickProfile()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [nothing, setNothing] = useState(false)
  return {
    preview,
    nothing,
    setPreview,
    show(ai: AiProfile) {
      if (!profile) return
      const p = buildPreview(ai, profile, member.data?.experiences ?? [])
      setNothing(previewIsEmpty(p))
      setPreview(previewIsEmpty(p) ? null : p)
    },
    reset() {
      setPreview(null)
      setNothing(false)
      save.reset()
    },
    save,
    async commit() {
      if (!preview || !profile) return
      await save.mutateAsync(previewToSave(preview, profile))
      toast.success(tx('qp.saved'))
      setPreview(null)
      onSaved?.()
    },
  }
}
