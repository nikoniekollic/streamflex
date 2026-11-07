import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import {
  ambientAllowed,
  getAmbientVersion,
  getPreviewUrl,
  isAmbientSlot,
  markAmbientFailed,
  peekPreviewUrl,
  setAmbientVisible,
  subscribeAmbient,
  warmPreview,
  type Wanted,
} from '@/lib/preview'

type ClipProps = {
  titleId: string
  active: boolean
  /** extrait lu en boucle, en secondes */
  clipSeconds?: number
  /** attente avant de lancer quoi que ce soit */
  delayMs?: number
  /** son activé (aperçu au survol) ou muet (fond de la page d'un titre) */
  audio?: boolean
  /** prépare le lien dès que l'élément est visible, et autorise la lecture silencieuse d'ambiance (quelques cartes seulement) */
  warm?: boolean
  className?: string
}

const AMBIENT_CLIP_S = 12

/** Extrait vidéo d'un instant aléatoire du film (lien Alldebrid débridé dans le navigateur), lu en boucle. */
export function PreviewClip({ titleId, active, clipSeconds = 30, delayMs = 700, audio = false, warm = false, className }: ClipProps) {
  const { activeProfile } = useActiveProfile()
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const start = useRef(0)
  const profileId = activeProfile?.id
  const sentinel = useRef<HTMLSpanElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  // Ce titre a-t-il une place parmi les quelques cartes qui jouent en silence ?
  useSyncExternalStore(subscribeAmbient, getAmbientVersion)
  const ambient = warm && !active && isAmbientSlot(titleId)
  const mode: 'hover' | 'ambient' | null = active ? 'hover' : ambient ? 'ambient' : null

  // Visibilité : ≥ 1,2 s à l'écran → lien préparé ; ≥ 60 % visible → candidat à la lecture d'ambiance
  useEffect(() => {
    const el = sentinel.current
    if (!warm || !el || !profileId || !('IntersectionObserver' in window)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(
      ([entry]) => {
        if (timer) clearTimeout(timer)
        timer = null
        if (entry.isIntersecting) timer = setTimeout(() => void warmPreview(supabase, profileId, titleId), 1200)
        setAmbientVisible(titleId, entry.isIntersecting && entry.intersectionRatio >= 0.6 && ambientAllowed())
      },
      { rootMargin: '100px', threshold: [0, 0.6] },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      if (timer) clearTimeout(timer)
      setAmbientVisible(titleId, false)
    }
  }, [warm, profileId, titleId])

  // Résolution du lien selon le mode
  useEffect(() => {
    if (!mode || !profileId) {
      setSrc(null)
      setPlaying(false)
      return
    }
    const ready = peekPreviewUrl(titleId)
    if (ready) {
      setSrc(ready) // lien déjà préparé : démarrage immédiat
      return () => {
        setSrc(null)
        setPlaying(false)
      }
    }
    const wanted: Wanted = { cancelled: false }
    const t = setTimeout(
      () => {
        const job = mode === 'hover' ? getPreviewUrl(supabase, profileId, titleId, wanted) : warmPreview(supabase, profileId, titleId)
        void job.then((url) => {
          if (wanted.cancelled) return
          if (url) setSrc(url)
          else if (mode === 'ambient') markAmbientFailed(titleId) // laisse sa place à une autre carte
        })
      },
      mode === 'hover' ? delayMs : 0,
    )
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
      setSrc(null)
      setPlaying(false)
    }
  }, [mode, profileId, titleId, delayMs])

  // Onglet masqué : on met en pause
  useEffect(() => {
    const on = () => {
      const v = video.current
      if (!v) return
      if (document.hidden) v.pause()
      else void v.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const withSound = mode === 'hover' && audio
  const clip = mode === 'ambient' ? AMBIENT_CLIP_S : clipSeconds
  const sentinelEl = warm ? <span ref={sentinel} aria-hidden className="pointer-events-none absolute inset-0" /> : null

  // Structure stable : le repère observé ne doit jamais être recréé quand la vidéo apparaît
  return (
    <>
      {sentinelEl}
      {src && mode && (
        <video
          key={mode}
          ref={video}
          src={src}
          playsInline
          preload="auto"
          aria-hidden
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            v.muted = !withSound
            v.volume = withSound ? 0.7 : 0
            const d = v.duration
            // début aléatoire, assez tôt pour qu'il reste de quoi remplir l'extrait
            start.current = Number.isFinite(d) && d > clip * 2 ? Math.min(d * (0.08 + Math.random() * 0.7), d - clip - 1) : 0
            if (start.current > 0) v.currentTime = start.current
          }}
          onCanPlay={(e) => {
            const v = e.currentTarget
            // Son refusé par le navigateur (aucune interaction préalable) : on retombe en muet plutôt que de ne rien montrer
            void v.play().catch(() => {
              v.muted = true
              return v.play().catch(() => undefined)
            })
          }}
          onPlaying={() => setPlaying(true)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            if (v.currentTime >= start.current + clip) v.currentTime = start.current
          }}
          onEnded={(e) => {
            e.currentTarget.currentTime = start.current
            void e.currentTarget.play().catch(() => undefined)
          }}
          onError={() => {
            console.warn('[StreamFlex][preview] la vidéo ne se charge pas')
            if (mode === 'ambient') markAmbientFailed(titleId)
            setSrc(null)
          }}
          className={cn('pointer-events-none size-full object-cover transition-opacity duration-300', playing ? 'opacity-100' : 'opacity-0', className)}
        />
      )}
    </>
  )
}

/** Jaquette du catalogue : lecture silencieuse sur quelques cartes visibles, aperçu de ~30 s avec le son au survol. */
export function HoverPreview({ titleId, active }: { titleId: string; active: boolean }) {
  return <PreviewClip titleId={titleId} active={active} audio warm delayMs={120} className="absolute inset-0 z-[1]" />
}
