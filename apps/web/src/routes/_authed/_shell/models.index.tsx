import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ModelCard } from '@/components/catalog/ModelCard'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { ClearMarks } from '@/components/catalog/ClearMarks'
import { MODELS_PER_PAGE, fetchPublicModels } from '@/lib/model-catalog'

export const Route = createFileRoute('/_authed/_shell/models/')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  validateSearch: (s: Record<string, unknown>): { page?: number } => {
    const p = Number(s.page)
    return Number.isInteger(p) && p > 1 ? { page: p } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ context, deps }) => ({ ...(await fetchPublicModels(context.supabase, deps.page)), page: deps.page }),
  staleTime: 5 * 60_000,
  component: ModelsPage,
})

function ModelsPage() {
  const { models, total, page } = Route.useLoaderData()
  const navigate = useNavigate()
  const pages = Math.max(1, Math.ceil(total / MODELS_PER_PAGE))
  return (
    <section className="px-6 py-10 md:px-12">
      <h1 className="mb-1 text-2xl font-bold">Modèles</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {total} modèle{total > 1 ? 's' : ''}
      </p>
      <div className="mb-6">
        <ClearMarks />
      </div>
      {models.length === 0 ? (
        <p className="text-muted-foreground">Aucun modèle pour le moment.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {models.map((m) => (
            <li key={m.id}>
              <ModelCard model={m} />
            </li>
          ))}
        </ul>
      )}
      <PaginationBar page={page} pages={pages} onPage={(p) => void navigate({ to: '/models', search: p > 1 ? { page: p } : {} })} />
    </section>
  )
}
