import type { TypedSupabaseClient } from '@/lib/supabase'
import { z } from 'zod'

export type AdminModel = { id: string; name: string; image_url: string | null; titles_count: number; cover_title_id: string | null; cover_pos: number | null }
export type ModelTitle = { id: string; title: string; model_id: string | null }

export const modelSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(80, '80 caractères max'),
  image_url: z.union([z.literal(''), z.string().trim().url('URL invalide').startsWith('https://', 'https:// uniquement')]).optional(),
})

const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

const fail = (e: { message: string }): never => {
  throw new Error(e.message.includes('forbidden') ? 'Action réservée aux administrateurs.' : e.message.includes('duplicate') ? 'Ce nom de modèle existe déjà.' : e.message)
}

export async function listModels(s: TypedSupabaseClient): Promise<AdminModel[]> {
  const { data, error } = await s.rpc('admin_list_models')
  if (error) fail(error)
  return (data ?? []) as AdminModel[]
}

export async function createModel(s: TypedSupabaseClient, name: string, image_url: string | null) {
  const { data, error } = await s.from('models').insert({ name, image_url }).select('id').single()
  if (error) fail(error)
  return data!.id
}

export async function updateModel(s: TypedSupabaseClient, id: string, patch: { name?: string; image_url?: string | null }) {
  const { error } = await s.from('models').update(patch).eq('id', id)
  if (error) fail(error)
}

export async function deleteModel(s: TypedSupabaseClient, id: string) {
  const { error } = await s.from('models').delete().eq('id', id)
  if (error) fail(error)
}

/** Envoi depuis le PC → bucket public « model-images » ; renvoie l'URL publique. */
export async function uploadModelImage(s: TypedSupabaseClient, file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error('Format accepté : JPG, PNG ou WebP.')
  if (file.size > MAX_BYTES) throw new Error('Image trop lourde (5 Mo max).')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await s.storage.from('model-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) fail(error)
  return s.storage.from('model-images').getPublicUrl(path).data.publicUrl
}

export async function searchTitlesForModel(s: TypedSupabaseClient, q: string): Promise<ModelTitle[]> {
  const term = q.trim().replace(/[%_,()]/g, ' ')
  if (term.length < 2) return []
  const { data, error } = await s.from('titles').select('id, title, model_id').ilike('title', `%${term}%`).order('title').limit(200)
  if (error) fail(error)
  return (data ?? []) as ModelTitle[]
}

export async function attachTitles(s: TypedSupabaseClient, model: string | null, ids: string[]) {
  const { data, error } = await s.rpc('admin_attach_titles', { p_model: model, p_title_ids: ids })
  if (error) fail(error)
  return data ?? 0
}

export async function attachByQuery(s: TypedSupabaseClient, model: string, q: string, override: boolean) {
  const { data, error } = await s.rpc('admin_attach_by_query', { p_model: model, p_query: q, p_override: override })
  if (error) fail(error)
  return data ?? 0
}

/** Déplace tous les titres de « from » vers « into » puis supprime « from » (ex. un faux modèle « video »). */
export async function mergeModels(s: TypedSupabaseClient, from: string, into: string) {
  const { data, error } = await (s as unknown as { rpc: (n: string, a: object) => Promise<{ data: number | null; error: { message: string } | null }> }).rpc('admin_merge_models', { p_from: from, p_into: into })
  if (error) fail(error)
  return data ?? 0
}

/** Supprime les modèles sans aucun titre rattaché. */
export async function deleteEmptyModels(s: TypedSupabaseClient) {
  const { data, error } = await (s as unknown as { rpc: (n: string) => Promise<{ data: number | null; error: { message: string } | null }> }).rpc('admin_delete_empty_models')
  if (error) fail(error)
  return data ?? 0
}

/** Nouvelle capture (film et moment tirés au hasard) pour les modèles donnés, ou pour tous si `ids` est nul. */
export async function recaptureModels(s: TypedSupabaseClient, ids: string[] | null) {
  const { data, error } = await (s as unknown as { rpc: (n: string, a: object) => Promise<{ data: number | null; error: { message: string } | null }> }).rpc('admin_recapture_models', { p_ids: ids })
  if (error) fail(error)
  return data ?? 0
}
