import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { SortSelect } from '@/components/catalog/SortSelect'
import { orderSpec, validSort, type SortKey } from '@/lib/sort'
import { MovieCard } from '@/components/catalog/MovieCard'
import type { CatalogTitle } from '@/lib/catalog'

const PAGE = 48

export const Route = createFileRoute('/_authed/_shell/browse')({
  validateSearch: (s: Record<string, unknown>): { page?: number; sort?: SortKey } => {
    const p = Number(s.page)
    const sort = validSort(s.sort)
    return { ...(Number.isInteger(p) && p > 1 ? { page: p } : {}), ...(sort ? { sort } : {}) }
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, sort: search.sort }),
  loader: async ({ context, deps }) => {
    const from = (deps.page - 1) * PAGE
    let q = context.supabase
      .from('titles')
      .select('id, type, slug, title, synopsis, release_year, runtime_minutes, maturity_rating, poster_url, backdrop_url, logo_url, published_at', { count: 'exact' })
    for (const o of orderSpec(deps.sort)) q = q.order(o.column, o)
    const { data, error, count } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    const titles: CatalogTitle[] = rows.map((t) => ({ ...t, genres: [] }))
    return { titles, total: count ?? titles.length, page: deps.page }
  },
  staleTime: 5 * 60_000,
  component: Browse,
})

function Browse() {
  const { titles, total, page } = Route.useLoaderData()
  const { sort } = Route.useSearch()
  const navigate = useNavigate()
  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <section className="px-6 py-10 md:px-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Catalogue</h1>
        <SortSelect value={sort} onChange={(v) => void navigate({ to: '/browse', search: v ? { sort: v } : {} })} />
      </div>
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
      <PaginationBar page={page} pages={pages} onPage={(p) => void navigate({ to: '/browse', search: { ...(p > 1 ? { page: p } : {}), ...(sort ? { sort } : {}) } })} />
    </section>
  )
}
