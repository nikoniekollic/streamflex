import { supabase } from '@/lib/supabase'
import { reportDuration } from '@/lib/preview'

// Réserve d'éléments <video> : chaque jaquette garde SON élément, déjà chargé et positionné sur son image, même après
// avoir quitté l'écran ou la page. Au retour, l'élément est simplement remis dans la carte : aucune relecture.
// Un même film peut figurer dans plusieurs rangées (Tendances, Films…) : chaque carte prend alors son propre élément.
//
// Chargement : au plus 12 vidéos en cours de chargement à la fois (6 connexions par hôte en HTTP/1.1, ~3 hôtes), servies
// dans l'ordre de la page (première ligne d'abord) — au-delà, tout reste en attente et les jaquettes restent noires.
// Limites adaptées à l'appareil : plus de mémoire = plus de jaquettes gardées prêtes ; connexion lente / économie de données =
// moins de chargements simultanés (chacun finit plus vite au lieu de tous traîner).
const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } }
const slowNet = !!nav.connection?.saveData || /(^|-)2g|3g/.test(nav.connection?.effectiveType ?? '')
const POOL_MAX = (nav.deviceMemory ?? 4) >= 8 ? 96 : (nav.deviceMemory ?? 4) <= 2 ? 24 : 48
const MAX_LOADING = slowNet ? 4 : 12 // mesuré : les liens Alldebrid se répartissent sur ~3 hôtes (6 connexions chacun)
const LOAD_TIMEOUT_MS = 12_000
const FRAME_WAIT_MS = 300 // attente max de l'image décodée après un saut (évite un flash noir)

export type PoolSlot = {
  titleId: string
  url: string
  el: HTMLVideoElement
  /** image prête à être montrée */
  ready: boolean
  failed: boolean
  /** début de l'extrait (secondes) */
  anchor: number
  /** durée de l'extrait en boucle */
  clip: number
  attached: boolean
  /** rang dans la page (ligne puis colonne) : plus petit = chargé en premier */
  order: number
  loading: boolean
  timer?: ReturnType<typeof setTimeout>
  /** repli si le saut vers l'instant aléatoire traîne */
  fallback?: ReturnType<typeof setTimeout>
  subs: Set<() => void>
}

// ───────── Vidéos « lentes à sauter » : instant de repli mémorisé
// Certains fichiers mettent 15 à 20 s à répondre à un saut (l'hébergeur rouvre le fichier à ce décalage). On montre alors une image
// du début déjà chargé. Cet instant est mémorisé dans le navigateur : aux visites suivantes la jaquette va directement à cette
// image (déjà dans les premiers Mo lus), sans attendre 4 s ni redemander un autre morceau du fichier.
const QUICK_KEY = 'sf:quick-frames:v1'
const QUICK_MAX = 3000
const quick = new Map<string, number>()
try {
  for (const [id, t] of Object.entries(JSON.parse(localStorage.getItem(QUICK_KEY) ?? '{}') as Record<string, number>)) if (typeof t === 'number') quick.set(id, t)
} catch {
  /* stockage indisponible */
}
let quickTimer: ReturnType<typeof setTimeout> | undefined
function rememberQuick(titleId: string, at: number) {
  quick.delete(titleId)
  quick.set(titleId, Math.round(at * 10) / 10)
  while (quick.size > QUICK_MAX) quick.delete(quick.keys().next().value as string)
  clearTimeout(quickTimer)
  quickTimer = setTimeout(() => {
    try {
      localStorage.setItem(QUICK_KEY, JSON.stringify(Object.fromEntries(quick)))
    } catch {
      /* quota plein */
    }
  }, 2000)
}

// ───────── Images figées des jaquettes (en mémoire, pour la session)
// Dès qu'une jaquette a son image, on en garde une copie réduite (ImageBitmap, ~240 px de large). Une jaquette revue
// (défilement aller-retour, retour sur une page, même film dans une autre rangée) s'affiche alors instantanément, sans
// recharger de vidéo ni occuper de connexion : la vidéo n'est relancée que pour l'aperçu animé (survol, ambiance).
// (Ces images ne peuvent pas être enregistrées : l'hébergeur n'autorise pas leur lecture par le site, seulement leur affichage.)
const SNAP_MAX = (nav.deviceMemory ?? 4) >= 8 ? 400 : (nav.deviceMemory ?? 4) <= 2 ? 80 : 220
const SNAP_W = 240
type Snap = { bm: ImageBitmap; pos: number | null }
const snaps = new Map<string, Snap>() // ordre d'insertion = LRU
const snapSubs = new Set<() => void>()
let snapVersion = 0
const canSnap = typeof window !== 'undefined' && 'createImageBitmap' in window

function takeSnap(titleId: string, el: HTMLVideoElement, pos: number | null) {
  if (!canSnap || !el.videoWidth || el.readyState < 2) return
  const cur = snaps.get(titleId)
  if (cur && (cur.pos === pos || pos == null)) return
  createImageBitmap(el, { resizeWidth: Math.min(SNAP_W, el.videoWidth), resizeQuality: 'medium' })
    .then((bm) => {
      snaps.get(titleId)?.bm.close()
      snaps.delete(titleId)
      snaps.set(titleId, { bm, pos })
      while (snaps.size > SNAP_MAX) {
        const [k, v] = snaps.entries().next().value as [string, Snap]
        v.bm.close()
        snaps.delete(k)
      }
      snapVersion++
      snapSubs.forEach((l) => l())
    })
    .catch(() => undefined) // navigateur sans prise en charge des vidéos d'un autre site : on s'en passe
}

/** Image figée déjà connue de ce film (null = aucune). */
export function peekSnap(titleId: string): ImageBitmap | null {
  const s = snaps.get(titleId)
  if (!s) return null
  snaps.delete(titleId) // récemment utilisée
  snaps.set(titleId, s)
  return s.bm
}
export const subscribeSnaps = (l: () => void) => {
  snapSubs.add(l)
  return () => void snapSubs.delete(l)
}
export const getSnapVersion = () => snapVersion

const pool = new Map<string, PoolSlot[]>() // l'ordre d'insertion sert de LRU
const waiting: PoolSlot[] = []
let loadingCount = 0

const all = () => [...pool.values()].flat()
const notify = (slot: PoolSlot) => slot.subs.forEach((l) => l())

function releaseLoad(slot: PoolSlot) {
  if (!slot.loading) return
  slot.loading = false
  clearTimeout(slot.timer)
  loadingCount--
  pump()
}

function startLoad(slot: PoolSlot) {
  slot.loading = true
  loadingCount++
  slot.el.src = slot.url
  slot.timer = setTimeout(() => releaseLoad(slot), LOAD_TIMEOUT_MS) // une vidéo lente ne bloque pas les suivantes
}

function pump() {
  // onglet en arrière-plan : on ne lance aucun nouveau chargement (reprise au retour)
  if (typeof document !== 'undefined' && document.hidden) return
  while (loadingCount < MAX_LOADING && waiting.length) {
    waiting.sort((a, b) => a.order - b.order)
    startLoad(waiting.shift()!)
  }
}

function destroy(slot: PoolSlot) {
  const i = waiting.indexOf(slot)
  if (i >= 0) waiting.splice(i, 1)
  releaseLoad(slot)
  clearTimeout(slot.fallback)
  slot.el.pause()
  slot.el.removeAttribute('src')
  slot.el.load()
  slot.el.remove()
  const list = pool.get(slot.titleId)?.filter((s) => s !== slot) ?? []
  if (list.length) pool.set(slot.titleId, list)
  else pool.delete(slot.titleId)
}

function evict() {
  let total = all().length
  for (const slot of all()) {
    if (total <= POOL_MAX) break
    if (!slot.attached) {
      destroy(slot)
      total--
    }
  }
}

/** Une vidéo déjà prête (et libre) existe-t-elle pour ce film ? */
export const peekSlot = (titleId: string, url: string | null): PoolSlot | null =>
  (url && pool.get(titleId)?.find((s) => s.url === url && !s.attached && !s.failed)) || null

/** Élément pour une jaquette : un élément libre déjà chargé, sinon un nouveau. */
export function acquireSlot(titleId: string, url: string, clip: number, order = 0, coverPos: number | null = null): PoolSlot {
  const list = pool.get(titleId) ?? []
  // éléments d'une ancienne URL (lien expiré) : jetés
  for (const old of list.filter((s) => s.url !== url && !s.attached)) destroy(old)
  const free = (pool.get(titleId) ?? []).find((s) => s.url === url && !s.attached)
  if (free) {
    free.clip = clip
    free.order = order
    const l = pool.get(titleId)!.filter((s) => s !== free)
    pool.set(titleId, [...l, free]) // le plus récemment utilisé
    return free
  }

  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'metadata'
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', background: '#000' })

  const slot: PoolSlot = { titleId, url, el, ready: false, failed: false, anchor: 0, clip, attached: false, order, loading: false, subs: new Set() }
  const markReady = () => {
    if (slot.ready || slot.failed) return
    slot.ready = true
    takeSnap(titleId, el, coverPos)
    notify(slot)
  }
  const done = () => {
    clearTimeout(slot.fallback)
    releaseLoad(slot)
    if (slot.ready) return
    // on attend que l'image du nouvel instant soit réellement décodée : sinon la jaquette apparaît noire un instant
    const v = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    if (v.requestVideoFrameCallback && el.isConnected) {
      v.requestVideoFrameCallback(markReady)
      setTimeout(markReady, FRAME_WAIT_MS)
    } else markReady()
  }

  el.addEventListener('loadedmetadata', () => {
    const d = el.duration
    reportDuration(supabase, titleId, d)
    // vidéo déjà connue comme lente à sauter : directement l'image mémorisée (dans le début déjà chargé)
    const known = quick.get(titleId)
    if (known != null && Number.isFinite(d) && known < d) {
      el.currentTime = known
      return
    }
    // instant aléatoire, assez tôt pour qu'il reste de quoi remplir l'extrait
    if (Number.isFinite(d) && d > slot.clip * 2) {
      // moment enregistré par l'admin (jaquette stable) ; à défaut, un instant au hasard
      el.currentTime = Math.min(d * (coverPos ?? 0.1 + Math.random() * 0.7), d - slot.clip - 1)
      // Mesuré : certains fichiers mettent 15 à 20 s à répondre à un saut (l'hébergeur rouvre le fichier à ce décalage).
      // Au bout de 4 s on montre ce qui est déjà tamponné (le début du fichier) au lieu de laisser la jaquette sans image.
      slot.fallback = setTimeout(() => {
        if (slot.ready || !el.buffered.length) return
        slot.anchor = Math.max(0, el.buffered.end(0) - 0.3)
        rememberQuick(titleId, slot.anchor)
        el.currentTime = slot.anchor
      }, 4000)
    } else done()
  })
  el.addEventListener('seeked', () => {
    slot.anchor = el.currentTime
    done()
  })
  el.addEventListener('timeupdate', () => {
    if (!el.paused && el.currentTime >= slot.anchor + slot.clip) el.currentTime = slot.anchor
  })
  el.addEventListener('ended', () => {
    el.currentTime = slot.anchor
    void el.play().catch(() => undefined)
  })
  el.addEventListener('error', () => {
    console.warn('[StreamFlex][preview] la vidéo ne se charge pas', titleId)
    slot.failed = true
    releaseLoad(slot)
    notify(slot)
  })

  pool.set(titleId, [...list, slot])
  waiting.push(slot)
  pump()
  evict()
  return slot
}

export function attachSlot(slot: PoolSlot, host: HTMLElement) {
  if (slot.el.parentElement !== host) host.appendChild(slot.el)
  slot.attached = true
}

export function detachSlot(slot: PoolSlot) {
  // pas encore prête : on libère tout de suite sa place de chargement (sinon une jaquette déjà sortie de l'écran retarde
  // jusqu'à 12 s celles qui sont visibles) ; le lien reste en cache, la recréer au retour ne coûte rien
  if (!slot.ready) return destroy(slot)
  slot.el.pause()
  slot.attached = false // l'élément reste en mémoire, hors de la page
  slot.el.remove()
  evict()
}

export function dropSlot(slot: PoolSlot) {
  destroy(slot)
}

// retour sur l'onglet : les chargements mis en attente repartent
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => !document.hidden && pump())
