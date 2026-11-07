import type { TypedSupabaseClient } from '@/lib/supabase'
import { loadWatch, resolveStream, type StreamInfo, type WatchData } from '@/lib/stream'

// Préchargement de la file de lecture : pendant qu'une vidéo joue, on prépare les suivantes (données de la page,
// lien débridé, début du fichier) pour que « suivant » / « précédent » soit quasi instantané et sans écran de chargement.
const STREAM_TTL_MS = 80 * 60_000
const KEEP = 12

const watches = new Map<string, Promise<WatchData>>()
const streams = new Map<string, { info: StreamInfo; until: number }>()
const streaming = new Map<string, Promise<void>>()
const warmEls: HTMLVideoElement[] = []

function trim<T>(m: Map<string, T>) {
  while (m.size > KEEP) m.delete(m.keys().next().value as string)
}

/** Données de la page de lecture (titre, position, sous-titres) déjà demandées pour ce titre ? */
export const takeWatch = (titleId: string): Promise<WatchData> | undefined => watches.get(titleId)

export function prefetchWatch(s: TypedSupabaseClient, profileId: string, titleId: string) {
  if (watches.has(titleId)) return
  const p = loadWatch(s, profileId, titleId, undefined, 0)
  p.catch(() => watches.delete(titleId))
  watches.set(titleId, p)
  trim(watches)
}

/** Lien de lecture déjà débridé pour ce film (null = à résoudre normalement). */
export function peekStream(titleId: string): StreamInfo | null {
  const hit = streams.get(titleId)
  return hit && hit.until > Date.now() ? hit.info : null
}

export function forgetStream(titleId: string) {
  streams.delete(titleId)
  watches.delete(titleId)
}

/** Débride le lien, puis amorce le téléchargement du début du fichier (élément <video> détaché, quelques secondes tamponnées). */
export function prefetchStream(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<void> {
  if (peekStream(titleId)) return Promise.resolve()
  const running = streaming.get(titleId)
  if (running) return running
  const p = resolveStream(s, { profileId, titleId, episodeId: null, preview: true })
    .then((info) => {
      streams.set(titleId, { info, until: Date.now() + STREAM_TTL_MS })
      trim(streams)
      const v = document.createElement('video')
      v.preload = 'auto'
      v.muted = true
      v.src = info.url
      warmEls.push(v)
      while (warmEls.length > 3) {
        const old = warmEls.shift()!
        old.removeAttribute('src')
        old.load()
      }
    })
    .catch(() => undefined) // le préchargement ne doit jamais gêner : au pire, la résolution se fera au clic
    .finally(() => streaming.delete(titleId))
  streaming.set(titleId, p)
  return p
}

/** Prépare les titres voisins dans la file : le suivant d'abord, puis le précédent, puis le suivant du suivant. */
export async function prefetchAround(s: TypedSupabaseClient, profileId: string, ids: (string | undefined)[]) {
  for (const id of ids) {
    if (!id) continue
    prefetchWatch(s, profileId, id)
    await prefetchStream(s, profileId, id) // un à la fois : on ménage Alldebrid
  }
}
