import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'

// RPC catalog_models ajoutée après la génération de database.ts → client non typé
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

export type PublicModel = { id: string; name: string; image_url: string | null; titles_count: number }

export const MODELS_PER_PAGE = 48
export const TITLES_PER_PAGE = 48

export async function fetchPublicModels(s: TypedSupabaseClient, page = 1, per = MODELS_PER_PAGE): Promise<{ models: PublicModel[]; total: number }> {
  const { data, error } = await raw(s).rpc('catalog_models', { p_limit: per, p_offset: (page - 1) * per })
  if (error) throw error
  const rows = (data ?? []) as (PublicModel & { total: number })[]
  return {
    models: rows.map(({ total: _t, ...m }) => ({ ...m, titles_count: Number(m.titles_count) })),
    total: Number(rows[0]?.total ?? 0),
  }
}

export async function fetchModelPage(s: TypedSupabaseClient, id: string, page = 1) {
  const from = (page - 1) * TITLES_PER_PAGE
  const [model, list] = await Promise.all([
    s.from('models').select('id, name, image_url').eq('id', id).maybeSingle(),
    s
      .from('titles')
      .select('id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at', { count: 'exact' })
      .eq('model_id', id)
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + TITLES_PER_PAGE - 1),
  ])
  if (list.error) throw list.error
  const titles: CatalogTitle[] = (list.data ?? []).map((t) => ({ ...t, genres: [] }))
  return { model: model.data, titles, total: list.count ?? titles.length, page }
}
