import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Loader2, SearchX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MovieCard, MovieCardSkeleton } from '@/components/catalog/MovieCard'
import { SEARCH_PAGE_SIZE, searchTitles, validateSearchParams, type SearchParams } from '@/lib/search'

export const Route = createFileRoute('/_authed/_shell/search')({
  validateSearch: validateSearchParams,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => searchTitles(context.supabase, deps, context.isKids),
  staleTime: 30_000,
  pendingMs: 150,
  pendingMinMs: 250,
  pendingComponent: SearchPending,
  component: SearchPage,
})

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'

const TYPES: { value: SearchParams['type']; label: string }[] = [
  { value: undefined, label: 'Tout' },
  { value: 'movie', label: 'Films' },
  { value: 'series', label: 'Séries' },
]

function SearchPage() {
  const { results, total, hasMore, genres, isMock } = Route.useLoaderData()
  const search = Route.useSearch()
  const loading = useRouterState({ select: (s) => s.isLoading })
  const hasFilters = !!(search.type || search.genre)
  const page = search.page ?? 1

  return (
    <div className="px-6 py-8 md:px-12">
      <Header q={search.q} total={total} loading={loading} />
      <Filters search={search} genres={genres} />

      {results.length === 0 ? (
        <EmptyState q={search.q} hasFilters={hasFilters} />
      ) : (
        <>
          <ul className={cn(GRID, 'transition-opacity', loading && 'opacity-60')}>
            {results.map((t) => (
              <li key={t.id}>
                <MovieCard title={t} />
                <p className="mt-2 line-clamp-1 text-sm text-neutral-300">{t.title}</p>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-10 flex justify-center">
              <Button asChild variant="secondary" size="lg" disabled={loading}>
                <Link to="/search" search={{ ...search, page: page + 1 }} replace resetScroll={false}>
                  {loading && <Loader2 className="animate-spin" />} Afficher plus
                </Link>
              </Button>
            </div>
          )}
        </>
      )}

      {isMock && (
        <p className="mt-10 text-xs text-neutral-500">Données de démonstration — aucun titre publié dans le catalogue.</p>
      )}
    </div>
  )
}

function Header({ q, total, loading }: { q?: string; total: number; loading: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-bold md:text-3xl">
        {q ? (
          <>
            Résultats pour <span className="text-primary">« {q} »</span>
          </>
        ) : (
          'Explorer le catalogue'
        )}
      </h1>
      <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {total} titre{total > 1 ? 's' : ''}
      </span>
    </div>
  )
}

function Filters({ search, genres }: { search: SearchParams; genres: { slug: string; name: string }[] }) {
  const chip = (active: boolean) =>
    cn(
      'shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors',
      active ? 'border-white bg-white font-medium text-black' : 'border-white/25 text-neutral-200 hover:border-white/60',
    )

  return (
    <div className="mb-8 grid gap-4">
      <div role="tablist" aria-label="Type" className="inline-flex w-fit rounded-lg bg-neutral-900 p-1">
        {TYPES.map((t) => {
          const active = search.type === t.value
          return (
            <Link
              key={t.label}
              role="tab"
              aria-selected={active}
              to="/search"
              search={{ ...search, type: t.value, page: undefined }}
              replace
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground shadow' : 'text-neutral-300 hover:text-white',
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {genres.length > 0 && (
        <div className="scrollbar-none -mx-6 flex gap-2 overflow-x-auto px-6 md:mx-0 md:flex-wrap md:px-0" aria-label="Catégories">
          <Link to="/search" search={{ ...search, genre: undefined, page: undefined }} replace className={chip(!search.genre)}>
            Toutes
          </Link>
          {genres.map((g) => (
            <Link
              key={g.slug}
              to="/search"
              search={{ ...search, genre: search.genre === g.slug ? undefined : g.slug, page: undefined }}
              replace
              aria-pressed={search.genre === g.slug}
              className={chip(search.genre === g.slug)}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ q, hasFilters }: { q?: string; hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <SearchX className="size-14 text-neutral-600" />
      <h2 className="text-xl font-semibold">Aucun résultat{q ? ` pour « ${q} »` : ''}</h2>
      <ul className="text-sm text-muted-foreground">
        <li>Vérifie l'orthographe ou essaie des mots-clés plus courts.</li>
        <li>Cherche par titre, titre original ou mot de la description.</li>
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        {hasFilters && (
          <Button asChild variant="secondary">
            <Link to="/search" search={{ q }} replace>
              <X /> Retirer les filtres
            </Link>
          </Button>
        )}
        {q && (
          <Button asChild variant="outline">
            <Link to="/search" search={{}}>
              Tout le catalogue
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link to="/request" search={q ? { title: q } : {}}>
            Demander ce titre
          </Link>
        </Button>
      </div>
    </div>
  )
}

function SearchPending() {
  const search = Route.useSearch()
  return (
    <div className="px-6 py-8 md:px-12">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">{search.q ? `Recherche « ${search.q} »` : 'Explorer le catalogue'}</h1>
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
      <div className="mb-8 h-9 w-56 animate-pulse rounded-lg bg-neutral-900" />
      <ul className={GRID} aria-busy="true" aria-label="Chargement">
        {Array.from({ length: Math.min(SEARCH_PAGE_SIZE, 18) }).map((_, i) => (
          <li key={i}>
            <MovieCardSkeleton />
            <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-neutral-800" />
          </li>
        ))}
      </ul>
    </div>
  )
}
