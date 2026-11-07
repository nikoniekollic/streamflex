import type { TypedSupabaseClient } from '@/lib/supabase'
import { StreamError } from '@/lib/stream'
import { DebridClientError, unlockInBrowser, type ClientDebrid } from '@/lib/alldebrid'

// Aperçus : les liens (Alldebrid, débridés dans le navigateur) sont préparés PAR LOTS pour toutes les jaquettes visibles :
//  • une seule requête serveur pour jusqu'à 12 films (au lieu d'une par jaquette),
//  • débridage 3 par 3, le survol passant toujours devant,
//  • liens gardés en mémoire ET dans le navigateur (retour sur une page = aucun nouvel appel).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BATCH = 12
const FLUSH_DELAY_MS = 120 // regroupe les jaquettes qui apparaissent ensemble
const UNLOCK_PARALLEL = 3
const UNLOCK_GAP_MS = 150
const WARM_MAX = 600 // titres préparés par session (le cache n'est pas compté)
const OK_TTL_MS = 100 * 60_000 // les liens Alldebrid valent ~2 h : on les jette un peu avant
const FAIL_TTL_MS = 5 * 60_000
const BREAKER_AFTER = 4
const BREAKER_MS = 15 * 60_000
const STORE_KEY = 'sf:preview-links:v1'
const STORE_MAX = 600

type Entry = { url: string | null; until: number }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<string | null>>()
let warmed = 0
let failStreak = 0
let pausedUntil = 0

export type Wanted = { cancelled: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const reported = new Set<string>()
/** Durée réelle lue par le navigateur → base (une fois par titre et par session) : alimente l'affichage et le tri par durée. */
export function reportDuration(s: TypedSupabaseClient, titleId: string, seconds: number) {
  if (!UUID.test(titleId) || reported.has(titleId) || !Number.isFinite(seconds) || seconds < 60 || seconds > 86_400) return
  reported.add(titleId)
  void (s as unknown as { rpc: (n: string, a: object) => PromiseLike<unknown> }).rpc('report_title_duration', { p_title: titleId, p_seconds: Math.round(seconds) })
}

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

function remember(titleId: string, url: string | null) {
  cache.set(titleId, { url, until: Date.now() + (url ? OK_TTL_MS : FAIL_TTL_MS) })
  if (url) persist()
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

// ───────── Débridage : 3 en parallèle, le survol d'abord
let unlockActive = 0
let lastUnlockAt = 0
const waitHigh: (() => void)[] = []
const waitLow: (() => void)[] = []
async function acquireUnlock(high: boolean) {
  if (unlockActive < UNLOCK_PARALLEL) {
    unlockActive++
  } else {
    await new Promise<void>((r) => (high ? waitHigh : waitLow).push(r)) // créneau transmis tel quel
  }
  const at = Math.max(Date.now(), lastUnlockAt + UNLOCK_GAP_MS)
  lastUnlockAt = at
  if (at > Date.now()) await sleep(at - Date.now())
}
function releaseUnlock() {
  const next = waitHigh.shift() ?? waitLow.shift()
  if (next) next()
  else unlockActive--
}

function noteFailure(message: string) {
  console.warn('[StreamFlex][preview] aperçu indisponible :', message)
  if (++failStreak >= BREAKER_AFTER) {
    pausedUntil = Date.now() + BREAKER_MS
    failStreak = 0
  }
}

type BatchItem = { titleId: string; sourceId: string; url: string; clientDebrid: ClientDebrid | null }

async function fetchBatch(s: TypedSupabaseClient, profileId: string, ids: string[]): Promise<BatchItem[]> {
  const { data, error } = await s.functions.invoke<{ items?: BatchItem[] }>('resolve-stream', { body: { profileId, titleIds: ids, preview: true } })
  if (error) throw new StreamError('network')
  return data?.items ?? []
}

/** Résout un lot de titres : un appel serveur, puis débridage espacé. Chaque titre finit dans `inflight` / le cache. */
function resolveBatch(s: TypedSupabaseClient, profileId: string, ids: string[], high: boolean) {
  const done = new Map<string, (u: string | null) => void>()
  for (const id of ids) inflight.set(id, new Promise<string | null>((res) => done.set(id, res)))
  const finish = (id: string, url: string | null) => {
    remember(id, url)
    done.get(id)?.(url)
    done.delete(id)
    inflight.delete(id)
  }

  void (async () => {
    let items: BatchItem[] = []
    try {
      items = await fetchBatch(s, profileId, ids)
      failStreak = 0
    } catch (e) {
      noteFailure((e as Error).message)
    }
    const byId = new Map(items.map((i) => [i.titleId, i]))
    await Promise.all(
      ids.map(async (id) => {
        const it = byId.get(id)
        if (!it) return finish(id, null)
        if (!it.clientDebrid) return finish(id, it.url || null)
        await acquireUnlock(high)
        try {
          finish(id, (await unlockInBrowser(it.clientDebrid)).url)
          failStreak = 0
        } catch (e) {
          // un fichier hors ligne n'est pas une panne d'Alldebrid : on ne coupe pas tous les aperçus pour ça
          if (!(e instanceof DebridClientError && e.failure === 'offline')) noteFailure(e instanceof Error ? e.message : 'débridage')
          finish(id, null)
        } finally {
          releaseUnlock()
        }
      }),
    )
  })()
}

// ───────── Survol : prioritaire, sans délai de regroupement
export function getPreviewUrl(s: TypedSupabaseClient, profileId: string, titleId: string, wanted: Wanted): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const hit = cache.get(titleId)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url)
  if (Date.now() < pausedUntil) return Promise.resolve(null)
  const running = inflight.get(titleId)
  if (running) return running
  const queued = pending.get(titleId)
  if (queued) {
    // déjà en attente dans le lot : on l'envoie tout de suite, seul
    pending.delete(titleId)
    resolveBatch(s, profileId, [titleId], true)
    queued.forEach((r) => void inflight.get(titleId)?.then(r))
    return inflight.get(titleId) ?? Promise.resolve(null)
  }
  if (wanted.cancelled) return Promise.resolve(null)
  resolveBatch(s, profileId, [titleId], true)
  return inflight.get(titleId) ?? Promise.resolve(null)
}

// ───────── Préchauffage : jaquettes visibles, envoyées par lots
const pending = new Map<string, ((u: string | null) => void)[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let ctx: { s: TypedSupabaseClient; profileId: string } | null = null

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (!ctx || overlayOpen) return void (pending.size && scheduleFlush(1000))
    if (Date.now() < pausedUntil) {
      for (const [id, rs] of pending) rs.forEach((r) => r(null)), pending.delete(id)
      return
    }
    const ids = [...pending.keys()].slice(0, BATCH)
    const waiters = ids.map((id) => pending.get(id) ?? [])
    ids.forEach((id) => pending.delete(id))
    if (ids.length) {
      resolveBatch(ctx.s, ctx.profileId, ids, false)
      ids.forEach((id, i) => waiters[i].forEach((r) => void inflight.get(id)?.then(r)))
    }
    if (pending.size) scheduleFlush(350)
  }, delay)
}

/** Jaquette visible : on prépare son lien (regroupé avec les autres). Renvoie le lien, ou null. */
export function warmPreview(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const known = cache.get(titleId)
  if (known && known.until > Date.now()) return Promise.resolve(known.url)
  const running = inflight.get(titleId)
  if (running) return running
  if (warmed >= WARM_MAX || Date.now() < pausedUntil) return Promise.resolve(null)
  ctx = { s, profileId }
  return new Promise((res) => {
    const list = pending.get(titleId)
    if (list) list.push(res)
    else {
      warmed++
      pending.set(titleId, [res])
    }
    scheduleFlush()
  })
}

/** La jaquette a quitté l'écran avant l'envoi du lot : on n'en demande pas le lien. */
export function cancelWarm(titleId: string) {
  const rs = pending.get(titleId)
  if (!rs) return
  pending.delete(titleId)
  warmed = Math.max(0, warmed - 1)
  rs.forEach((r) => r(null))
}

// ───────── Cartes qui ont le droit de charger leur image figée / de jouer en silence
const STILL_MAX = 16 // nouveaux éléments <video> simultanés : au-delà, les connexions se bousculent
const visibleOrder: string[] = []
const stillOrder: string[] = []
const failed = new Set<string>()
const ambientListeners = new Set<() => void>()
let ambientVersion = 0
let overlayOpen = false
const bump = () => {
  ambientVersion++
  ambientListeners.forEach((l) => l())
}

/** Lecteur plein écran ouvert : plus de lecture d'ambiance ni de préchauffage derrière. */
export function setOverlayOpen(open: boolean) {
  if (overlayOpen === open) return
  overlayOpen = open
  bump()
  if (!open && pending.size) scheduleFlush()
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

export const isAmbientSlot = (id: string, max: number) => !overlayOpen && max > 0 && visibleOrder.filter((x) => !failed.has(x)).slice(0, max).includes(id)
export const isStillSlot = (id: string) => stillOrder.slice(0, STILL_MAX).includes(id)
export const isOverlayOpen = () => overlayOpen
export const getAmbientVersion = () => ambientVersion
export const subscribeAmbient = (l: () => void) => {
  ambientListeners.add(l)
  return () => void ambientListeners.delete(l)
}
