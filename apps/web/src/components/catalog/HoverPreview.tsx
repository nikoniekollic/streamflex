import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { getPreviewUrl, type Wanted } from '@/lib/preview'

const DELAY_MS = 700 // le survol doit durer avant de lancer quoi que ce soit
const CLIP_S = 10 // durée de l'extrait, en boucle

/** Aperçu vidéo muet d'un instant aléatoire du film, au survol de la jaquette (écrans avec souris, films uniquement). */
export function HoverPreview({ titleId, active }: { titleId: string; active: boolean }) {
  const { activeProfile } = useActiveProfile()
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const start = useRef(0)
  const video = useRef<HTMLVideoElement>(null)
  const profileId = activeProfile?.id

  useEffect(() => {
    if (!active || !profileId || !window.matchMedia('(hover: hover)').matches) {
      setSrc(null)
      setPlaying(false)
      return
    }
    const wanted: Wanted = { cancelled: false }
    const t = setTimeout(() => {
      void getPreviewUrl(supabase, profileId, titleId, wanted).then((url) => {
        if (!wanted.cancelled && url) setSrc(url)
      })
    }, DELAY_MS)
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
      setSrc(null)
      setPlaying(false)
    }
  }, [active, profileId, titleId])

  if (!src) return null
  return (
    <video
      ref={video}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        if (Number.isFinite(v.duration) && v.duration > CLIP_S * 2) {
          start.current = v.duration * (0.15 + Math.random() * 0.6)
          v.currentTime = start.current
        }
      }}
      onCanPlay={(e) => void e.currentTarget.play().catch(() => undefined)}
      onPlaying={() => setPlaying(true)}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        if (start.current > 0 && v.currentTime > start.current + CLIP_S) v.currentTime = start.current
      }}
      onError={() => setSrc(null)}
      className={cn('pointer-events-none absolute inset-0 z-[1] size-full object-cover transition-opacity duration-300', playing ? 'opacity-100' : 'opacity-0')}
    />
  )
}
