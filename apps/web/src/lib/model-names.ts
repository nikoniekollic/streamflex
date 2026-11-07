import { useEffect, useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// Nom du modèle de chaque jaquette : les requêtes du catalogue ne renvoient pas model_id,
// on le récupère par lots (1 requête pour ~150 cartes) + la table des modèles chargée une seule fois.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nameOfTitle = new Map<string, string | null>()
/** minutes : durée réelle si connue, sinon estimée d'après la taille du fichier (estimated = true) */
export type TitleLength = { minutes: number; estimated: boolean }
const lengthOfTitle = new Map<string, TitleLength | null>()
/** moment (fraction de la durée) de l'image de la jaquette, null = au hasard */
const coverOfTitle = new Map<string, number | null>()
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
    const { data, error } = await (supabase as unknown as SupabaseClient).from('titles').select('id, model_id, runtime_minutes, len_key, cover_pos').in('id', chunk)
    if (error) continue
    type Row = { id: string; model_id: string | null; runtime_minutes: number | null; len_key: number | null; cover_pos: number | null }
    const found = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]))
    for (const id of chunk) {
      const r = found.get(id)
      nameOfTitle.set(id, r?.model_id ? (models.get(r.model_id) ?? null) : null)
      const minutes = r?.runtime_minutes ?? (r?.len_key ? Math.max(1, Math.round(r.len_key)) : null)
      lengthOfTitle.set(id, minutes ? { minutes, estimated: r?.runtime_minutes == null } : null)
      coverOfTitle.set(id, r?.cover_pos ?? null)
    }
  }
  notify()
}

function request(id: string) {
  if (nameOfTitle.has(id) || queue.has(id)) return
  if (!UUID.test(id)) {
    nameOfTitle.set(id, null)
    lengthOfTitle.set(id, null)
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

/** Durée du titre (réelle ou estimée), chargée par lots avec le nom du modèle. */
export function useTitleLength(titleId: string, known?: number | null): TitleLength | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => (known ? undefined : request(titleId)), [titleId, known])
  if (known) return { minutes: known, estimated: false }
  return lengthOfTitle.get(titleId) ?? null
}

/** 95 min → « 1 h 35 », 42 min → « 42 min » */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`
}

/** Moment de l'image de la jaquette (fraction de la durée), chargé par lots avec le nom du modèle. */
export function useCoverPos(titleId: string): number | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => request(titleId), [titleId])
  return coverOfTitle.get(titleId) ?? null
}
