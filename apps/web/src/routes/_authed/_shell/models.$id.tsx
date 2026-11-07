import { Link, createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { MovieCard } from '@/components/catalog/MovieCard'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { TITLES_PER_PAGE, fetchModelPage } from '@/lib/model-catalog'
import { modelNameStyle } from '@/lib/cover'
import { useSiteSettings } from '@/lib/site-settings'

export const Route = createFileRoute('/_authed/_shell/models/$id')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  validateSearch: (s: Record<string, unknown>): { page?: number } => {
    const p = Number(s.page)
    return Number.isInteger(p) && p > 1 ? { page: p } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ context, params, deps }) => {
    const r = await fetchModelPage(context.supabase, params.id, deps.page)
    if (!r.model) throw notFound()
    return { ...r, model: r.model }
  },
  staleTime: 5 * 60_000,
  component: ModelPage,
})

function ModelPage() {
  const { model, titles, total, page } = Route.useLoaderData()
  const { names } = useSiteSettings()
  const navigate = useNavigate()
  const s = modelNameStyle(model.name, names)
  const pages = Math.max(1, Math.ceil(total / TITLES_PER_PAGE))
  return (
    <section className="px-6 py-10 md:px-12">
      <Link to="/models" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="size-4" /> Tous les modèles
      </Link>
      <div className="mb-6 flex items-center gap-4">
        {model.image_url && <img src={model.image_url} alt="" className="size-20 rounded-full object-cover ring-2 ring-white/20" />}
        <div>
          <h1
            className="leading-tight"
            style={{
              fontFamily: s.fontFamily,
              fontWeight: s.fontWeight,
              fontStyle: s.fontStyle,
              textTransform: s.textTransform,
              letterSpacing: s.letterSpacing,
              color: s.color,
              textShadow: `0 0 18px ${s.glow}`,
              fontSize: '2rem',
            }}
          >
            {model.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {total} vidéo{total > 1 ? 's' : ''}
          </p>
        </div>
      </div>
      {titles.length === 0 ? (
        <p className="text-muted-foreground">Aucune vidéo publiée pour ce modèle.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {titles.map((t) => (
            <li key={t.id}>
              <MovieCard title={t} />
            </li>
          ))}
        </ul>
      )}
      <PaginationBar
        page={page}
        pages={pages}
        onPage={(p) => void navigate({ to: '/models/$id', params: { id: model.id }, search: p > 1 ? { page: p } : {} })}
      />
    </section>
  )
}
