import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Tables } from '@/types/database'

export type MySubscription = Pick<Tables<'subscriptions'>, 'status' | 'plan' | 'ends_at' | 'started_at'>

const cache = new Map<string, MySubscription | null>()

export async function getMySubscription(supabase: TypedSupabaseClient, userId: string): Promise<MySubscription | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, plan, ends_at, started_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  cache.set(userId, data)
  return data
}

export function clearSubscriptionCache() {
  cache.clear()
}

export function isSubscriptionActive(s: MySubscription | null | undefined): boolean {
  return !!s && s.status === 'active' && new Date(s.ends_at).getTime() > Date.now()
}

export function daysLeft(s: MySubscription | null | undefined): number {
  if (!s) return 0
  return Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 86_400_000))
}

// ───────── Codes d'activation (25 caractères, groupes de 5)
export const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g

export function normalizeCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25)
}

export function formatCode(v: string): string {
  return normalizeCode(v).replace(/(.{5})(?=.)/g, '$1-')
}

const REDEEM_ERRORS: Record<string, string> = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  invalid_format: 'Le code doit contenir 25 caractères.',
  invalid_code: 'Code invalide.',
  code_used: 'Ce code a déjà été utilisé.',
  code_expired: 'Ce code a expiré.',
  too_many_attempts: 'Trop de tentatives. Réessaie dans une heure.',
  subscription_suspended: 'Ton abonnement est suspendu. Contacte le support.',
}

export type RedeemResult = { ok: true; days: number; ends_at: string } | { ok: false; message: string }

export async function redeemCode(supabase: TypedSupabaseClient, code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_activation_code', { p_code: normalizeCode(code) })
  if (error) return { ok: false, message: error.message }
  const r = data as { ok: boolean; error?: string; days?: number; ends_at?: string }
  if (!r.ok) return { ok: false, message: REDEEM_ERRORS[r.error ?? ''] ?? 'Activation impossible.' }
  clearSubscriptionCache()
  return { ok: true, days: r.days ?? 0, ends_at: r.ends_at ?? '' }
}

export const dateFr = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
export const dateTimeFr = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
