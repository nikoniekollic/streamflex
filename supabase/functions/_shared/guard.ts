// Middleware Edge : IP bannie ? abonnement actif ?
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from './admin-client.ts'
import { json } from './cors.ts'

/** IP client (même ordre de priorité que public.request_ip() côté PostgREST). */
export function clientIp(req: Request): string | null {
  const h = req.headers
  const ip = h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]
  return ip?.trim() || null
}

export type BanInfo = { reason: string | null; expires_at: string | null }

export async function lookupBan(ip: string | null): Promise<BanInfo | null> {
  if (!ip) return null
  const { data, error } = await adminClient().rpc('ip_ban_lookup', { p_ip: ip })
  if (error || !Array.isArray(data) || data.length === 0) return null
  return data[0] as BanInfo
}

/** Renvoie une Response 403 si l'IP est bannie, sinon null. */
export async function denyIfBanned(req: Request): Promise<Response | null> {
  const ban = await lookupBan(clientIp(req))
  return ban ? json({ error: 'ip_banned', reason: ban.reason, expires_at: ban.expires_at }, 403) : null
}

/** Renvoie une Response 402 si l'utilisateur n'a pas d'abonnement actif (admins exemptés côté SQL). */
export async function denyIfNoSubscription(userClient: SupabaseClient): Promise<Response | null> {
  const { data, error } = await userClient.rpc('has_active_subscription')
  if (error) return json({ error: 'subscription_check_failed' }, 503)
  return data === true ? null : json({ error: 'subscription_required' }, 402)
}
