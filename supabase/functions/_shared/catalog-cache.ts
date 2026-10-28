// Cache du catalogue public (accueil + recherche) — clés versionnées, invalidation O(1) par INCR.
import { cache } from './redis.ts'

export const CATALOG_TTL = 3600 // 1 h
const VERSION_KEY = 'catalog:version'

export async function catalogVersion(): Promise<string> {
  return (await cache.getRaw(VERSION_KEY)) ?? '0'
}

export async function catalogKey(kind: string, params: unknown = null): Promise<string> {
  const version = await catalogVersion()
  if (params === null) return `catalog:v${version}:${kind}`
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(params)))
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `catalog:v${version}:${kind}:${hex}`
}

/** Read-through : Redis → sinon `load()` → stockage TTL 1 h. */
export async function remember<T>(key: string, load: () => Promise<T>, ttl = CATALOG_TTL): Promise<{ data: T; hit: boolean }> {
  const cached = await cache.get<T>(key)
  if (cached !== null) return { data: cached, hit: true }
  const data = await load()
  await cache.set(key, data, ttl)
  return { data, hit: false }
}

/** Purge logique de tout le catalogue (les anciennes clés expirent d'elles-mêmes). */
export async function invalidateCatalog(): Promise<number | null> {
  return cache.incr(VERSION_KEY)
}
