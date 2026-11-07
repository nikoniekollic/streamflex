import { useSyncExternalStore } from 'react'
import { setOverlayOpen } from '@/lib/preview'

// Lecteur en premier plan : s'ouvre PAR-DESSUS la page courante (qui reste en place, position comprise) ;
// la croix le ferme et on retrouve la page exactement où on l'avait laissée.
export type OverlayState = { open: boolean; titleId: string | null; episodeId: string | null; t: number | null }

let state: OverlayState = { open: false, titleId: null, episodeId: null, t: null }
const listeners = new Set<() => void>()

function set(next: OverlayState) {
  state = next
  setOverlayOpen(next.open)
  listeners.forEach((l) => l())
}

export function openPlayer(opts: { titleId: string; episodeId?: string | null; t?: number | null }) {
  set({ open: true, titleId: opts.titleId, episodeId: opts.episodeId ?? null, t: opts.t ?? null })
}

export function closePlayer() {
  if (state.open) set({ open: false, titleId: null, episodeId: null, t: null })
}

export const getOverlay = () => state

export function usePlayerOverlay(): OverlayState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    getOverlay,
  )
}
