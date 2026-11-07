import { PlayList } from '@/components/catalog/PlayList'
import { Link, createFileRoute, notFound, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MovieCard } from '@/components/catalog/MovieCard'
import { PlayListButtons } from '@/components/catalog/RandomPlay'
import { deletePlaylist, fetchPlaylist, removeFromPlaylist, renamePlaylist } from '@/lib/playlists'

export const Route = createFileRoute('/_authed/_shell/playlists/$id')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  loader: async ({ context, params }) => {
    const r = await fetchPlaylist(context.supabase, params.id)
    if (!r.playlist) throw notFound()
    return { playlist: r.playlist, titles: r.titles }
  },
  staleTime: 0,
  component: PlaylistPage,
})

function PlaylistPage() {
  const { playlist, titles } = Route.useLoaderData()
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const navigate = useNavigate()

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <section className="px-6 py-10 md:px-12">
      <Link to="/playlists" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="size-4" /> Toutes les listes
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{playlist.name}</h1>
        <span className="text-sm text-muted-foreground">
          {titles.length} vidéo{titles.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PlayListButtons label={playlist.name} ids={titles.map((t) => t.id)} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const n = window.prompt('Nouveau nom', playlist.name)?.trim()
              if (n && n !== playlist.name) void run(() => renamePlaylist(supabase, playlist.id, n), 'Liste renommée')
            }}
          >
            <Pencil /> Renommer
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => {
              if (!window.confirm(`Supprimer la liste « ${playlist.name} » ? Les vidéos ne sont pas supprimées.`)) return
              void run(() => deletePlaylist(supabase, playlist.id), 'Liste supprimée').then(() => navigate({ to: '/playlists' }))
            }}
          >
            <Trash2 /> Supprimer
          </Button>
        </div>
      </div>

      {titles.length === 0 ? (
        <p className="text-muted-foreground">Cette liste est vide. Ajoute des vidéos avec le bouton « liste » de chaque jaquette.</p>
      ) : (
        <PlayList titles={titles} label={playlist.name}>
<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {titles.map((t) => (
            <li key={t.id} className="relative">
              <MovieCard title={t} />
              <button
                type="button"
                aria-label={`Retirer ${t.title} de la liste`}
                title="Retirer de la liste"
                onClick={() => void run(() => removeFromPlaylist(supabase, playlist.id, t.id))}
                className="absolute bottom-2 left-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
</PlayList>
      )}
    </section>
  )
}
