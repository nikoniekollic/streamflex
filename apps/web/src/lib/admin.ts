import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Enums, Json, Tables } from '@/types/database'
import { slugify } from '@/lib/utils'
import { invalidateCatalogCache } from '@/lib/catalog-api'
import { FILE_ID_RE, extractFileId, isHoster } from '@/lib/stream-url'

// ───────── Constantes
export const PROVIDERS: { value: Enums<'video_provider'>; label: string; hint: string }[] = [
  { value: 'onefichier', label: '1fichier', hint: 'ID (ex. x7k2m9p4q1w8e3r5t6y0) ou colle l’URL 1fichier.com/?…' },
  { value: 'alist', label: 'AList', hint: 'URL signée /d/…' },
  { value: 'other', label: 'Autre', hint: 'URL directe' },
]
export const QUALITIES: Enums<'video_quality'>[] = ['2160p', '1080p', '720p', '480p']
export const MATURITY = ['Tous publics', '10+', '12+', '16+', '18+']
export const PAGE_SIZE = 20

// ───────── Formulaire
const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'URL invalide (http/https)')

const sourceSchema = z
  .object({
    id: z.string().optional(),
    provider: z.enum(['pixeldrain', 'onefichier', 'alist', 'other']),
    /** onefichier : ID seul (une URL collée est convertie) */
    file_id: z.string().trim().max(300),
    /** alist / other uniquement */
    raw_url: optionalUrl,
    quality: z.enum(['2160p', '1080p', '720p', '480p']),
    priority: z.string().regex(/^\d{1,4}$/, 'Nombre requis'),
    is_active: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (isHoster(s.provider)) {
      if (!FILE_ID_RE.test(extractFileId(s.provider, s.file_id))) {
        ctx.addIssue({ code: 'custom', path: ['file_id'], message: 'Identifiant invalide (4 à 32 caractères alphanumériques) ou URL non reconnue' })
      }
    } else if (!s.raw_url) {
      ctx.addIssue({ code: 'custom', path: ['raw_url'], message: 'URL requise pour ce fournisseur' })
    }
  })

export const titleFormSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['movie', 'series']),
  title: z.string().trim().min(1, 'Titre requis').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug requis')
    .regex(/^[a-z0-9-]+$/, 'Minuscules, chiffres et tirets uniquement'),
  original_title: z.string().trim().max(200),
  synopsis: z.string().trim().max(4000),
  release_year: z.string().refine((v) => v === '' || (/^\d{4}$/.test(v) && +v >= 1880 && +v <= 2100), 'Année invalide'),
  runtime_minutes: z.string().refine((v) => v === '' || (/^\d{1,4}$/.test(v) && +v > 0), 'Durée invalide'),
  maturity_rating: z.string(),
  poster_url: optionalUrl,
  backdrop_url: optionalUrl,
  logo_url: optionalUrl,
  trailer_url: optionalUrl,
  is_published: z.boolean(),
  genre_ids: z.array(z.number()),
  sources: z.array(sourceSchema),
})

export type TitleFormValues = z.infer<typeof titleFormSchema>
export type SourceFormValues = TitleFormValues['sources'][number]

export const emptySource = (): SourceFormValues => ({
  provider: 'onefichier',
  file_id: '',
  raw_url: '',
  quality: '1080p',
  priority: '10',
  is_active: true,
})

export const emptyTitle = (): TitleFormValues => ({
  type: 'movie',
  title: '',
  slug: '',
  original_title: '',
  synopsis: '',
  release_year: '',
  runtime_minutes: '',
  maturity_rating: '',
  poster_url: '',
  backdrop_url: '',
  logo_url: '',
  trailer_url: '',
  is_published: false,
  genre_ids: [],
  sources: [],
})

// ───────── Lecture
export type AdminListRow = Pick<
  Tables<'titles'>,
  'id' | 'type' | 'slug' | 'title' | 'release_year' | 'poster_url' | 'is_published' | 'updated_at'
> & { genres: string[]; sourceCount: number; model: string | null }

/** genre : id numérique de catégorie ou « none » (sans catégorie) ; model : id de modèle ou « none » (sans modèle) */
export type AdminListSearch = { page?: number; q?: string; type?: 'movie' | 'series'; status?: 'published' | 'draft'; genre?: string; model?: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Filtres communs à la liste et à « tout sélectionner » (mêmes règles). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAdminFilters(query: any, s: AdminListSearch) {
  if (s.q) query = query.ilike('title', `%${s.q.replace(/[%_]/g, '\\$&')}%`)
  if (s.type) query = query.eq('type', s.type)
  if (s.status) query = query.eq('is_published', s.status === 'published')
  if (s.model === 'none') query = query.is('model_id', null)
  else if (s.model && UUID_RE.test(s.model)) query = query.eq('model_id', s.model)
  if (s.genre === 'none') query = query.is('title_genres', null)
  else if (s.genre && /^\d+$/.test(s.genre)) query = query.eq('genre_f.genre_id', Number(s.genre))
  return query
}

const genreJoin = (s: AdminListSearch) => (s.genre && /^\d+$/.test(s.genre) ? ', genre_f:title_genres!inner(genre_id)' : '')

export async function fetchAdminList(supabase: TypedSupabaseClient, s: AdminListSearch) {
  const query = applyAdminFilters(
    supabase
      .from('titles')
      .select(`id, type, slug, title, release_year, poster_url, is_published, updated_at, title_genres(genres(name)), media_sources(count), models(name)${genreJoin(s)}`, {
        count: 'exact',
      }),
    s,
  )
  const from = ((s.page ?? 1) - 1) * PAGE_SIZE
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
  if (error) throw error

  type Raw = Omit<AdminListRow, 'genres' | 'sourceCount' | 'model'> & {
    title_genres: { genres: { name: string } | null }[]
    media_sources: { count: number }[]
    models: { name: string } | null
  }
  const rows: AdminListRow[] = ((data ?? []) as unknown as Raw[]).map(({ title_genres, media_sources, models, ...r }) => ({
    ...r,
    model: models?.name ?? null,
    genres: title_genres.flatMap((g) => (g.genres ? [g.genres.name] : [])),
    sourceCount: media_sources[0]?.count ?? 0,
  }))
  return { rows, total: count ?? 0, pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) }
}

/** Tous les identifiants correspondant aux filtres (pour « sélectionner tous les résultats »), 20 000 au plus. */
export async function fetchAdminIds(supabase: TypedSupabaseClient, s: AdminListSearch): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const q = applyAdminFilters(supabase.from('titles').select(`id${genreJoin(s)}${s.genre === 'none' ? ', title_genres(genre_id)' : ''}`), s)
    const { data, error } = await q.order('updated_at', { ascending: false }).order('id').range(from, from + 999)
    if (error) throw error
    const rows = (data ?? []) as unknown as { id: string }[]
    ids.push(...rows.map((r) => r.id))
    if (rows.length < 1000) break
  }
  return ids
}

const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))

// ───────── Actions groupées (par lots : longueur d'URL et délais)
export async function bulkSetPublished(supabase: TypedSupabaseClient, ids: string[], value: boolean) {
  for (const c of chunks(ids, 100)) {
    const { error } = await supabase
      .from('titles')
      .update({ is_published: value, ...(value ? { published_at: new Date().toISOString() } : {}) })
      .in('id', c)
    if (error) throw error
  }
  void invalidateCatalogCache(supabase)
}

export async function bulkDelete(supabase: TypedSupabaseClient, ids: string[]) {
  for (const c of chunks(ids, 100)) {
    const { error } = await supabase.from('titles').delete().in('id', c)
    if (error) throw error
  }
  void invalidateCatalogCache(supabase)
}

export async function bulkGenre(supabase: TypedSupabaseClient, ids: string[], genreId: number, add: boolean) {
  for (const c of chunks(ids, 100)) {
    const { error } = add
      ? await supabase.from('title_genres').upsert(c.map((title_id) => ({ title_id, genre_id: genreId })), { onConflict: 'title_id,genre_id', ignoreDuplicates: true })
      : await supabase.from('title_genres').delete().eq('genre_id', genreId).in('title_id', c)
    if (error) throw error
  }
  void invalidateCatalogCache(supabase)
}

export async function fetchGenres(supabase: TypedSupabaseClient) {
  const { data, error } = await supabase.from('genres').select('id, slug, name').order('name').range(0, 199)
  if (error) throw error
  return data
}

export async function createGenre(supabase: TypedSupabaseClient, name: string) {
  const { data, error } = await supabase
    .from('genres')
    .insert({ name: name.trim(), slug: slugify(name) })
    .select('id, slug, name')
    .single()
  if (error) throw error
  void invalidateCatalogCache(supabase)
  return data
}

export async function fetchTitleForEdit(supabase: TypedSupabaseClient, id: string): Promise<TitleFormValues | null> {
  const [titleRes, genresRes, sourcesRes] = await Promise.all([
    supabase
      .from('titles')
      .select(
        'id, type, slug, title, original_title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, trailer_url, is_published',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase.from('title_genres').select('genre_id').eq('title_id', id).range(0, 99),
    supabase
      .from('media_sources')
      .select('id, provider, file_id, raw_url, quality, priority, is_active')
      .eq('title_id', id)
      .order('priority')
      .range(0, 49),
  ])
  if (titleRes.error) throw titleRes.error
  const t = titleRes.data
  if (!t) return null
  const s = (v: string | number | null) => (v === null || v === undefined ? '' : String(v))
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    slug: t.slug,
    original_title: s(t.original_title),
    synopsis: s(t.synopsis),
    release_year: s(t.release_year),
    runtime_minutes: s(t.runtime_minutes),
    maturity_rating: s(t.maturity_rating),
    poster_url: s(t.poster_url),
    backdrop_url: s(t.backdrop_url),
    logo_url: s(t.logo_url),
    trailer_url: s(t.trailer_url),
    is_published: t.is_published,
    genre_ids: (genresRes.data ?? []).map((g) => g.genre_id),
    sources: (sourcesRes.data ?? []).map((m) => ({
      id: m.id,
      provider: m.provider,
      file_id: s(m.file_id),
      raw_url: s(m.raw_url),
      quality: m.quality,
      priority: String(m.priority),
      is_active: m.is_active,
    })),
  }
}

// ───────── Écriture
const DB_ERRORS: Record<string, string> = {
  '23505': 'Conflit : ce slug ou cet identifiant de source existe déjà.',
  '23514': 'Valeur refusée par une contrainte de la base.',
  '42501': 'Action réservée aux administrateurs.',
  P0001: 'Opération refusée par la base.',
}

export function adminErrorMessage(e: unknown): string {
  const err = e as { code?: string; message?: string }
  if (err?.message?.includes('media_sources_provider_uidx')) return 'Cet identifiant de source est déjà utilisé par un autre titre.'
  if (err?.message?.includes('titles_slug_key')) return 'Ce slug est déjà utilisé.'
  return (err?.code && DB_ERRORS[err.code]) || err?.message || 'Erreur inconnue.'
}

export async function saveTitle(supabase: TypedSupabaseClient, v: TitleFormValues): Promise<string> {
  const { sources, genre_ids, ...title } = v
  const { data, error } = await supabase.rpc('admin_save_title', {
    p_title: title as unknown as Json,
    p_genre_ids: genre_ids,
    p_sources:
      v.type === 'movie'
        ? (sources.map((s) =>
            isHoster(s.provider)
              ? { ...s, file_id: extractFileId(s.provider, s.file_id), raw_url: '' } // jamais d'URL stockée
              : { ...s, file_id: '' },
          ) as unknown as Json)
        : null,
  })
  if (error) throw error
  void invalidateCatalogCache(supabase)
  return data
}

export async function deleteTitle(supabase: TypedSupabaseClient, id: string) {
  const { error } = await supabase.from('titles').delete().eq('id', id)
  if (error) throw error
  void invalidateCatalogCache(supabase)
}

export async function setPublished(supabase: TypedSupabaseClient, id: string, is_published: boolean) {
  const { error } = await supabase.from('titles').update({ is_published }).eq('id', id)
  if (error) throw error
  void invalidateCatalogCache(supabase)
}
