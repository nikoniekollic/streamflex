import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import { MOCK_GENRES, MOCK_TITLES } from '@/lib/mock-catalog'
import { env } from '@/lib/env'
import { validSort, type SortKey } from '@/lib/sort'
import type { PublicModel } from '@/lib/model-catalog'

export const SEARCH_PAGE_SIZE = 30
export const SEARCH_DEBOUNCE_MS = 250

const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

/** Filtres de vidéos communs (recherche, catalogue, page d'un modèle) : gardés dans l'adresse de la page. */
export type VideoFilters = {
  sort?: SortKey
  /** durée minimale / maximale, en secondes */
  min?: number
  max?: number
  /** correspondance exacte du texte cherché (pas de recherche approchée) */
  exact?: boolean
}

export type SearchParams = VideoFilters & {
  q?: string
  type?: 'movie' | 'series'
  genre?: string
  /** ce qu'on cherche : tout, seulement les vidéos, seulement les modèles */
  kind?: 'videos' | 'models'
  model?: string
  page?: number
}

export type SearchResult = {
  results: CatalogTitle[]
  total: number
  hasMore: boolean
  genres: { slug: string; name: string }[]
  models: PublicModel[]
  isMock: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const secs = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 86_400 ? n : undefined
}

export function validateFilters(s: Record<string, unknown>): VideoFilters {
  const out: VideoFilters = {}
  const sort = validSort(s.sort)
  if (sort) out.sort = sort
  const min = secs(s.min)
  const max = secs(s.max)
  if (min) out.min = min
  if (max && (!min || max >= min)) out.max = max
  if (s.exact === true || s.exact === 'true' || s.exact === 1 || s.exact === '1') out.exact = true
  return out
}

export function validateSearchParams(s: Record<string, unknown>): SearchParams {
  const out: SearchParams = validateFilters(s)
  if (typeof s.q === 'string' && s.q.trim()) out.q = s.q.trim().slice(0, 100)
  if (s.type === 'movie' || s.type === 'series') out.type = s.type
  if (typeof s.genre === 'string' && /^[a-z0-9-]+$/.test(s.genre)) out.genre = s.genre
  if (s.kind === 'videos' || s.kind === 'models') out.kind = s.kind
  if (typeof s.model === 'string' && UUID.test(s.model)) out.model = s.model
  const page = Number(s.page)
  if (Number.isInteger(page) && page > 1 && page <= 50) out.page = page
  return out
}

export const hasVideoFilters = (f: VideoFilters & { model?: string }) => !!(f.sort || f.min || f.max || f.exact || f.model)

const normalize = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

let genresCache: { slug: string; name: string }[] | null = null
async function loadGenres(supabase: TypedSupabaseClient) {
  if (genresCache) return genresCache
  const { data } = await supabase.from('genres').select('slug, name').order('name').range(0, 199)
  genresCache = data && data.length ? data : null
  return data ?? []
}

type CatalogRow = Omit<CatalogTitle, 'genres'> & { genres: unknown; rank: number; total_count: number }

/**
 * Vidéos filtrées et triées par la base (recherche rapide par index : search_catalog). `offset`/`limit` : la page voulue.
 * Sert la recherche, le catalogue et la page d'un modèle.
 */
export async function queryVideos(
  supabase: TypedSupabaseClient,
  p: VideoFilters & { q?: string; model?: string; type?: 'movie' | 'series'; genre?: string },
  opts: { limit: number; offset?: number; kids?: boolean },
): Promise<{ titles: CatalogTitle[]; total: number }> {
  const { data, error } = await raw(supabase).rpc('search_catalog', {
    p_q: p.q ?? null,
    p_sort: p.sort ?? null,
    p_limit: opts.limit,
    p_offset: opts.offset ?? 0,
    p_model: p.model ?? null,
    p_min_s: p.min ?? null,
    p_max_s: p.max ?? null,
    p_exact: p.exact ?? false,
    p_kids: opts.kids ?? false,
    p_type: p.type ?? null,
    p_genre: p.genre ?? null,
  })
  if (error) throw error
  const rows = (data ?? []) as CatalogRow[]
  return {
    titles: rows.map(({ rank: _r, total_count: _t, genres, ...t }) => ({ ...t, genres: Array.isArray(genres) ? (genres as { slug: string; name: string }[]) : [] })),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

/** Modèles dont le nom correspond (recherche) — triés par nombre de vidéos. */
export async function searchModels(supabase: TypedSupabaseClient, q: string, limit = 12): Promise<PublicModel[]> {
  const { data, error } = await raw(supabase).rpc('catalog_models', { p_limit: limit, p_offset: 0, p_q: q })
  if (error) return []
  return ((data ?? []) as (PublicModel & { total: number })[]).map(({ total: _t, ...m }) => ({ ...m, titles_count: Number(m.titles_count), cover_title_id: m.cover_title_id ?? null, cover_pos: m.cover_pos ?? null }))
}

export async function searchTitles(supabase: TypedSupabaseClient, p: SearchParams, kids = false): Promise<SearchResult> {
  const limit = (p.page ?? 1) * SEARCH_PAGE_SIZE
  const wantModels = !!p.q && !kids && p.kind !== 'videos' && !p.model
  const [videos, genres, models] = await Promise.all([
    p.kind === 'models' ? Promise.resolve({ titles: [], total: 0 }) : queryVideos(supabase, p, { limit, kids }),
    loadGenres(supabase),
    wantModels ? searchModels(supabase, p.q!, p.kind === 'models' ? 48 : 12) : Promise.resolve([]),
  ])

  if (videos.titles.length === 0 && models.length === 0 && env.enableMocks && !p.q) {
    const { count } = await supabase.from('titles').select('id', { count: 'exact', head: true }).eq('is_published', true)
    if (!count) {
      const all = MOCK_TITLES.filter((t) => !p.q || normalize(t.title).includes(normalize(p.q)))
      return { results: all.slice(0, limit), total: all.length, hasMore: all.length > limit, genres: genres.length ? genres : MOCK_GENRES, models: [], isMock: true }
    }
  }
  return { results: videos.titles, total: videos.total, hasMore: videos.total > videos.titles.length, genres, models, isMock: false }
}

// ───────── Durées : affichage et saisie (« 45 s », « 5 min », « 1 h 30 »)
export function formatSpan(s: number | undefined): string {
  if (!s) return 'Toutes'
  if (s < 60) return `${s} s`
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** « 90 », « 1:30 », « 90s », « 5 min », « 1h30 » → secondes (un nombre sans unité = minutes). */
export function parseSpan(v: string): number | undefined {
  const t = v.trim().toLowerCase().replace(',', '.')
  if (!t) return undefined
  const clock = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (clock) return clock[3] != null ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2]
  const parts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(h|min|mn|m|s|sec)?/g)]
  if (!parts.length || t.replace(/[\d.\s]|h|min|mn|m|sec|s/g, '') !== '') return undefined
  let sec = 0
  for (const [, n, unit] of parts) sec += +n * (unit === 'h' ? 3600 : unit === 's' || unit === 'sec' ? 1 : 60)
  return sec > 0 ? Math.round(sec) : undefined
}
