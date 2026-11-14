import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { getSnapVersion, peekSnap, subscribeSnaps } from '@/lib/video-pool'

/** Image figée de la jaquette (mémoire de la session) ; null = pas encore d'image pour ce film. */
export function useSnap(titleId: string): ImageBitmap | null {
  useSyncExternalStore(subscribeSnaps, getSnapVersion)
  return peekSnap(titleId)
}

/** Affiche une image figée (canvas : l'image d'une vidéo d'un autre site peut être affichée, pas enregistrée). */
export function SnapImage({ bitmap, fit = 'cover', position = 'center', className }: { bitmap: ImageBitmap; fit?: 'cover' | 'contain' | 'fill'; position?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    try {
      c.width = bitmap.width
      c.height = bitmap.height
      c.getContext('2d')?.drawImage(bitmap, 0, 0)
    } catch {
      /* image libérée entre-temps */
    }
  }, [bitmap])
  return <canvas ref={ref} aria-hidden className={cn('pointer-events-none absolute inset-0 size-full', className)} style={{ objectFit: fit, objectPosition: position }} />
}
