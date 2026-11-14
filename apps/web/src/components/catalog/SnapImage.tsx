import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import { getSnapVersion, peekSnap, snapWidthFor, subscribeSnaps } from '@/lib/video-pool'

/** Image figée de la jaquette (mémoire de la session) ; null = pas encore d'image pour ce film. */
export function useSnap(titleId: string, minWidth = 0): ImageBitmap | null {
  useSyncExternalStore(subscribeSnaps, getSnapVersion)
  return peekSnap(titleId, minWidth)
}

/** Largeur affichée d'un élément (pixels CSS), suivie quand la grille change de taille. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Image figée assez grande pour la jaquette `ref` (sinon null : la vidéo est rechargée et l'image refaite en grand). */
export function useSnapFor(titleId: string, ref: RefObject<HTMLElement | null>): ImageBitmap | null {
  const w = useElementWidth(ref)
  return useSnap(titleId, w ? snapWidthFor(w) : 0)
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
