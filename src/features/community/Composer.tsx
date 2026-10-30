import { ChevronDown, ImagePlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Card } from '../../components/ui/Display'
import { GroupIcon } from '../../components/ui/GroupIcon'
import { IconTile } from '../../components/ui/IconTile'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { useCreatePost, type GroupWithMe } from './queries'

const MAX = 5000

/** Write a post to all of JEC or to one of my groups. A tap on the prompt opens the composer sheet. */
export function Composer({ groups, fixedGroup }: { groups?: GroupWithMe[]; fixedGroup?: GroupWithMe }) {
  const tx = useT()
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

  const addFiles = (files: File[]) => {
    setPhotos((p) => [...p, ...files].slice(0, 4))
    if (photos.length + files.length > 4) toast.info('Up to 4 photos per post.')
  }
  const target = fixedGroup ?? postable.find((g) => g.id === audience) ?? null
  const left = MAX - body.length

  return (
    <>
      <Card className="p-3">
        <div className="flex items-center gap-3">
          <Avatar src={me.avatar_url} name={me.full_name} size={42} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="fx-press min-h-12 min-w-0 flex-1 truncate rounded-full border border-border bg-surface-2/60 px-4 text-left text-[15px] text-muted hover:bg-surface-2"
          >
            {fixedGroup ? `Post in ${fixedGroup.name}…` : 'Share news, a question or a memory…'}
          </button>
          <label className="fx-press grid size-12 shrink-0 cursor-pointer place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label={tx('feed.addPhotos')}>
            <ImagePlus className="size-5" aria-hidden />
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) {
                  addFiles(files)
                  setOpen(true)
                }
              }}
            />
          </label>
        </div>
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} label={tx('feed.write')}>
        <div className="space-y-4 px-5 pb-3">
          <div className="flex items-center gap-3">
            <Avatar src={me.avatar_url} name={me.full_name} size={46} ring="verified" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{me.full_name}</p>
              {fixedGroup ? (
                <p className="text-caption flex items-center gap-1.5 text-muted">
                  <GroupIcon icon={fixedGroup.icon} kind={fixedGroup.kind} size="sm" className="!size-5 !rounded-full [&_svg]:!size-3" />
                  <span className="truncate">
                    Posting in <strong className="text-text">{fixedGroup.name}</strong>
                  </span>
                </p>
              ) : (
                <span className="relative mt-1 inline-flex max-w-full items-center">
                  <span className="pointer-events-none absolute left-2.5 grid size-5 place-items-center">
                    {target ? <GroupIcon icon={target.icon} kind={target.kind} size="sm" className="!size-5 !rounded-full [&_svg]:!size-3" /> : <Users className="size-4 text-primary" aria-hidden />}
                  </span>
                  <select
                    aria-label="Who can see this"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="min-h-9 max-w-full appearance-none truncate rounded-full border border-border bg-surface-2 pl-9 pr-8 text-sm font-semibold"
                  >
                    <option value="">All of JEC</option>
                    {postable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
                </span>
              )}
            </div>
          </div>
          <textarea
            autoFocus
            aria-label="Post text"
            className="min-h-40 w-full resize-none bg-transparent text-[18px] leading-relaxed placeholder:text-subtle focus:outline-none"
            placeholder="What would you like to share?"
            value={body}
            maxLength={MAX}
            onChange={(e) => setBody(e.target.value)}
          />
          {previews.length > 0 && (
            <div className={cn('grid gap-2', previews.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
              {previews.map((u, i) => (
                <div key={u} className={cn('relative overflow-hidden rounded-2xl', previews.length === 1 ? 'max-h-64' : 'aspect-square')}>
                  <img src={u} alt="" className="size-full object-cover" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="fx-liquid-dark absolute right-2 top-2 grid size-9 place-items-center rounded-full">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-border/70 pt-3">
            <label className="fx-press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full pr-3 font-semibold hover:bg-surface-2">
              <IconTile icon={ImagePlus} tone="emerald" variant="solid" size="sm" />
              Photos
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  addFiles(files)
                }}
              />
            </label>
            <span className={cn('ml-auto text-xs tabular-nums', left < 200 ? 'text-warning' : 'text-subtle')}>{body.length > MAX - 500 ? `${left} left` : ''}</span>
            <Button loading={create.isPending} disabled={!body.trim()} onClick={submit} className="px-7">
              Post
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
