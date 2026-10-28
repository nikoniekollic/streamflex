import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

export type VideoBookmark = Database['public']['Functions']['title_bookmarks']['Returns'][number]
export type NewBookmark = { timestamp_seconds: number; label: string; is_public: boolean }

export const bookmarkSchema = z.object({
  label: z.string().trim().min(1, 'Ajoute un texte').max(120, '120 caractères maximum'),
  is_public: z.boolean(),
})

export async function fetchBookmarks(
  supabase: TypedSupabaseClient,
  titleId: string,
  episodeId: string | null,
  profileId: string | null,
): Promise<VideoBookmark[]> {
  const { data, error } = await supabase.rpc('title_bookmarks', {
    p_title_id: titleId,
    p_episode_id: episodeId,
    p_profile_id: profileId,
  })
  if (error) throw error
  return data ?? []
}

export async function createBookmark(
  supabase: TypedSupabaseClient,
  ctx: { profileId: string; titleId: string; episodeId: string | null },
  b: NewBookmark,
): Promise<string> {
  const { data, error } = await supabase
    .from('video_bookmarks')
    .insert({
      profile_id: ctx.profileId,
      title_id: ctx.titleId,
      episode_id: ctx.episodeId,
      timestamp_seconds: Math.max(0, Math.floor(b.timestamp_seconds)),
      label: b.label.trim(),
      is_public: b.is_public,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function deleteBookmark(supabase: TypedSupabaseClient, id: string) {
  const { error } = await supabase.from('video_bookmarks').delete().eq('id', id)
  if (error) throw error
}

export function formatTimestamp(total: number): string {
  const s = Math.max(0, Math.floor(total))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
