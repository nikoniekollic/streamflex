import type { TypedSupabaseClient } from '@/lib/supabase'
import { StreamError } from '@/lib/stream'
import { DebridClientError, unlockInBrowser, type ClientDebrid } from '@/lib/alldebrid'
import { shareLink } from '@/lib/shared-links'
import { hasExactLength, setExactLength } from '@/lib/model-names'

// Aperçus : les liens (Alldebrid, débridés dans le navigateur) sont préparés PAR VAGUES DE 6 jaquettes, de la première ligne
// à la dernière (ordre de la page) :
//  • une seule requête serveur par vague (au lieu d'une par jaquette),
//  • débridage 3 par 3, le survol et le lecteur passant toujours devant,
//  • budget Alldebrid : limite officielle 12 requêtes/s et 600/min → on reste à 240/min pour les aperçus,
//  • liens gardés en mémoire ET dans le navigateur (retour sur une page = aucun nouvel appel).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BATCH = 24 // une requête serveur prépare jusqu'à 24 films (le coût fixe d'un appel est ~0,6 s)
const UNLOCK_BUDGET_PER_MIN = 360 // 60 % de la limite d'Alldebrid (600/min) : le lecteur garde de la marge
const FLUSH_DELAY_MS = 150 // regroupe les jaquettes qui apparaissent ensemble
const UNLOCK_PARALLEL = 8 // mesuré le 8 nov. : 1 en parallèle = 1,5 lien/s, 3 = 2,4/s, 6 = 5,5/s (aucune sérialisation) ; limite d'Alldebrid : 12/s
const UNLOCK_GAP_MS = 80
const WARM_MAX = 600 // titres préparés par session (le cache n'est pas compté)
const OK_TTL_MS = 100 * 60_000 // les liens Alldebrid valent ~2 h : on les jette un peu avant
const FAIL_TTL_MS = 5 * 60_000
const BREAKER_AFTER = 4
const BREAKER_MS = 15 * 60_000
const STORE_KEY = 'sf:preview-links:v1'
const STORE_MAX = 600

export type PreviewMeta = { quality: string; qualities: string[] }
type Entry = { url: string | null; until: number; meta?: PreviewMeta }
const stale = new Set<string>()
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
  if (!UUID.test(titleId) || reported.has(titleId) || !Number.isFinite(seconds) || seconds < 5 || seconds > 86_400) return
  reported.add(titleId)
  if (hasExactLength(titleId)) return // la base la connaît déjà à la seconde
  setExactLength(titleId, seconds) // affichée tout de suite sur les jaquettes
  void (s as unknown as { rpc: (n: string, a: object) => PromiseLike<unknown> }).rpc('report_title_duration', { p_title: titleId, p_seconds: Math.round(seconds) })
}

// ───────── Cache persistant (liens valides seulement)
try {
  const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, [string, number, PreviewMeta?]>
  const now = Date.now()
  for (const [id, [url, until, meta]] of Object.entries(stored)) if (until > now && typeof url === 'string') cache.set(id, { url, until, meta })
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
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(rows.map(([id, e]) => [id, [e.url, e.until, e.meta]]))))
    } catch {
      /* quota plein : on garde la mémoire seulement */
    }
  }, 1500)
}

function remember(titleId: string, url: string | null, meta?: PreviewMeta) {
  cache.set(titleId, { url, until: Date.now() + (url ? OK_TTL_MS : FAIL_TTL_MS), meta })
  if (url) persist()
}

/** Lien déjà connu (null = inconnu ou indisponible). */
export const peekPreviewUrl = (titleId: string): string | null => {
  const hit = cache.get(titleId)
  return hit && hit.until > Date.now() ? hit.url : null
}

/** Qualités connues du film (avec le lien d'aperçu) ; undefined = inconnues. */
export const peekPreviewMeta = (titleId: string): PreviewMeta | undefined => {
  const hit = cache.get(titleId)
  return hit && hit.until > Date.now() ? hit.meta : undefined
}

/** Le lien ne marche plus (expiré) : on l'oublie pour en demander un neuf au prochain besoin. */
export function invalidatePreview(titleId: string) {
  stale.add(titleId) // le lien partagé de ce film est peut-être mort : prochaine demande = nouveau débridage, qui le remplace
  if (cache.delete(titleId)) persist()
}

// ───────── Débridage : 3 en parallèle, le survol d'abord
let unlockActive = 0
let lastUnlockAt = 0
const unlockTimes: number[] = []
let rateLimitedUntil = 0
const waitHigh: (() => void)[] = []
const waitLow: { order: number; go: () => void }[] = []
async function acquireUnlock(high: boolean, order = 0) {
  if (unlockActive < UNLOCK_PARALLEL) {
    unlockActive++
  } else {
    // créneau transmis tel quel ; les aperçus passent dans l'ordre de la page (première ligne d'abord)
    await new Promise<void>((go) => (high ? waitHigh.push(go) : waitLow.push({ order, go })))
  }
  // budget par minute (les aperçus seulement : le survol passe devant)
  const now = Date.now()
  while (unlockTimes.length && unlockTimes[0] < now - 60_000) unlockTimes.shift()
  let at = Math.max(now, lastUnlockAt + UNLOCK_GAP_MS, rateLimitedUntil)
  if (!high && unlockTimes.length >= UNLOCK_BUDGET_PER_MIN) at = Math.max(at, unlockTimes[0] + 60_000)
  lastUnlockAt = at
  unlockTimes.push(at)
  if (at > Date.now()) await sleep(at - Date.now())
}
function releaseUnlock() {
  const hi = waitHigh.shift()
  if (hi) return hi()
  if (waitLow.length) {
    let best = 0
    for (let i = 1; i < waitLow.length; i++) if (waitLow[i].order < waitLow[best].order) best = i
    return waitLow.splice(best, 1)[0].go()
  }
  unlockActive--
}

function noteFailure(message: string) {
  console.warn('[StreamFlex][preview] aperçu indisponible :', message)
  if (message === 'RATE_LIMIT') {
    rateLimitedUntil = Date.now() + 45_000 // Alldebrid répond 429/503 : on lève le pied 45 s
    return
  }
  if (++failStreak >= BREAKER_AFTER) {
    pausedUntil = Date.now() + BREAKER_MS
    failStreak = 0
  }
}

type BatchItem = { titleId: string; sourceId: string; url: string; clientDebrid: ClientDebrid | null; quality?: string; qualities?: string[] }

async function fetchBatch(s: TypedSupabaseClient, profileId: string, ids: string[]): Promise<BatchItem[]> {
  const refreshIds = ids.filter((id) => stale.has(id))
  const { data, error } = await s.functions.invoke<{ items?: BatchItem[] }>('resolve-stream', { body: { profileId, titleIds: ids, preview: true, ...(refreshIds.length ? { refreshIds } : {}) } })
  if (error) throw new StreamError('network')
  return data?.items ?? []
}

/** Résout un lot de titres : un appel serveur, puis débridage espacé. Chaque titre finit dans `inflight` / le cache. */
function resolveBatch(s: TypedSupabaseClient, profileId: string, ids: string[], high: boolean, orders?: Map<string, number>) {
  const done = new Map<string, (u: string | null) => void>()
  for (const id of ids) inflight.set(id, new Promise<string | null>((res) => done.set(id, res)))
  const finish = (id: string, url: string | null, meta?: PreviewMeta) => {
    remember(id, url, meta)
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
        const meta = it.quality ? { quality: it.quality, qualities: it.qualities ?? [it.quality] } : undefined
        if (!it.clientDebrid) return finish(id, it.url || null, meta)
        await acquireUnlock(high, orders?.get(id) ?? 0)
        try {
          const unlocked = (await unlockInBrowser(it.clientDebrid)).url
          shareLink(s, id, unlocked, stale.delete(id)) // dépôt dans le cache partagé : les autres abonnés n'auront rien à débrider
          finish(id, unlocked, meta)
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

/** Liens de plusieurs films d'un coup (montage d'un modèle) : une requête serveur, résultats dans l'ordre demandé. */
export function resolveMany(s: TypedSupabaseClient, profileId: string, ids: string[]): Promise<(string | null)[]> {
  const fresh = (id: string) => (cache.get(id)?.until ?? 0) > Date.now()
  const missing = ids.filter((id) => UUID.test(id) && !fresh(id) && !inflight.has(id))
  if (missing.length && Date.now() >= pausedUntil) resolveBatch(s, profileId, missing, true)
  return Promise.all(ids.map((id) => peekPreviewUrl(id) ?? inflight.get(id) ?? Promise.resolve(null)))
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
    queued.resolvers.forEach((r) => void inflight.get(titleId)?.then(r))
    return inflight.get(titleId) ?? Promise.resolve(null)
  }
  if (wanted.cancelled) return Promise.resolve(null)
  resolveBatch(s, profileId, [titleId], true)
  return inflight.get(titleId) ?? Promise.resolve(null)
}

// ───────── Préchauffage : jaquettes visibles, envoyées par lots
const pending = new Map<string, { resolvers: ((u: string | null) => void)[]; order: number }>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let ctx: { s: TypedSupabaseClient; profileId: string } | null = null

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    // (le lecteur ouvert ne coupe plus la préparation : les images de la liste de lecture à droite en dépendent)
    if (!ctx) return
    if (Date.now() < pausedUntil) {
      for (const [id, p] of pending) p.resolvers.forEach((r) => r(null)), pending.delete(id)
      return
    }
    // première ligne d'abord, puis la suivante… (ordre de la page, de gauche à droite)
    const picked = [...pending.entries()].sort((a, b) => a[1].order - b[1].order).slice(0, BATCH)
    const ids = picked.map(([id]) => id)
    const orders = new Map(picked.map(([id, p]) => [id, p.order]))
    const waiters = picked.map(([, p]) => p.resolvers)
    ids.forEach((id) => pending.delete(id))
    if (ids.length) {
      resolveBatch(ctx.s, ctx.profileId, ids, false, orders)
      ids.forEach((id, i) => waiters[i].forEach((r) => void inflight.get(id)?.then(r)))
    }
    if (pending.size) scheduleFlush(120)
  }, delay)
}

/** Jaquette visible : on prépare son lien (regroupé avec les autres). Renvoie le lien, ou null. */
export function warmPreview(s: TypedSupabaseClient, profileId: string, titleId: string, order = 0): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const known = cache.get(titleId)
  if (known && known.until > Date.now()) return Promise.resolve(known.url)
  const running = inflight.get(titleId)
  if (running) return running
  if (warmed >= WARM_MAX || Date.now() < pausedUntil) return Promise.resolve(null)
  ctx = { s, profileId }
  return new Promise((res) => {
    const list = pending.get(titleId)
    if (list) list.resolvers.push(res)
    else {
      warmed++
      pending.set(titleId, { resolvers: [res], order })
    }
    scheduleFlush()
  })
}

/** La jaquette a quitté l'écran avant l'envoi du lot : on n'en demande pas le lien. */
export function cancelWarm(titleId: string) {
  const p = pending.get(titleId)
  if (!p) return
  pending.delete(titleId)
  warmed = Math.max(0, warmed - 1)
  p.resolvers.forEach((r) => r(null))
}

// ───────── Cartes qui ont le droit de charger leur image figée / de jouer en silence
const STILL_MAX = 24 // jaquettes autorisées à garder une vidéo ; le chargement, lui, passe 6 par 6 (lib/video-pool)
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
