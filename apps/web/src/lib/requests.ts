import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database, Tables } from '@/types/database'

export type RequestStatus = Database['public']['Enums']['request_status']
export type MyRequest = Pick<
  Tables<'content_requests'>,
  'id' | 'title' | 'media_type' | 'release_year' | 'note' | 'status' | 'admin_note' | 'created_at' | 'handled_at'
> & { titles: { slug: string } | null }
export type AdminRequest = Database['public']['Functions']['admin_list_requests']['Returns'][number]

export const STATUS_LABEL: Record<RequestStatus, string> = { pending: 'En attente', added: 'Ajouté', rejected: 'Refusé' }
export const TYPE_LABEL = { movie: 'Film', series: 'Série' } as const
const THIS_YEAR = new Date().getFullYear()

export const requestSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Au moins 2 caractères')
    .max(200, '200 caractères maximum'),
  media_type: z.enum(['movie', 'series'], { message: 'Choisis Film ou Série' }),
  release_year: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{4}$/.test(v) && +v >= 1880 && +v <= THIS_YEAR + 3), `Année entre 1880 et ${THIS_YEAR + 3}`),
  note: z.string().trim().max(500, '500 caractères maximum'),
})
export type RequestValues = z.infer<typeof requestSchema>

const ERRORS: Record<string, string> = {
  '23505': 'Tu as déjà une demande en attente pour ce titre.',
  too_many_pending: 'Tu as déjà 20 demandes en attente : patiente qu’elles soient traitées.',
  daily_limit: 'Limite de 10 demandes par 24 h atteinte.',
}

export function requestError(e: { code?: string; message?: string }): string {
  return ERRORS[e.code ?? ''] ?? ERRORS[e.message ?? ''] ?? e.message ?? 'Envoi impossible.'
}

export async function createRequest(supabase: TypedSupabaseClient, v: RequestValues, profileId: string | null) {
  const { error } = await supabase.from('content_requests').insert({
    title: v.title,
    media_type: v.media_type,
    release_year: v.release_year ? Number(v.release_year) : null,
    note: v.note || null,
    profile_id: profileId,
  })
  if (error) throw new Error(requestError(error))
}

export async function fetchMyRequests(supabase: TypedSupabaseClient, userId: string): Promise<MyRequest[]> {
  const { data, error } = await supabase
    .from('content_requests')
    .select('id, title, media_type, release_year, note, status, admin_note, created_at, handled_at, titles(slug)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(0, 99)
  if (error) throw error
  return (data ?? []) as unknown as MyRequest[]
}

export async function cancelRequest(supabase: TypedSupabaseClient, id: string) {
  const { error } = await supabase.from('content_requests').delete().eq('id', id).eq('status', 'pending')
  if (error) throw new Error(requestError(error))
}

// ───────── Admin
export const ADMIN_PAGE = 50

export async function fetchAdminRequests(supabase: TypedSupabaseClient, q: { status?: RequestStatus; q?: string; page?: number }) {
  const { data, error } = await supabase.rpc('admin_list_requests', {
    p_status: q.status ?? null,
    p_q: q.q ?? null,
    p_limit: ADMIN_PAGE,
    p_offset: ((q.page ?? 1) - 1) * ADMIN_PAGE,
  })
  if (error) throw error
  const rows = data ?? []
  const total = rows[0]?.total_count ?? 0
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE)) }
}

/** Change le statut (lot) ; la BDD notifie chaque demandeur (ajouté / refusé). Renvoie le nombre de demandes modifiées. */
export async function setRequestStatus(
  supabase: TypedSupabaseClient,
  ids: string[],
  status: RequestStatus,
  opts: { note?: string; titleId?: string | null } = {},
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_set_request_status', {
    p_ids: ids,
    p_status: status,
    p_admin_note: opts.note?.trim() || null,
    p_title_id: opts.titleId ?? null,
  })
  if (error) throw new Error(error.message === 'title_not_found' ? 'Titre du catalogue introuvable.' : error.message)
  return data ?? 0
}

/** Recherche de titres du catalogue (admin : publiés ou non) pour lier une demande. */
export async function searchCatalogForLink(supabase: TypedSupabaseClient, q: string) {
  const term = q.trim().replace(/[%_]/g, '\\$&')
  if (term.length < 2) return []
  const { data } = await supabase
    .from('titles')
    .select('id, title, slug, type, release_year, is_published')
    .ilike('title', `%${term}%`)
    .order('is_published', { ascending: false })
    .range(0, 7)
  return data ?? []
}
