import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogTitle } from '@/lib/catalog'
import type { TypedSupabaseClient } from '@/lib/supabase'

// Tris proposés partout (catalogue, recherche, page d'un modèle, accueil)
export type SortKey = 'recent' | 'old' | 'longest' | 'shortest' | 'az' | 'za'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Plus récent' },
  { value: 'old', label: 'Plus ancien' },
  { value: 'longest', label: 'Plus long' },
  { value: 'shortest', label: 'Plus court' },
  { value: 'az', label: 'Titre A → Z' },
  { value: 'za', label: 'Titre Z → A' },
]

export const validSort = (v: unknown): SortKey | undefined => (SORT_OPTIONS.some((o) => o.value === v) ? (v as SortKey) : undefined)

type Order = { column: 'published_at' | 'len_key' | 'title'; ascending: boolean; nullsFirst?: boolean }

/** Ordre SQL (Supabase) : les valeurs absentes (durée inconnue…) passent toujours en dernier. */
export function orderSpec(sort: SortKey | undefined): Order[] {
  switch (sort) {
    case 'old':
      return [{ column: 'published_at', ascending: true, nullsFirst: false }]
    case 'longest':
      return [{ column: 'len_key', ascending: false, nullsFirst: false }, { column: 'published_at', ascending: false, nullsFirst: false }]
    case 'shortest':
      return [{ column: 'len_key', ascending: true, nullsFirst: false }, { column: 'published_at', ascending: false, nullsFirst: false }]
    case 'az':
      return [{ column: 'title', ascending: true }]
    case 'za':
      return [{ column: 'title', ascending: false }]
    default:
      return [{ column: 'published_at', ascending: false, nullsFirst: false }]
  }
}

const cmpNum = (a: number | null, b: number | null, asc: boolean) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : asc ? a - b : b - a)
const time = (t: CatalogTitle) => (t.published_at ? Date.parse(t.published_at) : null)

/** Même tri, côté navigateur (rangées de l'accueil, résultats d'une recherche). */
export const isDurationSort = (s: SortKey | undefined) => s === 'longest' || s === 'shortest'

/** Durée (réelle ou estimée) des titres, pour trier des listes que la base n'a pas ordonnées elle-même. */
export async function fetchLengths(supabase: TypedSupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const db = supabase as unknown as SupabaseClient
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from('titles').select('id, len_key').in('id', ids.slice(i, i + 100))
    for (const r of (data ?? []) as { id: string; len_key: number | null }[]) if (r.len_key != null) out.set(r.id, r.len_key)
  }
  return out
}

export function sortTitles<T extends CatalogTitle>(list: T[], sort: SortKey | undefined, lens?: Map<string, number>): T[] {
  if (!sort) return list
  const len = (t: T) => lens?.get(t.id) ?? t.runtime_minutes
  const byDate = (a: T, b: T, asc: boolean) => cmpNum(time(a), time(b), asc)
  const out = [...list]
  switch (sort) {
    case 'recent':
      return out.sort((a, b) => byDate(a, b, false))
    case 'old':
      return out.sort((a, b) => byDate(a, b, true))
    case 'longest':
      return out.sort((a, b) => cmpNum(len(a), len(b), false) || byDate(a, b, false))
    case 'shortest':
      return out.sort((a, b) => cmpNum(len(a), len(b), true) || byDate(a, b, false))
    case 'az':
      return out.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true }))
    case 'za':
      return out.sort((a, b) => b.title.localeCompare(a.title, 'fr', { sensitivity: 'base', numeric: true }))
  }
}
