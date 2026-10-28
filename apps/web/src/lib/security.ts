import type { TypedSupabaseClient } from '@/lib/supabase'

export type IpStatus = { ip: string | null; banned: boolean; reason: string | null; expires_at: string | null }

const TTL_MS = 60_000
let cached: { at: number; value: IpStatus } | null = null
let inflight: Promise<IpStatus> | null = null

/** Statut IP (Edge Function `ip-check`), mis en cache 60 s. Fail-open : l'application réelle est côté serveur. */
export async function getIpStatus(supabase: TypedSupabaseClient, force = false): Promise<IpStatus> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value
  inflight ??= (async () => {
    try {
      const { data, error } = await supabase.functions.invoke<IpStatus>('ip-check', { method: 'GET' })
      const value: IpStatus = !error && data ? data : { ip: null, banned: false, reason: null, expires_at: null }
      cached = { at: Date.now(), value }
      return value
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function clearIpStatus() {
  cached = null
}
