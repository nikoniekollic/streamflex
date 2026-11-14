import { useSyncExternalStore } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { randomTitleIds } from '@/lib/playlists'
import { playedIds, resetPlayed } from '@/lib/random-history'

// File de lecture façon VK : une liste d'identifiants lue à la suite, avec lecture aléatoire, répétition,
// précédent / suivant. Gardée dans sessionStorage (survit au changement de page, pas à la fermeture de l'onglet).
export type Repeat = 'off' | 'all' | 'one'

export type Queue = {
  label: string
  /** ordre d'origine (liste telle quelle) */
  base: string[]
  /** ordre de lecture actuel */
  order: string[]
  index: number
  shuffle: boolean
  repeat: Repeat
  /** source infinie : on retire de nouveaux titres au hasard quand la fin approche */
  random: { modelId: string | null; kids: boolean } | null
  /** lecture aléatoire : chaque vidéo lancée est mémorisée pour ne pas revenir dans les listes suivantes */
  track: boolean
}

const KEY = 'sf:queue'
const REFILL_AT = 4

let queue: Queue | null = null
const listeners = new Set<() => void>()

try {
  const raw = sessionStorage.getItem(KEY)
  if (raw) queue = JSON.parse(raw) as Queue
} catch {
  /* stockage indisponible */
}

function commit(next: Queue | null) {
  queue = next
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* ignoré */
  }
  listeners.forEach((l) => l())
}

export function shuffled<T>(list: T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Démarre une file ; renvoie le premier titre à lire. */
export function startQueue(opts: { label: string; ids: string[]; shuffle?: boolean; startId?: string; random?: Queue['random']; track?: boolean }): string | null {
  const base = [...new Set(opts.ids)]
  if (base.length === 0) return null
  const shuffle = opts.shuffle ?? false
  let order = shuffle ? shuffled(base) : base
  let index = 0
  if (opts.startId && base.includes(opts.startId)) {
    // dans l'ordre : on se place sur la vidéo cliquée, les précédentes restent accessibles ; mélangé : elle passe en premier
    if (shuffle) order = [opts.startId, ...order.filter((i) => i !== opts.startId)]
    else index = base.indexOf(opts.startId)
  }
  commit({ label: opts.label, base, order, index, shuffle, repeat: 'off', random: opts.random ?? null, track: opts.track ?? false })
  return order[index]
}

export const RANDOM_LIST_SIZE = 100

/**
 * Lecture aléatoire : une liste de 100 vidéos tirées au hasard (catalogue entier ou un modèle), jamais déjà lancées
 * par « Aléatoire » sur ce profil. Si tout a été vu, l'historique repart de zéro.
 */
export async function drawRandomIds(s: TypedSupabaseClient, opts: { profileId: string; modelId?: string | null; kids?: boolean }): Promise<string[]> {
  const draw = (exclude: string[]) => randomTitleIds(s, { limit: RANDOM_LIST_SIZE, modelId: opts.modelId, kids: opts.kids, exclude })
  let ids = await draw(playedIds(opts.profileId).slice(-1500))
  if (ids.length < RANDOM_LIST_SIZE && playedIds(opts.profileId).length > 0) {
    // catalogue (presque) épuisé : on repart de zéro et on complète la liste
    resetPlayed(opts.profileId)
    const more = await draw(ids)
    ids = [...ids, ...more].slice(0, RANDOM_LIST_SIZE)
  }
  return shuffled(ids)
}

/** `ids` : liste déjà tirée (au survol du bouton) ; sinon tirage immédiat. */
export async function startRandomQueue(s: TypedSupabaseClient, opts: { profileId: string; label: string; modelId?: string | null; kids?: boolean; ids?: string[] }): Promise<string | null> {
  const ids = opts.ids?.length ? opts.ids : await drawRandomIds(s, opts)
  return startQueue({ label: opts.label, ids, shuffle: false, track: true })
}

export const getQueue = () => queue
export const stopQueue = () => commit(null)

/** Le titre affiché fait-il partie de la file ? Sinon la file est abandonnée (l'utilisateur est parti ailleurs). */
export function syncQueue(titleId: string): Queue | null {
  if (!queue) return null
  const i = queue.order.indexOf(titleId)
  if (i < 0) {
    commit(null)
    return null
  }
  if (i !== queue.index) commit({ ...queue, index: i })
  return queue
}

export function toggleShuffle() {
  if (!queue) return
  const current = queue.order[queue.index]
  if (queue.shuffle) {
    const order = queue.random ? queue.order : queue.base
    commit({ ...queue, shuffle: false, order, index: Math.max(0, order.indexOf(current)) })
  } else {
    const before = queue.order.slice(0, queue.index + 1)
    const after = shuffled(queue.order.slice(queue.index + 1))
    commit({ ...queue, shuffle: true, order: [...before, ...after] })
  }
}

export function cycleRepeat() {
  if (!queue) return
  commit({ ...queue, repeat: queue.repeat === 'off' ? 'all' : queue.repeat === 'all' ? 'one' : 'off' })
}

/** Titre suivant (null = fin de la file). « Répéter un » est géré par le lecteur lui-même (boucle). */
export async function nextInQueue(s: TypedSupabaseClient): Promise<string | null> {
  if (!queue) return null
  let q = queue
  if (q.random && q.order.length - q.index <= REFILL_AT) { // (sources infinies : plus utilisées par « Aléatoire », conservé pour d'autres usages)
    const more = await randomTitleIds(s, { limit: 30, modelId: q.random.modelId, kids: q.random.kids, exclude: q.order.slice(-200) }).catch(() => [])
    if (more.length) {
      q = { ...q, order: [...q.order, ...more], base: [...q.base, ...more] }
      commit(q)
    }
  }
  const next = q.index + 1
  if (next < q.order.length) {
    commit({ ...q, index: next })
    return q.order[next]
  }
  if (q.repeat === 'all') {
    const order = q.shuffle ? shuffled(q.base) : q.base
    commit({ ...q, order, index: 0 })
    return order[0]
  }
  return null
}

/** Saute directement à un titre de la liste (clic dans le panneau de droite). */
export function jumpInQueue(titleId: string): string | null {
  if (!queue) return null
  const i = queue.order.indexOf(titleId)
  if (i < 0) return null
  commit({ ...queue, index: i })
  return titleId
}

export function previousInQueue(): string | null {
  if (!queue || queue.index <= 0) return null
  const index = queue.index - 1
  commit({ ...queue, index })
  return queue.order[index]
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useQueue(): Queue | null {
  return useSyncExternalStore(subscribe, getQueue)
}

/**
 * Vidéo à proposer après une vidéo lue hors de toute liste (ou en fin de liste) : la vidéo suivante du même modèle
 * (plus ancienne, puis on repart de la plus récente), sinon une vidéo au hasard.
 */
export async function suggestNext(s: TypedSupabaseClient, titleId: string, kids = false): Promise<string | null> {
  const db = s as unknown as import('@supabase/supabase-js').SupabaseClient
  const { data: cur } = await db.from('titles').select('model_id, published_at').eq('id', titleId).maybeSingle()
  const row = cur as { model_id: string | null; published_at: string | null } | null
  if (row?.model_id && !kids) {
    const base = () => db.from('titles').select('id').eq('is_published', true).eq('model_id', row.model_id).neq('id', titleId)
    const older = row.published_at
      ? await base().lt('published_at', row.published_at).order('published_at', { ascending: false }).order('id').limit(1)
      : { data: null }
    const pick = (older.data as { id: string }[] | null)?.[0] ?? ((await base().order('published_at', { ascending: false }).order('id').limit(1)).data as { id: string }[] | null)?.[0]
    if (pick) return pick.id
  }
  const ids = await randomTitleIds(s, { limit: 1, kids, exclude: [titleId] }).catch(() => [])
  return ids[0] ?? null
}
