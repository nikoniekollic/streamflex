import { useEffect, useRef, useState, type PointerEvent } from 'react'

/**
 * Survol « intentionnel » : la carte n'est considérée survolée qu'après un court arrêt de la souris dessus.
 * Balayer une rangée avec la souris ne lance donc plus une série d'aperçus avec le son (ni leurs chargements).
 * Le contour de survol (CSS) reste, lui, immédiat.
 */
export function useHoverIntent(delayMs = 140) {
  const [active, setActive] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    active,
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setActive(true), delayMs)
    },
    onPointerLeave: () => {
      clearTimeout(timer.current)
      setActive(false)
    },
  }
}
