import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { env } from '@/lib/env'

// Tables/RPC de la surveillance : ajoutées après la génération de database.ts → client non typé
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

export type WatchConfig = {
  enabled: boolean
  publish: boolean
  model_per_folder: boolean
  folders_per_tick: number
  url: string | null
  last_tick_at: string | null
  last_message: string | null
}
export type WatchStats = { folders: number; due: number; hot: number }

export async function fetchWatch(s: TypedSupabaseClient): Promise<{ config: WatchConfig | null; stats: WatchStats }> {
  const db = raw(s)
  const now = new Date().toISOString()
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const [cfg, all, due, hot] = await Promise.all([
    db.from('watch_config').select('enabled, publish, model_per_folder, folders_per_tick, url, last_tick_at, last_message').eq('id', 1).maybeSingle(),
    db.from('watch_folders').select('folder_id', { count: 'exact', head: true }).eq('active', true),
    db.from('watch_folders').select('folder_id', { count: 'exact', head: true }).eq('active', true).lte('next_scan_at', now),
    db.from('watch_folders').select('folder_id', { count: 'exact', head: true }).gte('last_new_at', since),
  ])
  return { config: (cfg.data as WatchConfig | null) ?? null, stats: { folders: all.count ?? 0, due: due.count ?? 0, hot: hot.count ?? 0 } }
}

export async function setWatch(s: TypedSupabaseClient, enabled: boolean, publish: boolean, modelPerFolder: boolean) {
  const { error } = await raw(s).rpc('admin_watch_set', {
    p_enabled: enabled,
    p_publish: publish,
    p_model_per_folder: modelPerFolder,
    p_url: `${env.supabaseUrl}/functions/v1/onefichier-import`,
    p_anon_key: env.supabaseAnonKey,
  })
  if (error) throw new Error(error.message)
}

export async function watchNow(s: TypedSupabaseClient) {
  const { error } = await s.functions.invoke('onefichier-import', { body: { action: 'watch_now' } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b = (await error.context.json().catch(() => ({}))) as { message?: string; error?: string }
      throw new Error(b.message ?? b.error ?? 'Erreur du serveur')
    }
    throw new Error('Serveur injoignable')
  }
}
