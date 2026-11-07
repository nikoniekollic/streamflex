import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Check, ListPlus, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { addToPlaylist, createPlaylist, listPlaylists, playlistsContaining, removeFromPlaylist, type Playlist } from '@/lib/playlists'

/** Bouton « Ajouter à une liste de lecture » : coche / décoche les listes du profil pour ce titre, ou en crée une. */
export function PlaylistMenu({ titleId, className, variant = 'icon' }: { titleId: string; className?: string; variant?: 'icon' | 'button' }) {
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile?.id
  const [lists, setLists] = useState<Playlist[] | null>(null)
  const [inside, setInside] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    if (!profileId) return
    try {
      const [l, c] = await Promise.all([listPlaylists(supabase, profileId), playlistsContaining(supabase, profileId, titleId)])
      setLists(l)
      setInside(c)
    } catch (e) {
      toast.error('Listes indisponibles', { description: (e as Error).message })
    }
  }

  const toggle = async (p: Playlist) => {
    setBusy(p.id)
    try {
      if (inside.has(p.id)) {
        await removeFromPlaylist(supabase, p.id, titleId)
        setInside((s) => (s.delete(p.id), new Set(s)))
        toast(`Retiré de « ${p.name} »`)
      } else {
        await addToPlaylist(supabase, p.id, [titleId])
        setInside((s) => new Set(s).add(p.id))
        toast.success(`Ajouté à « ${p.name} »`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const name = window.prompt('Nom de la nouvelle liste de lecture')?.trim()
    if (!name || !profileId) return
    try {
      const id = await createPlaylist(supabase, profileId, name)
      await addToPlaylist(supabase, id, [titleId])
      toast.success(`Liste « ${name} » créée`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <DropdownMenu onOpenChange={(o) => o && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Ajouter à une liste de lecture"
          title="Ajouter à une liste de lecture"
          className={cn(
            variant === 'button'
              ? 'flex h-11 items-center gap-2 rounded-md bg-neutral-500/60 px-6 text-base font-semibold text-white hover:bg-neutral-500/40 md:h-12'
              : 'flex size-8 items-center justify-center rounded-full border-2 border-neutral-300 bg-black/60 text-white backdrop-blur-sm transition-all hover:scale-110 hover:border-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none',
            className,
          )}
        >
          <ListPlus className={variant === 'button' ? 'size-6' : 'size-4'} strokeWidth={2.5} />
          {variant === 'button' && 'Liste de lecture'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Ajouter à une liste</DropdownMenuLabel>
        {lists === null && (
          <div className="flex justify-center p-3">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {lists?.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Aucune liste pour l’instant.</p>}
        {lists?.map((p) => (
          <DropdownMenuItem
            key={p.id}
            disabled={busy === p.id}
            onSelect={(e) => {
              e.preventDefault() // le menu reste ouvert : on peut cocher plusieurs listes
              void toggle(p)
            }}
          >
            <Check className={cn('size-4', inside.has(p.id) ? 'opacity-100' : 'opacity-0')} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{p.count}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void create()}>
          <Plus className="size-4" /> Nouvelle liste…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
