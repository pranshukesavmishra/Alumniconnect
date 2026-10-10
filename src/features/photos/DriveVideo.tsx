import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { useT } from '../../i18n'
import { supabase } from '../../lib/supabase'
import { mediaUrl, type MediaKind } from './video'

/** The member's access token for the drive-media function (a <video> tag cannot send headers). Read once; refreshed only if playback fails. */
export function useMediaToken(enabled: boolean) {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(!enabled)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setToken(data.session?.access_token ?? null)
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [enabled])
  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.refreshSession()
    const t = data.session?.access_token ?? null
    setToken(t)
    return t
  }, [])
  return { token, ready, refresh }
}

export interface DriveVideoProps {
  kind: MediaKind
  id: string
  poster?: string
  className?: string
  controls?: boolean
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  label?: string
  videoRef?: Ref<HTMLVideoElement>
  onPlaying?: () => void
  onEnded?: () => void
  onClick?: () => void
  testId?: string
}

/**
 * A plain native <video> (controls, playsInline, preload=metadata) that streams from the drive-media function. The browser asks for byte
 * ranges, so seeking works. If the address stops working (an expired token) it fetches a fresh one once and carries on where it was.
 */
export function DriveVideo({ kind, id, poster, className, controls = true, autoPlay, muted, loop, preload = 'metadata', label, videoRef, onPlaying, onEnded, onClick, testId }: DriveVideoProps) {
  const tx = useT()
  const needsToken = kind !== 'glimpse'
  const { token, ready, refresh } = useMediaToken(needsToken)
  const local = useRef<HTMLVideoElement | null>(null)
  const resumeAt = useRef(0)
  const retried = useRef(false)
  const [failed, setFailed] = useState(false)

  const setRef = (el: HTMLVideoElement | null) => {
    local.current = el
    if (typeof videoRef === 'function') videoRef(el)
    else if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = el
  }

  if (!ready) return <div className={className} aria-busy="true" />
  if (needsToken && !token) return <p className="p-4 text-center text-sm text-white">{tx('video.signInAgain')}</p>
  const src = mediaUrl(kind, id, token)

  async function onError() {
    resumeAt.current = local.current?.currentTime ?? 0
    if (needsToken && !retried.current) {
      retried.current = true
      if (await refresh()) return
    }
    setFailed(true)
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-white" role="alert">
        <p>{tx('video.cannotPlay')}</p>
        <button type="button" className="min-h-11 rounded-full bg-white/15 px-4 font-semibold" onClick={() => { retried.current = false; setFailed(false) }}>{tx('photos.retry')}</button>
      </div>
    )
  }

  return (
    <video
      ref={setRef}
      key={src}
      src={src}
      poster={poster}
      className={className}
      controls={controls}
      playsInline
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      preload={preload}
      aria-label={label}
      data-testid={testId ?? 'drive-video'}
      onError={() => void onError()}
      onLoadedMetadata={(e) => {
        if (resumeAt.current > 0) {
          e.currentTarget.currentTime = resumeAt.current
          resumeAt.current = 0
        }
      }}
      onPlaying={onPlaying}
      onEnded={onEnded}
      onClick={onClick}
    />
  )
}
