// Clés API gérées par l'admin (/admin/security → Supabase Vault), fallback variables d'environnement.
import { adminClient } from './admin-client.ts'

export type SecretName =
  | 'ALLDEBRID_API_KEY'
  | 'ALLDEBRID_AGENT'
  | 'PIXELDRAIN_API_KEY'
  | 'ONEFICHIER_API_KEY'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'REDIS_URL'
  | 'CATALOG_WEBHOOK_SECRET'

const TTL_MS = 5 * 60_000
const cache = new Map<SecretName, { value: string | undefined; at: number }>()

export async function getSecret(name: SecretName): Promise<string | undefined> {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value: string | undefined
  try {
    const { data, error } = await adminClient().rpc('get_api_key', { p_name: name })
    if (!error && typeof data === 'string' && data) value = data
  } catch {
    /* Vault indisponible → fallback env */
  }
  value ??= Deno.env.get(name) || undefined
  cache.set(name, { value, at: Date.now() })
  return value
}
