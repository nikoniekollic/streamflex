import { useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { StreamStatus } from '@/components/player/StreamStatus'
import { WatchSession } from '@/components/player/WatchSession'
import { StreamError, loadWatch, type StreamErrorCode, type WatchData } from '@/lib/stream'
import { prefetchStream, takeWatch } from '@/lib/prefetch'
import { closePlayer, openPlayer, usePlayerOverlay } from '@/lib/player-overlay'
import { ratioCss, useSiteSettings } from '@/lib/site-settings'

type Load = { status: 'loading' } | { status: 'ready'; data: WatchData } | { status: 'error'; code: StreamErrorCode }

/** Lecteur plein écran en premier plan, monté une fois dans le gabarit de l'application. */
export function PlayerHost() {
  const o = usePlayerOverlay()
  const { player } = useSiteSettings()
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile?.id
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    if (!o.open || !o.titleId || !profileId) {
      if (!o.open) setLoad({ status: 'loading' }) // fermé : le prochain titre repart d'un écran vierge
      return
    }
    let alive = true
    // données déjà préchargées (file de lecture) : affichage immédiat ; sinon on garde l'image précédente jusqu'à l'arrivée
    const mode = o.episodeId ? null : o.t == null ? 'saved' : o.t === 0 ? 'zero' : null
    const pre = mode ? takeWatch(o.titleId, mode) : undefined
    // lien de lecture résolu EN PARALLÈLE du chargement des données de la page (au lieu d'à la suite)
    void prefetchStream(supabase, profileId, o.titleId)
    setLoad((cur) => (cur.status === 'ready' ? cur : { status: 'loading' }))
    ;(pre ?? loadWatch(supabase, profileId, o.titleId, o.episodeId ?? undefined, o.t ?? undefined))
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
  const windowed = player.mode === 'window'
  return (
    // Fond : la page reste visible derrière, assombrie et floutée (réglages « Lecteur » de l'admin) ; un clic dessus ferme le lecteur
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: `rgba(0,0,0,${player.backdrop / 100})`, backdropFilter: player.blur ? `blur(${player.blur}px)` : undefined, WebkitBackdropFilter: player.blur ? `blur(${player.blur}px)` : undefined }}
      onMouseDown={(e) => windowed && e.target === e.currentTarget && closePlayer()}
      role="dialog"
      aria-modal="true"
      aria-label="Lecteur vidéo"
    >
      <div
        className="relative overflow-hidden bg-black shadow-2xl ring-1 shadow-black/60 ring-white/10"
        style={
          windowed
            ? { width: `min(${player.size}vw, calc(${player.size}vh * ${player.ratio.split(':')[0]} / ${player.ratio.split(':')[1]}))`, aspectRatio: ratioCss(player.ratio), borderRadius: player.radius }
            : { width: '100vw', height: '100dvh' }
        }
      >
        {load.status === 'loading' && <StreamStatus phase="resolving" title="" onBack={closePlayer} embedded />}
        {load.status === 'error' && (
          <StreamStatus phase="error" code={load.code} title="" onBack={closePlayer} onRetry={() => o.titleId && openPlayer({ titleId: o.titleId, episodeId: o.episodeId, t: o.t })} embedded />
        )}
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
    </div>
  )
}
