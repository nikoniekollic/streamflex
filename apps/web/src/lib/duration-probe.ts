import { useSyncExternalStore } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { resolveMany } from '@/lib/preview'
import { hasExactLength, setExactLength } from '@/lib/model-names'

// Lecture des durées RÉELLES (métadonnées de la vidéo, quelques Ko) dans le navigateur.
// L'hébergeur refuse les serveurs (HTTP 503) : c'est le navigateur des visiteurs qui lit, une seule fois par vidéo pour tout le site
// (la durée est enregistrée dans la base). Sans elle, le tri « plus longues » se fiait à une estimation d'après la taille du fichier.
//  • page d'un modèle : toutes ses vidéos sans durée sont lues, puis le tri est recalculé ;
//  • jaquettes affichées ailleurs : lues au passage (priorité basse, le survol et le lecteur passent devant).
const CHUNK = 24 // liens résolus en un seul appel serveur
// vidéos lues en même temps (l'hébergeur n'en sert qu'une dizaine à la fois) : page d'un modèle / jaquettes vues au passage
const PARALLEL_URGENT = 8
const PARALLEL_BACKGROUND = 3
const PROBE_TIMEOUT_MS = 25_000
const SESSION_MAX = 6000 // vidéos lues au plus par visite
const REPORT_EVERY_MS = 2000

/** Lit la durée d'une vidéo (métadonnées seulement). null si illisible. */
export function probeDuration(url: string | null, timeoutMs = PROBE_TIMEOUT_MS, onAbort?: (abort: () => void) => void): Promise<number | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let timer: ReturnType<typeof setTimeout>
    const end = (s: number | null) => {
      clearTimeout(timer)
      v.onloadedmetadata = null
      v.onerror = null
      v.removeAttribute('src')
      v.load()
      resolve(s)
    }
    timer = setTimeout(() => end(null), timeoutMs)
    onAbort?.(() => end(null)) // coupe la connexion tout de suite (le lecteur récupère la bande passante)
    v.onloadedmetadata = () => end(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null)
    v.onerror = () => end(null)
    v.src = url
  })
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

// ───────── File d'attente commune à tout le site
let ctx: { s: TypedSupabaseClient; profileId: string } | null = null
const urgent: string[] = [] // page d'un modèle
const background: string[] = [] // jaquettes vues au passage
const queued = new Set<string>()
const tried = new Set<string>()
const toReport = new Map<string, number>()
let pumping = false
let reportTimer: ReturnType<typeof setTimeout> | null = null
let version = 0
const listeners = new Set<() => void>()
const notify = () => {
  version++
  listeners.forEach((l) => l())
}

/** Profil actif (les liens se résolvent pour lui) ; null = lecture suspendue. */
export function setDurationContext(s: TypedSupabaseClient | null, profileId: string | null) {
  ctx = s && profileId ? { s, profileId } : null
  if (ctx) void pump()
}

/** Ajoute des vidéos à lire. `urgent` : page d'un modèle (passe devant les jaquettes vues au passage). */
export function requestDurations(ids: string[], urgentRead = false) {
  if (!ctx) return // pas d'abonnement actif / pas de profil : rien à lire
  let added = false
  for (const id of ids) {
    if (tried.has(id) || hasExactLength(id)) continue
    if (queued.has(id)) {
      if (urgentRead && !urgent.includes(id)) {
        const k = background.indexOf(id)
        if (k >= 0) background.splice(k, 1)
        urgent.push(id)
      }
      continue
    }
    if (tried.size + queued.size >= SESSION_MAX) break
    queued.add(id)
    ;(urgentRead ? urgent : background).push(id)
    added = true
  }
  if (added) void pump()
}

// ───────── Pause pendant la lecture d'une vidéo
// L'hébergeur ne sert qu'une dizaine de connexions à la fois : les lectures de durées en parallèle ralentissaient le démarrage
// et l'avance de la vidéo regardée. Dès que le lecteur s'ouvre, tout s'arrête (connexions coupées, vidéos remises en file),
// et reprend quelques secondes après sa fermeture.
const holds = new Set<symbol>()
const running = new Map<string, () => void>() // vidéo en cours de lecture de durée → coupure
const RESUME_AFTER_MS = 4000
let resumeAt = 0
let resumeWaiters: (() => void)[] = []
let resumeTimer: ReturnType<typeof setTimeout> | undefined
const isHeld = () => holds.size > 0 || Date.now() < resumeAt

/** Suspend la lecture des durées (lecteur ouvert) ; renvoie la fonction qui la libère. */
export function holdDurations(): () => void {
  const k = Symbol('hold')
  holds.add(k)
  clearTimeout(resumeTimer)
  for (const abort of running.values()) abort()
  return () => {
    if (!holds.delete(k) || holds.size) return
    resumeAt = Date.now() + RESUME_AFTER_MS
    clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      if (holds.size) return
      const w = resumeWaiters
      resumeWaiters = []
      w.forEach((r) => r())
    }, RESUME_AFTER_MS)
  }
}
const waitResume = () => new Promise<void>((r) => resumeWaiters.push(r))
/** Attend que le lecteur soit fermé (lecture complète de l'admin). */
export const waitDurationsFree = (): Promise<void> => (isHeld() ? waitResume().then(waitDurationsFree) : Promise.resolve())
let adminSeq = 0
/** Lecture d'une durée coupée automatiquement si le lecteur s'ouvre (null). */
export async function probeDurationYielding(url: string | null, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  if (isHeld()) return null
  const k = `admin:${adminSeq++}`
  const sec = await probeDuration(url, timeoutMs, (abort) => running.set(k, abort))
  running.delete(k)
  return sec
}

/** Une vidéo est-elle encore en attente / en cours de lecture ? */
export const isDurationPending = (id: string) => queued.has(id)

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (ctx && (urgent.length || background.length)) {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        await new Promise<void>((r) => {
          const on = () => {
            if (document.visibilityState !== 'visible') return
            document.removeEventListener('visibilitychange', on)
            r()
          }
          document.addEventListener('visibilitychange', on)
        })
        continue
      }
      if (isHeld()) {
        await waitResume()
        continue
      }
      const isUrgent = urgent.length > 0
      const ids = (isUrgent ? urgent : background).splice(0, CHUNK)
      const { s, profileId } = ctx
      const urls = await resolveMany(s, profileId, ids, false).catch(() => ids.map(() => null))
      await mapLimit(
        ids.map((id, i) => ({ id, url: urls[i] ?? null })),
        isUrgent ? PARALLEL_URGENT : PARALLEL_BACKGROUND,
        async (x) => {
          if (isHeld()) return requeue(x.id, isUrgent) // lecteur ouvert pendant ce lot : on n'ouvre plus rien
          let aborted = false
          const sec = hasExactLength(x.id)
            ? null
            : await probeDuration(x.url, PROBE_TIMEOUT_MS, (abort) =>
                running.set(x.id, () => {
                  aborted = true
                  abort()
                }),
              )
          running.delete(x.id)
          if (aborted) return requeue(x.id, isUrgent) // coupée pour le lecteur : relue plus tard
          tried.add(x.id)
          queued.delete(x.id)
          if (sec != null && sec >= 1 && sec <= 86_400) {
            setExactLength(x.id, sec)
            toReport.set(x.id, Math.round(sec))
            reportTimer ??= setTimeout(() => void report(), REPORT_EVERY_MS)
          }
          notify()
        },
      )
    }
  } finally {
    pumping = false
  }
}

function requeue(id: string, isUrgent: boolean) {
  ;(isUrgent ? urgent : background).unshift(id)
}

/** Enregistre tout de suite les durées lues (avant de recharger une page triée par durée). */
export function flushDurationReports(): Promise<void> {
  if (reportTimer) clearTimeout(reportTimer)
  return report()
}

async function report() {
  reportTimer = null
  if (!ctx || toReport.size === 0) return
  const items = [...toReport].slice(0, 100).map(([id, s]) => ({ id, s }))
  for (const it of items) toReport.delete(it.id)
  const { error } = await (ctx.s as unknown as { rpc: (n: string, a: object) => PromiseLike<{ error: unknown }> }).rpc('report_durations', { p_items: items })
  if (error) console.warn('[StreamFlex][durées] enregistrement impossible', error)
  if (toReport.size) reportTimer ??= setTimeout(() => void report(), REPORT_EVERY_MS)
}

/** Avancement de la lecture d'une liste de vidéos : combien restent à lire. */
export function useDurationProgress(ids: string[]): { pending: number } {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => version,
  )
  let pending = 0
  for (const id of ids) if (queued.has(id)) pending++
  return { pending }
}
