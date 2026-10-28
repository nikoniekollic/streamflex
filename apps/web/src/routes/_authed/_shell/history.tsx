import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { History, Loader2, Play, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { MovieCard, MovieCardSkeleton } from '@/components/catalog/MovieCard'
import { formatTime } from '@/lib/stream'
import {
  RESUME_MAX,
  clearHistory,
  episodeLabel,
  fetchHistory,
  removeFromHistory,
  resumeAt,
  toCatalogTitle,
  watchedAgo,
  type HistoryItem,
} from '@/lib/history'

const GRID = 'grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const Route = createFileRoute('/_authed/_shell/history')({
  validateSearch: (s: Record<string, unknown>): { page?: number } => {
    const p = Number(s.page)
    return Number.isInteger(p) && p > 1 && p <= 10 ? { page: p } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ context, deps }) => fetchHistory(context.supabase, context.activeProfile!.id, deps.page),
  staleTime: 0,
  pendingMs: 150,
  pendingComponent: () => (
    <div className="px-6 py-8 md:px-12">
      <h1 className="mb-8 text-2xl font-bold md:text-3xl">Historique</h1>
      <ul className={GRID} aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="grid gap-2">
            <MovieCardSkeleton variant="backdrop" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-800" />
          </li>
        ))}
      </ul>
    </div>
  ),
  component: HistoryPage,
})

function HistoryPage() {
  const { items, total, hasMore } = Route.useLoaderData()
  const { page = 1 } = Route.useSearch()
  const { supabase, activeProfile } = Route.useRouteContext()
  const profileId = activeProfile!.id
  const router = useRouter()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [clearing, setClearing] = useState(false)
  const [open, setOpen] = useState(false)

  const visible = items.filter((i) => !removed.has(i.title_id))

  const remove = async (h: HistoryItem) => {
    setRemoved((s) => new Set(s).add(h.title_id))
    try {
      await removeFromHistory(supabase, profileId, h.title_id)
      toast(`« ${h.title} » retiré de l'historique`)
      void router.invalidate()
    } catch (e) {
      setRemoved((s) => {
        const n = new Set(s)
        n.delete(h.title_id)
        return n
      })
      toast.error('Suppression impossible', { description: (e as Error).message })
    }
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      await clearHistory(supabase, profileId)
      setOpen(false)
      toast.success('Historique vidé')
      await router.invalidate()
    } catch (e) {
      toast.error('Impossible de vider l’historique', { description: (e as Error).message })
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold md:text-3xl">Historique</h1>
          <span className="text-sm text-muted-foreground">{activeProfile!.name}</span>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              {total} titre{total > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {visible.length > 0 && (
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <Trash2 /> Vider l'historique
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Vider tout l'historique ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Les positions de lecture de {total} titre{total > 1 ? 's' : ''} seront effacées et « Reprendre la lecture » sera vide.
                  Cette action est définitive.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={clearing}>Annuler</AlertDialogCancel>
                <Button variant="destructive" onClick={() => void clearAll()} disabled={clearing}>
                  {clearing && <Loader2 className="animate-spin" />} Vider
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <History className="size-14 text-neutral-600" />
          <h2 className="text-xl font-semibold">Aucun visionnage pour le moment</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Les films et séries que tu lances apparaîtront ici, avec ta progression.</p>
          <Button asChild variant="secondary">
            <Link to="/">Découvrir le catalogue</Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className={GRID}>
            {visible.map((h) => {
              const done = h.ratio > RESUME_MAX
              const at = resumeAt(h)
              const ep = episodeLabel(h)
              return (
                <li key={h.title_id} className="group/item relative">
                  <MovieCard
                    title={toCatalogTitle(h)}
                    variant="backdrop"
                    progress={h.duration_seconds ? h.ratio : undefined}
                    watch={{ episode: h.episode_id, t: at }}
                    favorite={false}
                    caption={ep}
                  />
                  <button
                    type="button"
                    onClick={() => void remove(h)}
                    aria-label={`Retirer ${h.title} de l'historique`}
                    title="Retirer de l'historique"
                    className="absolute top-2 right-2 z-20 flex size-8 items-center justify-center rounded-full border border-white/40 bg-black/70 text-white opacity-0 backdrop-blur-sm transition hover:border-white hover:bg-black focus-visible:opacity-100 group-hover/item:opacity-100 max-md:opacity-100"
                  >
                    <X className="size-4" />
                  </button>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to="/title/$slug" params={{ slug: h.slug }} className="block truncate font-medium hover:underline">
                        {h.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {ep ? `${ep} · ` : ''}
                        {watchedAgo(h.updated_at)}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      {done ? (
                        'Terminé'
                      ) : (
                        <>
                          <Play className="size-3 fill-current" />
                          {formatTime(at)}
                          {h.duration_seconds ? ` / ${formatTime(h.duration_seconds)}` : ''}
                        </>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          {hasMore && (
            <div className="mt-10 flex justify-center">
              <Button asChild variant="secondary" size="lg">
                <Link to="/history" search={{ page: page + 1 }} replace resetScroll={false}>
                  Afficher plus
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
