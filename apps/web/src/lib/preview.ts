import type { TypedSupabaseClient } from '@/lib/supabase'
import { resolveStream } from '@/lib/stream'

// Aperçus : le lien Alldebrid (débridé dans le navigateur) est résolu À L'AVANCE pour les jaquettes visibles
// (file « préchauffage », lente et espacée), et le survol passe devant tout : quand la souris arrive,
// le lien est déjà prêt et la vidéo démarre sans attendre l'Edge Function ni Alldebrid.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WARM_GAP_MS = 800 // préchauffage : un lien toutes les 0,8 s
const HOVER_GAP_MS = 250 // survol : quasi immédiat, légèrement lissé
const WARM_MAX = 200 // plafond de liens préchauffés par session
const OK_TTL_MS = 90 * 60_000 // les liens Alldebrid valent ~2 h
const FAIL_TTL_MS = 10 * 60_000
const BREAKER_AFTER = 5
const BREAKER_MS = 5 * 60_000

const cache = new Map<string, { url: string | null; until: number }>()
const inflight = new Map<string, Promise<string | null>>()
let hoverChain: Promise<unknown> = Promise.resolve()
let warmChain: Promise<unknown> = Promise.resolve()
let lastHoverAt = 0
let lastWarmAt = 0
let hoverPending = 0
let warmed = 0
let failStreak = 0
let pausedUntil = 0

export type Wanted = { cancelled: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function resolveOne(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<string | null> {
  try {
    const info = await resolveStream(s, { profileId, titleId, episodeId: null, preview: true })
    failStreak = 0
    cache.set(titleId, { url: info.url, until: Date.now() + OK_TTL_MS })
    return info.url
  } catch (e) {
    console.warn('[StreamFlex][preview] aperçu indisponible :', (e as Error).message)
    cache.set(titleId, { url: null, until: Date.now() + FAIL_TTL_MS })
    if (++failStreak >= BREAKER_AFTER) {
      pausedUntil = Date.now() + BREAKER_MS
      failStreak = 0
    }
    return null
  }
}

/** Lien déjà connu (null = inconnu ou indisponible). */
export const peekPreviewUrl = (titleId: string): string | null => {
  const hit = cache.get(titleId)
  return hit && hit.until > Date.now() ? hit.url : null
}

/** Survol : résolution prioritaire (aucun appel si la souris est déjà partie). */
export function getPreviewUrl(s: TypedSupabaseClient, profileId: string, titleId: string, wanted: Wanted): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const hit = cache.get(titleId)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url)
  if (Date.now() < pausedUntil) return Promise.resolve(null)

  hoverPending++
  const job = hoverChain.then(async () => {
    try {
      // un préchauffage de ce même titre est peut-être déjà en route : on l'attend plutôt que de doubler l'appel
      const running = inflight.get(titleId)
      if (running) return await running
      if (wanted.cancelled) return null
      const wait = lastHoverAt + HOVER_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      if (wanted.cancelled) return null
      lastHoverAt = Date.now()
      const p = resolveOne(s, profileId, titleId)
      inflight.set(titleId, p)
      try {
        return await p
      } finally {
        inflight.delete(titleId)
      }
    } finally {
      hoverPending--
    }
  })
  hoverChain = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

/** Jaquette visible à l'écran : on prépare le lien en arrière-plan, sans jamais gêner un survol. Renvoie le lien (ou null). */
export function warmPreview(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const known = cache.get(titleId)
  if (known && known.until > Date.now()) return Promise.resolve(known.url)
  const running = inflight.get(titleId)
  if (running) return running
  if (warmed >= WARM_MAX || Date.now() < pausedUntil) return Promise.resolve(null)
  warmed++
  const job = warmChain.then(async () => {
    while (hoverPending > 0) await sleep(300) // le survol d'abord
    const again = cache.get(titleId)
    if (again && again.until > Date.now()) return again.url
    const other = inflight.get(titleId)
    if (other) return other
    if (Date.now() < pausedUntil) return null
    const wait = lastWarmAt + WARM_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastWarmAt = Date.now()
    const p = resolveOne(s, profileId, titleId)
    inflight.set(titleId, p)
    try {
      return await p
    } finally {
      inflight.delete(titleId)
    }
  })
  warmChain = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

// ───────── Lecture silencieuse « d'ambiance » : seulement quelques cartes visibles à la fois
const AMBIENT_MAX = 4
const visibleOrder: string[] = []
const failed = new Set<string>()
const ambientListeners = new Set<() => void>()
let ambientVersion = 0
const bump = () => {
  ambientVersion++
  ambientListeners.forEach((l) => l())
}

/** Données économisées, mouvement réduit ou petit écran : pas de lecture d'ambiance. */
export function ambientAllowed(): boolean {
  if (typeof window === 'undefined') return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !conn?.saveData && window.matchMedia('(min-width: 768px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function setAmbientVisible(id: string, visible: boolean) {
  const i = visibleOrder.indexOf(id)
  if (visible && i < 0) visibleOrder.push(id)
  else if (!visible && i >= 0) visibleOrder.splice(i, 1)
  else return
  bump()
}

export function markAmbientFailed(id: string) {
  if (failed.has(id)) return
  failed.add(id)
  bump()
}

export const isAmbientSlot = (id: string) => visibleOrder.filter((x) => !failed.has(x)).slice(0, AMBIENT_MAX).includes(id)
export const getAmbientVersion = () => ambientVersion
export const subscribeAmbient = (l: () => void) => {
  ambientListeners.add(l)
  return () => void ambientListeners.delete(l)
}
