import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import { MOCK_GENRES, MOCK_TITLES } from '@/lib/mock-catalog'
import { invokeCatalog } from '@/lib/catalog-api'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'

type SearchRow = Database['public']['Functions']['search_titles']['Returns'][number]

export const SEARCH_PAGE_SIZE = 30
export const SEARCH_DEBOUNCE_MS = 300

export type SearchParams = {
  q?: string
  type?: 'movie' | 'series'
  genre?: string
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

export async function searchTitles(supabase: TypedSupabaseClient, p: SearchParams, kids = false): Promise<SearchResult> {
  const limit = (p.page ?? 1) * SEARCH_PAGE_SIZE

  // 1) Redis via Edge `catalog` (clé = q normalisée + filtres + page, TTL 1 h)
  let rows: SearchRow[]
  let genres: { slug: string; name: string }[]
  const cached = await invokeCatalog<{ rows: SearchRow[]; genres: { slug: string; name: string }[] }>(supabase, {
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
      supabase.rpc('search_titles', { p_q: p.q ?? null, p_type: p.type ?? null, p_genre: p.genre ?? null, p_limit: limit, p_offset: 0, p_kids: kids }),
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
