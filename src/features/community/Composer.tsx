import { ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Card } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { useCreatePost, type GroupWithMe } from './queries'

/** Write a post to all of JEC or to one of my groups. */
export function Composer({ groups, fixedGroup }: { groups?: GroupWithMe[]; fixedGroup?: GroupWithMe }) {
  const { data: me } = useMyProfile()
  const create = useCreatePost()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [audience, setAudience] = useState<string>(fixedGroup?.id ?? '')
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const postable = (groups ?? []).filter((g) => g.joined && (g.kind !== 'channel' || g.myRole === 'admin' || me?.is_admin))
  if (!me) return null

  async function submit() {
    if (!body.trim()) return toast.error('Write something first.')
    try {
      await create.mutateAsync({ body, groupId: fixedGroup?.id ?? (audience || null), photos })
      setBody('')
      setPhotos([])
      setOpen(false)
      toast.success('Posted')
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  if (!open) {
    return (
      <Card className="flex items-center gap-3 p-3">
        <Avatar src={me.avatar_url} name={me.full_name} size={40} />
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 flex-1 rounded-full border border-border bg-surface-2/50 px-4 text-left text-[15px] text-muted hover:bg-surface-2">
          {fixedGroup ? `Post in ${fixedGroup.name}…` : 'Share news, a question or a memory…'}
        </button>
      </Card>
    )
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar src={me.avatar_url} name={me.full_name} size={40} />
        {fixedGroup ? (
          <p className="text-sm text-muted">
            Posting in <strong className="text-text">{fixedGroup.icon} {fixedGroup.name}</strong>
          </p>
        ) : (
          <select aria-label="Who can see this" value={audience} onChange={(e) => setAudience(e.target.value)} className="min-h-10 rounded-full border border-border bg-surface px-3 text-sm font-semibold">
            <option value="">🌐 All of JEC</option>
            {postable.map((g) => (
              <option key={g.id} value={g.id}>
                {g.icon} {g.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        autoFocus
        aria-label="Post text"
        className="min-h-28 w-full resize-y rounded-xl border border-border bg-surface p-3 text-[16px] focus:border-primary focus:outline-none"
        placeholder="What would you like to share?"
        value={body}
        maxLength={5000}
        onChange={(e) => setBody(e.target.value)}
      />
      {previews.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {previews.map((u, i) => (
            <div key={u} className="relative aspect-square overflow-hidden rounded-lg">
              <img src={u} alt="" className="size-full object-cover" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/60 text-white">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
          <ImagePlus className="size-5" aria-hidden /> Photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              setPhotos((p) => [...p, ...files].slice(0, 4))
              if (photos.length + files.length > 4) toast.info('Up to 4 photos per post.')
            }}
          />
        </label>
        <span className="ml-auto text-xs text-muted">{body.length > 4500 ? `${5000 - body.length} left` : ''}</span>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button loading={create.isPending} onClick={submit}>
          Post
        </Button>
      </div>
    </Card>
  )
}
