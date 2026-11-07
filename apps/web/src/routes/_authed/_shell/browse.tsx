import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { MovieCard } from '@/components/catalog/MovieCard'
import type { CatalogTitle } from '@/lib/catalog'

const PAGE = 48

export const Route = createFileRoute('/_authed/_shell/browse')({
  validateSearch: (s: Record<string, unknown>): { page?: number } => {
    const p = Number(s.page)
    return Number.isInteger(p) && p > 1 ? { page: p } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ context, deps }) => {
    const from = (deps.page - 1) * PAGE
    const { data, error } = await context.supabase
      .from('titles')
      .select('id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at', { count: 'exact' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE) // PAGE + 1 lignes : la dernière indique « page suivante »
    if (error) throw error
    const rows = data ?? []
    const titles: CatalogTitle[] = rows.slice(0, PAGE).map((t) => ({ ...t, genres: [] }))
    return { titles, hasNext: rows.length > PAGE, page: deps.page }
  },
  component: Browse,
})

function Browse() {
  const { titles, hasNext, page } = Route.useLoaderData()
  return (
    <section className="px-6 py-10 md:px-12">
      <h1 className="mb-6 text-2xl font-bold">Catalogue</h1>
      {titles.length === 0 ? (
        <p className="text-muted-foreground">Aucun titre publié pour le moment.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {titles.map((t) => (
            <li key={t.id}>
              <MovieCard title={t} />
            </li>
          ))}
        </ul>
      )}
      {(page > 1 || hasNext) && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 && (
            <Button asChild variant="secondary">
              <Link to="/browse" search={page > 2 ? { page: page - 1 } : {}}>
                Précédent
              </Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">Page {page}</span>
          {hasNext && (
            <Button asChild variant="secondary">
              <Link to="/browse" search={{ page: page + 1 }}>
                Suivant
              </Link>
            </Button>
          )}
        </nav>
      )}
    </section>
  )
}
