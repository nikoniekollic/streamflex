import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import { MOCK_GENRES, MOCK_TITLES } from '@/lib/mock-catalog'
import { invokeCatalog } from '@/lib/catalog-api'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'
import { orderSpec, validSort, type SortKey } from '@/lib/sort'

type SearchRow = Database['public']['Functions']['search_titles']['Returns'][number]

export const SEARCH_PAGE_SIZE = 30
export const SEARCH_DEBOUNCE_MS = 300

export type SearchParams = {
  q?: string
  type?: 'movie' | 'series'
  genre?: string
  sort?: SortKey
  page?: number
}

export type SearchResult = {
  results: CatalogTitle[]
  total: number
  hasMore: boolean
  genres: { slug: string; name: string }[]
  isMock: boolean
}

export function validateSearchParams(s: Record<string, unknown>): SearchParams {
  const out: SearchParams = {}
  if (typeof s.q === 'string' && s.q.trim()) out.q = s.q.trim().slice(0, 100)
  if (s.type === 'movie' || s.type === 'series') out.type = s.type
  if (typeof s.genre === 'string' && /^[a-z0-9-]+$/.test(s.genre)) out.genre = s.genre
  const sort = validSort(s.sort)
  if (sort) out.sort = sort
  const page = Number(s.page)
  if (Number.isInteger(page) && page > 1 && page <= 20) out.page = page
  return out
}

const normalize = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function searchMock(p: SearchParams, limit: number, kids: boolean): Omit<SearchResult, 'genres' | 'isMock'> {
  const q = p.q ? normalize(p.q) : null
  const all = MOCK_TITLES.filter(
    (t) =>
      (!kids || ['Tous publics', '10+'].includes(t.maturity_rating ?? '')) &&
      (!p.type || t.type === p.type) &&
      (!p.genre || t.genres.some((g) => g.slug === p.genre)) &&
      (!q || normalize(t.title).includes(q) || normalize(t.synopsis ?? '').includes(q)),
  )
  return { results: all.slice(0, limit), total: all.length, hasMore: all.length > limit }
}

let genresCache: { slug: string; name: string }[] | null = null

async function loadGenres(supabase: TypedSupabaseClient) {
  if (genresCache) return genresCache
  const { data } = await supabase.from('genres').select('slug, name').order('name').range(0, 199)
  genresCache = data && data.length ? data : null
  return data ?? []
}

/** Exploration triée (sans mot-clé) : le tri est fait par la base, sur tout le catalogue publié. */
async function browseSorted(supabase: TypedSupabaseClient, p: SearchParams, limit: number): Promise<SearchResult> {
  const genres = await loadGenres(supabase)
  const embed = p.genre ? 'title_genres!inner(genres!inner(slug, name))' : 'title_genres(genres(slug, name))'
  let q = supabase
    .from('titles')
    .select(`id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at, ${embed}`, { count: 'exact' })
    .eq('is_published', true)
  if (p.type) q = q.eq('type', p.type)
  if (p.genre) q = q.eq('title_genres.genres.slug', p.genre)
  for (const o of orderSpec(p.sort)) q = q.order(o.column, o)
  const { data, error, count } = await q.range(0, limit - 1)
  if (error) throw error
  const rows = (data ?? []) as unknown as (Omit<CatalogTitle, 'genres'> & { title_genres: { genres: { slug: string; name: string } | null }[] })[]
  const results: CatalogTitle[] = rows.map(({ title_genres, ...t }) => ({ ...t, genres: title_genres.flatMap((g) => (g.genres ? [g.genres] : [])) }))
  const total = count ?? results.length
  return { results, total, hasMore: total > results.length, genres, isMock: false }
}

export async function searchTitles(supabase: TypedSupabaseClient, p: SearchParams, kids = false): Promise<SearchResult> {
  const limit = (p.page ?? 1) * SEARCH_PAGE_SIZE
  if (p.sort && !p.q && !kids) {
    try {
      const r = await browseSorted(supabase, p, limit)
      if (r.results.length > 0) return r
    } catch {
      /* repli : recherche classique + tri local */
    }
  }
  // Avec un mot-clé : la base trie TOUS les résultats (pas seulement la page chargée), « Afficher plus » suit donc le tri
  return searchRanked(supabase, p, kids, limit)
}

async function searchRanked(supabase: TypedSupabaseClient, p: SearchParams, kids: boolean, limit: number): Promise<SearchResult> {

  // 1) Redis via Edge `catalog` (clé = q normalisée + filtres + page, TTL 1 h)
  let rows: SearchRow[]
  let genres: { slug: string; name: string }[]
  // un tri choisi passe directement par la base (le cache du catalogue ne connaît que l'ordre de pertinence)
  const cached = p.sort ? null : await invokeCatalog<{ rows: SearchRow[]; genres: { slug: string; name: string }[] }>(supabase, {
    op: 'search',
    q: p.q,
    type: p.type,
    genre: p.genre,
    page: p.page ?? 1,
    kids,
  })
  if (cached) {
    rows = cached.data.rows ?? []
    genres = cached.data.genres ?? []
  } else {
    // 2) repli direct Supabase
    const [rpc, g] = await Promise.all([
      supabase.rpc('search_titles', { p_q: p.q ?? null, p_type: p.type ?? null, p_genre: p.genre ?? null, p_limit: limit, p_offset: 0, p_kids: kids, ...(p.sort ? { p_sort: p.sort } : {}) } as never),
      loadGenres(supabase),
    ])
    if (rpc.error) throw rpc.error
    rows = rpc.data ?? []
    genres = g
  }

  if (rows.length === 0 && env.enableMocks) {
    // Catalogue réellement vide ? → données de démonstration (cohérent avec l'accueil)
    const { count } = await supabase.from('titles').select('id', { count: 'exact', head: true }).eq('is_published', true)
    if (!count) return { ...searchMock(p, limit, kids), genres: genres.length ? genres : MOCK_GENRES, isMock: true }
  }

  const total = rows[0]?.total_count ?? 0
  const results: CatalogTitle[] = rows.map(({ rank: _rank, total_count: _total, genres: g, ...t }) => ({
    ...t,
    genres: Array.isArray(g) ? (g as { slug: string; name: string }[]) : [],
  }))
  return { results, total, hasMore: total > results.length, genres, isMock: false }
}
