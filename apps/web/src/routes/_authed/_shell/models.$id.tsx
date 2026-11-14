import { PlayList } from '@/components/catalog/PlayList'
import { Link, createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { MovieCard } from '@/components/catalog/MovieCard'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { FilterPanel, type PanelValue } from '@/components/catalog/FilterPanel'
import { ClearMarks } from '@/components/catalog/ClearMarks'
import { RandomPlayButton } from '@/components/catalog/RandomPlay'
import { hasVideoFilters, validateFilters, type VideoFilters } from '@/lib/search'
import { TITLES_PER_PAGE, fetchModelPage } from '@/lib/model-catalog'
import { modelNameStyle } from '@/lib/cover'
import { useSiteSettings } from '@/lib/site-settings'

type ModelSearch = VideoFilters & { q?: string; page?: number }

export const Route = createFileRoute('/_authed/_shell/models/$id')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  validateSearch: (s: Record<string, unknown>): ModelSearch => {
    const p = Number(s.page)
    const q = typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 100) : undefined
    return { ...validateFilters(s), ...(q ? { q } : {}), ...(Number.isInteger(p) && p > 1 ? { page: p } : {}) }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    const { page, ...f } = deps
    const r = await fetchModelPage(context.supabase, params.id, page ?? 1, f)
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
  const search = Route.useSearch()
  const filtered = hasVideoFilters(search) || !!search.q
  const go = (p: ModelSearch) => void navigate({ to: '/models/$id', params: { id: model.id }, search: { ...p, page: p.page && p.page > 1 ? p.page : undefined } })
  const apply = (v: PanelValue) => go({ q: v.q, sort: v.sort, min: v.min, max: v.max, exact: v.exact })
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
            {filtered && ' (filtrées)'}
          </p>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RandomPlayButton label={model.name} modelId={model.id} />
          <ClearMarks modelId={model.id} modelName={model.name} />
        </div>
      </div>
      <FilterPanel value={search} onApply={apply} showQuery queryPlaceholder={`Rechercher dans les vidéos de ${model.name}…`} />
      {titles.length === 0 ? (
        <p className="text-muted-foreground">{filtered ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucune vidéo publiée pour ce modèle.'}</p>
      ) : (
        <PlayList titles={titles} label={model.name}>
<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {titles.map((t) => (
            <li key={t.id}>
              <MovieCard title={t} />
            </li>
          ))}
        </ul>
</PlayList>
      )}
      <PaginationBar page={page} pages={pages} onPage={(p) => go({ ...search, page: p })} />
    </section>
  )
}
