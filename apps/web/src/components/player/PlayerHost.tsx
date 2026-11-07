import { useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { StreamStatus } from '@/components/player/StreamStatus'
import { WatchSession } from '@/components/player/WatchSession'
import { StreamError, loadWatch, type StreamErrorCode, type WatchData } from '@/lib/stream'
import { closePlayer, openPlayer, usePlayerOverlay } from '@/lib/player-overlay'

type Load = { status: 'loading' } | { status: 'ready'; data: WatchData } | { status: 'error'; code: StreamErrorCode }

/** Lecteur plein écran en premier plan, monté une fois dans le gabarit de l'application. */
export function PlayerHost() {
  const o = usePlayerOverlay()
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile?.id
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    if (!o.open || !o.titleId || !profileId) return
    let alive = true
    setLoad({ status: 'loading' })
    loadWatch(supabase, profileId, o.titleId, o.episodeId ?? undefined, o.t ?? undefined)
      .then((data) => alive && setLoad({ status: 'ready', data }))
      .catch((e) => alive && setLoad({ status: 'error', code: e instanceof StreamError ? e.code : 'title_not_found' }))
    return () => {
      alive = false
    }
  }, [o.open, o.titleId, o.episodeId, o.t, supabase, profileId])

  // Page figée derrière ; Échap ferme (sauf en plein écran, où Échap quitte d'abord le plein écran)
  useEffect(() => {
    if (!o.open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) closePlayer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [o.open])

  if (!o.open) return null
  return (
    <div className="fixed inset-0 z-[100] bg-black" role="dialog" aria-modal="true" aria-label="Lecteur vidéo">
      {load.status === 'loading' && <StreamStatus phase="resolving" title="" onBack={closePlayer} />}
      {load.status === 'error' && <StreamStatus phase="error" code={load.code} title="" onBack={closePlayer} onRetry={() => o.titleId && openPlayer({ titleId: o.titleId, episodeId: o.episodeId, t: o.t })} />}
      {load.status === 'ready' && (
        <WatchSession
          key={`${load.data.title.id}:${load.data.episode?.id ?? ''}`}
          data={load.data}
          mode="overlay"
          onBack={closePlayer}
          onSwitch={(t) => openPlayer({ titleId: t.titleId ?? load.data.title.id, episodeId: t.episodeId ?? null, t: 0 })}
        />
      )}
    </div>
  )
}
