import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import type { Database } from '@/types/database'

export type HistoryItem = Database['public']['CompositeTypes']['history_row']

export const HISTORY_PAGE = 60
/** Fenêtre « Reprendre la lecture » (aussi appliquée côté SQL) */
export const RESUME_MIN = 0.02
export const RESUME_MAX = 0.95

export function toCatalogTitle(h: HistoryItem): CatalogTitle {
  return {
    id: h.title_id,
    type: h.type,
    slug: h.slug,
    title: h.title,
    synopsis: h.synopsis,
    release_year: h.release_year,
    runtime_minutes: h.runtime_minutes,
    maturity_rating: h.maturity_rating,
    poster_url: h.poster_url,
    backdrop_url: h.backdrop_url,
    logo_url: h.logo_url,
    published_at: h.published_at,
    genres: [],
  }
}

export function episodeLabel(h: Pick<HistoryItem, 'season_number' | 'episode_number' | 'episode_name'>): string | null {
  if (h.episode_number == null) return null
  return `S${h.season_number ?? 1}:É${h.episode_number}${h.episode_name ? ` · ${h.episode_name}` : ''}`
}

/** Position de reprise : 0 si quasi terminé (> 95 %) → on relance depuis le début. */
export function resumeAt(h: Pick<HistoryItem, 'position_seconds' | 'ratio'>): number {
  return h.ratio > RESUME_MAX ? 0 : Math.max(0, Math.floor(h.position_seconds))
}

export async function fetchHistory(supabase: TypedSupabaseClient, profileId: string, page = 1) {
  const { data, error } = await supabase.rpc('my_watch_history', { p_profile_id: profileId, p_limit: page * HISTORY_PAGE, p_offset: 0 })
  if (error) throw error
  const items = data ?? []
  const total = items[0]?.total_count ?? 0
  return { items, total, hasMore: total > items.length }
}

export async function fetchContinueWatching(supabase: TypedSupabaseClient, profileId: string, limit = 20) {
  const { data, error } = await supabase.rpc('my_continue_watching', { p_profile_id: profileId, p_limit: limit })
  if (error) throw error
  return data ?? []
}

/** Retire un titre de l'historique du profil (tous ses épisodes). RLS : uniquement les lignes du compte. */
export async function removeFromHistory(supabase: TypedSupabaseClient, profileId: string, titleId: string) {
  const { error } = await supabase.from('watch_progress').delete().eq('profile_id', profileId).eq('title_id', titleId)
  if (error) throw error
}

export async function clearHistory(supabase: TypedSupabaseClient, profileId: string) {
  const { error } = await supabase.from('watch_progress').delete().eq('profile_id', profileId)
  if (error) throw error
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
export function watchedAgo(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const a = Math.abs(s)
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' })
}
