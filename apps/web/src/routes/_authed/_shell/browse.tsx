import { gridPageSize } from '@/lib/screen'
import { PlayList } from '@/components/catalog/PlayList'
import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, Circle, ListChecks, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSelection } from '@/lib/selection'
import { adminErrorMessage, bulkDelete } from '@/lib/admin'
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

// Mode sélection (admin) : gardé d'une page à l'autre et au rechargement de l'onglet, comme la sélection elle-même
const MODE_KEY = 'sf:browse-select-mode:v1'
function readMode(): boolean {
  try {
    return sessionStorage.getItem(MODE_KEY) === '1'
  } catch {
    return false
  }
}
function saveMode(on: boolean) {
  try {
    if (on) sessionStorage.setItem(MODE_KEY, '1')
    else sessionStorage.removeItem(MODE_KEY)
  } catch {
    /* stockage indisponible : le mode reste actif jusqu'au rechargement */
  }
}

function Browse() {
  const { titles, total, page, per } = Route.useLoaderData()
  const { supabase, isAdmin, isKids } = Route.useRouteContext()
  const router = useRouter()
  const canSelect = isAdmin && !isKids
  const [mode, setModeState] = useState(readMode)
  const selecting = canSelect && mode
  const setMode = (on: boolean) => {
    saveMode(on)
    setModeState(on)
  }
  const [selected, setSelected] = useSelection()
  const [working, setWorking] = useState(false)
  const allOnPage = titles.length > 0 && titles.every((t) => selected.has(t.id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s)
      for (const t of titles) {
        if (allOnPage) n.delete(t.id)
        else n.add(t.id)
      }
      return n
    })
  const remove = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Supprimer ${ids.length} vidéo(s) du site ET leurs fichiers chez 1fichier ? Les fichiers restent 30 jours dans la corbeille 1fichier ; sur le site, c’est définitif.`)) return
    setWorking(true)
    try {
      await bulkDelete(supabase, ids)
      toast.success(`Supprimé${ids.length > 1 ? 's' : ''} : ${ids.length} vidéo${ids.length > 1 ? 's' : ''}`)
      setSelected(new Set())
      await router.invalidate()
    } catch (e) {
      toast.error(adminErrorMessage(e))
      await router.invalidate()
    } finally {
      setWorking(false)
    }
  }
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
          {canSelect && (
            <Button variant={selecting ? 'secondary' : 'outline'} size="sm" onClick={() => setMode(!selecting)}>
              {selecting ? <X /> : <ListChecks />} {selecting ? 'Terminer la sélection' : 'Sélectionner'}
            </Button>
          )}
          <RandomPlayButton label="Catalogue" />
        </div>
      </div>
      {selecting && (
        // sélection page après page : le compteur s'additionne d'une page à l'autre, puis tout est supprimé d'un coup
        <div className="sticky top-16 z-40 mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur">
          <Button size="sm" variant="outline" disabled={titles.length === 0 || working} onClick={togglePage}>
            {allOnPage ? 'Désélectionner cette page' : 'Tout sélectionner (cette page)'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} vidéo${selected.size > 1 ? 's' : ''} sélectionnée${selected.size > 1 ? 's' : ''} au total — passe à la page suivante pour en ajouter`
              : 'Clique sur les vidéos pour les sélectionner'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" disabled={working} onClick={() => setSelected(new Set())}>
                Tout désélectionner
              </Button>
            )}
            <Button size="sm" variant="destructive" disabled={working || selected.size === 0} onClick={() => void remove()}>
              {working ? <Loader2 className="animate-spin" /> : <Trash2 />} Supprimer ({selected.size})
            </Button>
          </div>
        </div>
      )}
      <FilterPanel value={search} onApply={apply} showQuery showModel queryPlaceholder="Rechercher dans le catalogue…" />
      {titles.length === 0 ? (
        <p className="text-muted-foreground">{hasVideoFilters(search) || search.q ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucun titre publié pour le moment.'}</p>
      ) : (
        <PlayList titles={titles} label={'Catalogue'}>
<ul className="sf-grid">
          {titles.map((t) => (
            <li key={t.id} className="relative">
              <MovieCard title={t} />
              {selecting && (
                // en mode sélection, un clic sur la vignette coche / décoche au lieu de lancer la vidéo
                <button
                  type="button"
                  aria-pressed={selected.has(t.id)}
                  aria-label={`${selected.has(t.id) ? 'Désélectionner' : 'Sélectionner'} ${t.title}`}
                  onClick={() => toggle(t.id)}
                  className={cn(
                    'absolute inset-0 z-30 rounded-md ring-inset transition',
                    selected.has(t.id) ? 'bg-primary/25 ring-4 ring-primary' : 'bg-black/10 hover:bg-black/30',
                  )}
                >
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 p-0.5">
                    {selected.has(t.id) ? <CheckCircle2 className="size-6 text-primary" /> : <Circle className="size-6 text-white" />}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
</PlayList>
      )}
      <PaginationBar page={page} pages={pages} onPage={(p) => go({ ...search, page: p })} />
    </section>
  )
}
