// Opérations admin : utilisateurs, abonnements, codes, IP, clés API (toutes contrôlées par is_admin() côté SQL)
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database, Enums, Tables } from '@/types/database'

export type AdminUser = Database['public']['Functions']['admin_list_users']['Returns'][number]
export type UserFilter = 'active' | 'expired' | 'suspended' | 'admin'
export const USERS_PAGE = 25

const ERR: Record<string, string> = {
  forbidden: 'Action réservée aux administrateurs.',
  invalid_days: 'Nombre de jours invalide.',
  user_not_found: 'Utilisateur introuvable.',
  invalid_count: 'Entre 1 et 500 codes par lot.',
  code_not_updatable: 'Ce code a déjà été utilisé.',
  unknown_key: 'Nom de clé inconnu.',
  invalid_value: 'Valeur invalide (3 à 4096 caractères).',
}

export function opError(e: unknown): Error {
  const err = e as { message?: string; code?: string }
  if (err?.code === '23505') return new Error('Cette entrée existe déjà.')
  if (err?.code === '22P02') return new Error('Adresse IP ou plage CIDR invalide.')
  return new Error(ERR[err?.message ?? ''] ?? err?.message ?? 'Erreur inconnue.')
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw opError(error)
  return data as T
}

async function runList<T>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await p
  if (error) throw opError(error)
  return data ?? []
}

// ───────── Utilisateurs & abonnements
export async function listUsers(s: TypedSupabaseClient, q: { q?: string; filter?: UserFilter; page?: number }) {
  const rows: AdminUser[] = ((await runList(
    s.rpc('admin_list_users', {
      p_q: q.q ?? null,
      p_filter: q.filter ?? null,
      p_limit: USERS_PAGE,
      p_offset: ((q.page ?? 1) - 1) * USERS_PAGE,
    }),
  )) || []) as AdminUser[]
  const total = rows[0]?.total_count ?? 0
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / USERS_PAGE)) }
}

export const adjustSubscription = (s: TypedSupabaseClient, user: string, days: number, note?: string) =>
  run(s.rpc('admin_adjust_subscription', { p_user: user, p_days: days, p_note: note || null }))

export const setSubscription = (
  s: TypedSupabaseClient,
  user: string,
  endsAt: string | null,
  status: Enums<'subscription_status'>,
  note?: string,
) => run(s.rpc('admin_set_subscription', { p_user: user, p_ends_at: endsAt, p_status: status, p_note: note || null }))

export async function userEvents(s: TypedSupabaseClient, user: string) {
  return runList(
    s
      .from('subscription_events')
      .select('id, source, delta_days, previous_ends_at, new_ends_at, status, note, created_at')
      .eq('user_id', user)
      .order('created_at', { ascending: false })
      .range(0, 19),
  )
}

// ───────── Codes d'activation
export type CodeRow = Pick<
  Tables<'activation_codes'>,
  'id' | 'code_hint' | 'duration_days' | 'status' | 'label' | 'expires_at' | 'created_at' | 'used_at' | 'used_by'
>

export async function listCodes(s: TypedSupabaseClient, status?: Enums<'activation_code_status'>) {
  let q = s
    .from('activation_codes')
    .select('id, code_hint, duration_days, status, label, expires_at, created_at, used_at, used_by', { count: 'exact' })
  if (status) q = q.eq('status', status)
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(0, 99)
  if (error) throw opError(error)
  return { rows: (data ?? []) as CodeRow[], total: count ?? 0 }
}

export const generateCodes = (s: TypedSupabaseClient, count: number, days: number, label?: string, expiresAt?: string | null) =>
  runList(s.rpc('admin_generate_codes', { p_count: count, p_duration_days: days, p_label: label || null, p_expires_at: expiresAt ?? null }))

export const setCodeStatus = (s: TypedSupabaseClient, id: string, status: 'active' | 'revoked') =>
  run(s.rpc('admin_set_code_status', { p_id: id, p_status: status }))

export function downloadCodesCsv(codes: { code: string }[], days: number, label?: string) {
  const csv = ['code,duration_days,label', ...codes.map((c) => `${c.code},${days},"${(label ?? '').replace(/"/g, '""')}"`)].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `codes-${days}j-${new Date().toISOString().slice(0, 10)}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

// ───────── Bannissements IP
export type IpBan = Tables<'ip_bans'>

export const listBans = (s: TypedSupabaseClient) =>
  runList(s.from('ip_bans').select('id, ip, reason, expires_at, created_by, created_at').order('created_at', { ascending: false }).range(0, 499))

export async function banIp(s: TypedSupabaseClient, ip: string, reason: string, expiresAt: string | null, userId: string) {
  await run(s.from('ip_bans').insert({ ip: ip.trim(), reason: reason.trim() || null, expires_at: expiresAt, created_by: userId }))
}

export const unbanIp = (s: TypedSupabaseClient, id: string) => run(s.from('ip_bans').delete().eq('id', id))

export function isValidIpOrCidr(v: string): boolean {
  const t = v.trim()
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/
  const v6 = /^[0-9a-f:]+(\/(12[0-8]|1[01]\d|[1-9]?\d))?$/i
  return v4.test(t) || (t.includes(':') && v6.test(t))
}

// ───────── Clés API (Vault)
export const API_KEYS: { name: string; label: string; help: string; secret: boolean }[] = [
  { name: 'ALLDEBRID_API_KEY', label: 'Alldebrid — clé API', help: 'alldebrid.com → Mon compte → Clés API', secret: true },
  { name: 'ALLDEBRID_AGENT', label: 'Alldebrid — agent', help: "Nom d'application déclaré (ex. streamflex)", secret: false },
  { name: 'PIXELDRAIN_API_KEY', label: 'Pixeldrain — clé API', help: 'pixeldrain.com → Paramètres → Clés API', secret: true },
  { name: 'ONEFICHIER_API_KEY', label: '1fichier — clé API', help: '1fichier.com → Paramètres → API', secret: true },
  { name: 'UPSTASH_REDIS_REST_URL', label: 'Redis (Upstash) — URL REST', help: 'https://….upstash.io', secret: false },
  { name: 'UPSTASH_REDIS_REST_TOKEN', label: 'Redis (Upstash) — token', help: 'Token REST', secret: true },
  { name: 'REDIS_URL', label: 'Redis — URL TCP (ioredis)', help: 'rediss://user:pass@hôte:port — prioritaire sur Upstash REST', secret: true },
  { name: 'CATALOG_WEBHOOK_URL', label: 'Cache catalogue — URL du webhook', help: 'https://<ref>.supabase.co/functions/v1/catalog-webhook', secret: false },
  { name: 'CATALOG_WEBHOOK_SECRET', label: 'Cache catalogue — secret du webhook', help: '≥ 16 caractères — bouton « Générer »', secret: true },
]

export function generateSecret(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const listApiKeys = (s: TypedSupabaseClient) => runList(s.rpc('admin_list_api_keys'))
export const setApiKey = (s: TypedSupabaseClient, name: string, value: string) => run(s.rpc('admin_set_api_key', { p_name: name, p_value: value }))
export const deleteApiKey = (s: TypedSupabaseClient, name: string) => run(s.rpc('admin_delete_api_key', { p_name: name }))

// ───────── Utilitaires
export const DURATION_PRESETS = [
  { label: '7 jours', days: 7 },
  { label: '1 mois', days: 30 },
  { label: '3 mois', days: 90 },
  { label: '6 mois', days: 180 },
  { label: '1 an', days: 365 },
]

export const BAN_PRESETS: { label: string; minutes: number | null }[] = [
  { label: '1 heure', minutes: 60 },
  { label: '24 heures', minutes: 1440 },
  { label: '7 jours', minutes: 10080 },
  { label: '30 jours', minutes: 43200 },
  { label: 'Permanent', minutes: null },
]
