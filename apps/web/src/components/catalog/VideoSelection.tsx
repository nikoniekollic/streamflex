// Sélection de vidéos pour les supprimer (admin) : pages Catalogue et Modèle.
// La sélection est gardée d'une page à l'autre (voir lib/selection) : on coche page après page, le compteur s'additionne,
// puis « Supprimer » efface tout d'un coup, sur le site ET chez 1fichier (corbeille 30 jours).
import { useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, Circle, ListChecks, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSelection } from '@/lib/selection'
import { adminErrorMessage, bulkDelete } from '@/lib/admin'

// Mode sélection : gardé d'une page à l'autre et au rechargement de l'onglet, comme la sélection elle-même
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

export type VideoSelection = ReturnType<typeof useVideoSelection>

/** État de la sélection pour les vidéos affichées sur cette page. */
export function useVideoSelection(titles: { id: string }[]) {
  const { supabase, isAdmin, isKids } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const canSelect = isAdmin && !isKids
  const [mode, setModeState] = useState(readMode)
  const selecting = canSelect && mode
  const [selected, setSelected] = useSelection()
  const [working, setWorking] = useState(false)
  const allOnPage = titles.length > 0 && titles.every((t) => selected.has(t.id))
  return {
    canSelect,
    selecting,
    selected,
    working,
    allOnPage,
    pageCount: titles.length,
    setMode: (on: boolean) => {
      saveMode(on)
      setModeState(on)
    },
    clear: () => setSelected(new Set()),
    toggle: (id: string) =>
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    togglePage: () =>
      setSelected((s) => {
        const n = new Set(s)
        for (const t of titles) {
          if (allOnPage) n.delete(t.id)
          else n.add(t.id)
        }
        return n
      }),
    remove: async () => {
      const ids = [...selected]
      if (!ids.length) return
      if (!window.confirm(`Supprimer ${ids.length} vidéo(s) du site ET leurs fichiers chez 1fichier ? Les fichiers restent 30 jours dans la corbeille 1fichier ; sur le site, c’est définitif.`)) return
      setWorking(true)
      try {
        await bulkDelete(supabase, ids)
        toast.success(`Supprimé${ids.length > 1 ? 's' : ''} : ${ids.length} vidéo${ids.length > 1 ? 's' : ''}`)
        setSelected(new Set())
      } catch (e) {
        toast.error(adminErrorMessage(e))
      } finally {
        await router.invalidate()
        setWorking(false)
      }
    },
  }
}

/** Bouton « Sélectionner » / « Terminer la sélection » (admin seulement). */
export function SelectModeButton({ sel }: { sel: VideoSelection }) {
  if (!sel.canSelect) return null
  return (
    <Button variant={sel.selecting ? 'secondary' : 'outline'} size="sm" onClick={() => sel.setMode(!sel.selecting)}>
      {sel.selecting ? <X /> : <ListChecks />} {sel.selecting ? 'Terminer la sélection' : 'Sélectionner'}
    </Button>
  )
}

/** Barre de sélection (reste visible en défilant) : tout sélectionner, compteur cumulé, supprimer. */
export function SelectionBar({ sel }: { sel: VideoSelection }) {
  if (!sel.selecting) return null
  const n = sel.selected.size
  return (
    <div className="sticky top-16 z-40 mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur">
      <Button size="sm" variant="outline" disabled={sel.pageCount === 0 || sel.working} onClick={sel.togglePage}>
        {sel.allOnPage ? 'Désélectionner cette page' : 'Tout sélectionner (cette page)'}
      </Button>
      <span className="text-sm text-muted-foreground">
        {n > 0
          ? `${n} vidéo${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''} au total — passe à la page suivante pour en ajouter`
          : 'Clique sur les vidéos pour les sélectionner'}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {n > 0 && (
          <Button size="sm" variant="ghost" disabled={sel.working} onClick={sel.clear}>
            Tout désélectionner
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={sel.working || n === 0} onClick={() => void sel.remove()}>
          {sel.working ? <Loader2 className="animate-spin" /> : <Trash2 />} Supprimer ({n})
        </Button>
      </div>
    </div>
  )
}

/** Calque posé sur une vignette en mode sélection : un clic coche / décoche au lieu de lancer la vidéo. */
export function SelectOverlay({ sel, id, title }: { sel: VideoSelection; id: string; title: string }) {
  if (!sel.selecting) return null
  const on = sel.selected.has(id)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? 'Désélectionner' : 'Sélectionner'} ${title}`}
      onClick={() => sel.toggle(id)}
      className={cn('absolute inset-0 z-30 rounded-md ring-inset transition', on ? 'bg-primary/25 ring-4 ring-primary' : 'bg-black/10 hover:bg-black/30')}
    >
      <span className="absolute left-2 top-2 rounded-full bg-black/70 p-0.5">
        {on ? <CheckCircle2 className="size-6 text-primary" /> : <Circle className="size-6 text-white" />}
      </span>
    </button>
  )
}
