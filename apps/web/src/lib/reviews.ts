import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

export type Review = Database['public']['Functions']['title_reviews']['Returns'][number]
export type RatingSummary = Database['public']['Functions']['title_rating_summary']['Returns'][number]
export const REVIEWS_PAGE = 10

export const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Choisis une note').max(5),
  comment: z.string().trim().max(2000, '2000 caractères maximum'),
})
export type ReviewValues = z.infer<typeof reviewSchema>

export async function fetchRatingSummary(supabase: TypedSupabaseClient, titleId: string): Promise<RatingSummary> {
  const { data, error } = await supabase.rpc('title_rating_summary', { p_title_id: titleId })
  if (error) throw error
  const r = data?.[0]
  return {
    average: r?.average == null ? null : Number(r.average),
    total: Number(r?.total ?? 0),
    r1: Number(r?.r1 ?? 0),
    r2: Number(r?.r2 ?? 0),
    r3: Number(r?.r3 ?? 0),
    r4: Number(r?.r4 ?? 0),
    r5: Number(r?.r5 ?? 0),
  }
}

export async function fetchReviews(supabase: TypedSupabaseClient, titleId: string, profileId: string | null, page: number) {
  const { data, error } = await supabase.rpc('title_reviews', {
    p_title_id: titleId,
    p_profile_id: profileId,
    p_limit: REVIEWS_PAGE,
    p_offset: page * REVIEWS_PAGE,
  })
  if (error) throw error
  const rows = data ?? []
  return { rows, total: Number(rows[0]?.total_count ?? 0) }
}

export async function saveReview(supabase: TypedSupabaseClient, profileId: string, titleId: string, v: ReviewValues) {
  const { data, error } = await supabase.rpc('upsert_review', {
    p_profile_id: profileId,
    p_title_id: titleId,
    p_rating: v.rating,
    p_comment: v.comment || null,
  })
  if (error) throw error
  return data
}

export async function deleteReview(supabase: TypedSupabaseClient, id: string) {
  const { error } = await supabase.from('reviews').delete().eq('id', id)
  if (error) throw error
}

export function reviewError(e: { code?: string; message?: string }): string {
  if (e.code === '42501') return 'Action non autorisée.'
  if (e.code === '23514') return 'Note ou commentaire invalide.'
  return e.message ?? 'Enregistrement impossible.'
}
