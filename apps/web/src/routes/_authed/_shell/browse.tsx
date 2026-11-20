import { gridPageSize } from '@/lib/screen'
import { PlayList } from '@/components/catalog/PlayList'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SelectModeButton, SelectOverlay, SelectionBar, useVideoSelection } from '@/components/catalog/VideoSelection'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { RandomPlayButton } from '@/components/catalog/RandomPlay'
import { MovieCard } from '@/components/catalog/MovieCard'
import { FilterPanel, type PanelValue } from '@/components/catalog/FilterPanel'
import { hasVideoFilters, queryVideos, validateFilters, type VideoFilters } from '@/lib/search'

type BrowseSearch = VideoFilters & { q?: string; model?: string; page?: number }
const UUID = /^[0-9a-f-]{36}$/i


export const Route = createFileRoute('/_authed/_shell/browse')({
  validateSearch: (s: Record<string, unknown>): BrowseSearch => {
    const p = Number(s.page)
    const q = typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 100) : undefined
    const model = typeof s.model === 'string' && UUID.test(s.model) ? s.model : undefined
    return { ...validateFilters(s), ...(q ? { q } : {}), ...(model ? { model } : {}), ...(Number.isInteger(p) && p > 1 ? { page: p } : {}) }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { page = 1, ...f } = deps
    const per = gridPageSize() // lignes complètes, selon le nombre de colonnes de cet écran
    const { titles, total } = await queryVideos(context.supabase, f, { limit: per, offset: (page - 1) * per, kids: context.isKids })
    return { titles, total, page, per }
  },
  staleTime: 5 * 60_000,
  component: Browse,
})

function Browse() {
  const { titles, total, page, per } = Route.useLoaderData()
  const sel = useVideoSelection(titles)
  const search = Route.useSearch()
  const navigate = useNavigate()
  const go = (p: BrowseSearch) => void navigate({ to: '/browse', search: { ...p, page: p.page && p.page > 1 ? p.page : undefined } })
  const apply = (v: PanelValue) => go({ q: v.q, sort: v.sort, min: v.min, max: v.max, exact: v.exact, model: v.model })
  const pages = Math.max(1, Math.ceil(total / per))
  return (
    <section className="px-6 py-10 md:px-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          Catalogue <span className="text-sm font-normal text-muted-foreground">{total} vidéo{total > 1 ? 's' : ''}{hasVideoFilters(search) || search.q ? ' (filtrées)' : ''}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <SelectModeButton sel={sel} />
          <RandomPlayButton label="Catalogue" />
        </div>
      </div>
      <SelectionBar sel={sel} />
      <FilterPanel value={search} onApply={apply} showQuery showModel queryPlaceholder="Rechercher dans le catalogue…" />
      {titles.length === 0 ? (
        <p className="text-muted-foreground">{hasVideoFilters(search) || search.q ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucun titre publié pour le moment.'}</p>
      ) : (
        <PlayList titles={titles} label={'Catalogue'}>
<ul className="sf-grid">
          {titles.map((t) => (
            <li key={t.id} className="relative">
              <MovieCard title={t} />
              <SelectOverlay sel={sel} id={t.id} title={t.title} />
            </li>
          ))}
        </ul>
</PlayList>
      )}
      <PaginationBar page={page} pages={pages} onPage={(p) => go({ ...search, page: p })} />
    </section>
  )
}
