import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MovieCard, MovieCardSkeleton } from '@/components/catalog/MovieCard'
import { fetchMyList, useFavorites } from '@/lib/favorites'

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'

export const Route = createFileRoute('/_authed/_shell/my-list')({
  loader: ({ context }) => fetchMyList(context.supabase, context.activeProfile!.id),
  staleTime: 0,
  pendingMs: 150,
  pendingComponent: () => (
    <div className="px-6 py-8 md:px-12">
      <h1 className="mb-8 text-2xl font-bold md:text-3xl">Ma liste</h1>
      <ul className={GRID} aria-busy="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i}>
            <MovieCardSkeleton />
          </li>
        ))}
      </ul>
    </div>
  ),
  component: MyList,
})

function MyList() {
  const titles = Route.useLoaderData()
  const { ids, loaded } = useFavorites()
  // un titre retiré disparaît immédiatement (annulable via le toast)
  const visible = loaded ? titles.filter((t) => ids.has(t.id)) : titles

  return (
    <div className="px-6 py-8 md:px-12">
      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="text-2xl font-bold md:text-3xl">Ma liste</h1>
        {visible.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {visible.length} titre{visible.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border-2 border-neutral-600">
            <Plus className="size-8 text-neutral-500" />
          </span>
          <h2 className="text-xl font-semibold">Ta liste est vide</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ajoute des films et séries avec le bouton <Plus className="inline size-4" /> pour les retrouver ici.
          </p>
          <Button asChild variant="secondary">
            <Link to="/search">Explorer le catalogue</Link>
          </Button>
        </div>
      ) : (
        <ul className={GRID}>
          {visible.map((t) => (
            <li key={t.id}>
              <MovieCard title={t} />
              <p className="mt-2 line-clamp-1 text-sm text-neutral-300">{t.title}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
