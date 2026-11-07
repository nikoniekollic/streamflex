// Clés API gérées par l'admin (/admin/security → Supabase Vault), fallback variables d'environnement.
import { adminClient } from './admin-client.ts'

export type SecretName =
  | 'ONEFICHIER_API_KEY'
  | 'ALLDEBRID_API_KEY'
  | 'ALLDEBRID_AGENT'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'REDIS_URL'
  | 'CATALOG_WEBHOOK_SECRET'

const TTL_MS = 5 * 60_000
// La PROMESSE est mise en cache : un lot de 24 films demande la clé 24 fois en même temps, une seule lecture du Vault part
const cache = new Map<SecretName, { value: Promise<string | undefined>; at: number }>()

export function getSecret(name: SecretName): Promise<string | undefined> {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = (async () => {
    let v: string | undefined
    try {
      const { data, error } = await adminClient().rpc('get_api_key', { p_name: name })
      if (!error && typeof data === 'string' && data) v = data
    } catch {
      /* Vault indisponible → fallback env */
    }
    return v ?? (Deno.env.get(name) || undefined)
  })()
  cache.set(name, { value, at: Date.now() })
  return value
}
