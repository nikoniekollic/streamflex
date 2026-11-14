import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import { queryVideos, type VideoFilters } from '@/lib/search'

// RPC catalog_models ajoutée après la génération de database.ts → client non typé
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

/** cover_title_id / cover_pos : un film du modèle et son moment enregistré → image capturée de sa vidéo */
export type PublicModel = { id: string; name: string; image_url: string | null; titles_count: number; cover_title_id: string | null; cover_pos: number | null }

export const MODELS_PER_PAGE = 48
export const TITLES_PER_PAGE = 48

export type ModelSort = 'most' | 'least' | 'recent' | 'longest' | 'az' | 'za'
export const MODEL_SORTS: { value: ModelSort; label: string }[] = [
  { value: 'most', label: 'Le plus de vidéos' },
  { value: 'least', label: 'Le moins de vidéos' },
  { value: 'recent', label: 'Nouveautés récentes' },
  { value: 'longest', label: 'Durée totale la plus longue' },
  { value: 'az', label: 'Nom A → Z' },
  { value: 'za', label: 'Nom Z → A' },
]
export const validModelSort = (v: unknown): ModelSort | undefined => (MODEL_SORTS.some((o) => o.value === v) && v !== 'most' ? (v as ModelSort) : undefined)

export async function fetchPublicModels(s: TypedSupabaseClient, page = 1, per = MODELS_PER_PAGE, opts: { sort?: ModelSort; q?: string } = {}): Promise<{ models: PublicModel[]; total: number }> {
  const { data, error } = await raw(s).rpc('catalog_models', { p_limit: per, p_offset: (page - 1) * per, p_sort: opts.sort ?? null, p_q: opts.q ?? null })
  if (error) throw error
  const rows = (data ?? []) as (PublicModel & { total: number })[]
  return {
    models: rows.map(({ total: _t, ...m }) => ({ ...m, titles_count: Number(m.titles_count), cover_title_id: m.cover_title_id ?? null, cover_pos: m.cover_pos ?? null })),
    total: Number(rows[0]?.total ?? 0),
  }
}

/** Vidéos d'un modèle : tri, durée, recherche dans ses vidéos (filtrés par la base). `all` = nombre total sans filtre. */
export async function fetchModelPage(s: TypedSupabaseClient, id: string, page = 1, f: VideoFilters & { q?: string } = {}) {
  const [model, list] = await Promise.all([
    s.from('models').select('id, name, image_url').eq('id', id).maybeSingle(),
    queryVideos(s, { ...f, model: id }, { limit: TITLES_PER_PAGE, offset: (page - 1) * TITLES_PER_PAGE }),
  ])
  const titles: CatalogTitle[] = list.titles
  return { model: model.data, titles, total: list.total, page }
}
