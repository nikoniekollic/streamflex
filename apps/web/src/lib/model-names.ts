import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'

// Nom du modèle de chaque jaquette : les requêtes du catalogue ne renvoient pas model_id,
// on le récupère par lots (1 requête pour ~150 cartes) + la table des modèles chargée une seule fois.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nameOfTitle = new Map<string, string | null>()
const listeners = new Set<() => void>()
let version = 0
let modelsPromise: Promise<Map<string, string>> | null = null
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

const notify = () => {
  version++
  listeners.forEach((l) => l())
}

function loadModels(): Promise<Map<string, string>> {
  modelsPromise ??= (async () => {
    const map = new Map<string, string>()
    for (let off = 0; off < 20_000; off += 1000) {
      const { data, error } = await supabase.from('models').select('id, name').range(off, off + 999)
      if (error) {
        modelsPromise = null // on réessaiera
        break
      }
      for (const m of data ?? []) map.set(m.id, m.name)
      if ((data?.length ?? 0) < 1000) break
    }
    return map
  })()
  return modelsPromise
}

async function flush() {
  timer = null
  const ids = [...queue]
  queue.clear()
  if (ids.length === 0) return
  const models = await loadModels()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const { data, error } = await supabase.from('titles').select('id, model_id').in('id', chunk)
    if (error) continue
    const found = new Map((data ?? []).map((r) => [r.id, r.model_id]))
    for (const id of chunk) {
      const mid = found.get(id)
      nameOfTitle.set(id, mid ? (models.get(mid) ?? null) : null)
    }
  }
  notify()
}

function request(id: string) {
  if (nameOfTitle.has(id) || queue.has(id)) return
  if (!UUID.test(id)) {
    nameOfTitle.set(id, null)
    return
  }
  queue.add(id)
  timer ??= setTimeout(() => void flush(), 60)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Nom du modèle rattaché au titre (null si aucun / pas encore chargé). */
export function useModelName(titleId: string): string | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => request(titleId), [titleId])
  return nameOfTitle.get(titleId) ?? null
}
