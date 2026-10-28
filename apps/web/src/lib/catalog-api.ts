// Accès au catalogue via l'Edge Function `catalog` (cache Redis 1 h), repli direct Supabase si indisponible.
import type { TypedSupabaseClient } from '@/lib/supabase'

export type CacheState = 'HIT' | 'MISS' | 'BYPASS'

export async function invokeCatalog<T>(
  supabase: TypedSupabaseClient,
  body: Record<string, unknown>,
): Promise<{ data: T; cache: CacheState } | null> {
  try {
    const { data, error, response } = (await supabase.functions.invoke<T>('catalog', { body })) as {
      data: T | null
      error: unknown
      response?: Response
    }
    if (error || data === null) return null
    const state = (response?.headers.get('X-Cache') as CacheState | null) ?? 'BYPASS'
    if (import.meta.env.DEV) console.debug(`[catalog] ${String(body.op)} → ${state}`)
    return { data, cache: state }
  } catch {
    return null
  }
}

/** Purge du cache catalogue (admin) — le webhook BDD le fait aussi ; best effort. */
export async function invalidateCatalogCache(supabase: TypedSupabaseClient): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('catalog', { body: { op: 'invalidate' } })
    return !error
  } catch {
    return false
  }
}
