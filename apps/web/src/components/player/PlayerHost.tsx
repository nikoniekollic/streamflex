import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useRouteContext } from '@tanstack/react-router'
import { StreamStatus } from '@/components/player/StreamStatus'
import { WatchSession } from '@/components/player/WatchSession'
import { StreamError, loadWatch, type StreamErrorCode, type WatchData } from '@/lib/stream'
import { prefetchStream, takeWatch } from '@/lib/prefetch'
import { closePlayer, openPlayer, usePlayerOverlay } from '@/lib/player-overlay'
import { useSiteSettings } from '@/lib/site-settings'

type Load = { status: 'loading' } | { status: 'ready'; data: WatchData } | { status: 'error'; code: StreamErrorCode }

/** Lecteur plein écran en premier plan, monté une fois dans le gabarit de l'application. */
export function PlayerHost() {
  const o = usePlayerOverlay()
  const { player } = useSiteSettings()
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile?.id
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  // proportions RÉELLES de la vidéo (lues dans le fichier) : le lecteur s'agrandit au maximum de l'écran sans bandes noires
  const [videoRatio, setVideoRatio] = useState<number | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onMeta = (e: Event) => {
      const v = e.target
      if (v instanceof HTMLVideoElement && v.videoWidth > 0 && v.videoHeight > 0) {
        const r = v.videoWidth / v.videoHeight
        if (r > 0.3 && r < 4) setVideoRatio(Math.round(r * 1000) / 1000)
      }
    }
    // événements des vidéos (ils ne remontent pas : écoute en phase de capture) ; « resize » = changement de qualité
    el.addEventListener('loadedmetadata', onMeta, true)
    el.addEventListener('resize', onMeta, true)
    return () => {
      el.removeEventListener('loadedmetadata', onMeta, true)
      el.removeEventListener('resize', onMeta, true)
    }
  }, [o.open])

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
  const [rw, rh] = player.ratio.split(':').map(Number)
  const ratio = videoRatio ?? (rw > 0 && rh > 0 ? rw / rh : 16 / 9)
  // Cadre de taille FIXE (largeur × hauteur réglées dans l'admin), comme YouTube : la vidéo s'y adapte sans jamais être rognée et
  // les bandes remplissent le reste — horizontales (haut / bas) pour une vidéo large, verticales (côtés) pour une vidéo verticale.
  // L'épaisseur réglée est un MINIMUM : le cadre ne rétrécit jamais, seule la vidéo s'ajuste à l'intérieur.
  const portrait = ratio < 1
  const barOn = portrait ? player.barsPortrait : player.barsLandscape
  const pad = barOn ? (portrait ? player.barSizeV : player.barSizeH) : 0
  const videoInset = !pad ? '0' : portrait ? `0 ${pad}%` : `${pad}% 0`
  const barBg = barOn ? `color-mix(in srgb, ${player.barColor} ${player.barOpacity}%, transparent)` : '#000'
  const full = player.width >= 100 && player.size >= 100
  const vars = { '--sf-player-bg': barBg, '--sf-video-inset': videoInset } as CSSProperties
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
      {/* croix rouge, toujours visible en haut à droite : ferme le lecteur et ramène à la page d'avant */}
      <button
        type="button"
        onClick={closePlayer}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Fermer le lecteur (Échap)"
        title="Fermer (Échap)"
        className="fixed top-3 right-3 z-[120] flex size-11 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-2 ring-white/20 transition hover:scale-110 hover:bg-red-500 focus-visible:ring-white md:top-4 md:right-4"
      >
        <X className="size-6" strokeWidth={3} />
      </button>
      <div
        ref={frame}
        className={windowed ? 'sf-player-frame relative overflow-hidden ring-1 ring-white/10' : 'relative overflow-hidden'}
        style={
          windowed
            ? // le fond reste visible autour du cadre (assombri, flouté) : un clic dessus ferme le lecteur
              { ...vars, width: `${player.width}vw`, height: `${player.size}dvh`, borderRadius: full ? 0 : player.radius, background: barBg }
            : { ...vars, width: '100vw', height: '100dvh', background: barBg }
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
