import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { getPreviewUrl, type Wanted } from '@/lib/preview'

type ClipProps = {
  titleId: string
  active: boolean
  /** extrait lu en boucle, en secondes */
  clipSeconds?: number
  /** attente avant de lancer quoi que ce soit */
  delayMs?: number
  /** son activé (aperçu au survol) ou muet (fond de la page d'un titre) */
  audio?: boolean
  className?: string
}

/** Extrait vidéo d'un instant aléatoire du film (lien Alldebrid débridé dans le navigateur), lu en boucle. */
export function PreviewClip({ titleId, active, clipSeconds = 30, delayMs = 700, audio = false, className }: ClipProps) {
  const { activeProfile } = useActiveProfile()
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const start = useRef(0)
  const profileId = activeProfile?.id

  useEffect(() => {
    if (!active || !profileId) {
      setSrc(null)
      setPlaying(false)
      return
    }
    const wanted: Wanted = { cancelled: false }
    const t = setTimeout(() => {
      void getPreviewUrl(supabase, profileId, titleId, wanted).then((url) => {
        if (!wanted.cancelled && url) setSrc(url)
      })
    }, delayMs)
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
      setSrc(null)
      setPlaying(false)
    }
  }, [active, profileId, titleId, delayMs])

  if (!src) return null
  return (
    <video
      src={src}
      playsInline
      preload="auto"
      aria-hidden
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        v.muted = !audio
        v.volume = audio ? 0.7 : 0
        const d = v.duration
        // début aléatoire, assez tôt pour qu'il reste de quoi remplir l'extrait
        start.current = Number.isFinite(d) && d > clipSeconds * 2 ? Math.min(d * (0.08 + Math.random() * 0.7), d - clipSeconds - 1) : 0
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
        if (v.currentTime >= start.current + clipSeconds) v.currentTime = start.current
      }}
      onEnded={(e) => {
        e.currentTarget.currentTime = start.current
        void e.currentTarget.play().catch(() => undefined)
      }}
      onError={() => {
        console.warn('[StreamFlex][preview] la vidéo ne se charge pas')
        setSrc(null)
      }}
      className={cn('pointer-events-none size-full object-cover transition-opacity duration-500', playing ? 'opacity-100' : 'opacity-0', className)}
    />
  )
}

/** Aperçu au survol d'une jaquette : ~30 s aléatoires, avec le son. */
export function HoverPreview({ titleId, active }: { titleId: string; active: boolean }) {
  return <PreviewClip titleId={titleId} active={active} audio delayMs={600} className="absolute inset-0 z-[1]" />
}
