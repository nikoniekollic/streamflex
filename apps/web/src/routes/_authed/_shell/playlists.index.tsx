import { useState, type FormEvent } from 'react'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ListMusic, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RandomPlayButton } from '@/components/catalog/RandomPlay'
import { createPlaylist, listPlaylists } from '@/lib/playlists'

export const Route = createFileRoute('/_authed/_shell/playlists/')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true })
  },
  loader: ({ context }) => listPlaylists(context.supabase, context.activeProfile!.id),
  staleTime: 0,
  component: PlaylistsPage,
})

function PlaylistsPage() {
  const lists = Route.useLoaderData()
  const { supabase, activeProfile } = Route.useRouteContext()
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !activeProfile) return
    setBusy(true)
    try {
      await createPlaylist(supabase, activeProfile.id, name)
      setName('')
      await router.invalidate()
      toast.success('Liste créée')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="px-6 py-10 md:px-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Listes de lecture</h1>
        <RandomPlayButton label="Tout le catalogue" size="default" />
      </div>

      <form onSubmit={create} className="mb-8 flex max-w-md gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nouvelle liste…" aria-label="Nom de la liste" />
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Créer
        </Button>
      </form>

      {lists.length === 0 ? (
        <p className="text-muted-foreground">Aucune liste. Crée-en une, puis ajoute des vidéos avec le bouton « liste » de chaque jaquette.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lists.map((p) => (
            <li key={p.id}>
              <Link
                to="/playlists/$id"
                params={{ id: p.id }}
                className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-white/40"
              >
                <ListMusic className="size-8 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.count} vidéo{p.count > 1 ? 's' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
