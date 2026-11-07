import type { CatalogTitle } from '@/lib/catalog'

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

type Order = { column: 'published_at' | 'runtime_minutes' | 'title'; ascending: boolean; nullsFirst?: boolean }

/** Ordre SQL (Supabase) : les valeurs absentes (durée inconnue…) passent toujours en dernier. */
export function orderSpec(sort: SortKey | undefined): Order[] {
  switch (sort) {
    case 'old':
      return [{ column: 'published_at', ascending: true, nullsFirst: false }]
    case 'longest':
      return [{ column: 'runtime_minutes', ascending: false, nullsFirst: false }, { column: 'published_at', ascending: false, nullsFirst: false }]
    case 'shortest':
      return [{ column: 'runtime_minutes', ascending: true, nullsFirst: false }, { column: 'published_at', ascending: false, nullsFirst: false }]
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
export function sortTitles<T extends CatalogTitle>(list: T[], sort: SortKey | undefined): T[] {
  if (!sort) return list
  const byDate = (a: T, b: T, asc: boolean) => cmpNum(time(a), time(b), asc)
  const out = [...list]
  switch (sort) {
    case 'recent':
      return out.sort((a, b) => byDate(a, b, false))
    case 'old':
      return out.sort((a, b) => byDate(a, b, true))
    case 'longest':
      return out.sort((a, b) => cmpNum(a.runtime_minutes, b.runtime_minutes, false) || byDate(a, b, false))
    case 'shortest':
      return out.sort((a, b) => cmpNum(a.runtime_minutes, b.runtime_minutes, true) || byDate(a, b, false))
    case 'az':
      return out.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true }))
    case 'za':
      return out.sort((a, b) => b.title.localeCompare(a.title, 'fr', { sensitivity: 'base', numeric: true }))
  }
}
