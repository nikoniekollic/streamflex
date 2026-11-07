import { useSyncExternalStore } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { randomTitleIds } from '@/lib/playlists'

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
export function startQueue(opts: { label: string; ids: string[]; shuffle?: boolean; startId?: string; random?: Queue['random'] }): string | null {
  const base = [...new Set(opts.ids)]
  if (base.length === 0) return null
  const shuffle = opts.shuffle ?? false
  let order = shuffle ? shuffled(base) : base
  if (opts.startId && base.includes(opts.startId)) order = [opts.startId, ...order.filter((i) => i !== opts.startId)]
  commit({ label: opts.label, base, order, index: 0, shuffle, repeat: 'off', random: opts.random ?? null })
  return order[0]
}

/** Lecture aléatoire infinie (catalogue entier ou un modèle). */
export async function startRandomQueue(s: TypedSupabaseClient, opts: { label: string; modelId?: string | null; kids?: boolean }): Promise<string | null> {
  const ids = await randomTitleIds(s, { limit: 30, modelId: opts.modelId, kids: opts.kids })
  return startQueue({ label: opts.label, ids, shuffle: false, random: { modelId: opts.modelId ?? null, kids: !!opts.kids } })
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
  if (q.random && q.order.length - q.index <= REFILL_AT) {
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
