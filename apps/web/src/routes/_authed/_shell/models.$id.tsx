import { PlayList } from '@/components/catalog/PlayList'
import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link, createFileRoute, notFound, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { flushDurationReports, requestDurations, useDurationProgress } from '@/lib/duration-probe'
import { MovieCard } from '@/components/catalog/MovieCard'
import { PaginationBar } from '@/components/ui/pagination-bar'
import { FilterPanel, type PanelValue } from '@/components/catalog/FilterPanel'
import { ClearMarks } from '@/components/catalog/ClearMarks'
import { RandomPlayButton } from '@/components/catalog/RandomPlay'
import { VerifyFilesButton } from '@/components/admin/VerifyFilesButton'
import { SelectModeButton, SelectOverlay, SelectionBar, useVideoSelection } from '@/components/catalog/VideoSelection'
import { hasVideoFilters, validateFilters, type VideoFilters } from '@/lib/search'
import { fetchModelPage } from '@/lib/model-catalog'
import { gridPageSize } from '@/lib/screen'
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
    const r = await fetchModelPage(context.supabase, params.id, page ?? 1, f, gridPageSize())
    if (!r.model) throw notFound()
    return { ...r, model: r.model }
  },
  staleTime: 5 * 60_000,
  component: ModelPage,
})

function ModelPage() {
  const { model, titles, total, page, per } = Route.useLoaderData()
  const { names } = useSiteSettings()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const filtered = hasVideoFilters(search) || !!search.q
  const go = (p: ModelSearch) => void navigate({ to: '/models/$id', params: { id: model.id }, search: { ...p, page: p.page && p.page > 1 ? p.page : undefined } })
  const apply = (v: PanelValue) => go({ q: v.q, sort: v.sort, min: v.min, max: v.max, exact: v.exact })
  const s = modelNameStyle(model.name, names)
  const pages = Math.max(1, Math.ceil(total / per))
  const byLength = search.sort === 'longest' || search.sort === 'shortest' || search.min != null || search.max != null
  const durations = useModelRealDurations(model.id, byLength, search.sort === 'shortest')
  const sel = useVideoSelection(titles)
  const { supabase: sb } = Route.useRouteContext()
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
          <SelectModeButton sel={sel} />
          {sel.canSelect && <VerifyFilesButton supabase={sb} scope={{ modelId: model.id }} label={model.name} />}
        </div>
      </div>
      <SelectionBar sel={sel} />
      <FilterPanel value={search} onApply={apply} showQuery queryPlaceholder={`Rechercher dans les vidéos de ${model.name}…`} />
      {durations.pending > 0 && (
        <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Lecture des durées réelles : {durations.total - durations.pending} / {durations.total}
          {byLength ? ' — le tri par durée sera recalculé à la fin.' : ''}
        </p>
      )}
      {titles.length === 0 ? (
        <p className="text-muted-foreground">{filtered ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucune vidéo publiée pour ce modèle.'}</p>
      ) : (
        <PlayList titles={titles} label={model.name}>
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

/**
 * Vidéos du modèle dont la base ne connaît pas la durée réelle (seulement estimée d'après la taille du fichier) : elles sont
 * toutes lues, puis la page est rechargée si elle est triée ou filtrée par durée — l'ordre suit alors les vraies durées.
 */
function useModelRealDurations(modelId: string, byLength: boolean, shortestFirst: boolean) {
  const router = useRouter()
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    let off = false
    setIds([])
    void (async () => {
      // d'abord celles que le tri place en tête (estimation la plus longue / la plus courte) : la 1re page se corrige vite
      const list: string[] = []
      for (let from = 0; from < 6000 && !off; from += 1000) {
        const { data, error } = await (supabase as unknown as SupabaseClient)
          .from('titles')
          .select('id')
          .eq('model_id', modelId)
          .eq('is_published', true)
          .eq('type', 'movie')
          .is('duration_s', null)
          .order('len_key', { ascending: shortestFirst, nullsFirst: false })
          .order('id')
          .range(from, from + 999)
        if (error) break
        list.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
        if ((data?.length ?? 0) < 1000) break
      }
      if (off) return
      requestDurations(list, true)
      setIds(list)
    })()
    return () => {
      off = true
    }
  }, [modelId, shortestFirst])
  const { pending } = useDurationProgress(ids)
  const before = useRef(0)
  const latest = useRef(byLength)
  latest.current = byLength
  // longue lecture : l'ordre est recalculé toutes les 45 s avec les durées déjà lues
  const reading = pending > 0
  useEffect(() => {
    if (!reading) return
    const t = setInterval(() => {
      if (latest.current) void flushDurationReports().then(() => router.invalidate({ filter: (m) => m.routeId === Route.id }))
    }, 45_000)
    return () => clearInterval(t)
  }, [reading, router])
  useEffect(() => {
    // fin de la lecture : nouvel ordre d'après les durées réelles (enregistrées en base quelques secondes après la lecture)
    if (before.current > 0 && pending === 0 && latest.current) {
      before.current = 0
      void flushDurationReports().then(() => router.invalidate({ filter: (m) => m.routeId === Route.id }))
    }
    before.current = pending
  }, [pending, router])
  return { total: ids.length, pending }
}
