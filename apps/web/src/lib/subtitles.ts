import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Tables } from '@/types/database'

export type SubtitleTrack = Pick<Tables<'subtitles'>, 'id' | 'language' | 'label' | 'format' | 'is_default' | 'is_forced'>
export type SubtitleRow = Tables<'subtitles'>
export type SubtitleTarget = { titleId: string; episodeId: string | null }

const COLS = 'id, language, label, format, is_default, is_forced'

// ───────── Lecture (lecteur)
export async function fetchSubtitles(supabase: TypedSupabaseClient, t: SubtitleTarget): Promise<SubtitleTrack[]> {
  let q = supabase.from('subtitles').select(COLS)
  q = t.episodeId ? q.eq('episode_id', t.episodeId) : q.eq('title_id', t.titleId)
  const { data } = await q.order('is_default', { ascending: false }).order('language').range(0, 49)
  return data ?? [] // non bloquant : pas de sous-titres plutôt qu'une erreur de lecture
}

const blobCache = new Map<string, Promise<string>>()

/** WebVTT servi par l'Edge Function `subtitle` (conversion SRT + CORS) → URL blob même origine pour <track>. */
export function loadSubtitleUrl(supabase: TypedSupabaseClient, id: string): Promise<string> {
  let p = blobCache.get(id)
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.functions.invoke<string>('subtitle', { body: { id } })
      if (error || typeof data !== 'string' || !data.startsWith('WEBVTT')) throw new Error('subtitle_unavailable')
      return URL.createObjectURL(new Blob([data], { type: 'text/vtt' }))
    })()
    p.catch(() => blobCache.delete(id))
    blobCache.set(id, p)
  }
  return p
}

// ───────── Langues
const names = (() => {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'language' })
  } catch {
    return null
  }
})()

export function languageName(code: string): string {
  try {
    const n = names?.of(code)
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : code
  } catch {
    return code
  }
}

export const COMMON_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'pt-BR', 'nl', 'ar', 'ja', 'ko', 'zh', 'ru', 'tr', 'pl']

const PREF_KEY = 'sf:subtitle-lang'
export function getSubtitlePref(): string | null | undefined {
  try {
    const v = localStorage.getItem(PREF_KEY)
    return v === null ? undefined : v === 'off' ? null : v
  } catch {
    return undefined
  }
}
export function setSubtitlePref(lang: string | null) {
  try {
    localStorage.setItem(PREF_KEY, lang ?? 'off')
  } catch {
    /* ignore */
  }
}

/** Piste initiale : préférence utilisateur > défaut > forcés dans la langue audio > aucune. */
export function pickInitialTrack(tracks: SubtitleTrack[], audio: string[] = []): string | null {
  const pref = getSubtitlePref()
  if (pref === null) return tracks.find((t) => t.is_forced && audio.includes(t.language))?.id ?? null
  if (pref) {
    const match = tracks.find((t) => t.language === pref && !t.is_forced) ?? tracks.find((t) => t.language === pref)
    if (match) return match.id
  }
  return tracks.find((t) => t.is_default)?.id ?? tracks.find((t) => t.is_forced && audio.includes(t.language))?.id ?? null
}

// ───────── Admin
const MAX_UPLOAD = 2 * 1024 * 1024

export async function listSubtitlesAdmin(supabase: TypedSupabaseClient, t: SubtitleTarget): Promise<SubtitleRow[]> {
  let q = supabase.from('subtitles').select('*')
  q = t.episodeId ? q.eq('episode_id', t.episodeId) : q.eq('title_id', t.titleId)
  const { data, error } = await q.order('language').range(0, 99)
  if (error) throw error
  return data
}

export function detectFormat(name: string): 'vtt' | 'srt' | null {
  const m = name.toLowerCase().match(/\.(vtt|srt)(?:$|\?)/)
  return (m?.[1] as 'vtt' | 'srt') ?? null
}

export type NewSubtitle = { language: string; label: string; is_default: boolean; is_forced: boolean }

async function clearDefault(supabase: TypedSupabaseClient, t: SubtitleTarget) {
  let q = supabase.from('subtitles').update({ is_default: false })
  q = t.episodeId ? q.eq('episode_id', t.episodeId) : q.eq('title_id', t.titleId)
  const { error } = await q.eq('is_default', true)
  if (error) throw error
}

export async function addSubtitleLink(supabase: TypedSupabaseClient, t: SubtitleTarget, meta: NewSubtitle, url: string, userId: string) {
  const format = detectFormat(url)
  if (!format) throw new Error('URL attendue en .vtt ou .srt')
  if (meta.is_default) await clearDefault(supabase, t)
  const { error } = await supabase.from('subtitles').insert({
    title_id: t.episodeId ? null : t.titleId,
    episode_id: t.episodeId,
    ...meta,
    url,
    format,
    created_by: userId,
  })
  if (error) throw subtitleError(error)
}

export async function uploadSubtitle(supabase: TypedSupabaseClient, t: SubtitleTarget, meta: NewSubtitle, file: File, userId: string) {
  const format = detectFormat(file.name)
  if (!format) throw new Error('Fichier .vtt ou .srt attendu')
  if (file.size > MAX_UPLOAD) throw new Error('Fichier trop volumineux (2 Mo max)')
  const path = `${t.titleId}/${t.episodeId ?? 'movie'}/${meta.language}-${crypto.randomUUID()}.${format}`
  const up = await supabase.storage.from('subtitles').upload(path, file, {
    contentType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
    upsert: false,
  })
  if (up.error) throw new Error(`Upload : ${up.error.message}`)
  const { data } = supabase.storage.from('subtitles').getPublicUrl(path)
  try {
    if (meta.is_default) await clearDefault(supabase, t)
    const { error } = await supabase.from('subtitles').insert({
      title_id: t.episodeId ? null : t.titleId,
      episode_id: t.episodeId,
      ...meta,
      url: data.publicUrl,
      format,
      storage_path: path,
      created_by: userId,
    })
    if (error) throw subtitleError(error)
  } catch (e) {
    await supabase.storage.from('subtitles').remove([path]) // pas d'orphelin
    throw e
  }
}

export async function setDefaultSubtitle(supabase: TypedSupabaseClient, t: SubtitleTarget, id: string, value: boolean) {
  if (value) await clearDefault(supabase, t)
  const { error } = await supabase.from('subtitles').update({ is_default: value }).eq('id', id)
  if (error) throw subtitleError(error)
}

export async function deleteSubtitle(supabase: TypedSupabaseClient, row: Pick<SubtitleRow, 'id' | 'storage_path'>) {
  const { error } = await supabase.from('subtitles').delete().eq('id', row.id)
  if (error) throw subtitleError(error)
  if (row.storage_path) await supabase.storage.from('subtitles').remove([row.storage_path])
}

function subtitleError(e: { code?: string; message: string }): Error {
  if (e.code === '23505') return new Error('Un sous-titre avec cette langue et ce libellé existe déjà.')
  if (e.code === '23514') return new Error('Valeur invalide (langue BCP 47, URL http(s)).')
  return new Error(e.message)
}
