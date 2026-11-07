import { supabase } from '@/lib/supabase'
import { reportDuration } from '@/lib/preview'

// Réserve d'éléments <video> : chaque jaquette garde SON élément, déjà chargé et positionné sur son image, même après
// avoir quitté l'écran ou la page. Au retour, l'élément est simplement remis dans la carte : aucune relecture.
const POOL_MAX = 40

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
  subs: Set<() => void>
}

const pool = new Map<string, PoolSlot>() // l'ordre d'insertion sert de LRU

function notify(slot: PoolSlot) {
  slot.subs.forEach((l) => l())
}

function destroy(slot: PoolSlot) {
  slot.el.pause()
  slot.el.removeAttribute('src')
  slot.el.load()
  slot.el.remove()
  pool.delete(slot.titleId)
}

function evict() {
  for (const slot of pool.values()) {
    if (pool.size <= POOL_MAX) break
    if (!slot.attached) destroy(slot)
  }
}

export const peekSlot = (titleId: string, url: string | null): PoolSlot | null => {
  const s = pool.get(titleId)
  return s && url && s.url === url && !s.failed ? s : null
}

/** Élément de cette jaquette (créé au besoin). */
export function acquireSlot(titleId: string, url: string, clip: number): PoolSlot {
  const existing = pool.get(titleId)
  if (existing && existing.url === url) {
    existing.clip = clip
    pool.delete(titleId) // remis en queue : le plus récemment utilisé
    pool.set(titleId, existing)
    return existing
  }
  if (existing) destroy(existing)

  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'metadata'
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', background: '#000' })

  const slot: PoolSlot = { titleId, url, el, ready: false, failed: false, anchor: 0, clip, attached: false, subs: new Set() }

  el.addEventListener('loadedmetadata', () => {
    const d = el.duration
    reportDuration(supabase, titleId, d)
    // instant aléatoire, assez tôt pour qu'il reste de quoi remplir l'extrait
    if (Number.isFinite(d) && d > slot.clip * 2) el.currentTime = Math.min(d * (0.1 + Math.random() * 0.7), d - slot.clip - 1)
    else if (!slot.ready) {
      slot.ready = true
      notify(slot)
    }
  })
  el.addEventListener('seeked', () => {
    slot.anchor = el.currentTime
    if (!slot.ready) {
      slot.ready = true
      notify(slot)
    }
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
    notify(slot)
  })

  el.src = url
  pool.set(titleId, slot)
  evict()
  return slot
}

export function attachSlot(slot: PoolSlot, host: HTMLElement) {
  if (slot.el.parentElement !== host) host.appendChild(slot.el)
  slot.attached = true
}

export function detachSlot(slot: PoolSlot) {
  slot.el.pause()
  slot.attached = false // l'élément reste dans le DOM détaché de sa carte : gardé en mémoire
  slot.el.remove()
  evict()
}

export function dropSlot(titleId: string) {
  const s = pool.get(titleId)
  if (s) destroy(s)
}
