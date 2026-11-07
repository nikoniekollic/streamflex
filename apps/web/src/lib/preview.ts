import type { TypedSupabaseClient } from '@/lib/supabase'
import { resolveStream } from '@/lib/stream'

// Aperçus : le lien Alldebrid (débridé dans le navigateur) est résolu À L'AVANCE pour les jaquettes visibles
// (une à la fois, espacées de 0,8 s), gardé en mémoire ET dans le navigateur (un retour arrière ou
// un rechargement ne refait aucun appel), et le survol passe devant tout.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WARM_GAP_MS = 800 // un lien toutes les 0,8 s : on ménage Alldebrid (et, derrière, 1fichier)
const WARM_PARALLEL = 1
const HOVER_GAP_MS = 120 // survol : quasi immédiat
const WARM_MAX = 200 // résolutions réseau préchauffées par session (le cache n'est pas compté)
const OK_TTL_MS = 80 * 60_000 // les liens Alldebrid valent ~2 h : on les jette un peu avant
const FAIL_TTL_MS = 5 * 60_000
const BREAKER_AFTER = 3
const BREAKER_MS = 20 * 60_000 // 3 échecs de suite : Alldebrid limite probablement la clé, on coupe 20 min
const STORE_KEY = 'sf:preview-links:v1'
const STORE_MAX = 400

type Entry = { url: string | null; until: number }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<string | null>>()
let hoverChain: Promise<unknown> = Promise.resolve()
let lastHoverAt = 0
let lastWarmAt = 0
let hoverPending = 0
let warmed = 0
let failStreak = 0
let pausedUntil = 0

export type Wanted = { cancelled: boolean }

const reported = new Set<string>()
/** Durée réelle lue par le navigateur → base (une fois par titre et par session) : alimente l'affichage et le tri par durée. */
export function reportDuration(s: TypedSupabaseClient, titleId: string, seconds: number) {
  if (!UUID.test(titleId) || reported.has(titleId) || !Number.isFinite(seconds) || seconds < 60 || seconds > 86_400) return
  reported.add(titleId)
  void (s as unknown as { rpc: (n: string, a: object) => PromiseLike<unknown> }).rpc('report_title_duration', { p_title: titleId, p_seconds: Math.round(seconds) })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ───────── Cache persistant (liens valides seulement)
try {
  const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, [string, number]>
  const now = Date.now()
  for (const [id, [url, until]] of Object.entries(stored)) if (until > now && typeof url === 'string') cache.set(id, { url, until })
} catch {
  /* stockage indisponible ou corrompu */
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const now = Date.now()
      const rows = [...cache.entries()].filter(([, e]) => e.url && e.until > now).sort((a, b) => b[1].until - a[1].until).slice(0, STORE_MAX)
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(rows.map(([id, e]) => [id, [e.url, e.until]]))))
    } catch {
      /* quota plein : on garde la mémoire seulement */
    }
  }, 1500)
}

async function resolveOne(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<string | null> {
  try {
    const info = await resolveStream(s, { profileId, titleId, episodeId: null, preview: true })
    failStreak = 0
    cache.set(titleId, { url: info.url, until: Date.now() + OK_TTL_MS })
    persist()
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

/** Le lien ne marche plus (expiré) : on l'oublie pour en demander un neuf au prochain besoin. */
export function invalidatePreview(titleId: string) {
  if (cache.delete(titleId)) persist()
}

/** Survol : résolution prioritaire (aucun appel si la souris est déjà partie). */
export function getPreviewUrl(s: TypedSupabaseClient, profileId: string, titleId: string, wanted: Wanted): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const hit = cache.get(titleId)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url)
  if (Date.now() < pausedUntil) return Promise.resolve(null)

  // un préchauffage de ce même titre est déjà en route : on l'attend plutôt que de doubler l'appel
  const running = inflight.get(titleId)
  if (running) return running

  hoverPending++
  const job = hoverChain.then(async () => {
    try {
      const again = inflight.get(titleId)
      if (again) return await again
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

// ───────── Préchauffage : 3 résolutions en parallèle, dans l'ordre d'arrivée
let warmActive = 0
const warmWaiters: (() => void)[] = []
async function acquireWarm() {
  if (warmActive < WARM_PARALLEL) {
    warmActive++
    return
  }
  await new Promise<void>((r) => warmWaiters.push(r)) // le créneau est transmis tel quel
}
function releaseWarm() {
  const next = warmWaiters.shift()
  if (next) next()
  else warmActive--
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
  const job = (async () => {
    await acquireWarm()
    try {
      while (hoverPending > 0) await sleep(200) // le survol d'abord
      const again = cache.get(titleId)
      if (again && again.until > Date.now()) return again.url
      const other = inflight.get(titleId)
      if (other) return await other
      if (Date.now() < pausedUntil) return null
      const startAt = Math.max(Date.now(), lastWarmAt + WARM_GAP_MS) // créneau réservé avant d'attendre
      lastWarmAt = startAt
      const wait = startAt - Date.now()
      if (wait > 0) await sleep(wait)
      const p = resolveOne(s, profileId, titleId)
      inflight.set(titleId, p)
      try {
        return await p
      } finally {
        inflight.delete(titleId)
      }
    } finally {
      releaseWarm()
    }
  })()
  return job
}

// ───────── Cartes qui ont le droit de charger leur image figée / de jouer en silence
const AMBIENT_MAX = 4
const STILL_MAX = 14 // éléments <video> simultanés : au-delà, les connexions se bousculent et tout devient intermittent
const visibleOrder: string[] = []
const stillOrder: string[] = []
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

function toggle(list: string[], id: string, on: boolean): boolean {
  const i = list.indexOf(id)
  if (on && i < 0) list.push(id)
  else if (!on && i >= 0) list.splice(i, 1)
  else return false
  return true
}

export function setAmbientVisible(id: string, visible: boolean) {
  if (toggle(visibleOrder, id, visible)) bump()
}

/** Carte visible à l'écran : candidate au chargement de son image figée. */
export function setStillVisible(id: string, visible: boolean) {
  if (toggle(stillOrder, id, visible)) bump()
}

export function markAmbientFailed(id: string) {
  if (failed.has(id)) return
  failed.add(id)
  bump()
}

export const isAmbientSlot = (id: string) => visibleOrder.filter((x) => !failed.has(x)).slice(0, AMBIENT_MAX).includes(id)
export const isStillSlot = (id: string) => stillOrder.slice(0, STILL_MAX).includes(id)
export const getAmbientVersion = () => ambientVersion
export const subscribeAmbient = (l: () => void) => {
  ambientListeners.add(l)
  return () => void ambientListeners.delete(l)
}
