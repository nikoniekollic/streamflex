import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Tables } from '@/types/database'
import { MOCK_GENRES, MOCK_PROGRESS, MOCK_TITLES } from '@/lib/mock-catalog'
import { invokeCatalog } from '@/lib/catalog-api'
import { env } from '@/lib/env'
import { episodeLabel, fetchContinueWatching, resumeAt, toCatalogTitle } from '@/lib/history'

export type CatalogTitle = Pick<
  Tables<'titles'>,
  | 'id'
  | 'type'
  | 'slug'
  | 'title'
  | 'synopsis'
  | 'release_year'
  | 'runtime_minutes'
  | 'maturity_rating'
  | 'poster_url'
  | 'backdrop_url'
  | 'logo_url'
  | 'published_at'
> & { genres: Pick<Tables<'genres'>, 'slug' | 'name'>[] }

export type ContinueItem = Pick<Tables<'watch_progress'>, 'id' | 'episode_id' | 'position_seconds' | 'duration_seconds'> & {
  title: CatalogTitle
  /** libellé épisode (S1:É2 · Nom) pour les séries */
  caption?: string | null
}

export type CategoryRow = { key: string; label: string; titles: CatalogTitle[] }

export type HomeData = {
  hero: CatalogTitle | null
  continueWatching: ContinueItem[]
  rows: CategoryRow[]
  isMock: boolean
}

const HOME_LIMIT = 60
const ROW_LIMIT = 20
const MIN_ROW_SIZE = 4

export function buildRows(titles: CatalogTitle[], genreOrder: { slug: string; name: string }[]): CategoryRow[] {
  const rows: CategoryRow[] = [{ key: 'trending', label: 'Tendances actuelles', titles: titles.slice(0, ROW_LIMIT) }]

  const series = titles.filter((t) => t.type === 'series')
  const movies = titles.filter((t) => t.type === 'movie')

  for (const g of genreOrder) {
    const list = titles.filter((t) => t.genres.some((x) => x.slug === g.slug)).slice(0, ROW_LIMIT)
    if (list.length >= MIN_ROW_SIZE) rows.push({ key: `genre-${g.slug}`, label: g.name, titles: list })
  }
  if (series.length >= MIN_ROW_SIZE) rows.push({ key: 'series', label: 'Séries', titles: series.slice(0, ROW_LIMIT) })
  if (movies.length >= MIN_ROW_SIZE) rows.push({ key: 'movies', label: 'Films', titles: movies.slice(0, ROW_LIMIT) })

  return rows
}

function pickHero(titles: CatalogTitle[]): CatalogTitle | null {
  const pool = titles.slice(0, 10).filter((t) => t.backdrop_url)
  if (pool.length === 0) return titles[0] ?? null
  return pool[Math.floor(Math.random() * pool.length)]
}

function mockHome(kids = false): HomeData {
  const titles = kids ? MOCK_TITLES.filter((t) => KIDS_RATINGS.includes(t.maturity_rating ?? '')) : MOCK_TITLES
  return {
    hero: pickHero(titles),
    continueWatching: kids ? [] : MOCK_PROGRESS,
    rows: buildRows(titles, MOCK_GENRES),
    isMock: true,
  }
}

type CatalogRow = Omit<CatalogTitle, 'genres'> & { genres: unknown }

async function loadCatalogDirect(supabase: TypedSupabaseClient, kids: boolean) {
  const [titlesRes, genresRes] = await Promise.all([
    supabase.rpc('catalog_titles', { p_kids: kids, p_limit: HOME_LIMIT }),
    kids
      ? supabase.from('genres').select('slug, name').eq('is_family', true).order('name').range(0, 199)
      : supabase.from('genres').select('slug, name').order('name').range(0, 199),
  ])
  if (titlesRes.error) throw titlesRes.error
  return { titles: (titlesRes.data ?? []) as CatalogRow[], genres: genresRes.data ?? [] }
}

export const KIDS_RATINGS = ['Tous publics', '10+']

export async function fetchHome(
  supabase: TypedSupabaseClient,
  profile: { id: string; is_kids_profile: boolean },
): Promise<HomeData> {
  const kids = profile.is_kids_profile
  // Catalogue partagé : Redis (Edge `catalog`, clé distincte enfants) → repli direct ; reprise : propre au profil
  const [catalog, progressRes] = await Promise.all([
    invokeCatalog<{ titles: CatalogRow[]; genres: { slug: string; name: string }[] }>(supabase, { op: 'home', kids }).then(
      (r) => r?.data ?? loadCatalogDirect(supabase, kids),
    ),
    fetchContinueWatching(supabase, profile.id, ROW_LIMIT).catch(() => []), // 2 % ≤ progression ≤ 95 %
  ])

  if (catalog.titles.length === 0) {
    if (env.enableMocks) return mockHome(kids)
    return { hero: null, continueWatching: [], rows: [], isMock: false }
  }

  const titles: CatalogTitle[] = catalog.titles.map((t) => ({ ...t, genres: Array.isArray(t.genres) ? (t.genres as CatalogTitle['genres']) : [] }))

  const progress: ContinueItem[] = progressRes.map((h) => ({
    id: h.title_id,
    episode_id: h.episode_id,
    position_seconds: resumeAt(h),
    duration_seconds: h.duration_seconds,
    title: toCatalogTitle(h),
    caption: episodeLabel(h),
  }))

  return { hero: pickHero(titles), continueWatching: progress, rows: buildRows(titles, catalog.genres), isMock: false }
}
