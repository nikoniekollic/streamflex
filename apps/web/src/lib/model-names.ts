import { useEffect, useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// Nom du modèle de chaque jaquette : les requêtes du catalogue ne renvoient pas model_id,
// on le récupère par lots (1 requête pour ~150 cartes) + la table des modèles chargée une seule fois.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nameOfTitle = new Map<string, string | null>()
const modelIdOfTitle = new Map<string, string | null>()
const emojiOfModel = new Map<string, string | null>()
/** durée réelle du fichier en secondes (exact = à la seconde ; sinon minutes enregistrées, jamais une estimation) */
export type TitleLength = { seconds: number; exact: boolean }
const lengthOfTitle = new Map<string, TitleLength | null>()

/** Durée réelle lue dans la vidéo : mise à jour immédiate des jaquettes concernées. */
export function setExactLength(id: string, seconds: number) {
  lengthOfTitle.set(id, { seconds: Math.round(seconds), exact: true })
  notify()
}
export const hasExactLength = (id: string) => lengthOfTitle.get(id)?.exact === true
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
      const { data, error } = await (supabase as unknown as SupabaseClient).from('models').select('id, name, emoji').range(off, off + 999)
      if (error) {
        modelsPromise = null // on réessaiera
        break
      }
      for (const m of (data ?? []) as { id: string; name: string; emoji: string | null }[]) {
        map.set(m.id, m.name)
        emojiOfModel.set(m.id, m.emoji ?? null)
      }
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
    const { data, error } = await (supabase as unknown as SupabaseClient).from('titles').select('id, model_id, runtime_minutes, duration_s, cover_pos').in('id', chunk)
    if (error) {
      for (const id of chunk) coverOfTitle.set(id, null) // ne bloque pas les aperçus : moment au hasard
      continue
    }
    type Row = { id: string; model_id: string | null; runtime_minutes: number | null; duration_s: number | null; cover_pos: number | null }
    const found = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]))
    for (const id of chunk) {
      const r = found.get(id)
      nameOfTitle.set(id, r?.model_id ? (models.get(r.model_id) ?? null) : null)
      modelIdOfTitle.set(id, r?.model_id ?? null)
      // durée lue dans la vidéo pendant cette session : plus récente que la base
      if (lengthOfTitle.get(id)?.exact) {
        /* déjà exacte */
      } else if (r?.duration_s) lengthOfTitle.set(id, { seconds: r.duration_s, exact: true })
      else if (r?.runtime_minutes) lengthOfTitle.set(id, { seconds: r.runtime_minutes * 60, exact: false })
      else lengthOfTitle.set(id, null)
      coverOfTitle.set(id, r?.cover_pos ?? null)
    }
  }
  notify()
}

function request(id: string) {
  if (nameOfTitle.has(id) || queue.has(id)) return
  if (!UUID.test(id)) {
    nameOfTitle.set(id, null)
    modelIdOfTitle.set(id, null)
    lengthOfTitle.set(id, null)
    coverOfTitle.set(id, null)
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

/** Durée réelle du titre (jamais estimée), chargée par lots avec le nom du modèle puis précisée à la seconde dès que la vidéo est lue. */
export function useTitleLength(titleId: string, known?: number | null): TitleLength | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => request(titleId), [titleId])
  const l = lengthOfTitle.get(titleId)
  if (l) return l
  return known ? { seconds: known * 60, exact: false } : null
}

/** 95 min → « 1 h 35 », 42 min → « 42 min » */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`
}

/** Durée affichée sur les jaquettes : « 1:23:45 » (horloge) ou « 1 h 23 min 45 s » (texte). */
export function formatDuration(seconds: number, style: 'clock' | 'text' = 'clock'): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  // moins d'une minute : les secondes seules (« 45 s »), pour distinguer d'un coup d'œil les fichiers courts des longs
  if (s < 60) return `${s} s`
  if (style === 'text') return h ? `${h} h ${p(m)} min ${p(r)} s` : `${m} min ${p(r)} s`
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`
}

/** Moment de l'image de la jaquette (fraction de la durée), chargé par lots avec le nom du modèle. */
/** undefined = pas encore chargé (l'aperçu attend, pour se placer tout de suite au bon moment) ; null = aucun moment enregistré. */
export function useCoverPos(titleId: string): number | null | undefined {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => request(titleId), [titleId])
  return coverOfTitle.has(titleId) ? coverOfTitle.get(titleId) : undefined
}

export type ModelInfo = { id: string; name: string; emoji: string | null }

/** Modèle du titre (id, nom, emoji propre), chargé par lots avec le reste ; null = aucun / pas encore chargé. */
export function useModelInfo(titleId: string): ModelInfo | null {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => request(titleId), [titleId])
  const id = modelIdOfTitle.get(titleId)
  const name = nameOfTitle.get(titleId)
  return id && name ? { id, name, emoji: emojiOfModel.get(id) ?? null } : null
}
