import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'

// Tables ajoutées après la génération de database.ts → client non typé
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

export type Playlist = { id: string; name: string; created_at: string; count: number }

const fail = (e: { message: string }): never => {
  throw new Error(e.message.includes('duplicate') ? 'Cette vidéo est déjà dans la liste.' : e.message)
}

export async function listPlaylists(s: TypedSupabaseClient, profileId: string): Promise<Playlist[]> {
  const { data, error } = await raw(s)
    .from('playlists')
    .select('id, name, created_at, playlist_items(count)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .range(0, 199)
  if (error) fail(error)
  return ((data ?? []) as unknown as (Omit<Playlist, 'count'> & { playlist_items: { count: number }[] })[]).map(({ playlist_items, ...p }) => ({ ...p, count: playlist_items[0]?.count ?? 0 }))
}

export async function createPlaylist(s: TypedSupabaseClient, profileId: string, name: string): Promise<string> {
  const { data, error } = await raw(s).from('playlists').insert({ name: name.trim(), profile_id: profileId }).select('id').single()
  if (error) fail(error)
  return (data as { id: string }).id
}

export async function renamePlaylist(s: TypedSupabaseClient, id: string, name: string) {
  const { error } = await raw(s).from('playlists').update({ name: name.trim() }).eq('id', id)
  if (error) fail(error)
}

export async function deletePlaylist(s: TypedSupabaseClient, id: string) {
  const { error } = await raw(s).from('playlists').delete().eq('id', id)
  if (error) fail(error)
}

export async function addToPlaylist(s: TypedSupabaseClient, playlistId: string, titleIds: string[]) {
  for (let i = 0; i < titleIds.length; i += 200) {
    const rows = titleIds.slice(i, i + 200).map((title_id) => ({ playlist_id: playlistId, title_id }))
    const { error } = await raw(s).from('playlist_items').upsert(rows, { onConflict: 'playlist_id,title_id', ignoreDuplicates: true })
    if (error) fail(error)
  }
}

export async function removeFromPlaylist(s: TypedSupabaseClient, playlistId: string, titleId: string) {
  const { error } = await raw(s).from('playlist_items').delete().eq('playlist_id', playlistId).eq('title_id', titleId)
  if (error) fail(error)
}

/** Listes du profil qui contiennent ce titre. */
export async function playlistsContaining(s: TypedSupabaseClient, profileId: string, titleId: string): Promise<Set<string>> {
  const { data, error } = await raw(s)
    .from('playlist_items')
    .select('playlist_id, playlists!inner(profile_id)')
    .eq('title_id', titleId)
    .eq('playlists.profile_id', profileId)
  if (error) fail(error)
  return new Set(((data ?? []) as { playlist_id: string }[]).map((r) => r.playlist_id))
}

const FIELDS = 'id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at'

export async function fetchPlaylist(s: TypedSupabaseClient, id: string): Promise<{ playlist: { id: string; name: string } | null; titles: CatalogTitle[] }> {
  const db = raw(s)
  const [pl, items] = await Promise.all([
    db.from('playlists').select('id, name').eq('id', id).maybeSingle(),
    db.from('playlist_items').select(`added_at, titles(${FIELDS})`).eq('playlist_id', id).order('added_at', { ascending: true }).range(0, 999),
  ])
  if (items.error) fail(items.error)
  const titles = ((items.data ?? []) as unknown as { titles: Omit<CatalogTitle, 'genres'> | null }[]).flatMap((r) => (r.titles ? [{ ...r.titles, genres: [] }] : []))
  return { playlist: (pl.data as { id: string; name: string } | null) ?? null, titles }
}

/** Identifiants tirés au hasard (catalogue entier ou un seul modèle). */
export async function randomTitleIds(s: TypedSupabaseClient, opts: { limit?: number; modelId?: string | null; kids?: boolean; exclude?: string[] } = {}): Promise<string[]> {
  const { data, error } = await raw(s).rpc('random_title_ids', {
    p_limit: opts.limit ?? 30,
    p_model: opts.modelId ?? null,
    p_kids: opts.kids ?? false,
    p_exclude: opts.exclude ?? [],
  })
  if (error) fail(error)
  return (data ?? []) as string[]
}
