import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ModelCard } from '@/components/catalog/ModelCard'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { ClearMarks } from '@/components/catalog/ClearMarks'
import { MODELS_PER_PAGE, MODEL_SORTS, fetchPublicModels, validModelSort, type ModelSort } from '@/lib/model-catalog'
import { ArrowDownUp, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

type ModelsSearch = { page?: number; sort?: ModelSort; q?: string }

export const Route = createFileRoute('/_authed/_shell/models/')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  validateSearch: (s: Record<string, unknown>): ModelsSearch => {
    const p = Number(s.page)
    const sort = validModelSort(s.sort)
    const q = typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 80) : undefined
    return { ...(Number.isInteger(p) && p > 1 ? { page: p } : {}), ...(sort ? { sort } : {}), ...(q ? { q } : {}) }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => ({ ...(await fetchPublicModels(context.supabase, deps.page ?? 1, MODELS_PER_PAGE, { sort: deps.sort, q: deps.q })), page: deps.page ?? 1 }),
  staleTime: 5 * 60_000,
  component: ModelsPage,
})

function ModelsPage() {
  const { models, total, page } = Route.useLoaderData()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const go = (p: ModelsSearch) => void navigate({ to: '/models', search: { ...p, page: p.page && p.page > 1 ? p.page : undefined }, replace: true })
  const [q, setQ] = useState(search.q ?? '')
  useEffect(() => setQ(search.q ?? ''), [search.q])
  // filtre par nom : appliqué en tapant (après une courte pause)
  useEffect(() => {
    if ((search.q ?? '') === q.trim()) return
    const t = setTimeout(() => go({ sort: search.sort, q: q.trim() || undefined }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const pages = Math.max(1, Math.ceil(total / MODELS_PER_PAGE))
  return (
    <section className="px-6 py-10 md:px-12">
      <h1 className="mb-1 text-2xl font-bold">Modèles</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {total} modèle{total > 1 ? 's' : ''}
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un modèle…"
            aria-label="Rechercher un modèle"
            className="h-10 w-full rounded-md border border-white/10 bg-neutral-900 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-white/40"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <ArrowDownUp className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Trier par</span>
          <select
            value={search.sort ?? 'most'}
            onChange={(e) => go({ q: search.q, sort: validModelSort(e.target.value) })}
            className="h-10 rounded-md border border-white/10 bg-neutral-900 px-2 text-sm text-white"
            aria-label="Trier les modèles"
          >
            {MODEL_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <ClearMarks />
      </div>
      {models.length === 0 ? (
        <p className="text-muted-foreground">{search.q ? `Aucun modèle ne correspond à « ${search.q} ».` : 'Aucun modèle pour le moment.'}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {models.map((m) => (
            <li key={m.id}>
              <ModelCard model={m} />
            </li>
          ))}
        </ul>
      )}
      <PaginationBar page={page} pages={pages} onPage={(p) => go({ ...search, page: p })} />
    </section>
  )
}
