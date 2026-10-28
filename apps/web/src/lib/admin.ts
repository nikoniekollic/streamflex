import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Enums, Json, Tables } from '@/types/database'
import { slugify } from '@/lib/utils'
import { invalidateCatalogCache } from '@/lib/catalog-api'
import { FILE_ID_RE, buildStreamUrl, extractFileId, isHoster } from '@/lib/stream-url'

// ───────── Constantes
export const PROVIDERS: { value: Enums<'video_provider'>; label: string; hint: string }[] = [
  { value: 'pixeldrain', label: 'Pixeldrain', hint: 'ID (ex. AbCd1234) ou colle l’URL pixeldrain.com/u/…' },
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
    /** pixeldrain / onefichier : ID seul (une URL collée est convertie) */
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
  provider: 'pixeldrain',
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
> & { genres: string[]; sourceCount: number }

export type AdminListSearch = { page?: number; q?: string; type?: 'movie' | 'series'; status?: 'published' | 'draft' }

export async function fetchAdminList(supabase: TypedSupabaseClient, s: AdminListSearch) {
  let query = supabase
    .from('titles')
    .select('id, type, slug, title, release_year, poster_url, is_published, updated_at, title_genres(genres(name)), media_sources(count)', {
      count: 'exact',
    })
  if (s.q) query = query.ilike('title', `%${s.q.replace(/[%_]/g, '\\$&')}%`)
  if (s.type) query = query.eq('type', s.type)
  if (s.status) query = query.eq('is_published', s.status === 'published')
  const from = ((s.page ?? 1) - 1) * PAGE_SIZE
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
  if (error) throw error

  type Raw = Omit<AdminListRow, 'genres' | 'sourceCount'> & {
    title_genres: { genres: { name: string } | null }[]
    media_sources: { count: number }[]
  }
  const rows: AdminListRow[] = ((data ?? []) as unknown as Raw[]).map(({ title_genres, media_sources, ...r }) => ({
    ...r,
    genres: title_genres.flatMap((g) => (g.genres ? [g.genres.name] : [])),
    sourceCount: media_sources[0]?.count ?? 0,
  }))
  return { rows, total: count ?? 0, pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) }
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

// ───────── Test de débridage (Edge Function admin `debrid-link`)
export type DebridTestResult =
  | { ok: true; url: string; filename: string | null; filesize: number | null; host: string | null }
  | { ok: false; message: string }

export function debridLinkFor(s: Pick<SourceFormValues, 'provider' | 'file_id' | 'raw_url'>): string | null {
  if (s.provider === 'onefichier') {
    const id = extractFileId('onefichier', s.file_id)
    return FILE_ID_RE.test(id) ? buildStreamUrl('onefichier', id) : null
  }
  if (s.provider === 'other' && s.raw_url) return s.raw_url
  return null
}

export async function testDebridLink(supabase: TypedSupabaseClient, link: string): Promise<DebridTestResult> {
  const { data, error } = await supabase.functions.invoke<{ url: string; filename: string | null; filesize: number | null; host: string | null }>(
    'debrid-link',
    { body: { link } },
  )
  if (!error && data?.url) return { ok: true, ...data }
  let message = 'Fonction de débridage injoignable.'
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const body = (await ctx.json().catch(() => null)) as { message?: string; error?: string } | null
    message = body?.message ?? body?.error ?? message
  }
  return { ok: false, message }
}
