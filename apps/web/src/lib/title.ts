import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import type { Tables } from '@/types/database'
import { MOCK_TITLES } from '@/lib/mock-catalog'
import { env } from '@/lib/env'

export type EpisodeItem = Pick<Tables<'episodes'>, 'id' | 'episode_number' | 'name' | 'overview' | 'runtime_minutes' | 'still_url'> & {
  progress: number | null
}
export type SeasonItem = Pick<Tables<'seasons'>, 'id' | 'season_number' | 'name'> & { episodes: EpisodeItem[] }

export type TitleDetail = CatalogTitle & {
  original_title: string | null
  seasons: SeasonItem[]
  resume: { episodeId: string | null; position: number; ratio: number } | null
  isMock: boolean
  /** profil enfant + contenu non familial */
  restricted: boolean
}

const COLS =
  'id, type, slug, title, original_title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at, title_genres(genres(slug, name))'

export async function fetchTitleDetail(
  supabase: TypedSupabaseClient,
  slug: string,
  profile: { id: string; is_kids_profile: boolean },
): Promise<TitleDetail | null> {
  const { data, error } = await supabase.from('titles').select(COLS).eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!data) {
    const mock = env.enableMocks ? MOCK_TITLES.find((m) => m.slug === slug) : undefined
    return mock
      ? {
          ...mock,
          original_title: null,
          seasons: [],
          resume: null,
          isMock: true,
          restricted: profile.is_kids_profile && !['Tous publics', '10+'].includes(mock.maturity_rating ?? ''),
        }
      : null
  }

  const raw = data as unknown as Omit<CatalogTitle, 'genres'> & {
    original_title: string | null
    title_genres: { genres: { slug: string; name: string } | null }[]
  }
  const { title_genres, ...t } = raw
  const genres = title_genres.flatMap((g) => (g.genres ? [g.genres] : []))

  const [seasonsRes, episodesRes, progressRes] = await Promise.all([
    t.type === 'series'
      ? supabase.from('seasons').select('id, season_number, name').eq('title_id', t.id).order('season_number').range(0, 99)
      : Promise.resolve({ data: [] as Pick<Tables<'seasons'>, 'id' | 'season_number' | 'name'>[] }),
    t.type === 'series'
      ? supabase
          .from('episodes')
          .select('id, season_id, episode_number, name, overview, runtime_minutes, still_url')
          .eq('title_id', t.id)
          .order('episode_number')
          .range(0, 999)
      : Promise.resolve({ data: [] as (EpisodeItem & { season_id: string })[] }),
    supabase
      .from('watch_progress')
      .select('episode_id, position_seconds, duration_seconds, completed, updated_at')
      .eq('title_id', t.id)
      .eq('profile_id', profile.id)
      .order('updated_at', { ascending: false })
      .range(0, 999),
  ])
  const restricted = profile.is_kids_profile
    ? (await supabase.rpc('can_profile_watch', { p_profile_id: profile.id, p_title_id: t.id })).data !== 'ok'
    : false

  const progress = progressRes.data ?? []
  const ratioOf = (p: (typeof progress)[number]) =>
    p.completed ? 1 : p.duration_seconds ? Math.min(1, p.position_seconds / p.duration_seconds) : 0
  const byEpisode = new Map(progress.filter((p) => p.episode_id).map((p) => [p.episode_id as string, ratioOf(p)]))

  const seasons: SeasonItem[] = (seasonsRes.data ?? []).map((s) => ({
    ...s,
    episodes: (episodesRes.data ?? [])
      .filter((e) => e.season_id === s.id)
      .map(({ season_id: _s, ...e }) => ({ ...e, progress: byEpisode.get(e.id) ?? null })),
  }))

  const last = progress.find((p) => !p.completed)
  const resume = last ? { episodeId: last.episode_id, position: last.position_seconds, ratio: ratioOf(last) } : null

  return { ...t, genres, seasons, resume, isMock: false, restricted }
}
