import { useEffect, useSyncExternalStore } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { CatalogTitle } from '@/lib/catalog'
import { MOCK_TITLES } from '@/lib/mock-catalog'

const MOCK_PREFIX = '00000000-0000-4000-8000-'
const isMockId = (id: string) => id.startsWith(MOCK_PREFIX)

// ───────── Store global (IDs favoris de l'utilisateur courant) — partagé par toutes les cartes
type State = { profileId: string | null; ids: ReadonlySet<string>; loaded: boolean; pending: ReadonlySet<string> }

let state: State = { profileId: null, ids: new Set(), loaded: false, pending: new Set() }
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state

export function resetFavorites() {
  loading = null
  setState({ profileId: null, ids: new Set(), loaded: false, pending: new Set() })
}

async function ensureLoaded(supabase: TypedSupabaseClient, profileId: string) {
  if (state.profileId === profileId && state.loaded) return
  if (loading && state.profileId === profileId) return loading
  setState({ profileId, ids: new Set(), loaded: false })
  loading = (async () => {
    const { data, error } = await supabase
      .from('user_favorites')
      .select('title_id')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .range(0, 999)
    if (state.profileId !== profileId) return
    if (error) {
      loading = null
      return
    }
    // conserve les ajouts locaux (démo) faits avant la fin du chargement
    setState({ ids: new Set([...data.map((r) => r.title_id), ...[...state.ids].filter(isMockId)]), loaded: true })
  })()
  return loading
}

function withId(set: ReadonlySet<string>, id: string, on: boolean) {
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

type Toggleable = Pick<CatalogTitle, 'id' | 'title'>

async function toggleFavorite(supabase: TypedSupabaseClient, t: Toggleable, onView: () => void): Promise<void> {
  if (state.pending.has(t.id)) return
  const wasFav = state.ids.has(t.id)

  // optimiste
  setState({ ids: withId(state.ids, t.id, !wasFav), pending: withId(state.pending, t.id, true) })

  let error: { message: string } | null = null
  const profileId = state.profileId
  if (!isMockId(t.id) && profileId) {
    const res = wasFav
      ? await supabase.from('user_favorites').delete().eq('profile_id', profileId).eq('title_id', t.id)
      : await supabase.from('user_favorites').insert({ title_id: t.id, profile_id: profileId })
    // 23505 = déjà présent (autre onglet) → état final correct
    error = res.error && res.error.code !== '23505' ? res.error : null
  }

  setState({ pending: withId(state.pending, t.id, false) })

  if (error) {
    setState({ ids: withId(state.ids, t.id, wasFav) }) // rollback
    toast.error(wasFav ? 'Impossible de retirer ce titre' : "Impossible d'ajouter ce titre", { description: error.message })
    return
  }

  if (wasFav) {
    toast('Retiré de Ma liste', {
      description: t.title,
      action: { label: 'Annuler', onClick: () => void toggleFavorite(supabase, t, onView) },
    })
  } else {
    toast.success('Ajouté à Ma liste', {
      description: t.title,
      action: { label: 'Voir', onClick: onView },
    })
  }
}

// ───────── Hooks
export function useFavorites() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const profileId = activeProfile?.id

  useEffect(() => {
    if (profileId) void ensureLoaded(supabase, profileId)
  }, [supabase, profileId])

  return {
    ids: s.ids,
    loaded: s.loaded,
    isFavorite: (id: string) => s.ids.has(id),
    isPending: (id: string) => s.pending.has(id),
    toggle: (t: Toggleable) => toggleFavorite(supabase, t, () => void router.navigate({ to: '/my-list' })),
  }
}

export function useFavorite(t: Toggleable) {
  const f = useFavorites()
  return { isFavorite: f.isFavorite(t.id), pending: f.isPending(t.id), loaded: f.loaded, toggle: () => f.toggle(t) }
}

// ───────── Page /my-list
type Joined = Omit<CatalogTitle, 'genres'> & { title_genres: { genres: { slug: string; name: string } | null }[] }

export async function fetchMyList(supabase: TypedSupabaseClient, profileId: string): Promise<CatalogTitle[]> {
  await ensureLoaded(supabase, profileId)
  const { data, error } = await supabase
    .from('user_favorites')
    .select(
      'created_at, titles(id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at, title_genres(genres(slug, name)))',
    )
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .range(0, 499)
  if (error) throw error

  const rows = (data ?? []) as unknown as { titles: Joined | null }[]
  const real = rows.flatMap(({ titles: t }) => {
    if (!t) return []
    const { title_genres, ...rest } = t
    return [{ ...rest, genres: title_genres.flatMap((g) => (g.genres ? [g.genres] : [])) }]
  })
  const mock = MOCK_TITLES.filter((m) => state.ids.has(m.id))
  return [...mock, ...real]
}
