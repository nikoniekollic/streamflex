import { notFound } from '@tanstack/react-router'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Enums, Tables } from '@/types/database'
import { fetchSubtitles, type SubtitleTrack } from '@/lib/subtitles'

export type Quality = Enums<'video_quality'>

export type StreamInfo = {
  url: string
  provider: Enums<'video_provider'>
  quality: Quality
  sourceId: string
  qualities: Quality[]
  /** langues audio disponibles (toutes sources) */
  audios: string[]
  /** langues audio de la source servie */
  audio: string[]
  expiresAt: number
  debrid: boolean
  cached: boolean
  /** 1fichier : débridage via le Worker Cloudflare (jeton signé par resolve-stream) */
  debridWorker?: string
  debridToken?: string
}

export type StreamErrorCode =
  | 'unauthorized'
  | 'profile_required'
  | 'kids_restricted'
  | 'subscription_required'
  | 'ip_banned'
  | 'title_not_found'
  | 'episode_required'
  | 'episode_not_found'
  | 'no_source'
  | 'source_offline'
  | 'debrid_unavailable'
  | 'host_busy'
  | 'all_sources_failed'
  | 'network'
  | 'unknown'

export const STREAM_ERROR_TITLES: Record<StreamErrorCode, string> = {
  unauthorized: 'Session expirée',
  profile_required: 'Profil requis',
  kids_restricted: 'Profil Enfants',
  subscription_required: 'Abonnement requis',
  ip_banned: 'Accès bloqué',
  title_not_found: 'Titre introuvable',
  episode_required: 'Épisode requis',
  episode_not_found: 'Épisode introuvable',
  no_source: 'Aucune source',
  source_offline: 'Fichier hors ligne',
  debrid_unavailable: 'Débridage indisponible',
  host_busy: 'Hébergeur saturé',
  all_sources_failed: 'Sources indisponibles',
  network: 'Erreur réseau',
  unknown: 'Lecture impossible',
}

/** Erreurs pour lesquelles un nouvel essai a du sens. */
export const RETRYABLE_STREAM_ERRORS: StreamErrorCode[] = ['debrid_unavailable', 'host_busy', 'all_sources_failed', 'network', 'unknown']

export class StreamError extends Error {
  constructor(readonly code: StreamErrorCode) {
    super(code)
  }
}

export const STREAM_ERROR_MESSAGES: Record<StreamErrorCode, string> = {
  unauthorized: 'Session expirée. Reconnecte-toi.',
  profile_required: 'Choisis un profil pour lancer la lecture.',
  kids_restricted: "Ce contenu n'est pas disponible sur un profil Enfants.",
  subscription_required: "Un abonnement actif est nécessaire pour lancer la lecture. Active un code depuis ton profil.",
  ip_banned: "L'accès est bloqué depuis ton adresse IP.",
  title_not_found: 'Ce titre est introuvable.',
  episode_required: 'Choisis un épisode.',
  episode_not_found: 'Cet épisode est introuvable.',
  no_source: "Aucune source vidéo n'est disponible pour ce titre.",
  source_offline: "Le fichier vidéo est hors ligne ou a été supprimé chez l'hébergeur.",
  debrid_unavailable: 'Le service de débridage (Alldebrid) est injoignable ou refuse la requête.',
  host_busy: "L'hébergeur est temporairement saturé. Réessaie dans quelques minutes.",
  all_sources_failed: 'Toutes les sources sont momentanément indisponibles. Réessaie dans quelques minutes.',
  network: 'Erreur réseau. Vérifie ta connexion.',
  unknown: 'Impossible de lancer la lecture.',
}

export type ResolveParams = {
  profileId: string
  titleId: string
  episodeId: string | null
  quality?: Quality
  audio?: string
  refresh?: boolean
  exclude?: string[]
}

/** Échange le jeton signé contre le lien direct Alldebrid via le Worker Cloudflare (IP non datacenter). */
async function unlockViaWorker(worker: string, token: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(worker, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  } catch (e) {
    console.error('[StreamFlex][alldebrid] Worker injoignable (réseau/CORS)', worker, e)
    throw new StreamError('debrid_unavailable')
  }
  const body = (await res.json().catch(() => null)) as { url?: string; error?: string; code?: string; message?: string } | null
  if (!res.ok || !body?.url) {
    console.error(`[StreamFlex][alldebrid] HTTP ${res.status}`, body)
    throw new StreamError(body?.code === 'LINK_DOWN' || body?.code === 'LINK_NOT_FOUND' ? 'source_offline' : 'debrid_unavailable')
  }
  console.info('[StreamFlex][alldebrid] lien débridé obtenu')
  return body.url
}

export async function resolveStream(supabase: TypedSupabaseClient, params: ResolveParams): Promise<StreamInfo> {
  const { data, error } = await supabase.functions.invoke<StreamInfo>('resolve-stream', { body: params })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => ({}))) as { error?: StreamErrorCode }
      throw new StreamError(body.error && body.error in STREAM_ERROR_MESSAGES ? body.error : 'unknown')
    }
    throw new StreamError('network')
  }
  if (data && !data.url && data.debridWorker && data.debridToken) {
    data.url = await unlockViaWorker(data.debridWorker, data.debridToken)
  }
  if (!data?.url) throw new StreamError('unknown')
  return data
}

type EpisodeRow = Pick<Tables<'episodes'>, 'id' | 'season_id' | 'episode_number' | 'name'> & { season_number: number }

export type WatchData = {
  title: Pick<Tables<'titles'>, 'id' | 'type' | 'slug' | 'title' | 'backdrop_url'>
  episode: EpisodeRow | null
  nextEpisode: EpisodeRow | null
  startAt: number
  subtitles: SubtitleTrack[]
}

export async function loadWatch(
  supabase: TypedSupabaseClient,
  profileId: string,
  titleId: string,
  episodeParam: string | undefined,
  t: number | undefined,
): Promise<WatchData> {
  const { data: title, error } = await supabase
    .from('titles')
    .select('id, type, slug, title, backdrop_url')
    .eq('id', titleId)
    .maybeSingle()
  if (error) throw error
  if (!title) throw notFound()

  let episode: EpisodeRow | null = null
  let nextEpisode: EpisodeRow | null = null

  if (title.type === 'series') {
    const [seasonsRes, episodesRes, lastRes] = await Promise.all([
      supabase.from('seasons').select('id, season_number').eq('title_id', titleId).range(0, 99),
      supabase.from('episodes').select('id, season_id, episode_number, name').eq('title_id', titleId).range(0, 999),
      episodeParam
        ? Promise.resolve({ data: null })
        : supabase
            .from('watch_progress')
            .select('episode_id')
            .eq('profile_id', profileId)
            .eq('title_id', titleId)
            .not('episode_id', 'is', null)
            .order('updated_at', { ascending: false })
            .range(0, 0)
            .maybeSingle(),
    ])
    const seasonNo = new Map((seasonsRes.data ?? []).map((s) => [s.id, s.season_number]))
    const episodes: EpisodeRow[] = (episodesRes.data ?? [])
      .map((e) => ({ ...e, season_number: seasonNo.get(e.season_id) ?? 0 }))
      .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number)

    const targetId = episodeParam ?? lastRes.data?.episode_id ?? episodes[0]?.id
    const idx = episodes.findIndex((e) => e.id === targetId)
    if (idx === -1) throw new StreamError(episodes.length ? 'episode_not_found' : 'no_source')
    episode = episodes[idx]
    nextEpisode = episodes[idx + 1] ?? null
  }

  let progressQuery = supabase
    .from('watch_progress')
    .select('position_seconds, duration_seconds')
    .eq('profile_id', profileId)
    .eq('title_id', titleId)
  progressQuery = episode ? progressQuery.eq('episode_id', episode.id) : progressQuery.is('episode_id', null)

  const [progressRes, subtitles] = await Promise.all([
    progressQuery.maybeSingle(),
    fetchSubtitles(supabase, { titleId, episodeId: episode?.id ?? null }),
  ])
  const pr = progressRes.data
  const ratio = pr?.duration_seconds ? pr.position_seconds / pr.duration_seconds : 0
  const saved = pr && ratio <= 0.95 ? pr.position_seconds : 0 // > 95 % : relance depuis le début
  return { title, episode, nextEpisode, startAt: t ?? saved, subtitles }
}

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor((totalSeconds / 60) % 60)
  const h = Math.floor(totalSeconds / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
