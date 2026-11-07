import type { TypedSupabaseClient } from '@/lib/supabase'
import { loadWatch, resolveStream, type StreamInfo, type WatchData } from '@/lib/stream'
import { invalidatePreview, peekPreviewMeta, peekPreviewUrl } from '@/lib/preview'

// Préchargement de la file de lecture : pendant qu'une vidéo joue, on prépare les suivantes (données de la page,
// lien débridé, début du fichier) pour que « suivant » / « précédent » soit quasi instantané et sans écran de chargement.
const STREAM_TTL_MS = 80 * 60_000
const KEEP = 12

const WATCH_TTL_MS = 2 * 60_000 // la position de reprise ne doit pas être périmée

const watches = new Map<string, { p: Promise<WatchData>; at: number }>()
const streams = new Map<string, { info: StreamInfo; until: number }>()
const streaming = new Map<string, Promise<void>>()
const warmEls: HTMLVideoElement[] = []

function trim<T>(m: Map<string, T>) {
  while (m.size > KEEP) m.delete(m.keys().next().value as string)
}

/** « saved » = reprise à la position enregistrée (clic sur une jaquette) ; « zero » = depuis le début (file de lecture). */
export type WatchMode = 'saved' | 'zero'
const wkey = (titleId: string, mode: WatchMode) => `${titleId}:${mode}`

/** Données de la page de lecture (titre, position, sous-titres) déjà demandées pour ce titre ? */
export function takeWatch(titleId: string, mode: WatchMode): Promise<WatchData> | undefined {
  const hit = watches.get(wkey(titleId, mode))
  return hit && Date.now() - hit.at < WATCH_TTL_MS ? hit.p : undefined
}

export function prefetchWatch(s: TypedSupabaseClient, profileId: string, titleId: string, mode: WatchMode = 'zero') {
  const k = wkey(titleId, mode)
  const cur = watches.get(k)
  if (cur && Date.now() - cur.at < WATCH_TTL_MS) return
  const p = loadWatch(s, profileId, titleId, undefined, mode === 'zero' ? 0 : undefined)
  p.catch(() => watches.delete(k))
  watches.set(k, { p, at: Date.now() })
  trim(watches)
}

/**
 * Lien de lecture déjà débridé pour ce film : préchargé par la file de lecture, ou — c'est le cas le plus fréquent —
 * déjà obtenu pour l'aperçu de la jaquette (un seul fichier par titre : même lien, aucune nouvelle résolution).
 */
export function peekStream(titleId: string): StreamInfo | null {
  const hit = streams.get(titleId)
  if (hit && hit.until > Date.now()) return hit.info
  const url = peekPreviewUrl(titleId)
  if (!url) return null
  // Le lien d'aperçu est celui de la qualité la plus légère : on ne le réutilise pour la lecture que s'il n'y a QU'UNE qualité
  // (cas des films importés, souvent 1080p) ; sinon la lecture résout la plus haute qualité, comme avant.
  const meta = peekPreviewMeta(titleId)
  if (meta && meta.qualities.length > 1) return null
  const quality = (meta?.quality ?? '1080p') as StreamInfo['quality']
  return { url, provider: 'onefichier', quality, sourceId: `preview:${titleId}`, qualities: [quality], audios: [], audio: [], expiresAt: Date.now() + 60 * 60_000, cached: true }
}

/** Résolution déjà en route pour ce titre (ouverture du lecteur) : on l'attend au lieu de la doubler. */
export const streamInFlight = (titleId: string): Promise<void> | undefined => streaming.get(titleId)

export function forgetStream(titleId: string) {
  streams.delete(titleId)
  watches.delete(wkey(titleId, 'zero'))
  watches.delete(wkey(titleId, 'saved'))
  invalidatePreview(titleId)
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
    prefetchWatch(s, profileId, id, 'zero')
    await prefetchStream(s, profileId, id) // un à la fois : on ménage Alldebrid
  }
}
