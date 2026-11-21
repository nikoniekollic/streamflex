import { gridPageSize } from '@/lib/screen'
import { PlayList } from '@/components/catalog/PlayList'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SelectModeButton, SelectOverlay, SelectionBar, useSelecting, useVideoSelection } from '@/components/catalog/VideoSelection'
import { useInfiniteTitles } from '@/components/catalog/useInfiniteTitles'
import { Loader2 } from 'lucide-react'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { RandomPlayButton } from '@/components/catalog/RandomPlay'
import { MovieCard } from '@/components/catalog/MovieCard'
import { FilterPanel, type PanelValue } from '@/components/catalog/FilterPanel'
import { hasVideoFilters, queryVideos, validateFilters, videoCount, type VideoFilters } from '@/lib/search'

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
  const search = Route.useSearch()
  const { supabase, isKids } = Route.useRouteContext()
  const selecting = useSelecting()
  const pagesAll = Math.max(1, Math.ceil(total / per))
  // mode sélection : les pages suivantes s'ajoutent en défilant (plus de pagination)
  const { page: _p, ...filters } = search
  const inf = useInfiniteTitles(selecting, titles, page, pagesAll, `${JSON.stringify(filters)}|${page}|${per}`, (p) =>
    queryVideos(supabase, filters, { limit: per, offset: (p - 1) * per, kids: isKids }).then((r) => r.titles),
  )
  const list = inf.items
  const sel = useVideoSelection(list, (ids, how) => {
    if (how.deleted || (filters.model && how.modelId !== filters.model)) inf.drop(ids)
  })
  const navigate = useNavigate()
  const go = (p: BrowseSearch) => void navigate({ to: '/browse', search: { ...p, page: p.page && p.page > 1 ? p.page : undefined } })
  const apply = (v: PanelValue) => go({ q: v.q, sort: v.sort, min: v.min, max: v.max, exact: v.exact, model: v.model })
  const pages = Math.max(1, Math.ceil(total / per))
  return (
    <section className="px-6 py-10 md:px-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          Catalogue <span className="text-sm font-normal text-muted-foreground">{videoCount(total)}{hasVideoFilters(search) || search.q ? ' (filtrées)' : ''}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <SelectModeButton sel={sel} />
          <RandomPlayButton label="Catalogue" />
        </div>
      </div>
      <SelectionBar sel={sel} />
      <FilterPanel value={search} onApply={apply} showQuery showModel queryPlaceholder="Rechercher dans le catalogue…" />
      {list.length === 0 ? (
        <p className="text-muted-foreground">{hasVideoFilters(search) || search.q ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucun titre publié pour le moment.'}</p>
      ) : (
        <PlayList titles={list} label={'Catalogue'}>
<ul className="sf-grid">
          {list.map((t) => (
            <li key={t.id} className="relative">
              <MovieCard title={t} />
              <SelectOverlay sel={sel} id={t.id} title={t.title} />
            </li>
          ))}
        </ul>
</PlayList>
      )}
      {selecting ? (
        <div ref={inf.sentinel} className="flex justify-center py-8 text-sm text-muted-foreground">
          {inf.done ? `Fin de la liste — ${list.length} vidéo${list.length > 1 ? 's' : ''} affichée${list.length > 1 ? 's' : ''}` : <Loader2 className="size-5 animate-spin" />}
        </div>
      ) : (
        <PaginationBar page={page} pages={pages} onPage={(p) => go({ ...search, page: p })} />
      )}
    </section>
  )
}
